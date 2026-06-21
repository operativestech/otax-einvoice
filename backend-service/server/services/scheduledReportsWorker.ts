/**
 * Scheduled Reports Worker — fires per-org scheduled report emails.
 *
 * Tick cadence: 60 seconds. Schedules are stored in
 * `otaxdb.org_scheduled_reports` (one row per org × report-type) and define:
 *   - frequency: 'daily' | 'weekly' | 'monthly'
 *   - day_of_week (0-6, Sun=0) — used by weekly
 *   - day_of_month (1-31)      — used by monthly
 *   - time_hour, time_minute   — local-server time at which to fire
 *   - recipient_email          — optional override; falls back to the org's
 *                                global notification mailbox, then to portal
 *                                users
 *
 * Disable via env `SCHEDULED_REPORTS_WORKER=off`.
 */

import pg from 'pg';
import * as XLSX from 'xlsx';
import {
    REPORT_BY_ID,
    REPORT_CATALOGUE,
    computeWindow,
    type Frequency,
    type ReportDefinition,
} from './scheduledReports.js';
import { sendReportEmail } from './emailService.js';
import { recordOrgNotification } from './notificationsFeed.js';

/** Build a small XLSX with one Summary sheet — used as the "all-clear" attachment
 *  when an admin clicks Send Now for a report whose window has no data. Lets every
 *  scheduled report behave consistently: manual triggers ALWAYS deliver an attachment. */
