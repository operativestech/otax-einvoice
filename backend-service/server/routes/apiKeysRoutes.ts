/**
 * API Keys — let integrators (ERPs, POS, custom scripts) call OTax programmatically
 * without going through the portal JWT flow.
 *
 * How it works:
 *   1. An org admin creates a key via POST /api/admin/api-keys with a name + scope.
 *      The server returns the plaintext key ONCE (e.g. `otax_live_a1b2c3…`). The
 *      user copies it; the DB only stores a SHA-256 hash + the 8-char prefix so
 *      listing keys later doesn't expose the full secret.
 *   2. Integrators call protected endpoints with `X-API-Key: otax_live_a1b2c3…`.
 *      The `apiKeyAuth` middleware (mounted alongside / before `authenticate`)
 *      looks up the hash, checks the scope, and populates `req.user` so the
 *      rest of the app sees the call as an authenticated admin of that org.
 *   3. `last_used_at` updates on every successful call (fire-and-forget).
 *
 * Scopes:
 *   read    — GET endpoints (invoices, reports, master data)
 *   write   — read + POST endpoints (create invoices, customers)
 *   admin   — write + mutate settings (create further API keys, etc.)
 *
 * Key revocation is instant: the check consults the DB on every call. No cache.
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { authenticate, blockDemo, logActivity } from '../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

function getPool(req: Request): pg.Pool { return (req as any).app.get('pool'); }

// ──────────────────────────────────────────────────────────────────────
// Schema bootstrap — creates the `otaxdb.api_keys` table on first call.
// Cheap enough to run lazily rather than wiring into initDbSchema.
// ──────────────────────────────────────────────────────────────────────
let schemaReady = false;
async function ensureSchema(pool: pg.Pool): Promise<void> {
    if (schemaReady) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "otaxdb".api_keys (
                id              SERIAL PRIMARY KEY,
                organization_id INTEGER NOT NULL,
                name            VARCHAR(100) NOT NULL,
                key_hash        CHAR(64) NOT NULL UNIQUE,       -- SHA-256 hex
                key_prefix      VARCHAR(32) NOT NULL,           -- first chars of the plaintext key (display only)
                scope           VARCHAR(16) NOT NULL DEFAULT 'read',   -- 'read' | 'write' | 'admin'
                created_by      INTEGER,
                created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
                last_used_at    TIMESTAMP,
                expires_at      TIMESTAMP,
                is_active       BOOLEAN  NOT NULL DEFAULT TRUE
            );
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_org ON "otaxdb".api_keys(organization_id, is_active);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON "otaxdb".api_keys(key_hash);`);
        // Per-key rate limit (requests/minute). NULL → use DEFAULT_RATE_LIMIT below.
        // Idempotent so older deployments pick it up on next boot.
        await pool.query(`ALTER TABLE "otaxdb".api_keys ADD COLUMN IF NOT EXISTS rate_limit_per_min INTEGER`);
        schemaReady = true;
    } catch (e: any) {
        console.warn('[ApiKeys] ensureSchema failed (non-fatal):', e.message);
    }
}

function hashKey(plaintext: string): string {
    return crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/**
 * Generate a new API key. Format: `otax_<env>_<28-char-random>`.
 * Using a URL-safe base62 alphabet so the key can be pasted into .env files
 * and headers without escaping. 28 random chars → ~166 bits, plenty for a secret.
 */
function generatePlaintextKey(): string {
    const env = String(process.env.NODE_ENV || '').toLowerCase() === 'production' ? 'live' : 'test';
    const bytes = crypto.randomBytes(21); // base62 of 21 bytes is ~28 chars
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let random = '';
    for (const b of bytes) random += alphabet[b % 62];
    return `otax_${env}_${random}`;
}

/**
 * Express middleware — looks up an API key in `X-API-Key` header, populates
 * `req.user` with a synthesised session if valid. Usage in server.ts:
 *
 *   app.use(apiKeyAuth);  // mounts alongside authenticate(); either can succeed
 *
 * Does NOT reject requests that don't carry the header — that's `authenticate`'s
 * job. We just provide an alternative authentication path.
 */
