/**
 * webhookDispatcher — outbound webhook delivery with retry queue.
 *
 * Customers register one or more URLs they want OTax to call when interesting
 * events happen (invoice submitted, sync completed, etc). This module owns:
 *
 *   1. Persistence schema for subscriptions + delivery attempts
 *   2. `enqueue()` helper used by anywhere in the codebase that wants to fire
 *      an event — fan-outs to every matching subscription as a row in
 *      `webhook_deliveries` with status='pending'
 *   3. Background worker (`startWebhookDispatcher`) that polls deliveries,
 *      POSTs each one to the customer's URL, signs with per-subscription
 *      HMAC-SHA256, and records the response. On failure, schedules the
 *      next retry using exponential backoff (1m → 5m → 30m → 2h → 12h).
 *
 * Why a separate table instead of a node-side queue:
 *   - Survives restarts (no in-memory state)
 *   - Multi-instance safe (the worker uses SELECT … FOR UPDATE SKIP LOCKED)
 *   - Auditable: ops can SELECT * FROM webhook_deliveries WHERE status='failed'
 *
 * Tuning:
 *   POLL_INTERVAL_MS   how often the worker checks for due deliveries
 *   MAX_ATTEMPTS       give up after this many tries (status → 'failed')
 *   TIMEOUT_MS         hard ceiling per HTTP attempt
 */

import pg from 'pg';
import crypto from 'crypto';

const POLL_INTERVAL_MS = 15_000;     // 15 s — quick enough for "instant" feel, cheap on the DB
const MAX_ATTEMPTS = 6;
const TIMEOUT_MS = 10_000;           // 10 s per HTTP attempt
// Backoff schedule in seconds, indexed by attempt number (1-based):
const RETRY_DELAY_SECONDS = [60, 300, 1800, 7200, 43200, 86400]; // 1m, 5m, 30m, 2h, 12h, 24h
const MAX_BODY_LOG_BYTES = 2000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let schemaReady = false;

// ─── Schema bootstrap ────────────────────────────────────────────────────

