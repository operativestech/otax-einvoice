/**
 * Outbound webhook subscriptions — let the user point OTax at one or more
 * URLs to be notified about events (invoice submitted, sync completed, etc).
 *
 * Companion to:
 *   - services/webhookDispatcher.ts  → owns the delivery queue + retry worker
 *   - routes/webhookRoutes.ts        → INBOUND receiver (different feature)
 *
 * Endpoints (all require JWT + are org-scoped via `organization_id`):
 *
 *   GET    /api/admin/webhooks                — list subs (signing_secret hidden)
 *   POST   /api/admin/webhooks                — create
 *   PATCH  /api/admin/webhooks/:id            — update url / events / is_active / description
 *   DELETE /api/admin/webhooks/:id            — delete (cascades into webhook_deliveries)
 *   POST   /api/admin/webhooks/:id/test       — fire a synthetic event for debugging
 *   POST   /api/admin/webhooks/:id/rotate     — rotate the signing secret
 *   GET    /api/admin/webhooks/:id/deliveries — paginated delivery log
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import pg from 'pg';
import { authenticate, blockDemo, logActivity } from '../middleware/auth.js';
import { enqueueWebhookEvent } from '../services/webhookDispatcher.js';

const router = Router();
function getPool(req: Request): pg.Pool { return (req as any).app.get('pool'); }

// Reuses the same SUPPORTED_EVENTS list as the dispatcher. We keep it inline
// here so the API can validate `events` filters at create time.
const SUPPORTED_EVENTS = [
    'invoice.submitted', 'invoice.valid', 'invoice.rejected', 'invoice.cancelled',
    'sync.completed', 'sync.failed',
    'reconciliation.matched', 'reconciliation.match_accepted',
    'customer.created',
];

function generateSigningSecret(): string {
    return 'whk_' + crypto.randomBytes(24).toString('hex');
}

function safeUrl(s: any): string | null {
    if (!s) return null;
    const str = String(s).trim().slice(0, 2000);
    try {
        const u = new URL(str);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        return str;
    } catch { return null; }
}

// ─── Schema bootstrap (deferred until first call) ────────────────────────
let schemaReady = false;
async function ensureSchema(pool: pg.Pool): Promise<void> {
    if (schemaReady) return;
    // The dispatcher creates the tables we need; calling its enqueue with no
    // matching subs is the cheapest way to force ensureSchema there to run.
    await enqueueWebhookEvent(pool, -1, '__schema_warmup__', {}).catch(() => { });
    schemaReady = true;
}

// ─── List ─────────────────────────────────────────────────────────────────

router.get('/', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const orgId = (req as any).user?.organizationId;
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context.' });

        const r = await pool.query(
            `SELECT id, url, events, is_active, created_by, created_at, last_used_at, description
             FROM "otaxdb".webhook_subscriptions
             WHERE organization_id = $1
             ORDER BY created_at DESC`,
            [orgId]
        );
        // Per-sub delivery counts so the UI can show health at a glance.
        const counts = await pool.query(
            `SELECT subscription_id, status, COUNT(*)::int AS n
             FROM "otaxdb".webhook_deliveries
             WHERE organization_id = $1 AND created_at > NOW() - INTERVAL '30 days'
             GROUP BY subscription_id, status`,
            [orgId]
        );
        const countsBy: Record<number, Record<string, number>> = {};
        for (const c of counts.rows) {
            countsBy[c.subscription_id] = countsBy[c.subscription_id] || {};
            countsBy[c.subscription_id][c.status] = Number(c.n);
        }
        const rows = r.rows.map(s => ({ ...s, deliveryCounts30d: countsBy[s.id] || {} }));
        res.json({ success: true, rows, supportedEvents: SUPPORTED_EVENTS });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── Create ───────────────────────────────────────────────────────────────

router.post('/', authenticate, blockDemo, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const user = (req as any).user;
        const orgId = user?.organizationId;
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context.' });

        const { url, events, description } = req.body || {};
        const cleanUrl = safeUrl(url);
        if (!cleanUrl) return res.status(400).json({ success: false, message: 'A valid http(s) URL is required.' });

        // events is optional — empty array means "all events".
        let cleanEvents: string[] = [];
        if (Array.isArray(events)) {
            cleanEvents = events.map((e: any) => String(e).trim()).filter(e => SUPPORTED_EVENTS.includes(e));
        }
        const cleanDesc = description ? String(description).trim().slice(0, 255) : null;

        const secret = generateSigningSecret();
        const inserted = await pool.query(
            `INSERT INTO "otaxdb".webhook_subscriptions
                (organization_id, url, events, signing_secret, created_by, description)
             VALUES ($1, $2, $3::text[], $4, $5, $6)
             RETURNING id, url, events, is_active, created_at, description`,
            [orgId, cleanUrl, cleanEvents, secret, user.id || null, cleanDesc]
        );

        await logActivity(user.id, user.username, 'webhook_created', 'admin', 'webhook_subscriptions',
            String(inserted.rows[0].id), { url: cleanUrl, events: cleanEvents }, req).catch(() => { });

        // Echo the secret ONCE on creation — same convention as API keys.
        res.json({ success: true, subscription: inserted.rows[0], signingSecret: secret });
    } catch (err: any) {
        console.error('[Webhooks] create error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── Update ───────────────────────────────────────────────────────────────

router.patch('/:id', authenticate, blockDemo, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const user = (req as any).user;
        const orgId = user?.organizationId;
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ success: false, message: 'Invalid id.' });

        const { url, events, is_active, description } = req.body || {};
        const sets: string[] = [];
        const params: any[] = [];

        if (url !== undefined) {
            const u = safeUrl(url);
            if (!u) return res.status(400).json({ success: false, message: 'Invalid url.' });
            params.push(u); sets.push(`url = $${params.length}`);
        }
        if (events !== undefined) {
            const arr = Array.isArray(events) ? events.map((e: any) => String(e)).filter(e => SUPPORTED_EVENTS.includes(e)) : [];
            params.push(arr); sets.push(`events = $${params.length}::text[]`);
        }
        if (is_active !== undefined) { params.push(Boolean(is_active)); sets.push(`is_active = $${params.length}`); }
        if (description !== undefined) {
            params.push(description ? String(description).trim().slice(0, 255) : null);
            sets.push(`description = $${params.length}`);
        }
        if (sets.length === 0) return res.status(400).json({ success: false, message: 'Nothing to update.' });

        params.push(id, orgId);
        const r = await pool.query(
            `UPDATE "otaxdb".webhook_subscriptions SET ${sets.join(', ')}
              WHERE id = $${params.length - 1} AND organization_id = $${params.length}
              RETURNING id, url, events, is_active, description`,
            params
        );
        if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'Subscription not found.' });
        logActivity(user.id, user.username, 'webhook_updated', 'admin', 'webhook_subscriptions',
            String(id), { fields: Object.keys(req.body || {}) }, req).catch(() => { });
        res.json({ success: true, subscription: r.rows[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── Delete ───────────────────────────────────────────────────────────────

router.delete('/:id', authenticate, blockDemo, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const user = (req as any).user;
        const orgId = user?.organizationId;
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ success: false, message: 'Invalid id.' });

        const r = await pool.query(
            `DELETE FROM "otaxdb".webhook_subscriptions WHERE id = $1 AND organization_id = $2 RETURNING id`,
            [id, orgId]
        );
        if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'Subscription not found.' });
        logActivity(user.id, user.username, 'webhook_deleted', 'admin', 'webhook_subscriptions',
            String(id), {}, req).catch(() => { });
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── Rotate signing secret ────────────────────────────────────────────────

router.post('/:id/rotate', authenticate, blockDemo, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const user = (req as any).user;
        const orgId = user?.organizationId;
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ success: false, message: 'Invalid id.' });

        const newSecret = generateSigningSecret();
        const r = await pool.query(
            `UPDATE "otaxdb".webhook_subscriptions SET signing_secret = $1
              WHERE id = $2 AND organization_id = $3 RETURNING id`,
            [newSecret, id, orgId]
        );
        if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'Subscription not found.' });
        logActivity(user.id, user.username, 'webhook_secret_rotated', 'admin', 'webhook_subscriptions',
            String(id), {}, req).catch(() => { });
        res.json({ success: true, signingSecret: newSecret });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── Test fire ────────────────────────────────────────────────────────────

router.post('/:id/test', authenticate, blockDemo, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const user = (req as any).user;
        const orgId = user?.organizationId;
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ success: false, message: 'Invalid id.' });

        // Verify ownership
        const r = await pool.query(
            `SELECT id FROM "otaxdb".webhook_subscriptions WHERE id = $1 AND organization_id = $2`,
            [id, orgId]
        );
        if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'Subscription not found.' });

        // Enqueue a single synthetic delivery — only to THIS subscription, not
        // to other subscriptions that might match. We do this by inserting
        // directly so we bypass the fan-out logic in `enqueueWebhookEvent`.
        const envelope = {
            eventId: crypto.randomUUID(),
            eventType: 'test.ping',
            organizationId: orgId,
            timestamp: new Date().toISOString(),
            data: { message: 'This is a test webhook from OTax.', firedBy: user.username || user.id },
        };
        await pool.query(
            `INSERT INTO "otaxdb".webhook_deliveries
                (subscription_id, organization_id, event_type, payload, status, attempts, next_attempt_at)
             VALUES ($1, $2, 'test.ping', $3::jsonb, 'pending', 0, NOW())`,
            [id, orgId, JSON.stringify(envelope)]
        );

        res.json({ success: true, message: 'Test webhook queued — the dispatcher will pick it up within 15 seconds.' });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── Delivery log ─────────────────────────────────────────────────────────

router.get('/:id/deliveries', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const orgId = (req as any).user?.organizationId;
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ success: false, message: 'Invalid id.' });

        const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);
        const r = await pool.query(
            `SELECT id, event_type, status, attempts, last_status_code, last_error,
                    created_at, completed_at, next_attempt_at
             FROM "otaxdb".webhook_deliveries
             WHERE subscription_id = $1 AND organization_id = $2
             ORDER BY created_at DESC
             LIMIT ${limit}`,
            [id, orgId]
        );
        res.json({ success: true, rows: r.rows });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