export function apiKeyAuth(pool: pg.Pool) {
    return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        const raw = req.headers['x-api-key'] || req.headers['X-Api-Key'];
        const keyHeader = Array.isArray(raw) ? raw[0] : raw;
        if (!keyHeader || typeof keyHeader !== 'string' || !keyHeader.startsWith('otax_')) return next();

        try {
            await ensureSchema(pool);
            const hash = hashKey(keyHeader);
            const r = await pool.query(
                `SELECT ak.*, o.name AS org_name
                 FROM "otaxdb".api_keys ak
                 LEFT JOIN "otaxdb".organizations o ON o.id = ak.organization_id
                 WHERE ak.key_hash = $1 AND ak.is_active = TRUE
                   AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
                 LIMIT 1`,
                [hash]
            );
            if (r.rows.length === 0) return next(); // invalid key — let authenticate reject
            const key = r.rows[0];

            // Populate req.user so downstream routes see an authenticated admin of that org
            (req as any).user = {
                id: key.created_by || 0,
                username: `api_key:${key.name}`,
                email: null,
                organizationId: key.organization_id,
                organizationName: key.org_name,
                role: key.scope === 'admin' ? 'admin' : 'user',
                permissions: scopeToPermissions(String(key.scope || 'read')),
                isSuperAdmin: false,
                isOrgAdmin: key.scope === 'admin',
                isApiKey: true,
                apiKeyId: Number(key.id),
                apiKeyScope: key.scope,
                apiKeyRateLimitPerMin: key.rate_limit_per_min ? Number(key.rate_limit_per_min) : null,
            };

            // Fire-and-forget last-used update. Skipping on read errors so a slow
            // DB write never stalls the real request.
            pool.query(`UPDATE "otaxdb".api_keys SET last_used_at = NOW() WHERE id = $1`, [key.id]).catch(() => {});
        } catch (e: any) {
            console.warn('[ApiKeys] middleware error:', e.message);
        }
        next();
    };
}

/** Translate a scope string into the existing permission strings used by `authorize()`. */
function scopeToPermissions(scope: string): string[] {
    switch (scope) {
        case 'admin':
            return [
                'dashboard.view', 'invoices.view', 'invoices.create',
                'reports.view', 'masterdata.view', 'masterdata.edit',
                'settings.view', 'settings.edit', 'signing.view', 'org_users.view',
                'api_keys.manage',
            ];
        case 'write':
            return [
                'dashboard.view', 'invoices.view', 'invoices.create',
                'reports.view', 'masterdata.view', 'masterdata.edit', 'signing.view',
            ];
        case 'read':
        default:
            return ['dashboard.view', 'invoices.view', 'reports.view', 'masterdata.view', 'signing.view'];
    }
}

// ══════════════════════════════════════════════════════════════════════
// Per-API-key rate limiting (sliding-window, in-memory).
//
// Why in-memory:  Rate-limit decisions need <1 ms latency on the hot path.
//                 An in-memory sliding-window beats a DB roundtrip for that.
//                 Single-process accuracy is fine for our SaaS scale; if we
//                 ever scale to multiple Node processes we'll swap the
//                 backing store for Redis (the API surface stays identical).
// Why per-key:    The pre-existing global limiters (`etaLimiter`, `bulkLimiter`)
//                 throttle the whole org. A noisy customer integration could
//                 starve quieter ones — per-key buckets isolate them.
// Defaults:       60 req/min unless the key sets `rate_limit_per_min` to a
//                 different value. 0 → unlimited (admin override).
// Window cleanup: We trim each key's window in O(k) on every request, where k
//                 is the number of requests in the last 60s. We additionally
//                 sweep idle keys every 5 minutes to bound memory.
// ══════════════════════════════════════════════════════════════════════

const DEFAULT_RATE_LIMIT_PER_MIN = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const buckets = new Map<number, number[]>();
let lastSweepAt = 0;

