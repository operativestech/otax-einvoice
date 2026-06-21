/**
 * ERP Connector routes — wraps the importer in HTTP endpoints used by the
 * ERPConnector page + Settings → ERP Server "Test Connection" button.
 *
 * Mounted at `/api/admin/erp`:
 *   POST /test-connection     → ping the ERP, run a sanity SELECT / authenticate
 *   POST /preview-invoices    → fetch up to N invoices WITHOUT submitting
 *   POST /import-now          → fetch + submit + log a run row
 *   GET  /runs                → last 50 runs for the dashboard
 *
 * Every endpoint resolves the org from req.user.organizationId; super admins
 * can scope via ?orgId=NN.
 */

import { Router, Request, Response } from 'express';
import pg from 'pg';
import { authenticate, blockDemo, logActivity } from '../middleware/auth.js';
import { loadAdapterForOrg, previewInvoices, runImport, listRecentRuns, getRunDetail } from '../services/erp/importer.js';

const router = Router();
function getPool(req: Request): pg.Pool { return (req as any).app.get('pool'); }

function resolveOrgId(req: Request): number | null {
    const fromUser = (req as any).user?.organizationId;
    const fromQuery = req.query?.orgId ? parseInt(String(req.query.orgId)) : null;
    return fromQuery || fromUser || null;
}

/** POST /api/admin/erp/test-connection
 *  Returns { ok, message, details } from the adapter's testConnection().
 *  Doesn't fail with HTTP 5xx on a bad config — that's a normal user error.
 */
router.post('/test-connection', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        const orgId = resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization scoped to this user.' });

        const handle = await loadAdapterForOrg(pool, orgId);
        if (!handle) return res.status(400).json({ success: false, message: 'No ERP integration configured. Save your ERP Server settings first.' });

        try {
            const result = await handle.adapter.testConnection();
            return res.json({ success: true, ...result, provider: handle.adapter.provider });
        } finally {
            await handle.adapter.close?.();
        }
    } catch (err: any) {
        // Configuration errors (e.g. unsupported provider) come through here
        return res.json({ success: false, ok: false, message: err.message || String(err) });
    }
});

/** POST /api/admin/erp/preview-invoices
 *  Body: { limit?: number, since?: ISO-date, until?: ISO-date }
 *  Returns { invoices: [...], fetchedCount }. Read-only — never submits.
 */
router.post('/preview-invoices', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        const orgId = resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization scoped to this user.' });

        const limit = Math.max(1, Math.min(parseInt(String(req.body?.limit || 5)) || 5, 50));
        const since = req.body?.since ? new Date(req.body.since) : undefined;
        const until = req.body?.until ? new Date(req.body.until) : undefined;

        const result = await previewInvoices(pool, orgId, { limit, since, until });
        return res.json({ success: true, ...result });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message || String(err) });
    }
});

/** POST /api/admin/erp/import-now
 *  Body: { limit?: number, since?: ISO-date, until?: ISO-date }
 *  Fetches from the ERP + submits to ETA via the standard /api/excel/submit
 *  pipeline. Records a row in erp_runs.
 */
router.post('/import-now', authenticate, blockDemo, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        const orgId = resolveOrgId(req);
        const userId = (req as any).user?.id;
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization scoped to this user.' });
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized.' });

        const limit = Math.max(1, Math.min(parseInt(String(req.body?.limit || 100)) || 100, 1000));
        const since = req.body?.since ? new Date(req.body.since) : undefined;
        const until = req.body?.until ? new Date(req.body.until) : undefined;

        const result = await runImport(pool, orgId, Number(userId), { limit, since, until });

        await logActivity(
            Number(userId),
            (req as any).user.username,
            'erp_import_run',
            'admin',
            'erp_runs',
            String(result.runId),
            { status: result.status, fetchedCount: result.fetchedCount, submittedCount: result.submittedCount, failedCount: result.failedCount },
            req
        ).catch(() => {});

        // 4xx for full failures so the UI can highlight; 200 otherwise.
        if (result.status === 'failed') {
            return res.status(502).json({ success: false, ...result, message: result.errorMessage || 'Import failed.' });
        }
        return res.json({ success: true, ...result });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message || String(err) });
    }
});

