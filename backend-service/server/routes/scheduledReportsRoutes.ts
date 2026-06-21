/**
 * Scheduled Reports Routes — per-org CRUD on the schedule table + a
 * "send now" trigger.
 *
 * Mounted at `/api/admin/scheduled-reports`:
 *
 *   GET  /catalogue            → public catalogue of available report types
 *   GET  /                     → all schedule rows for the caller's org
 *   PUT  /:reportType          → upsert one report's schedule
 *   POST /:reportType/send-now → fire that report immediately (bypasses
 *                                cooldown, doesn't mutate last_sent_at)
 */

import { Router, Request, Response } from 'express';
import pg from 'pg';
import { authenticate, blockDemo, logActivity } from '../middleware/auth.js';
import {
    REPORT_CATALOGUE,
    REPORT_BY_ID,
    type Frequency,
} from '../services/scheduledReports.js';
import { runReport } from '../services/scheduledReportsWorker.js';

const router = Router();

function getPool(req: Request): pg.Pool { return (req as any).app.get('pool'); }

function resolveOrgId(req: Request): number | null {
    return (req as any).scopedOrgId || (req as any).user?.organizationId || null;
}

const isFrequency = (s: any): s is Frequency => s === 'daily' || s === 'weekly' || s === 'monthly';
const clampInt = (v: any, lo: number, hi: number, fallback: number): number => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
};

/** Public catalogue — what report types the UI can offer + their defaults. */
router.get('/catalogue', authenticate, async (_req, res) => {
    res.json({
        success: true,
        catalogue: REPORT_CATALOGUE.map(r => ({
            id:             r.id,
            label:          r.label,
            description:    r.description,
            defaultCadence: r.defaultCadence,
            windowKind:     r.windowKind,
        })),
    });
});

/** All schedule rows for the caller's org, with the catalogue merged in so the
 *  UI gets one row per known report type (even ones the user never configured). */