export function apiKeyRateLimit() {
    return (req: Request, res: Response, next: NextFunction): void => {
        const u = (req as any).user;
        if (!u?.isApiKey || !u.apiKeyId) return next();

        // 0 means "unlimited" — explicit opt-out for trusted internal keys.
        const limitPerMin = u.apiKeyRateLimitPerMin ?? DEFAULT_RATE_LIMIT_PER_MIN;
        if (limitPerMin === 0) return next();

        const now = Date.now();
        const windowStart = now - RATE_LIMIT_WINDOW_MS;

        let window = buckets.get(u.apiKeyId);
        if (!window) { window = []; buckets.set(u.apiKeyId, window); }
        // Drop timestamps that have slid out of the window
        while (window.length > 0 && window[0] < windowStart) window.shift();

        // Idle-key sweep — every 5 minutes, drop empty buckets so a churn of
        // short-lived keys doesn't leak memory.
        if (now - lastSweepAt > 5 * 60_000) {
            lastSweepAt = now;
            for (const [k, w] of buckets) {
                while (w.length > 0 && w[0] < windowStart) w.shift();
                if (w.length === 0) buckets.delete(k);
            }
        }

        if (window.length >= limitPerMin) {
            const retryAfterSec = Math.max(1, Math.ceil((window[0] + RATE_LIMIT_WINDOW_MS - now) / 1000));
            res.set('Retry-After', String(retryAfterSec));
            res.set('X-RateLimit-Limit', String(limitPerMin));
            res.set('X-RateLimit-Remaining', '0');
            res.set('X-RateLimit-Reset', String(Math.ceil((window[0] + RATE_LIMIT_WINDOW_MS) / 1000)));
            res.status(429).json({
                success: false,
                message: `API key rate limit exceeded — ${limitPerMin} requests/minute. Retry in ${retryAfterSec}s.`,
                retryAfter: retryAfterSec,
            });
            return;
        }
        window.push(now);
        res.set('X-RateLimit-Limit', String(limitPerMin));
        res.set('X-RateLimit-Remaining', String(Math.max(0, limitPerMin - window.length)));
        next();
    };
}

/** Block API keys from hitting an endpoint (e.g. account deletion). */
export function blockApiKey(req: Request, res: Response, next: NextFunction) {
    if ((req as any).user?.isApiKey) {
        return res.status(403).json({ success: false, message: 'API keys are not allowed on this endpoint.' });
    }
    next();
}

// ══════════════════════════════════════════════════════════════════════
// Admin routes — JWT-only (api keys can't create more api keys unless
// they're `admin` scope, which we allow via the authorize check).
// ══════════════════════════════════════════════════════════════════════