/** GET /api/admin/erp/runs
 *  Returns the most recent 50 rows from erp_runs for this org.
 */
router.get('/runs', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        const orgId = resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization scoped to this user.' });

        const rows = await listRecentRuns(pool, orgId, 50);
        return res.json({ success: true, rows });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message || String(err) });
    }
});

/** GET /api/admin/erp/runs/:id
 *  Drill-down: per-invoice rows touched by a specific run. Lets the user see
 *  exactly which fawatir failed and why, instead of the aggregated counts on
 *  the parent runs list.
 */
router.get('/runs/:id', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        const orgId = resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization scoped to this user.' });

        const runId = parseInt(req.params.id, 10);
        if (!runId) return res.status(400).json({ success: false, message: 'Bad run id.' });

        const invoices = await getRunDetail(pool, orgId, runId);
        return res.json({ success: true, invoices });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message || String(err) });
    }
});

/** GET /api/admin/erp/schedule
 *  Returns the auto-import schedule + the incremental-sync pointer. Also
 *  surfaces `provider` so the UI can disable scheduling when nothing's
 *  configured to run.
 */
router.get('/schedule', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        const orgId = resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization scoped to this user.' });

        const r = await pool.query(
            `SELECT erp_provider, erp_auto_import_mode, erp_auto_import_minutes, erp_last_synced_at
               FROM "otaxdb".org_integration_settings
              WHERE organization_id = $1`,
            [orgId]
        );
        const row = r.rows[0] || {};
        return res.json({
            success: true,
            provider: row.erp_provider || null,
            mode: row.erp_auto_import_mode || 'off',
            intervalMinutes: Number(row.erp_auto_import_minutes || 60),
            lastSyncedAt: row.erp_last_synced_at || null,
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message || String(err) });
    }
});

/** PUT /api/admin/erp/schedule
 *  Body: { mode: 'off' | 'interval', intervalMinutes?: number }
 */
router.put('/schedule', authenticate, blockDemo, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        const orgId = resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization scoped to this user.' });

        const mode = String(req.body?.mode || 'off');
        if (!['off', 'interval'].includes(mode)) {
            return res.status(400).json({ success: false, message: 'mode must be off | interval' });
        }
        const minutes = Math.max(5, Math.min(parseInt(String(req.body?.intervalMinutes || 60), 10) || 60, 1440));

        // Upsert — the row may not exist yet for orgs that haven't saved any
        // ERP creds (the schedule columns get added by ensureSettingsSchema
        // when /api/settings/save fires).
        await pool.query(
            `INSERT INTO "otaxdb".org_integration_settings (organization_id, erp_auto_import_mode, erp_auto_import_minutes, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (organization_id) DO UPDATE
             SET erp_auto_import_mode = EXCLUDED.erp_auto_import_mode,
                 erp_auto_import_minutes = EXCLUDED.erp_auto_import_minutes,
                 updated_at = NOW()`,
            [orgId, mode, minutes]
        );

        await logActivity(
            (req as any).user!.id,
            (req as any).user!.username,
            'erp_schedule_updated',
            'admin',
            'org_integration_settings',
            String(orgId),
            { mode, intervalMinutes: minutes },
            req
        ).catch(() => {});

        return res.json({ success: true, mode, intervalMinutes: minutes });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message || String(err) });
    }
});

/** POST /api/admin/erp/reset-pointer
 *  Wipes erp_last_synced_at so the next import re-fetches from the user's
 *  given window. Useful when the user changes the underlying view definition
 *  and wants to backfill.
 */
router.post('/reset-pointer', authenticate, blockDemo, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        const orgId = resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization scoped to this user.' });

        await pool.query(
            `UPDATE "otaxdb".org_integration_settings SET erp_last_synced_at = NULL WHERE organization_id = $1`,
            [orgId]
        );
        return res.json({ success: true });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message || String(err) });
    }
});

export default router;
