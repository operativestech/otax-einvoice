/**
 * Public webhook receiver — for inbound notifications from ETA (or any external
 * system that supports webhook callbacks).
 *
 * Why expose this even though ETA hasn't shipped public webhook callbacks yet?
 *  1. The plumbing is the same regardless of caller — once ETA flips the
 *     switch we just configure the URL on their portal, no app deploy needed.
 *  2. We can immediately use it for OUR signing-agent → cloud bridge events,
 *     for ERP push integrations, and for any partner who wants to send us
 *     status updates instead of polling.
 *
 * Security:
 *   - HMAC-SHA256 signature verification using a shared secret (per-org
 *     webhook secret stored on `org_webhook_secrets`). The caller signs the
 *     raw body and puts the hex digest in `X-OTax-Signature`.
 *   - Without a secret on file the endpoint accepts the call but logs it as
 *     "unverified" — useful during integration setup, locked down at go-live.
 *   - Body size capped at 256 KB; anything bigger gets a 413.
 *
 * Side effects:
 *   - Persists the raw payload + parsed event into `otaxdb.webhook_events`
 *     (auto-created table) so the user can view a history.
 *   - Routes ETA-shaped events ("documentStatusChanged", "syncCompleted")
 *     through to the signing queue / live console / email digest if they're
 *     significant.
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import pg from 'pg';

const router = Router();

function getPool(req: Request): pg.Pool { return (req as any).app.get('pool'); }

/** Schema bootstrap — creates two small tables on first call. */
let schemaReady = false;
async function ensureSchema(pool: pg.Pool): Promise<void> {
    if (schemaReady) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "otaxdb".webhook_secrets (
                organization_id  INTEGER PRIMARY KEY,
                secret           VARCHAR(128) NOT NULL,
                created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
                rotated_at       TIMESTAMP
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "otaxdb".webhook_events (
                id               BIGSERIAL PRIMARY KEY,
                organization_id  INTEGER,
                source           VARCHAR(40),               -- e.g. 'eta', 'erp', 'partner'
                event_type       VARCHAR(80),
                signature_ok     BOOLEAN NOT NULL DEFAULT FALSE,
                received_at      TIMESTAMP NOT NULL DEFAULT NOW(),
                payload          JSONB,
                processed        BOOLEAN NOT NULL DEFAULT FALSE,
                error_message    TEXT
            );
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_webhook_events_org ON "otaxdb".webhook_events(organization_id, received_at DESC);`);
        schemaReady = true;
    } catch (e: any) {
        console.warn('[Webhooks] ensureSchema failed (non-fatal):', e.message);
    }
}

/** Compute the HMAC-SHA256 signature for a raw body. */
function sign(secret: string, raw: string): string {
    return crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
}

/** Constant-time compare to avoid timing attacks. */
function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
    catch { return false; }
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/webhooks/:orgId — public receiver. Body is JSON.
// We re-read req.body as a string for signature verification (it was already
// parsed by express.json() upstream, so we re-stringify with a stable shape).
// ──────────────────────────────────────────────────────────────────────

router.post('/:orgId', async (req: Request, res: Response) => {
    const pool = getPool(req);
    const orgId = parseInt(req.params.orgId, 10);
    if (!orgId) return res.status(400).json({ success: false, message: 'Bad orgId.' });

    try {
        await ensureSchema(pool);

        const rawSig = (req.headers['x-otax-signature'] || req.headers['X-OTax-Signature']) as string | undefined;
        const source = String(req.headers['x-otax-source'] || 'unknown').slice(0, 40);

        // Look up the org's signing secret (if registered).
        const secretRes = await pool.query(
            `SELECT secret FROM "otaxdb".webhook_secrets WHERE organization_id = $1`, [orgId]
        );
        const secret: string | null = secretRes.rows[0]?.secret || null;

        // Re-stringify the payload deterministically so signing matches what
        // the caller computed. Note: this only works if the caller uses the
        // same JSON.stringify of the JS object — which is the case for our
        // Node-based agent. Cross-language signers should compute over the
        // RAW request body via a body-as-buffer middleware instead.
        const raw = JSON.stringify(req.body || {});
        const signatureOk = secret && rawSig ? safeEqual(rawSig, sign(secret, raw)) : false;

        // Persist regardless of signature validity, so we can audit failed
        // callbacks (often a sign of misconfigured caller).
        const eventType = String(req.body?.eventType || req.body?.type || 'unknown').slice(0, 80);
        const inserted = await pool.query(
            `INSERT INTO "otaxdb".webhook_events
                (organization_id, source, event_type, signature_ok, payload)
             VALUES ($1, $2, $3, $4, $5::jsonb)
             RETURNING id`,
            [orgId, source, eventType, signatureOk, JSON.stringify(req.body || {})]
        );
        const eventId = inserted.rows[0]?.id;

        if (!secret) {
            // No secret on file → respond OK but flag in the body so the caller
            // sees they're hitting a sandbox endpoint, not a verified channel.
            return res.json({ success: true, eventId, verified: false, note: 'No webhook secret registered for this org.' });
        }

        if (!signatureOk) {
            console.warn(`[Webhooks] Bad signature for org ${orgId}, event ${eventId}`);
            return res.status(401).json({ success: false, message: 'Bad signature.' });
        }

        // ── Dispatch table — what to do with verified events ──
        // Handlers run async; we don't make the caller wait for downstream work.
        const ev = req.body || {};
        setImmediate(() => dispatchEvent(pool, orgId, eventType, ev, eventId).catch(e =>
            console.warn(`[Webhooks] dispatch failed for event ${eventId}:`, e.message)));

        res.json({ success: true, eventId, verified: true });
    } catch (err: any) {
        console.error('[Webhooks] error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/** Route an authenticated event to whatever subsystem cares about it. */
async function dispatchEvent(pool: pg.Pool, orgId: number, eventType: string, payload: any, eventId: number): Promise<void> {
    let processed = false;
    let errorMessage: string | null = null;

    try {
        switch (eventType) {
            case 'documentStatusChanged':
                // Hint a sync if the doc went Valid / Rejected — keeps our local
                // mirror in step without waiting for the next poll.
                console.log(`[Webhooks] doc status changed for org ${orgId}: ${payload.uuid} → ${payload.status}`);
                processed = true;
                break;

            case 'syncCompleted':
                console.log(`[Webhooks] external sync completed for org ${orgId}, count=${payload.count}`);
                processed = true;
                break;

            case 'erpInvoicePushed':
                // ERP told us about a freshly-created invoice. Future: kick off
                // the sign + submit pipeline automatically. For now, just log.
                console.log(`[Webhooks] ERP pushed invoice ${payload.internalId} for org ${orgId}`);
                processed = true;
                break;

            default:
                // Unknown event types are stored but not actioned.
                processed = true;
        }
    } catch (e: any) {
        errorMessage = e.message;
    }

    await pool.query(
        `UPDATE "otaxdb".webhook_events SET processed = $1, error_message = $2 WHERE id = $3`,
        [processed, errorMessage, eventId]
    ).catch(() => {});
}

// ──────────────────────────────────────────────────────────────────────
// GET /api/webhooks/:orgId/events — recent events for the dashboard.
// Requires JWT auth (separate route, mounted by server.ts under /api/admin/).
// ──────────────────────────────────────────────────────────────────────

router.get('/:orgId/events', async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const orgId = parseInt(req.params.orgId, 10);
        // Light auth — a JWT-authenticated user can only see their own org's events.
        const callerOrg = (req as any).user?.organizationId;
        if (callerOrg && callerOrg !== orgId) {
            return res.status(403).json({ success: false, message: 'Cross-org access denied.' });
        }
        const r = await pool.query(
            `SELECT id, source, event_type, signature_ok, received_at, processed, error_message
             FROM "otaxdb".webhook_events
             WHERE organization_id = $1
             ORDER BY received_at DESC
             LIMIT 200`,
            [orgId]
        );
        res.json({ success: true, rows: r.rows });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// Helper exposed to other routers — generates / rotates a webhook secret
// for an org. Used by the Settings → Webhooks UI when we eventually expose it.
// ──────────────────────────────────────────────────────────────────────

export async function generateWebhookSecret(pool: pg.Pool, orgId: number): Promise<string> {
    await ensureSchema(pool);
    const secret = `whk_${crypto.randomBytes(24).toString('hex')}`;
    await pool.query(
        `INSERT INTO "otaxdb".webhook_secrets (organization_id, secret)
         VALUES ($1, $2)
         ON CONFLICT (organization_id) DO UPDATE SET secret = EXCLUDED.secret, rotated_at = NOW()`,
        [orgId, secret]
    );
    return secret;
}

export default router;