async function ensureSchema(pool: pg.Pool): Promise<void> {
    if (schemaReady) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "otaxdb".webhook_subscriptions (
                id              SERIAL PRIMARY KEY,
                organization_id INTEGER NOT NULL,
                url             VARCHAR(2000) NOT NULL,
                events          TEXT[] NOT NULL DEFAULT '{}'::text[],   -- empty array means "all events"
                signing_secret  VARCHAR(128) NOT NULL,
                is_active       BOOLEAN NOT NULL DEFAULT TRUE,
                created_by      INTEGER,
                created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
                last_used_at    TIMESTAMP,
                description     VARCHAR(255)
            );
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_webhook_subs_org ON "otaxdb".webhook_subscriptions(organization_id, is_active);`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS "otaxdb".webhook_deliveries (
                id                BIGSERIAL PRIMARY KEY,
                subscription_id   INTEGER NOT NULL REFERENCES "otaxdb".webhook_subscriptions(id) ON DELETE CASCADE,
                organization_id   INTEGER NOT NULL,
                event_type        VARCHAR(80) NOT NULL,
                payload           JSONB NOT NULL,
                status            VARCHAR(16) NOT NULL DEFAULT 'pending',     -- pending | success | failed
                attempts          INTEGER NOT NULL DEFAULT 0,
                next_attempt_at   TIMESTAMP NOT NULL DEFAULT NOW(),
                last_status_code  INTEGER,
                last_response     TEXT,
                last_error        TEXT,
                created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
                completed_at      TIMESTAMP
            );
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending ON "otaxdb".webhook_deliveries(status, next_attempt_at) WHERE status = 'pending';`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org ON "otaxdb".webhook_deliveries(organization_id, created_at DESC);`);

        schemaReady = true;
    } catch (e: any) {
        console.warn('[WebhookDispatcher] ensureSchema:', e.message);
    }
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Enqueue an outbound event for every active subscription on this org that
 * matches the event type filter. Returns the number of deliveries scheduled
 * (for caller logging — not awaited per-delivery).
 *
 * Best-effort: a DB hiccup here MUST NOT fail the parent operation. Callers
 * should wrap with `.catch(() => 0)` if they care about the result.
 */
export async function enqueueWebhookEvent(
    pool: pg.Pool,
    orgId: number,
    eventType: string,
    payload: any
): Promise<number> {
    await ensureSchema(pool);
    const subs = await pool.query<{ id: number }>(
        `SELECT id FROM "otaxdb".webhook_subscriptions
         WHERE organization_id = $1 AND is_active = TRUE
           AND (cardinality(events) = 0 OR $2 = ANY(events))`,
        [orgId, eventType]
    );
    if (subs.rowCount === 0) return 0;

    // Standard envelope around the caller's payload — gives every webhook a
    // predictable shape regardless of which event it carries.
    const envelope = {
        eventId: crypto.randomUUID(),
        eventType,
        organizationId: orgId,
        timestamp: new Date().toISOString(),
        data: payload,
    };

    let count = 0;
    for (const s of subs.rows) {
        await pool.query(
            `INSERT INTO "otaxdb".webhook_deliveries
                (subscription_id, organization_id, event_type, payload, status, attempts, next_attempt_at)
             VALUES ($1, $2, $3, $4::jsonb, 'pending', 0, NOW())`,
            [s.id, orgId, eventType, JSON.stringify(envelope)]
        ).catch(e => console.warn('[WebhookDispatcher] enqueue insert:', e.message));
        count++;
    }
    return count;
}

/**
 * Boot the background worker. Returns a stop handle for clean shutdown.
 * No-op if `WEBHOOK_DISPATCHER=off` is set in the environment.
 */
export function startWebhookDispatcher(pool: pg.Pool): { stop: () => void } {
    if (String(process.env.WEBHOOK_DISPATCHER || '').toLowerCase() === 'off') {
        console.log('[WebhookDispatcher] Disabled via WEBHOOK_DISPATCHER=off.');
        return { stop: () => { } };
    }
    if (timer) return { stop: () => stopWebhookDispatcher() };

    console.log(`[WebhookDispatcher] starting (poll every ${POLL_INTERVAL_MS / 1000}s, max attempts ${MAX_ATTEMPTS})`);
    timer = setInterval(() => {
        if (running) return;
        running = true;
        tick(pool).catch(e => console.warn('[WebhookDispatcher] tick:', e.message))
                  .finally(() => { running = false; });
    }, POLL_INTERVAL_MS);
    // Fire one tick shortly after boot so backlog isn't queued for 15 s.
    setTimeout(() => { if (!running) { running = true; tick(pool).finally(() => { running = false; }); } }, 5_000);
    return { stop: () => stopWebhookDispatcher() };
}

export function stopWebhookDispatcher(): void {
    if (timer) { clearInterval(timer); timer = null; console.log('[WebhookDispatcher] stopped'); }
}

// ─── Worker loop ─────────────────────────────────────────────────────────

interface DeliveryRow {
    id: string;
    subscription_id: number;
    organization_id: number;
    event_type: string;
    payload: any;
    attempts: number;
    url: string;
    signing_secret: string;
}

async function tick(pool: pg.Pool): Promise<void> {
    await ensureSchema(pool);

    // Atomically claim up to N pending+due deliveries. SKIP LOCKED keeps
    // us safe if multiple Node processes ever run this loop in parallel.
    const claimed = await pool.query<DeliveryRow>(`
        WITH due AS (
            SELECT d.id
            FROM "otaxdb".webhook_deliveries d
            WHERE d.status = 'pending' AND d.next_attempt_at <= NOW()
            ORDER BY d.next_attempt_at ASC
            LIMIT 25
            FOR UPDATE SKIP LOCKED
        )
        UPDATE "otaxdb".webhook_deliveries d
            SET attempts = d.attempts + 1
        FROM due, "otaxdb".webhook_subscriptions s
        WHERE d.id = due.id AND s.id = d.subscription_id
        RETURNING d.id, d.subscription_id, d.organization_id, d.event_type,
                  d.payload, d.attempts, s.url, s.signing_secret
    `);
    if (claimed.rowCount === 0) return;

    // Process in parallel, but cap concurrency to avoid hammering one slow
    // endpoint and starving others.
    const CONCURRENCY = 5;
    for (let i = 0; i < claimed.rows.length; i += CONCURRENCY) {
        const batch = claimed.rows.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(d => deliverOne(pool, d)));
    }
}

async function deliverOne(pool: pg.Pool, d: DeliveryRow): Promise<void> {
    const body = JSON.stringify(d.payload);
    const signature = crypto.createHmac('sha256', d.signing_secret).update(body, 'utf8').digest('hex');

    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    let statusCode: number | null = null;
    let responseSnippet: string | null = null;
    let errMsg: string | null = null;

    try {
        const r = await fetch(d.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'OTax-Webhooks/1',
                'X-OTax-Signature': signature,
                'X-OTax-Event': d.event_type,
                'X-OTax-Delivery': String(d.id),
            },
            body,
            signal: ctrl.signal,
        });
        statusCode = r.status;
        // Trim the response — we don't want a chatty endpoint to balloon our
        // delivery log row.
        const text = await r.text().catch(() => '');
        responseSnippet = text.slice(0, MAX_BODY_LOG_BYTES);

        if (r.ok) {
            await pool.query(
                `UPDATE "otaxdb".webhook_deliveries
                    SET status = 'success', last_status_code = $1, last_response = $2, last_error = NULL, completed_at = NOW()
                  WHERE id = $3`,
                [statusCode, responseSnippet, d.id]
            );
            await pool.query(
                `UPDATE "otaxdb".webhook_subscriptions SET last_used_at = NOW() WHERE id = $1`,
                [d.subscription_id]
            ).catch(() => { });
            return;
        }
        errMsg = `HTTP ${statusCode}`;
    } catch (e: any) {
        errMsg = e?.name === 'AbortError' ? `Timeout after ${TIMEOUT_MS}ms` : (e?.message || String(e));
    } finally {
        clearTimeout(timeoutId);
    }

    // Failure path — schedule a retry, or fail-permanent if we've burned all attempts.
    const nextAttempts = d.attempts; // attempts has already been incremented by the SELECT…UPDATE above
    if (nextAttempts >= MAX_ATTEMPTS) {
        await pool.query(
            `UPDATE "otaxdb".webhook_deliveries
                SET status = 'failed', last_status_code = $1, last_response = $2, last_error = $3, completed_at = NOW()
              WHERE id = $4`,
            [statusCode, responseSnippet, errMsg, d.id]
        );
        return;
    }
    const delaySec = RETRY_DELAY_SECONDS[Math.min(nextAttempts, RETRY_DELAY_SECONDS.length - 1)];
    await pool.query(
        `UPDATE "otaxdb".webhook_deliveries
            SET status = 'pending', last_status_code = $1, last_response = $2, last_error = $3,
                next_attempt_at = NOW() + ($4 || ' seconds')::interval
          WHERE id = $5`,
        [statusCode, responseSnippet, errMsg, String(delaySec), d.id]
    );
}
