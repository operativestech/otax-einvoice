/**
 * In-app notifications feed — the Facebook-style bell drawer in the TopBar.
 *
 * Distinct from the *email* notifications worker (notificationsWorker.ts).
 * This module records EVERY user-facing event (report emails sent, sync
 * failures, big invoices, etc.) into a per-user feed so the user can see a
 * scrollable list of "what happened" without sifting through their inbox.
 *
 * Storage: `otaxdb.user_notifications` — one row per (user, event). The
 * worker that triggers an event is responsible for fanning the row out to
 * every user who should see it (typically all active members of the org).
 *
 * The schema is self-healing — the first call to `recordNotification` /
 * `listNotifications` runs the CREATE TABLE so we don't need a migration.
 */

import pg from 'pg';

let schemaReady = false;
async function ensureSchema(pool: pg.Pool): Promise<void> {
    if (schemaReady) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "otaxdb".user_notifications (
                id              BIGSERIAL PRIMARY KEY,
                user_id         INTEGER NOT NULL,
                organization_id INTEGER,
                kind            VARCHAR(64) NOT NULL,        -- 'report_sent' | 'sync_failed' | 'invoice_rejected' | ...
                title           VARCHAR(500) NOT NULL,
                message         TEXT,
                href            VARCHAR(500),                -- relative URL the bell row links to (open in new tab)
                metadata        JSONB,
                read_at         TIMESTAMP,
                created_at      TIMESTAMP NOT NULL DEFAULT NOW()
            );
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread ON "otaxdb".user_notifications(user_id, read_at) WHERE read_at IS NULL;`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created ON "otaxdb".user_notifications(user_id, created_at DESC);`);
        schemaReady = true;
    } catch (e: any) {
        console.warn('[NotifFeed] ensureSchema failed (non-fatal):', e.message);
    }
}

export interface NotificationInput {
    /** Which OTax user owns this row in their bell. Required. */
    userId: number;
    organizationId?: number | null;
    /** Stable machine-readable kind so the UI can pick an icon + colour. */
    kind: string;
    /** Short headline shown in the dropdown (max ~80 chars rendered). */
    title: string;
    /** Optional one-line subtitle / preview. */
    message?: string;
    /** Relative URL the bell row navigates to. Opens in a new tab. */
    href?: string;
    /** Anything extra the worker wants to keep with the row (audit, debug). */
    metadata?: any;
}

/** Insert one notification row. Best-effort: never throws to the caller —
 *  a failed bell record should not also fail the email send that generated it. */
export async function recordNotification(pool: pg.Pool, input: NotificationInput): Promise<void> {
    await ensureSchema(pool);
    try {
        await pool.query(
            `INSERT INTO "otaxdb".user_notifications
                (user_id, organization_id, kind, title, message, href, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
            [
                input.userId,
                input.organizationId ?? null,
                input.kind,
                input.title.slice(0, 500),
                input.message ? String(input.message).slice(0, 4000) : null,
                input.href ? String(input.href).slice(0, 500) : null,
                input.metadata ? JSON.stringify(input.metadata) : null,
            ]
        );
    } catch (e: any) {
        console.warn('[NotifFeed] record failed (non-fatal):', e.message);
    }
}

/**
 * Fan out a notification to every active member of the org. Used when an
 * event is org-level (e.g. "scheduled report sent for the company").
 */
export async function recordOrgNotification(
    pool: pg.Pool,
    orgId: number,
    input: Omit<NotificationInput, 'userId' | 'organizationId'>
): Promise<void> {
    await ensureSchema(pool);
    try {
        const r = await pool.query(
            `SELECT id FROM "otaxdb".portal_users
              WHERE organization_id = $1 AND is_active = TRUE`,
            [orgId]
        );
        for (const row of r.rows) {
            await recordNotification(pool, {
                ...input,
                userId: Number(row.id),
                organizationId: orgId,
            });
        }
    } catch (e: any) {
        console.warn('[NotifFeed] recordOrg failed (non-fatal):', e.message);
    }
}

export interface NotificationRow {
    id:             number;
    kind:           string;
    title:          string;
    message:        string | null;
    href:           string | null;
    metadata:       any | null;
    read_at:        string | null;
    created_at:     string;
}

export async function listNotifications(
    pool: pg.Pool, userId: number, opts: { limit?: number; before?: string } = {}
): Promise<{ rows: NotificationRow[]; unread: number }> {
    await ensureSchema(pool);
    const limit = Math.max(1, Math.min(opts.limit ?? 30, 100));
    const params: any[] = [userId, limit];
    let whereExtra = '';
    if (opts.before) {
        params.push(opts.before);
        whereExtra = ` AND created_at < $${params.length}`;
    }
    const list = await pool.query<NotificationRow>(
        `SELECT id, kind, title, message, href, metadata, read_at, created_at
           FROM "otaxdb".user_notifications
          WHERE user_id = $1${whereExtra}
          ORDER BY created_at DESC
          LIMIT $2`,
        params
    );
    const unreadRes = await pool.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM "otaxdb".user_notifications WHERE user_id = $1 AND read_at IS NULL`,
        [userId]
    );
    return { rows: list.rows, unread: Number(unreadRes.rows[0]?.c || 0) };
}

export async function markRead(pool: pg.Pool, userId: number, id: number): Promise<void> {
    await ensureSchema(pool);
    await pool.query(
        `UPDATE "otaxdb".user_notifications SET read_at = NOW()
          WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
        [id, userId]
    );
}

export async function markAllRead(pool: pg.Pool, userId: number): Promise<number> {
    await ensureSchema(pool);
    const r = await pool.query(
        `UPDATE "otaxdb".user_notifications SET read_at = NOW()
          WHERE user_id = $1 AND read_at IS NULL`,
        [userId]
    );
    return r.rowCount || 0;
}
