/**
 * ERP Auto-Import Scheduler — fires runImport() on a per-org cadence.
 *
 * Mirrors the design of autoSyncScheduler:
 *   - Single 60-second tick across the whole process
 *   - For each org with `erp_auto_import_mode = 'interval'`, fire when
 *     `erp_last_synced_at + erp_auto_import_minutes` has elapsed
 *   - Concurrent-run guard inside runImport() (advisory lock) handles the
 *     race between the cron tick and a manual click
 *
 * Tuning:
 *   ERP_SCHEDULER=off   disable entirely
 *   ERP_SCHEDULER_USER  optional override for the user id we run jobs as
 *                       (defaults to the org's first active portal user)
 */

import pg from 'pg';
import { runImport, ensureSchema } from './importer.js';

const TICK_INTERVAL_MS = 60_000;
const MIN_DEDUP_MINUTES = 2;       // never fire twice within 2 minutes for the same org

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startErpScheduler(pool: pg.Pool): { stop: () => void } {
    if (String(process.env.ERP_SCHEDULER || '').toLowerCase() === 'off') {
        console.log('[ErpScheduler] Disabled via ERP_SCHEDULER=off.');
        return { stop: () => {} };
    }
    if (timer) return { stop: stopErpScheduler };

    console.log(`[ErpScheduler] starting (tick every ${TICK_INTERVAL_MS / 1000}s)`);

    // Make sure the columns we query exist before the first tick fires —
    // ensureSchema in the importer is lazy, so the scheduler used to crash on
    // a fresh DB that hadn't seen a manual import yet.
    (async () => {
        try {
            await ensureSchema(pool);
        } catch (e: any) {
            console.warn('[ErpScheduler] ensureSchema:', e.message);
        }

        timer = setInterval(() => {
            if (running) return;
            running = true;
            tick(pool).catch(e => console.warn('[ErpScheduler] tick error:', e.message))
                      .finally(() => { running = false; });
        }, TICK_INTERVAL_MS);
        // Fire one tick after a 15s warmup so the backlog clears without waiting
        // a full minute on boot.
        setTimeout(() => { if (!running) { running = true; tick(pool).finally(() => { running = false; }); } }, 15_000);
    })();

    return { stop: stopErpScheduler };
}

export function stopErpScheduler(): void {
    if (timer) { clearInterval(timer); timer = null; console.log('[ErpScheduler] stopped'); }
}

/** Find every org whose schedule is due and kick off an import for each. */
async function tick(pool: pg.Pool): Promise<void> {
    // We only fire when there's an actual ERP integration AND auto-import is on.
    const dueRes = await pool.query(`
        SELECT i.organization_id,
               i.erp_auto_import_minutes,
               i.erp_last_synced_at,
               i.erp_provider
          FROM "otaxdb".org_integration_settings i
         WHERE i.erp_auto_import_mode = 'interval'
           AND i.erp_provider IS NOT NULL
           AND i.erp_provider <> ''
    `);
    const now = Date.now();
    const dueOrgs: Array<{ orgId: number; minutesSinceLast: number }> = [];
    for (const row of dueRes.rows) {
        const orgId = Number(row.organization_id);
        const intervalMin = Math.max(5, Math.min(Number(row.erp_auto_import_minutes || 60), 1440));
        const lastSyncMs = row.erp_last_synced_at ? new Date(row.erp_last_synced_at).getTime() : 0;
        const minutesSinceLast = lastSyncMs ? (now - lastSyncMs) / 60_000 : Infinity;
        if (minutesSinceLast < MIN_DEDUP_MINUTES) continue;
        if (minutesSinceLast >= intervalMin) {
            dueOrgs.push({ orgId, minutesSinceLast });
        }
    }
    if (dueOrgs.length === 0) return;

    // Fire orgs sequentially — keeps memory bounded and respects the per-org
    // advisory lock that runImport already takes.
    for (const { orgId } of dueOrgs) {
        try {
            const userId = await pickRunnerUser(pool, orgId);
            if (!userId) {
                console.warn(`[ErpScheduler] org ${orgId}: no portal user available, skipping`);
                continue;
            }
            console.log(`[ErpScheduler] firing import for org ${orgId} (user ${userId})`);
            const result = await runImport(pool, orgId, userId, { triggeredBy: 'scheduled' });
            if (result.status === 'busy') {
                console.log(`[ErpScheduler] org ${orgId}: a manual import was already running, will retry next tick`);
            } else {
                console.log(`[ErpScheduler] org ${orgId}: ${result.status} fetched=${result.fetchedCount} submitted=${result.submittedCount} failed=${result.failedCount} skipped=${result.skippedCount}`);
            }
        } catch (e: any) {
            console.warn(`[ErpScheduler] org ${orgId} crashed:`, e.message);
        }
    }
}

/** Pick a portal user we can run as. Prefers the one identified by
 *  ERP_SCHEDULER_USER env var; otherwise the first active user of the org. */
async function pickRunnerUser(pool: pg.Pool, orgId: number): Promise<number | null> {
    const envUser = process.env.ERP_SCHEDULER_USER ? parseInt(process.env.ERP_SCHEDULER_USER, 10) : NaN;
    if (!isNaN(envUser)) {
        const r = await pool.query(
            `SELECT id FROM "otaxdb".portal_users WHERE id = $1 AND organization_id = $2 AND is_active = TRUE LIMIT 1`,
            [envUser, orgId]
        );
        if (r.rows.length > 0) return Number(r.rows[0].id);
    }
    const r = await pool.query(
        `SELECT id FROM "otaxdb".portal_users
          WHERE organization_id = $1 AND is_active = TRUE
          ORDER BY id ASC LIMIT 1`,
        [orgId]
    );
    return r.rows.length > 0 ? Number(r.rows[0].id) : null;
}
