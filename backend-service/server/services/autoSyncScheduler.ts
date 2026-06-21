/**
 * autoSyncScheduler — fires ETA sync on a per-org schedule.
 *
 * Modes (stored on `organization_settings`):
 *   - `off`       → never auto-syncs
 *   - `interval`  → every `eta_sync_interval` minutes since last run
 *   - `times`     → at each `HH:MM` in `eta_sync_times` (up to 10)
 *
 * The scheduler ticks every 60s. For each active org it decides if a run is due,
 * and if so fires `POST /api/eta/sync/start` on localhost using a short-lived JWT
 * minted for any portal user of that org. We go through HTTP (not a direct function
 * call) so we re-use the existing background-sync logic untouched.
 *
 * Env vars:
 *   AUTO_SYNC_SCHEDULER=off   disable entirely
 *   PORT                       used to call back to this same process
 *   JWT_SECRET                 must match the auth middleware's secret
 */

import pg from 'pg';
import jwt from 'jsonwebtoken';
import { sendSyncFailureEmail } from './emailService.js';

const TICK_INTERVAL_MS = 60_000;
const MIN_TIME_MODE_DEDUP_MINUTES = 2; // never re-fire within 2 min of a prior run (avoids tick overlaps)

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startAutoSyncScheduler(pool: pg.Pool): void {
    if (timer) return;
    console.log(`[AutoSync] scheduler starting (tick every ${TICK_INTERVAL_MS / 1000}s)`);
    timer = setInterval(() => {
        if (running) return;
        running = true;
        tick(pool).catch(e => console.error('[AutoSync] tick error:', e.message)).finally(() => { running = false; });
    }, TICK_INTERVAL_MS);
    // Fire once shortly after startup so the user doesn't have to wait a full minute
    setTimeout(() => {
        if (!running) { running = true; tick(pool).finally(() => { running = false; }); }
    }, 10_000);
}

export function stopAutoSyncScheduler(): void {
    if (timer) { clearInterval(timer); timer = null; console.log('[AutoSync] scheduler stopped'); }
}

// ──────────────────────────────────────────────────────────────

interface AutoSyncRow {
    organization_id: number;
    eta_sync_mode: string | null;
    eta_sync_interval: number | null;
    eta_sync_times: string[] | null;
    eta_last_auto_sync_at: Date | null;
    eta_auto_sync: boolean | null;
}

async function tick(pool: pg.Pool): Promise<void> {
    // Pull org-level schedules. Skip mode='off' and anything without creds.
    const res = await pool.query<AutoSyncRow>(
        `SELECT organization_id, eta_sync_mode, eta_sync_interval, eta_sync_times,
                eta_last_auto_sync_at, eta_auto_sync
         FROM "otaxdb".organization_settings
         WHERE COALESCE(eta_sync_mode, 'off') <> 'off'
           AND (eta_preprod_client_id IS NOT NULL OR eta_prod_client_id IS NOT NULL OR eta_client_id IS NOT NULL)`
    );

    const now = new Date();
    for (const row of res.rows) {
        try {
            if (!isDueNow(row, now)) continue;
            const result = await fireSync(pool, row.organization_id);
            if (result.ok) {
                await pool.query(
                    `UPDATE "otaxdb".organization_settings SET eta_last_auto_sync_at = NOW() WHERE organization_id = $1`,
                    [row.organization_id]
                );
                console.log(`[AutoSync] fired sync for org ${row.organization_id} (mode=${row.eta_sync_mode})`);
            } else if (result.error) {
                // Notify the org's admin emails once per failure — best-effort, don't
                // block the tick on SMTP. The worker's normal digest cooldown doesn't
                // apply to sync-failure mails: those are event-driven, not scheduled.
                notifySyncFailure(pool, row.organization_id, result.error, row.eta_sync_mode || 'unknown')
                    .catch(e => console.warn('[AutoSync] failure-email dispatch failed:', e.message));
            }
        } catch (e: any) {
            console.warn(`[AutoSync] org ${row.organization_id} failed:`, e.message);
            notifySyncFailure(pool, row.organization_id, e.message, row.eta_sync_mode || 'unknown')
                .catch(ee => console.warn('[AutoSync] failure-email dispatch failed:', ee.message));
        }
    }
}

