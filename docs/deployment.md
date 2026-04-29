# OTax — Deployment & Operations Guide

> Last updated: 2026-04-18. Covers production deployment, required env vars, health monitoring, and common operations.

## 1. Architecture recap

| Component | Tech | Where |
|---|---|---|
| Frontend | Vite + React 18 + TS | `E-Invoice/` — builds to `dist/` (static) |
| Backend | Node 20 + Express + TS (via `tsx`) | `backend-service/` — single process |
| DB | PostgreSQL 17 | currently cloudclusters.net |
| Signing agent | C# .NET tray app | client PCs with USB tokens |
| AI (optional) | Gemini 2.0 Flash | Google Generative AI API |

The **backend is a single Node process** that hosts:
- All HTTP routes (`/api/*`)
- WebSocket server (`/api/bridge`) — connects to on-prem signing agents
- Background signing worker (polls every 15s)
- Schedule-driven ETA sync (per-org setting)

**Important consequence**: if you deploy 2+ backend instances behind a load balancer, the signing agent will only connect to ONE of them. The worker on other instances cannot reach the agent. **Deploy 1 backend instance until we move agent state to a shared store.**

---

## 2. Required environment variables

Create `backend-service/.env`:

```ini
# Database (required)
DB_HOST=<host>
DB_PORT=5432
DB_NAME=<db>
DB_USER=<user>
DB_PASS=<pass>
DATABASE_URL="postgresql://<user>:<pass>@<host>:<port>/<db>?schema=otaxdb"

# JWT (required) — MUST be long and random in production
JWT_SECRET=<at-least-32-chars-random>

# SMTP for OTP emails (required for signup flows)
SMTP_USER=<email>
SMTP_PASS=<app-password>
SMTP_FROM=<display-name>

# Optional — enable AI assistant with grounded tools
GEMINI_API_KEY=<google-ai-studio-key>

# Optional — turn off the background signing worker
SIGNING_WORKER=off
```

The backend also reads `backend-service/server/db_config.json` as a fallback. **Remove it in production** — env vars only. The current file contains plaintext creds that should be rotated before go-live.

Frontend `E-Invoice/.env.production`:
```ini
VITE_API_URL=https://api.yourdomain.com/api
```

---

## 3. First-time setup on a fresh server

```bash
# 1. Clone
git clone <repo> otax && cd otax

# 2. Backend
cd backend-service
npm ci
npx prisma generate
npm run start  # or: tsx server/server.ts

# 3. Frontend (separate build step; static files served from dist/)
cd ../E-Invoice
npm ci
npm run build
# serve dist/ via nginx, Vercel, Render, etc.
```

On first boot, `initDbSchema()` in `server/server.ts` auto-creates:
- `otaxdb.*` (credentials, portal_users, super_admins, permissions, roles, signing_queue, package_requests, organization_settings columns)
- `InvoicesDb` schema (dynamic per-org tables created on first user activity)
- Backfills composite document indexes for all active orgs

Permissions and role grants are idempotent (`ON CONFLICT DO NOTHING`), so reruns are safe.

---

## 4. Health check

**Endpoint**: `GET /api/health` (unauthenticated)

```json
{
  "status": "OK",          // "OK" | "DEGRADED" | "ERROR"
  "timestamp": "2026-04-18T19:00:00.000Z",
  "checks": {
    "db": { "ok": true, "time": "...", "database": "LoginDb" },
    "signingQueue": { "ok": true, "queued": 0, "processing": 0, "signed": 42, "failed": 0 },
    "agentBridge": { "connectedAgents": 1, "active": true },
    "features": { "signingWorker": true, "gemini": false },
    "uptimeSeconds": 3600,
    "nodeVersion": "v20.11.0"
  }
}
```

Status codes:
- `200` with status `OK` or `DEGRADED`
- `500` with status `ERROR` — DB unreachable