function buildEmptyReportXlsx(opts: {
    reportLabel: string;
    orgName:     string;
    windowStart: Date;
    windowEnd:   Date;
    skipReason:  string;
}): Buffer {
    const fmtUtc = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([{
        'Report':             opts.reportLabel,
        'Organization':       opts.orgName,
        'Window Start (UTC)': fmtUtc(opts.windowStart),
        'Window End (UTC)':   fmtUtc(opts.windowEnd),
        'Rows Found':         0,
        'Status':             'No data — empty report',
        'Reason':             opts.skipReason,
        'Note':               'Manual "Send now" — empty XLSX attached so you can verify delivery.',
    }]);
    XLSX.utils.book_append_sheet(wb, ws, 'Summary');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const TICK_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

interface ScheduleRow {
    id:               number;
    organization_id:  number;
    org_name:         string;
    report_type:      string;
    enabled:          boolean;
    frequency:        Frequency;
    day_of_week:      number | null;
    day_of_month:     number | null;
    time_hour:        number;
    time_minute:      number;
    recipient_email:  string | null;
    last_sent_at:     Date | null;
}

// ─── Schema ──────────────────────────────────────────────────────────────

let schemaReady = false;
async function ensureSchema(pool: pg.Pool): Promise<void> {
    if (schemaReady) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "otaxdb".org_scheduled_reports (
                id              BIGSERIAL PRIMARY KEY,
                organization_id INTEGER NOT NULL,
                report_type     VARCHAR(64) NOT NULL,
                enabled         BOOLEAN NOT NULL DEFAULT FALSE,
                frequency       VARCHAR(16) NOT NULL DEFAULT 'daily',
                day_of_week     INTEGER,
                day_of_month    INTEGER,
                time_hour       INTEGER NOT NULL DEFAULT 8,
                time_minute     INTEGER NOT NULL DEFAULT 0,
                recipient_email VARCHAR(255),
                last_sent_at    TIMESTAMP,
                last_error      TEXT,
                created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
                UNIQUE (organization_id, report_type)
            );
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_scheduled_reports_org ON "otaxdb".org_scheduled_reports(organization_id);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_scheduled_reports_enabled ON "otaxdb".org_scheduled_reports(enabled, frequency);`);
        schemaReady = true;
    } catch (e: any) {
        console.warn('[ScheduledReports] ensureSchema failed (non-fatal):', e.message);
    }
}

// ─── Schedule evaluation ─────────────────────────────────────────────────

/**
 * Decide whether a saved schedule row is "due to fire now". The semantics are
 * conservative — we never fire ahead of the configured time, and we use a
 * conservative cooldown derived from the cadence so we don't double-fire on
 * clock drift.
 */
export function isDue(s: ScheduleRow, now: Date): boolean {
    if (!s.enabled) return false;

    const scheduledToday = new Date(now);
    scheduledToday.setHours(s.time_hour, s.time_minute, 0, 0);

    if (s.frequency === 'daily') {
        if (now < scheduledToday) return false;
        if (!s.last_sent_at) return true;
        // Already fired since the start of today's slot? skip.
        return new Date(s.last_sent_at) < scheduledToday;
    }

    if (s.frequency === 'weekly') {
        const targetDow = s.day_of_week ?? 0; // default Sunday
        if (now.getDay() !== targetDow) return false;
        if (now < scheduledToday) return false;
        if (!s.last_sent_at) return true;
        // ~6 days cooldown — covers a clock that drifts by a few hours either way.
        const cooldown = new Date(scheduledToday); cooldown.setDate(cooldown.getDate() - 6);
        return new Date(s.last_sent_at) < cooldown;
    }

    if (s.frequency === 'monthly') {
        const targetDom = s.day_of_month ?? 1; // default 1st
        if (now.getDate() !== targetDom) return false;
        if (now < scheduledToday) return false;
        if (!s.last_sent_at) return true;
        // ~25-day cooldown — a month is at least 28 days, so 25 is safe.
        const cooldown = new Date(scheduledToday); cooldown.setDate(cooldown.getDate() - 25);
        return new Date(s.last_sent_at) < cooldown;
    }

    return false;
}

// ─── Recipient resolver ──────────────────────────────────────────────────

/**
 * Priority:
 *   1. Schedule row's `recipient_email` (per-report override)
 *   2. organization_settings.notify_recipient_email (org-wide)
 *   3. First active+verified portal user of the org
 */
async function resolveRecipient(pool: pg.Pool, row: ScheduleRow): Promise<string | null> {
    if (row.recipient_email && String(row.recipient_email).trim()) {
        return String(row.recipient_email).trim();
    }
    try {
        const r = await pool.query(
            `SELECT notify_recipient_email FROM "otaxdb".organization_settings WHERE organization_id = $1`,
            [row.organization_id]
        );
        const orgWide = r.rows[0]?.notify_recipient_email;
        if (orgWide && String(orgWide).trim()) return String(orgWide).trim();
    } catch { /* column may not exist on first run */ }
    try {
        const r = await pool.query(
            `SELECT email FROM "otaxdb".portal_users
              WHERE organization_id = $1 AND is_active = TRUE AND email_verified = TRUE
              ORDER BY id ASC LIMIT 1`,
            [row.organization_id]
        );
        return r.rows[0]?.email || null;
    } catch { return null; }
}

// ─── Run a single report ─────────────────────────────────────────────────

/**
 * Generate + send one report. `markSent` controls whether we update
 * `last_sent_at` — used by the "Send Now" button to bypass the cooldown.
 *
 * Returns a small status object so callers (worker + REST run-now) can
 * surface what happened to the user.
 */
export async function runReport(
    pool: pg.Pool,
    row: ScheduleRow,
    opts: { markSent?: boolean; forceSend?: boolean } = { markSent: true }
): Promise<{ status: 'sent' | 'sent_empty' | 'skipped' | 'failed' | 'no_recipient'; message?: string; recipient?: string }> {
    const def: ReportDefinition | undefined = REPORT_BY_ID[row.report_type];
    if (!def) {
        return { status: 'failed', message: `Unknown report type: ${row.report_type}` };
    }

    const recipient = await resolveRecipient(pool, row);
    if (!recipient) return { status: 'no_recipient', message: 'No recipient configured for this org.' };

    const now = new Date();
    const { start, end } = computeWindow(def.windowKind, now);

    try {
        const result = await def.generator({
            orgId:       row.organization_id,
            orgName:     row.org_name,
            pool,
            windowStart: start,
            windowEnd:   end,
            // Generators that respect forceSend will produce an XLSX even when the
            // window is empty (just headers + a notice row), so the admin gets a
            // real attachment to verify the pipeline. Generators that ignore the
            // flag simply skip as before.
            forceSend:   opts.forceSend === true,
        });

        if (result.skip) {
            // Manual "Send now" with forceSend=true → email an all-clear note WITH a
            // small XLSX attachment ("Summary" sheet) so the admin gets the same
            // shape of message they'd get with real data. Generic helper means every
            // report type benefits without per-generator changes. Scheduled cron
            // (forceSend unset) still skips silently to save Gmail quota.
            if (opts.forceSend) {
                const fmtDate = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
                const skipReason = result.skipReason || 'Nothing to report.';
                const subject = `✅ ${def.label} — 0 rows — ${row.org_name || 'OTax'}`;
                const html = `
                    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px; background: #f8fafc; border-radius: 16px;">
                      <div style="text-align: center; margin-bottom: 24px;">
                        <div style="background: #1e40af; display: inline-block; padding: 12px 20px; border-radius: 12px;">
                          <span style="color: white; font-size: 22px; font-weight: bold;">OTax</span>
                        </div>
                      </div>
                      <div style="background: white; padding: 32px; border-radius: 12px; border: 1px solid #e2e8f0;">
                        <h2 style="color: #1e293b; margin: 0 0 8px;">${def.label}</h2>
                        <p style="color: #64748b; font-size: 14px; margin: 0 0 18px;">
                          Manual "Send now" trigger for <strong>${row.org_name || 'your organization'}</strong>.
                        </p>
                        <div style="background: #ecfdf5; border: 1px solid #a7f3d0; padding: 14px 16px; border-radius: 10px; margin-bottom: 16px;">
                          <div style="font-weight: bold; color: #065f46;">✅ ${skipReason}</div>
                        </div>
                        <p style="color: #475569; font-size: 13px; line-height: 1.6; margin: 0;">
                          Window: <strong>${fmtDate(start)}</strong> → <strong>${fmtDate(end)}</strong>.<br/>
                          The attached XLSX confirms the delivery pipeline works end-to-end.
                          Scheduled cron runs will keep skipping until there's data — that's the design.
                        </p>
                      </div>
                      <p style="text-align: center; color: #94a3b8; font-size: 11px; margin-top: 16px;">© ${new Date().getFullYear()} OTax Platform</p>
                    </div>
                `;
                const buffer = buildEmptyReportXlsx({
                    reportLabel: def.label,
                    orgName:     row.org_name || 'OTax',
                    windowStart: start,
                    windowEnd:   end,
                    skipReason,
                });
                const stamp = end.toISOString().slice(0, 10);
                await sendReportEmail({
                    to:      recipient,
                    subject,
                    html,
                    attachment: {
                        filename: `OTax-${row.report_type}-${stamp}-empty.xlsx`,
                        content:  buffer,
                    },
                });
                console.log(`[ScheduledReports] force-sent EMPTY ${row.report_type} to ${recipient} for org ${row.organization_id} (with XLSX)`);
                return { status: 'sent_empty', message: skipReason, recipient };
            }

            if (opts.markSent !== false) {
                await pool.query(
                    `UPDATE "otaxdb".org_scheduled_reports
                       SET last_sent_at = NOW(), last_error = NULL, updated_at = NOW()
                     WHERE id = $1`,
                    [row.id]
                );
            }
            return { status: 'skipped', message: result.skipReason || 'Nothing to report.', recipient };
        }

        await sendReportEmail({
            to:         recipient,
            subject:    result.subject,
            html:       result.html,
            attachment: result.attachment,
        });

        if (opts.markSent !== false) {
            await pool.query(
                `UPDATE "otaxdb".org_scheduled_reports
                   SET last_sent_at = NOW(), last_error = NULL, updated_at = NOW()
                 WHERE id = $1`,
                [row.id]
            );
        }

        // Fan a notification out to every user of the org so the in-app
        // bell (TopBar) lights up. The href deep-links to a viewer that
        // shows what was sent + lets the user re-download the XLSX.
        await recordOrgNotification(pool, row.organization_id, {
            kind:    'report_sent',
            title:   result.subject,
            message: result.attachment
                ? `${def.label} — XLSX sent to ${recipient}`
                : `${def.label} — sent to ${recipient}`,
            href:    `/notifications`,
            metadata: {
                reportType: row.report_type,
                recipient,
                attachmentName: result.attachment?.filename || null,
            },
        }).catch(() => { /* best-effort, never blocks the email path */ });

        console.log(`[ScheduledReports] sent ${row.report_type}${result.isEmpty ? ' (empty XLSX)' : ''} to ${recipient} for org ${row.organization_id}`);
        return { status: result.isEmpty ? 'sent_empty' : 'sent', recipient };

    } catch (e: any) {
        // Detect Gmail's daily-sender limit so we can store an actionable
        // hint on the row instead of just the raw SMTP error. The TopBar
        // bell + the per-row "⚠ Error" badge then make the customer aware
        // why their scheduled report stopped firing.
        const raw = String(e?.message || e);
        const isRateLimit = /5\.4\.5|Daily user sending limit|exceeded.*Gmail/i.test(raw);
        const hint = isRateLimit
            ? 'Gmail daily sending limit hit (~500 emails/day for free accounts). Resets at midnight Pacific. For higher volume, configure SMTP_USER / SMTP_PASS in the backend .env to a transactional provider (SendGrid, Mailgun, AWS SES).'
            : undefined;
        const stored = hint ? `${raw}\n\nHint: ${hint}` : raw;

        await pool.query(
            `UPDATE "otaxdb".org_scheduled_reports SET last_error = $1, updated_at = NOW() WHERE id = $2`,
            [stored, row.id]
        ).catch(() => {});
        console.warn(`[ScheduledReports] ${row.report_type} failed for org ${row.organization_id}:`, raw);
        return {
            status:    'failed',
            message:   hint ? `${raw} — ${hint}` : raw,
            recipient,
        };
    }
}

// ─── Tick ────────────────────────────────────────────────────────────────

async function tick(pool: pg.Pool): Promise<void> {
    await ensureSchema(pool);

    const now = new Date();
    const r = await pool.query<ScheduleRow & { org_name: string }>(
        `SELECT s.*, o.name AS org_name
           FROM "otaxdb".org_scheduled_reports s
           JOIN "otaxdb".organizations o ON o.id = s.organization_id AND o.is_active = TRUE
          WHERE s.enabled = TRUE`
    );
    for (const row of r.rows) {
        if (!isDue(row, now)) continue;
        try {
            await runReport(pool, row);
        } catch (e: any) {
            console.warn(`[ScheduledReports] tick crash on report ${row.id}:`, e.message);
        }
    }
}

// ─── Public API ──────────────────────────────────────────────────────────

export function startScheduledReportsWorker(pool: pg.Pool): { stop: () => void } {
    if (String(process.env.SCHEDULED_REPORTS_WORKER || '').toLowerCase() === 'off') {
        console.log('[ScheduledReports] Disabled via SCHEDULED_REPORTS_WORKER=off.');
        return { stop: () => {} };
    }
    if (timer) return { stop: stopScheduledReportsWorker };

    console.log(`[ScheduledReports] starting (tick every ${TICK_MS / 1000}s, ${REPORT_CATALOGUE.length} report type(s))`);
    // Ensure schema before the first tick fires.
    (async () => {
        await ensureSchema(pool);
        timer = setInterval(() => {
            if (running) return;
            running = true;
            tick(pool).catch(e => console.warn('[ScheduledReports] tick error:', e.message))
                      .finally(() => { running = false; });
        }, TICK_MS);
        // Warmup tick after 30s so anything queued for "8:00" doesn't have to
        // wait the full minute.
        setTimeout(() => {
            if (!running) { running = true; tick(pool).finally(() => { running = false; }); }
        }, 30_000);
    })();

    return { stop: stopScheduledReportsWorker };
}

export function stopScheduledReportsWorker(): void {
    if (timer) { clearInterval(timer); timer = null; console.log('[ScheduledReports] stopped'); }
}