/** Email every active admin of the org that the last auto-sync failed. */
async function notifySyncFailure(pool: pg.Pool, orgId: number, errorMessage: string, syncMode: string): Promise<void> {
    const orgRes = await pool.query<{ name: string }>(
        `SELECT name FROM "otaxdb".organizations WHERE id = $1`, [orgId]
    );
    const orgName = orgRes.rows[0]?.name || `Org #${orgId}`;

    const userRes = await pool.query<{ email: string }>(
        `SELECT DISTINCT email FROM "otaxdb".portal_users
         WHERE organization_id = $1 AND is_active = TRUE
           AND email IS NOT NULL AND email <> '' AND email_verified = TRUE`,
        [orgId]
    );
    for (const { email } of userRes.rows) {
        await sendSyncFailureEmail(email, orgName, errorMessage, syncMode)
            .catch(e => console.warn(`[AutoSync] sync-failure email to ${email} failed:`, e.message));
    }
}

/**
 * Decide whether this org's sync is due right now, given its schedule and the
 * last time we fired. Exported so unit tests / smoke scripts can exercise it
 * without needing the HTTP side effects.
 */
export function isDueNow(row: AutoSyncRow, now: Date): boolean {
    const mode = (row.eta_sync_mode || 'off').toLowerCase();
    if (mode === 'off') return false;

    const lastAt = row.eta_last_auto_sync_at ? new Date(row.eta_last_auto_sync_at) : null;
    const minutesSinceLast = lastAt ? (now.getTime() - lastAt.getTime()) / 60_000 : Infinity;

    // Safety: never fire twice within MIN_TIME_MODE_DEDUP_MINUTES regardless of mode
    if (minutesSinceLast < MIN_TIME_MODE_DEDUP_MINUTES) return false;

    if (mode === 'interval') {
        const intervalMinutes = Math.max(5, Math.min(Number(row.eta_sync_interval) || 60, 1440));
        return minutesSinceLast >= intervalMinutes;
    }

    if (mode === 'times') {
        const times = row.eta_sync_times || [];
        if (times.length === 0) return false;
        // The scheduler ticks every 60s. A scheduled time is "due" if its HH:MM
        // is within the last 60 seconds of now. We also enforce the 2-min dedup above.
        const currentHH = now.getHours();
        const currentMM = now.getMinutes();
        for (const t of times) {
            const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
            if (!m) continue;
            const hh = parseInt(m[1], 10), mm = parseInt(m[2], 10);
            if (hh === currentHH && mm === currentMM) return true;
        }
        return false;
    }

    return false;
}

// ──────────────────────────────────────────────────────────────

/**
 * Public entry point for "Run Sync Now" buttons in the UI. Bypasses the
 * scheduler's `isDueNow()` gate but reuses the same fire logic so we don't
 * duplicate the JWT-mint + HTTP-call dance. Returns the same shape so the
 * API handler can forward it straight back to the user.
 */
export async function runAutoSyncNow(pool: pg.Pool, orgId: number): Promise<{ ok: boolean; error?: string }> {
    const result = await fireSync(pool, orgId);
    if (result.ok) {
        await pool.query(
            `UPDATE "otaxdb".organization_settings SET eta_last_auto_sync_at = NOW() WHERE organization_id = $1`,
            [orgId]
        ).catch(() => { /* best effort */ });
    }
    return result;
}

/**
 * Fires the sync HTTP endpoint for one org.
 * Returns `{ ok: true }` on HTTP 2xx, or `{ ok: false, error }` so the caller
 * can surface the reason to the admin via email.
 */
async function fireSync(pool: pg.Pool, orgId: number): Promise<{ ok: boolean; error?: string }> {
    // Find any portal user of this org to mint a token for.
    const userRes = await pool.query<{ id: string }>(
        `SELECT id FROM "otaxdb".portal_users WHERE organization_id = $1 AND is_active = true ORDER BY id ASC LIMIT 1`,
        [orgId]
    );
    if (userRes.rowCount === 0) {
        const msg = `No active portal user found for this organization — cannot mint a sync token.`;
        console.warn(`[AutoSync] ${msg} (org ${orgId})`);
        return { ok: false, error: msg };
    }
    const userId = Number(userRes.rows[0].id);
    const secret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    const token = jwt.sign({ userId }, secret, { expiresIn: '5m' });

    const port = process.env.PORT || 3001;
    const url = `http://localhost:${port}/api/eta/sync/start`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'auto-sync-scheduler' }),
        });
        if (res.ok) return { ok: true };
        // Try to extract ETA's error message for the notification
        let bodyText = '';
        try { bodyText = (await res.text()).slice(0, 500); } catch {}
        return { ok: false, error: `HTTP ${res.status} from sync endpoint: ${bodyText || '(no body)'}` };
    } catch (e: any) {
        console.warn(`[AutoSync] HTTP call failed for org ${orgId}:`, e.message);
        return { ok: false, error: e.message || String(e) };
    }
}