Wire to:
- Load balancer health check (prefer 200 as OK, flag non-200 for replacement)
- Uptime monitoring (Better Uptime, UptimeRobot, etc.)
- Grafana / Datadog for status dashboards

---

## 5. Backup & Disaster Recovery

**Current state**: Single PostgreSQL instance on cloudclusters.net. No scheduled backups, no tested restore procedure.

**Minimum required before go-live**:
1. Enable daily `pg_dump` to S3/Backblaze (any offsite)
2. Keep 30 days of dumps
3. Document a tested restore procedure
4. Move to a managed Postgres with point-in-time recovery (RDS, Neon, Supabase, Railway)

The schema is reproducible from `prisma/recreate_tables.sql` but **invoice data is not**. Per-org invoice tables + reconciliation data accumulate and cannot be reconstructed from ETA alone (reconciliation state, internal IDs, etc. are local).

---

## 6. Common operations

### Adding a new organization
Triggered automatically when a new user signs up. First API call for that org (e.g. sync start) creates `org_<id>_<slug>_documents`, `..._lines`, `..._item_codes`, `..._erp_transactions`, `..._bank_statements`, `..._matches` in the `InvoicesDb` schema.

### Giving a user explicit RBAC roles
The default auth path grants a broad `org_admin` permission set. To create a restricted role:
```sql
-- Create a "viewer" role
INSERT INTO "otaxdb".roles (name, display_name) VALUES ('viewer', 'View-only Access');

-- Grant only view permissions
INSERT INTO "otaxdb".role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM "otaxdb".roles r
CROSS JOIN "otaxdb".permissions p
WHERE r.name = 'viewer'
  AND p.name IN ('dashboard.view', 'invoices.view', 'reports.view', 'reconciliation.view');

-- Attach to a user (portal_users)
INSERT INTO "otaxdb".portal_user_roles (user_id, role_id)
SELECT 42, id FROM "otaxdb".roles WHERE name = 'viewer';
```

### Replaying a failed signing job
UI path: TopBar → click the red pill → Settings/Signing → pick FAILED → retry.
API path: `POST /api/signing/queue/:id/retry` with `signing.manage` permission.

### Clearing auto-match suggestions (nuke & re-run)
`runAutoMatch` already wipes prior SUGGESTED rows before writing new ones, so just re-run with the same date range.

### Rotating JWT secret
1. Set a new `JWT_SECRET` in `.env`
2. Restart backend
3. All existing tokens invalidate → users must re-login (no server state change needed)

### Moving off the shared cloud DB
1. Run `pg_dump` from current DB
2. `pg_restore` to new instance
3. Update `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DATABASE_URL` env vars
4. Restart backend — `initDbSchema` will verify schema on boot (idempotent)

---

## 7. Monitoring

What to watch in production:

| Signal | Alarm when |
|---|---|
| `/api/health` returns 500 | Immediate page |
| `signingQueue.failed > 10` | Email to ops — something systematic is wrong |
| `agentBridge.connectedAgents = 0` for >5 min (if org uses agent signing) | Notify org admin |
| `POST /api/eta/documents/submit` latency > 30s | Investigate ETA portal slowness |
| 429 rate limit hits > normal baseline | Someone/something spamming — check logs |
| Disk usage on Postgres (per-org document tables grow fast) | Alert at 80% |

Logs are currently `console.log`. Before scale, switch to `pino` + correlation IDs. See TODO in the hardening phase memo.

---

## 8. Known gaps for production

- **Plaintext DB credentials** in `db_config.json` + `.env` → move to secrets manager
- **No scheduled DB backups** → set up `pg_dump` cron or use managed Postgres
- **Single backend instance** (WebSocket state is in-memory) → fine for < 100 orgs, plan HA later
- **No rate limit on the baseline `/api/*`** — only hot endpoints. Add global `apiLimiter` when abuse shows up
- **xlsx library has historic CVEs** → monitor CVE feed for `xlsx` updates
- **`console.log` everywhere** → add `pino` with log rotation
