/**
 * Notifications Worker — daily digest + monthly VAT filing reminder.
 *
 * Two independent timers:
 *
 *   1. DAILY DIGEST (every 6 hours).
 *      For each active org that has at least one portal_user with a verified
 *      email, we compute the last-24h stats (new Valid / Rejected / Late) from
 *      that org's documents table. If ANY of the counters is > 0, we send a
 *      single digest email to every admin-tier user of that org. A cooldown
 *      column (`last_digest_sent_at`) on `organization_settings` enforces
 *      "at most one digest per org per calendar day" so Gmail doesn't rate-limit
 *      us on a restart loop.
 *
 *   2. MONTHLY VAT REMINDER (every 6 hours, but fires once per month).
 *      On the 1st of each month, we compute the previous month's Output VAT /
 *      Input VAT / Net Payable and email every org's primary admin. Cooldown:
 *      `last_vat_reminder_sent_at` column, `to_char(date_trunc('month', x), 'YYYY-MM')`
 *      match check.
 *
 * All email sends are best-effort — individual failures are caught and logged
 * so one bad mailbox doesn't block the rest of the batch. Disable via env
 * `NOTIFICATIONS_WORKER=off`.
 */

import pg from 'pg';
import { getOrgTableNames } from './orgTables.js';
import { sendDailyDigestEmail } from './emailService.js';

const TICK_MS = 6 * 60 * 60 * 1000; // 6 hours
const DIGEST_LOOKBACK_HOURS = 24;
const LATE_THRESHOLD_HOURS = 48;

/**
 * Ensure the bookkeeping columns exist. Idempotent — safe to call every tick.
 * We keep the two cooldown timestamps on `organization_settings` so the state
 * stays per-org without a new table.
 */
async function ensureColumns(pool: pg.Pool): Promise<void> {
    try {
        await pool.query(`
            ALTER TABLE "otaxdb".organization_settings
              ADD COLUMN IF NOT EXISTS notify_daily_digest BOOLEAN DEFAULT TRUE,
              ADD COLUMN IF NOT EXISTS notify_vat_reminder BOOLEAN DEFAULT TRUE,
              ADD COLUMN IF NOT EXISTS notify_recipient_email VARCHAR(255),
              ADD COLUMN IF NOT EXISTS last_digest_sent_at TIMESTAMP,
              ADD COLUMN IF NOT EXISTS last_vat_reminder_sent_at TIMESTAMP
        `);
    } catch (e: any) {
        console.warn('[NotifWorker] Column ensure failed (non-fatal):', e.message);
    }
}

/**
 * Recipients for org-level notifications.
 *
 * Priority:
 *   1. If the org configured a single mailbox in
 *      `organization_settings.notify_recipient_email`, that's the *only*
 *      recipient — gives the user a "send everything to my accountant" knob
 *      without exposing SMTP credentials.
 *   2. Otherwise fall back to every active, email-verified portal_user of the
 *      org (legacy behaviour — works out of the box for solo admins).
 *
 * Either way, the *sender* is the global OTax SMTP — customers never
 * configure outbound credentials.
 */
async function getOrgAdminEmails(pool: pg.Pool, orgId: number): Promise<string[]> {
    try {
        // Step 1: configured override.
        const r1 = await pool.query(
            `SELECT notify_recipient_email FROM "otaxdb".organization_settings WHERE organization_id = $1`,
            [orgId]
        );
        const override = r1.rows[0]?.notify_recipient_email;
        if (override && String(override).trim()) {
            return [String(override).trim()];
        }
    } catch { /* column may not exist yet on first run; fall through */ }

    // Step 2: legacy fallback — all org admins with verified email.
    try {
        const r2 = await pool.query(
            `SELECT DISTINCT email FROM "otaxdb".portal_users
             WHERE organization_id = $1 AND is_active = TRUE
               AND email IS NOT NULL AND email <> '' AND email_verified = TRUE`,
            [orgId]
        );
        return r2.rows.map((x: any) => String(x.email));
    } catch { return []; }
}

/**
 * Compute the last-24h counters for one org from its per-org documents table.
 * Returns zeros if the table doesn't exist (org never synced any invoices).
 */