router.get('/', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        const orgId = resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const r = await pool.query(
            `SELECT id, report_type, enabled, frequency,
                    day_of_week, day_of_month, time_hour, time_minute,
                    recipient_email, last_sent_at, last_error, updated_at
               FROM "otaxdb".org_scheduled_reports
              WHERE organization_id = $1`,
            [orgId]
        );
        const byType = new Map<string, any>();
        for (const row of r.rows) byType.set(row.report_type, row);

        const merged = REPORT_CATALOGUE.map(def => {
            const row = byType.get(def.id);
            return {
                id:             def.id,
                label:          def.label,
                description:    def.description,
                defaultCadence: def.defaultCadence,
                windowKind:     def.windowKind,
                enabled:        row?.enabled ?? false,
                frequency:      row?.frequency || def.defaultCadence,
                dayOfWeek:      row?.day_of_week ?? null,
                dayOfMonth:     row?.day_of_month ?? null,
                timeHour:       row?.time_hour ?? 8,
                timeMinute:     row?.time_minute ?? 0,
                recipientEmail: row?.recipient_email || null,
                lastSentAt:     row?.last_sent_at || null,
                lastError:      row?.last_error || null,
            };
        });

        res.json({ success: true, reports: merged });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/** Upsert one report's schedule. Body is partial — only changed fields need to be sent. */
router.put('/:reportType', authenticate, blockDemo, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        const orgId = resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const reportType = String(req.params.reportType);
        const def = REPORT_BY_ID[reportType];
        if (!def) return res.status(400).json({ success: false, message: 'Unknown report type' });

        const body = req.body || {};
        const enabled    = typeof body.enabled === 'boolean' ? body.enabled : false;
        const frequency: Frequency = isFrequency(body.frequency) ? body.frequency : def.defaultCadence;
        const dayOfWeek  = body.dayOfWeek  == null ? null : clampInt(body.dayOfWeek, 0, 6, 0);
        const dayOfMonth = body.dayOfMonth == null ? null : clampInt(body.dayOfMonth, 1, 31, 1);
        const timeHour   = clampInt(body.timeHour,   0, 23, 8);
        const timeMinute = clampInt(body.timeMinute, 0, 59, 0);
        const recipient  = body.recipientEmail == null ? null : String(body.recipientEmail).trim() || null;
        if (recipient && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || recipient.length > 255)) {
            return res.status(400).json({ success: false, message: 'Invalid recipient email.' });
        }

        // ── Single-active-report invariant ──
        // Customer requirement: at most ONE scheduled report can be enabled per
        // org at a time (avoids confusing the user with multiple cron rows
        // while we're still on free Gmail SMTP). When the caller flips this
        // report ON, we proactively flip every other row OFF in the same
        // transaction so the worker has a clean single-row choice.
        if (enabled) {
            await pool.query(
                `UPDATE "otaxdb".org_scheduled_reports
                    SET enabled = FALSE, updated_at = NOW()
                  WHERE organization_id = $1
                    AND report_type <> $2
                    AND enabled = TRUE`,
                [orgId, reportType]
            );
        }

        await pool.query(
            `INSERT INTO "otaxdb".org_scheduled_reports
                (organization_id, report_type, enabled, frequency, day_of_week, day_of_month, time_hour, time_minute, recipient_email, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
             ON CONFLICT (organization_id, report_type) DO UPDATE SET
                 enabled         = EXCLUDED.enabled,
                 frequency       = EXCLUDED.frequency,
                 day_of_week     = EXCLUDED.day_of_week,
                 day_of_month    = EXCLUDED.day_of_month,
                 time_hour       = EXCLUDED.time_hour,
                 time_minute     = EXCLUDED.time_minute,
                 recipient_email = EXCLUDED.recipient_email,
                 updated_at      = NOW()`,
            [orgId, reportType, enabled, frequency, dayOfWeek, dayOfMonth, timeHour, timeMinute, recipient]
        );

        await logActivity(
            (req as any).user!.id,
            (req as any).user!.username,
            'scheduled_report_updated',
            'admin',
            'org_scheduled_reports',
            String(orgId),
            { reportType, enabled, frequency, recipient },
            req
        ).catch(() => {});

        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/** Fire a report immediately — bypasses the cooldown and DOESN'T move
 *  `last_sent_at`, so the next scheduled run still happens on time. */
router.post('/:reportType/send-now', authenticate, blockDemo, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        const orgId = resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const reportType = String(req.params.reportType);
        const def = REPORT_BY_ID[reportType];
        if (!def) return res.status(400).json({ success: false, message: 'Unknown report type' });

        // Find the saved row OR construct a synthetic one with defaults so the
        // user can preview a report they haven't enabled yet.
        const r = await pool.query(
            `SELECT s.*, o.name AS org_name
               FROM "otaxdb".org_scheduled_reports s
               JOIN "otaxdb".organizations o ON o.id = s.organization_id
              WHERE s.organization_id = $1 AND s.report_type = $2`,
            [orgId, reportType]
        );
        let row: any = r.rows[0];
        if (!row) {
            const orgRow = await pool.query(`SELECT name FROM "otaxdb".organizations WHERE id = $1`, [orgId]);
            row = {
                id: 0,
                organization_id: orgId,
                org_name:        orgRow.rows[0]?.name || '',
                report_type:     reportType,
                enabled:         true,
                frequency:       def.defaultCadence,
                day_of_week:     null,
                day_of_month:    null,
                time_hour:       8,
                time_minute:     0,
                recipient_email: req.body?.recipientEmail || null,
                last_sent_at:    null,
            };
        }

        // Manual "Send now" → forceSend so admins get an all-clear email even when there's
        // no data in the window. Lets them prove the SMTP path is alive without waiting for
        // real rejections to come in. Scheduled cron still skips silently to save quota.
        const result = await runReport(pool, row, { markSent: false, forceSend: true });
        return res.json({ success: true, ...result });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