/** GET /api/admin/api-keys — list all keys for the caller's org (hash hidden). */
router.get('/', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const orgId = (req as any).user?.organizationId;
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const r = await pool.query(
            `SELECT id, name, key_prefix, scope, created_by, created_at, last_used_at, expires_at, is_active, rate_limit_per_min
             FROM "otaxdb".api_keys
             WHERE organization_id = $1
             ORDER BY is_active DESC, created_at DESC`,
            [orgId]
        );
        res.json({ success: true, rows: r.rows, defaultRateLimitPerMin: 60 });
    } catch (err: any) {
        console.error('[ApiKeys] list error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/admin/api-keys — create a new key. Returns the plaintext key
 * ONCE in the response. The caller is responsible for storing it — we don't.
 */
router.post('/', authenticate, blockDemo, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const user = (req as any).user;
        const orgId = user?.organizationId;
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        // An API key creating another API key must itself have admin scope.
        if (user.isApiKey && user.apiKeyScope !== 'admin') {
            return res.status(403).json({ success: false, message: 'Only admin-scope API keys can create other keys.' });
        }

        const { name, scope, expiresAt, rateLimitPerMin } = req.body || {};
        const cleanName = String(name || '').trim().slice(0, 100);
        const cleanScope = ['read', 'write', 'admin'].includes(String(scope)) ? String(scope) : 'read';
        if (!cleanName) return res.status(400).json({ success: false, message: 'Name is required.' });

        // Parse expiresAt if given, else leave NULL (never-expiring).
        let expiresDate: Date | null = null;
        if (expiresAt) {
            const d = new Date(expiresAt);
            if (!isNaN(d.getTime())) expiresDate = d;
        }

        // Per-key rate limit. NULL → server default (60 req/min). 0 → unlimited.
        // We cap the upper bound so a misconfigured key can't act like no limit.
        let cleanRateLimit: number | null = null;
        if (rateLimitPerMin !== undefined && rateLimitPerMin !== null && rateLimitPerMin !== '') {
            const n = parseInt(String(rateLimitPerMin), 10);
            if (!isNaN(n) && n >= 0 && n <= 100000) cleanRateLimit = n;
        }

        const plaintext = generatePlaintextKey();
        const hash = hashKey(plaintext);
        const prefix = plaintext.slice(0, 16); // "otax_live_Xxxxxx"

        const inserted = await pool.query(
            `INSERT INTO "otaxdb".api_keys (organization_id, name, key_hash, key_prefix, scope, created_by, expires_at, rate_limit_per_min)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, name, key_prefix, scope, created_at, expires_at, rate_limit_per_min`,
            [orgId, cleanName, hash, prefix, cleanScope, user.id || null, expiresDate, cleanRateLimit]
        );

        logActivity(user.id, user.username, 'api_key_created', 'admin', 'api_keys', String(inserted.rows[0].id), { name: cleanName, scope: cleanScope, rateLimitPerMin: cleanRateLimit }, req).catch(() => {});

        res.json({
            success: true,
            // This is the ONLY time we emit the plaintext key. Frontend must copy it now.
            key: plaintext,
            keyDetails: inserted.rows[0],
        });
    } catch (err: any) {
        console.error('[ApiKeys] create error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PATCH /api/admin/api-keys/:id — adjust rate limit (no key rotation).
 * Body: { rateLimitPerMin: number | null }   // NULL → use server default, 0 → unlimited
 */
router.patch('/:id', authenticate, blockDemo, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const user = (req as any).user;
        const orgId = user?.organizationId;
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const { rateLimitPerMin } = req.body || {};
        let cleanRateLimit: number | null = null;
        if (rateLimitPerMin !== undefined && rateLimitPerMin !== null && rateLimitPerMin !== '') {
            const n = parseInt(String(rateLimitPerMin), 10);
            if (isNaN(n) || n < 0 || n > 100000) {
                return res.status(400).json({ success: false, message: 'rateLimitPerMin must be 0–100000' });
            }
            cleanRateLimit = n;
        }

        const r = await pool.query(
            `UPDATE "otaxdb".api_keys SET rate_limit_per_min = $1
             WHERE id = $2 AND organization_id = $3
             RETURNING id, name, scope, rate_limit_per_min`,
            [cleanRateLimit, id, orgId]
        );
        if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'Key not found.' });

        logActivity(user.id, user.username, 'api_key_rate_limit_updated', 'admin', 'api_keys', String(id), { rateLimitPerMin: cleanRateLimit }, req).catch(() => {});
        res.json({ success: true, keyDetails: r.rows[0] });
    } catch (err: any) {
        console.error('[ApiKeys] patch error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/** DELETE /api/admin/api-keys/:id — revoke (soft delete). Instant effect. */
router.delete('/:id', authenticate, blockDemo, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const user = (req as any).user;
        const orgId = user?.organizationId;
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const r = await pool.query(
            `UPDATE "otaxdb".api_keys SET is_active = FALSE WHERE id = $1 AND organization_id = $2 RETURNING id, name`,
            [id, orgId]
        );
        if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'Key not found.' });
        logActivity(user.id, user.username, 'api_key_revoked', 'admin', 'api_keys', String(id), { name: r.rows[0].name }, req).catch(() => {});
        res.json({ success: true });
    } catch (err: any) {
        console.error('[ApiKeys] revoke error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