async function computeDigestStats(
    pool: pg.Pool, orgId: number, orgName: string
): Promise<{ newValidCount: number; newValidTotal: number; rejectedCount: number; rejectedTotal: number; lateCount: number; lateTotal: number } | null> {
    const tables = getOrgTableNames(orgId, orgName);
    const exists = await pool.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'InvoicesDb' AND table_name = $1) AS exists`,
        [tables.documents]
    );
    if (!exists.rows[0]?.exists) return null;

    const sql = `
        SELECT
          COUNT(*) FILTER (WHERE status = 'Valid'    AND synced_at >= NOW() - INTERVAL '${DIGEST_LOOKBACK_HOURS} hours')::int      AS new_valid_count,
          COALESCE(SUM(total) FILTER (WHERE status = 'Valid' AND synced_at >= NOW() - INTERVAL '${DIGEST_LOOKBACK_HOURS} hours'), 0)::float AS new_valid_total,
          COUNT(*) FILTER (WHERE status IN ('Rejected', 'Invalid') AND synced_at >= NOW() - INTERVAL '${DIGEST_LOOKBACK_HOURS} hours')::int AS rejected_count,
          COALESCE(SUM(total) FILTER (WHERE status IN ('Rejected', 'Invalid') AND synced_at >= NOW() - INTERVAL '${DIGEST_LOOKBACK_HOURS} hours'), 0)::float AS rejected_total,
          COUNT(*) FILTER (
            WHERE direction = 'Sent' AND "dateTimeIssued" IS NOT NULL AND "dateTimeReceived" IS NOT NULL
              AND EXTRACT(EPOCH FROM ("dateTimeReceived" - "dateTimeIssued")) / 3600.0 > ${LATE_THRESHOLD_HOURS}
              AND synced_at >= NOW() - INTERVAL '${DIGEST_LOOKBACK_HOURS} hours'
          )::int AS late_count,
          COALESCE(SUM(total) FILTER (
            WHERE direction = 'Sent' AND "dateTimeIssued" IS NOT NULL AND "dateTimeReceived" IS NOT NULL
              AND EXTRACT(EPOCH FROM ("dateTimeReceived" - "dateTimeIssued")) / 3600.0 > ${LATE_THRESHOLD_HOURS}
              AND synced_at >= NOW() - INTERVAL '${DIGEST_LOOKBACK_HOURS} hours'
          ), 0)::float AS late_total
        FROM "InvoicesDb"."${tables.documents}"
    `;
    const r = await pool.query(sql);
    const x = r.rows[0] || {};
    return {
        newValidCount: Number(x.new_valid_count || 0),
        newValidTotal: Number(x.new_valid_total || 0),
        rejectedCount: Number(x.rejected_count || 0),
        rejectedTotal: Number(x.rejected_total || 0),
        lateCount:     Number(x.late_count     || 0),
        lateTotal:     Number(x.late_total     || 0),
    };
}

/** Run one full cycle across every active org. */
async function tick(pool: pg.Pool): Promise<void> {
    const today = new Date();

    try {
        await ensureColumns(pool);

        const orgs = await pool.query(`
            SELECT o.id, o.name,
                   COALESCE(os.notify_daily_digest, TRUE) AS notify_digest,
                   os.last_digest_sent_at
            FROM "otaxdb".organizations o
            LEFT JOIN "otaxdb".organization_settings os ON os.organization_id = o.id
            WHERE o.is_active = TRUE
        `);

        for (const org of orgs.rows) {
            const orgId = org.id as number;
            const orgName = org.name as string;

            // ── 1. Daily digest (cooldown = 22h to handle clock drift across 6h ticks) ──
            if (org.notify_digest !== false) {
                const last = org.last_digest_sent_at ? new Date(org.last_digest_sent_at) : null;
                const hoursSince = last ? (today.getTime() - last.getTime()) / 3600000 : Infinity;
                if (hoursSince >= 22) {
                    try {
                        const stats = await computeDigestStats(pool, orgId, orgName);
                        if (stats && (stats.rejectedCount > 0 || stats.lateCount > 0 || stats.newValidCount >= 10)) {
                            const emails = await getOrgAdminEmails(pool, orgId);
                            for (const e of emails) {
                                await sendDailyDigestEmail(e, orgName, stats).catch(err =>
                                    console.warn(`[NotifWorker] digest send failed for ${e}:`, err.message));
                            }
                            if (emails.length > 0) {
                                await pool.query(
                                    `UPDATE "otaxdb".organization_settings SET last_digest_sent_at = NOW() WHERE organization_id = $1`,
                                    [orgId]
                                );
                                console.log(`[NotifWorker] Daily digest sent for org ${orgId} (${orgName}) to ${emails.length} recipient(s).`);
                            }
                        }
                    } catch (e: any) {
                        console.warn(`[NotifWorker] Digest cycle failed for org ${orgId}:`, e.message);
                    }
                }
            }

            // VAT-reminder cycle removed — superseded by the
            // "Pre-Filing VAT Pack" report in scheduledReports.ts which
            // ships a richer XLSX (Summary / Sent / Received sheets) on a
            // configurable monthly cadence.
        }
    } catch (err: any) {
        console.error('[NotifWorker] tick error:', err.message);
    }
}

/**
 * Public entry point for "Run Daily Digest Now" — fires the digest for ONE
 * org, bypassing the 22h cooldown. Used by an admin endpoint and tests.
 *
 * The VAT-reminder branch was removed — it's replaced by the
 * "Pre-Filing VAT Pack" scheduled report (see scheduledReports.ts), which
 * has its own per-report "Send now" button in Settings → Scheduled Reports.
 */
export async function runNotificationsNow(
    pool: pg.Pool, orgId: number
): Promise<{ digest: { sent: number; reason?: string } }> {
    await ensureColumns(pool);

    const orgRow = await pool.query<{ name: string }>(
        `SELECT name FROM "otaxdb".organizations WHERE id = $1 AND is_active = TRUE`,
        [orgId]
    );
    if (orgRow.rowCount === 0) {
        return { digest: { sent: 0, reason: 'Organization not found or inactive' } };
    }
    const orgName = orgRow.rows[0].name;

    const report = { digest: { sent: 0 } as { sent: number; reason?: string } };

    try {
        const stats = await computeDigestStats(pool, orgId, orgName);
        if (!stats) {
            report.digest.reason = 'No documents table for this org yet — skip';
        } else if (stats.rejectedCount === 0 && stats.lateCount === 0 && stats.newValidCount === 0) {
            report.digest.reason = 'No activity in the last 24h — nothing to digest';
        } else {
            const emails = await getOrgAdminEmails(pool, orgId);
            if (emails.length === 0) {
                report.digest.reason = 'No active users with verified email';
            } else {
                for (const e of emails) {
                    await sendDailyDigestEmail(e, orgName, stats).catch(err =>
                        console.warn(`[NotifWorker:run-now] digest send failed for ${e}:`, err.message));
                }
                report.digest.sent = emails.length;
                await pool.query(
                    `UPDATE "otaxdb".organization_settings SET last_digest_sent_at = NOW() WHERE organization_id = $1`,
                    [orgId]
                ).catch(() => {});
            }
        }
    } catch (e: any) {
        report.digest.reason = `Failed: ${e.message}`;
    }

    return report;
}

/** Boot the worker. Returns a handle that lets server.ts cleanly shut it down. */
export function startNotificationsWorker(pool: pg.Pool): { stop: () => void } {
    if (String(process.env.NOTIFICATIONS_WORKER || '').toLowerCase() === 'off') {
        console.log('[NotifWorker] Disabled via NOTIFICATIONS_WORKER=off.');
        return { stop: () => {} };
    }
    // Fire once ~30 seconds after boot, then every 6 hours.
    const initial = setTimeout(() => { tick(pool); }, 30_000);
    const interval = setInterval(() => { tick(pool); }, TICK_MS);
    console.log(`[NotifWorker] Started. Tick every ${TICK_MS / 3600000}h.`);
    return {
        stop: () => { clearTimeout(initial); clearInterval(interval); console.log('[NotifWorker] Stopped.'); },
    };
}
