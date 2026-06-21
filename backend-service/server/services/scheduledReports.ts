/**
 * Scheduled Reports — generators for the per-org cron-style report emails.
 *
 * Architecture:
 *   - Each report type is a `(ctx: ReportContext) => Promise<ReportResult>`.
 *   - The worker (scheduledReportsWorker.ts) walks the catalogue, picks the
 *     ones that are due according to the saved schedule rows, and dispatches
 *     to `runReport()`.
 *   - Generators decide on their own whether there's anything to send via
 *     `result.skip` (e.g. "no rejected invoices in the period — don't spam
 *     a noisy zero email").
 *
 * Adding a new report:
 *   1. Write a `genXxx(ctx)` function returning ReportResult.
 *   2. Add an entry to `REPORT_CATALOGUE` with id + label + cadence default.
 *   3. The UI auto-discovers it via `/api/admin/scheduled-reports/catalogue`.
 */

import pg from 'pg';
import * as XLSX from 'xlsx';
import { getOrgTableNames } from './orgTables.js';

// ─── Types ───────────────────────────────────────────────────────────────

export interface ReportContext {
    orgId:       number;
    orgName:     string;
    pool:        pg.Pool;
    /** Inclusive start of the data window (UTC). */
    windowStart: Date;
    /** Exclusive end of the data window (UTC). */
    windowEnd:   Date;
    /** When true, generators should ALWAYS produce an XLSX (even an empty one with
     *  just headers) instead of returning skip:true. Set by the manual "Send now"
     *  button so admins can verify the delivery pipeline. Scheduled cron leaves it
     *  unset to save Gmail quota. */
    forceSend?:  boolean;
}

export interface ReportResult {
    subject:     string;
    /** Inline HTML body for the email. */
    html:        string;
    /** Optional XLSX attachment — required for "bulk list" style reports. */
    attachment?: { filename: string; content: Buffer; contentType?: string };
    /** Set true to suppress the email entirely (e.g. nothing to report). */
    skip?:       boolean;
    /** Why we skipped, surfaced in the worker log. */
    skipReason?: string;
    /** True when the result was produced via forceSend with no data in the window —
     *  the worker uses this to label the toast/notification as "all-clear" rather than
     *  the normal "sent". The XLSX attachment is still included. */
    isEmpty?:    boolean;
}

export type Frequency = 'daily' | 'weekly' | 'monthly';

export interface ReportDefinition {
    id:           string;
    label:        string;
    description:  string;
    /** Default frequency offered to the UI (the user can override). */
    defaultCadence: Frequency;
    /** Sane window size for the report — daily uses 24h, monthly uses prior calendar month, etc. */
    windowKind:   'last24h' | 'last7d' | 'last30d' | 'priorMonth' | 'thisMonth';
    generator:    (ctx: ReportContext) => Promise<ReportResult>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const fmtMoney = (n: number) =>
    Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: Date | string | null | undefined) => {
    if (!d) return '';
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return dt.toISOString().slice(0, 19).replace('T', ' ');
};

/** Build an XLSX buffer from one or more sheets. */
function buildXlsx(sheets: Array<{ name: string; rows: any[] }>): Buffer {
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
        const ws = XLSX.utils.json_to_sheet(s.rows.length > 0 ? s.rows : [{}]);
        XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31)); // 31-char limit
    }
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Shared header/footer chrome for the report HTML.
 *
 * NB: Emails are CTA-free by design — the customer asked us to drop the
 * "Open X →" button at the bottom because every notification email already
 * includes the data they need (XLSX attachment, inline stats). The
 * `ctaHref` / `ctaLabel` params are accepted for backward-compat with the
 * generators but are intentionally NOT rendered.
 */
function reportTemplate(opts: {
    title: string;
    intro: string;
    body: string;
    accent?: string;
    ctaHref?: string;   // accepted but unused — see header comment
    ctaLabel?: string;
}): string {
    const accent = opts.accent || '#1e40af';
    return `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:16px;">
        <div style="text-align:center;margin-bottom:24px;">
          <div style="background:${accent};display:inline-block;padding:12px 20px;border-radius:12px;">
            <span style="color:#fff;font-size:22px;font-weight:bold;">OTax</span>
          </div>
        </div>
        <div style="background:#fff;padding:32px;border-radius:12px;border:1px solid #e2e8f0;">
          <h2 style="color:#1e293b;margin:0 0 8px;">${opts.title}</h2>
          <p style="color:#64748b;font-size:14px;margin:0 0 20px;">${opts.intro}</p>
          ${opts.body}
        </div>
        <p style="text-align:center;color:#94a3b8;font-size:11px;margin-top:16px;">© ${new Date().getFullYear()} OTax Platform</p>
      </div>
    `;
}

/** Stat card used inside the email body. */
function statCard(label: string, value: string, sub: string, color: string): string {
    return `
      <div style="background:${color}15;border:1px solid ${color}40;padding:14px;border-radius:10px;text-align:center;min-width:140px;flex:1;">
        <div style="color:${color};font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
        <div style="color:#1e293b;font-size:24px;font-weight:900;margin:6px 0 2px;">${value}</div>
        <div style="color:#64748b;font-size:11px;">${sub}</div>
      </div>
    `;
}

/** Resolve the per-org InvoicesDb document table — returns null if it doesn't exist. */
async function getDocsTable(pool: pg.Pool, orgId: number, orgName: string): Promise<{ docs: string; lines: string } | null> {
    const tables = getOrgTableNames(orgId, orgName);
    const r = await pool.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'InvoicesDb' AND table_name = $1) AS exists`,
        [tables.documents]
    );
    if (!r.rows[0]?.exists) return null;
    return { docs: tables.documents, lines: tables.lines };
}

// ─── Generator: Invalid / Rejected Invoices ─────────────────────────────
//
// Daily Excel of every invoice that ETA flagged Invalid or Rejected in the
// window. Includes the full rejection reason so the accountant can fix the
// underlying issue (validation error, business rule, signature, etc.) and
// re-submit. This is the user's #1 ask.

const genInvalidInvoices = async (ctx: ReportContext): Promise<ReportResult> => {
    const t = await getDocsTable(ctx.pool, ctx.orgId, ctx.orgName);
    if (!t) return { subject: '', html: '', skip: true, skipReason: 'No documents table for this org yet' };

    const r = await ctx.pool.query(
        `SELECT uuid, "internalId", "submissionId", status,
                "issuerId", "issuerName", "receiverId", "receiverName",
                direction, "dateTimeIssued", "dateTimeReceived",
                total, "totalSales", "totalDiscount", "netAmount",
                currency, "rejectionReasons", "documentStatusReason"
           FROM "InvoicesDb"."${t.docs}"
          WHERE status IN ('Invalid', 'Rejected')
            AND "dateTimeReceived" >= $1 AND "dateTimeReceived" < $2
          ORDER BY "dateTimeReceived" DESC`,
        [ctx.windowStart, ctx.windowEnd]
    );

    if (r.rows.length === 0) {
        // forceSend (manual "Send now") is handled centrally in the worker —
        // every empty report falls back to a generic all-clear XLSX so the
        // admin always gets an attachment to verify delivery.
        return { subject: '', html: '', skip: true, skipReason: 'No invalid/rejected invoices in the window' };
    }

    const totalAmount = r.rows.reduce((s: number, x: any) => s + Number(x.total || 0), 0);

    // Build the XLSX rows — every column the user might need to investigate.
    const xlsxRows = r.rows.map((row: any) => ({
        'UUID':                row.uuid,
        'Internal ID':         row.internalId || '',
        'Submission ID':       row.submissionId || '',
        'Status':              row.status,
        'Direction':           row.direction || '',
        'Issuer Tax ID':       row.issuerId || '',
        'Issuer Name':         row.issuerName || '',
        'Receiver Tax ID':     row.receiverId || '',
        'Receiver Name':       row.receiverName || '',
        'Date Issued':         fmtDate(row.dateTimeIssued),
        'Date Received':       fmtDate(row.dateTimeReceived),
        'Total Sales':         Number(row.totalSales || 0),
        'Total Discount':      Number(row.totalDiscount || 0),
        'Net Amount':          Number(row.netAmount || 0),
        'Total':               Number(row.total || 0),
        'Currency':            row.currency || 'EGP',
        'Rejection Reasons':   row.rejectionReasons || '',
        'Status Reason':       row.documentStatusReason || '',
    }));

    const xlsx = buildXlsx([{ name: 'Invalid_Rejected', rows: xlsxRows }]);

    const baseUrl = process.env.FRONTEND_URL || 'https://otax.onrender.com';
    const body = `
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
        ${statCard('Invalid + Rejected', String(r.rows.length), `${fmtMoney(totalAmount)} EGP`, '#dc2626')}
      </div>
      <p style="color:#475569;font-size:13px;line-height:1.6;">
        The attached Excel file lists every invoice flagged Invalid or Rejected by ETA between
        <strong>${fmtDate(ctx.windowStart)}</strong> and <strong>${fmtDate(ctx.windowEnd)}</strong>,
        including the full rejection reason so you can fix the root cause and re-submit.
      </p>
    `;

    const stamp = ctx.windowEnd.toISOString().slice(0, 10);
    return {
        subject: `❌ OTax — Invalid/Rejected invoices (${r.rows.length}) — ${ctx.orgName}`,
        html: reportTemplate({
            title: `Invalid / Rejected Invoices — ${ctx.orgName}`,
            intro: `${r.rows.length} invoice(s) need your attention.`,
            body,
            accent: '#dc2626',
            ctaHref: `${baseUrl}/reports`,
            ctaLabel: 'Open Reports',
        }),
        attachment: {
            filename: `OTax-Invalid-${stamp}.xlsx`,
            content: xlsx,
        },
    };
};

// ─── Generator: Pre-Filing VAT Pack ──────────────────────────────────────
//
// Monthly Excel: every Valid invoice in the prior calendar month, grouped
// into Sent / Received sheets, with VAT broken down by tax type. Drop-in
// upload for the ETA filing portal.

const genVatPack = async (ctx: ReportContext): Promise<ReportResult> => {
    const t = await getDocsTable(ctx.pool, ctx.orgId, ctx.orgName);
    if (!t) return { subject: '', html: '', skip: true, skipReason: 'No documents table for this org yet' };

    // We compute Output VAT (Sent invoices T1) and Input VAT (Received T1).
    const sql = `
      SELECT d.uuid, d."internalId", d.direction, d.status,
             d."issuerId", d."issuerName", d."receiverId", d."receiverName",
             d."dateTimeIssued", d.total, d."totalSales", d."netAmount", d.currency,
             COALESCE(SUM(
               CASE WHEN l."tax1_type" = 'T1' THEN COALESCE(l."tax1_amount",0) ELSE 0 END +
               CASE WHEN l."tax2_type" = 'T1' THEN COALESCE(l."tax2_amount",0) ELSE 0 END +
               CASE WHEN l."tax3_type" = 'T1' THEN COALESCE(l."tax3_amount",0) ELSE 0 END +
               CASE WHEN l."tax4_type" = 'T1' THEN COALESCE(l."tax4_amount",0) ELSE 0 END +
               CASE WHEN l."tax5_type" = 'T1' THEN COALESCE(l."tax5_amount",0) ELSE 0 END +
               CASE WHEN l."tax6_type" = 'T1' THEN COALESCE(l."tax6_amount",0) ELSE 0 END +
               CASE WHEN l."tax7_type" = 'T1' THEN COALESCE(l."tax7_amount",0) ELSE 0 END +
               CASE WHEN l."tax8_type" = 'T1' THEN COALESCE(l."tax8_amount",0) ELSE 0 END
             ), 0) AS vat_amount
        FROM "InvoicesDb"."${t.docs}" d
   LEFT JOIN "InvoicesDb"."${t.lines}" l ON l.document_uuid = d.uuid
       WHERE d.status = 'Valid'
         AND d."dateTimeIssued" >= $1 AND d."dateTimeIssued" < $2
    GROUP BY d.uuid, d."internalId", d.direction, d.status,
             d."issuerId", d."issuerName", d."receiverId", d."receiverName",
             d."dateTimeIssued", d.total, d."totalSales", d."netAmount", d.currency
    ORDER BY d."dateTimeIssued" ASC
    `;
    const r = await ctx.pool.query(sql, [ctx.windowStart, ctx.windowEnd]);

    if (r.rows.length === 0) {
        return { subject: '', html: '', skip: true, skipReason: 'No Valid invoices in the prior month' };
    }

    const sentRows: any[] = [];
    const receivedRows: any[] = [];
    let outputVat = 0;
    let inputVat  = 0;
    let totalSent = 0;
    let totalReceived = 0;

    for (const row of r.rows) {
        const vat = Number(row.vat_amount || 0);
        const baseRow = {
            'Internal ID':     row.internalId || '',
            'UUID':            row.uuid,
            'Date Issued':     fmtDate(row.dateTimeIssued),
            'Issuer Tax ID':   row.issuerId || '',
            'Issuer Name':     row.issuerName || '',
            'Receiver Tax ID': row.receiverId || '',
            'Receiver Name':   row.receiverName || '',
            'Net Amount':      Number(row.netAmount || 0),
            'Total Sales':     Number(row.totalSales || 0),
            'VAT (T1)':        vat,
            'Total':           Number(row.total || 0),
            'Currency':        row.currency || 'EGP',
        };
        if (row.direction === 'Sent') {
            sentRows.push(baseRow); outputVat += vat; totalSent += Number(row.total || 0);
        } else {
            receivedRows.push(baseRow); inputVat += vat; totalReceived += Number(row.total || 0);
        }
    }

    // Build summary sheet first so it opens by default.
    const month = ctx.windowStart.toISOString().slice(0, 7);
    const summaryRows = [
        { Metric: 'Period',                      Value: month },
        { Metric: 'Sent invoices (count)',       Value: sentRows.length },
        { Metric: 'Sent total (EGP)',            Value: totalSent },
        { Metric: 'Output VAT (Sent T1, EGP)',   Value: outputVat },
        { Metric: 'Received invoices (count)',   Value: receivedRows.length },
        { Metric: 'Received total (EGP)',        Value: totalReceived },
        { Metric: 'Input VAT (Received T1, EGP)', Value: inputVat },
        { Metric: 'Net Payable (EGP)',           Value: outputVat - inputVat },
    ];

    const xlsx = buildXlsx([
        { name: 'Summary',  rows: summaryRows },
        { name: 'Sent',     rows: sentRows },
        { name: 'Received', rows: receivedRows },
    ]);

    const netPayable = outputVat - inputVat;
    const payableColor = netPayable >= 0 ? '#dc2626' : '#059669';

    const baseUrl = process.env.FRONTEND_URL || 'https://otax.onrender.com';
    const body = `
      <div style="background:#eff6ff;border:1px solid #bfdbfe;padding:18px;border-radius:10px;text-align:center;margin-bottom:16px;">
        <div style="font-size:11px;font-weight:bold;color:#1e40af;text-transform:uppercase;">${month} — Net VAT Payable</div>
        <div style="font-size:34px;font-weight:900;color:${payableColor};margin:8px 0;">${fmtMoney(Math.abs(netPayable))} EGP</div>
        <div style="font-size:12px;color:#64748b;">${netPayable >= 0 ? 'Amount owed to ETA' : 'Amount refundable'}</div>
      </div>
      <table style="width:100%;font-size:13px;color:#475569;border-collapse:collapse;">
        <tr><td style="padding:6px 0;">Output VAT (Sent T1)</td><td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:bold;">${fmtMoney(outputVat)} EGP</td></tr>
        <tr><td style="padding:6px 0;">Input VAT (Received T1)</td><td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:bold;">${fmtMoney(inputVat)} EGP</td></tr>
        <tr><td style="padding:6px 0;border-top:1px solid #e2e8f0;"><strong>Net</strong></td><td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:bold;border-top:1px solid #e2e8f0;color:${payableColor};">${fmtMoney(netPayable)} EGP</td></tr>
      </table>
      <p style="color:#64748b;font-size:12px;margin-top:16px;">
        The attached Excel has three sheets: <strong>Summary</strong>, <strong>Sent</strong> (output invoices), and
        <strong>Received</strong> (input invoices) — ready to upload to the ETA filing portal.
      </p>
    `;

    return {
        subject: `📅 OTax — VAT pack ${month} — ${ctx.orgName}`,
        html: reportTemplate({
            title: `VAT Pack — ${month}`,
            intro: `Pre-filing pack for ${ctx.orgName}.`,
            body,
            accent: '#1e40af',
            ctaHref: `${baseUrl}/reports`,
            ctaLabel: 'Open VAT Summary',
        }),
        attachment: {
            filename: `OTax-VAT-${month}.xlsx`,
            content: xlsx,
        },
    };
};

// ─── Generator: Late Submissions ────────────────────────────────────────
//
// Daily Excel: every Sent invoice where dateTimeReceived - dateTimeIssued > 48h.
// Helps catch ERP delays and avoid ETA penalties.

const genLateSubmissions = async (ctx: ReportContext): Promise<ReportResult> => {
    const t = await getDocsTable(ctx.pool, ctx.orgId, ctx.orgName);
    if (!t) return { subject: '', html: '', skip: true, skipReason: 'No documents table for this org yet' };

    const r = await ctx.pool.query(
        `SELECT uuid, "internalId", direction, status,
                "issuerId", "issuerName", "receiverId", "receiverName",
                "dateTimeIssued", "dateTimeReceived",
                EXTRACT(EPOCH FROM ("dateTimeReceived" - "dateTimeIssued")) / 3600.0 AS hours_late,
                total, currency
           FROM "InvoicesDb"."${t.docs}"
          WHERE direction = 'Sent'
            AND "dateTimeIssued" IS NOT NULL AND "dateTimeReceived" IS NOT NULL
            AND EXTRACT(EPOCH FROM ("dateTimeReceived" - "dateTimeIssued")) / 3600.0 > 48
            AND "dateTimeReceived" >= $1 AND "dateTimeReceived" < $2
          ORDER BY hours_late DESC`,
        [ctx.windowStart, ctx.windowEnd]
    );

    if (r.rows.length === 0) {
        return { subject: '', html: '', skip: true, skipReason: 'No late submissions in the window' };
    }

    const totalAmount = r.rows.reduce((s: number, x: any) => s + Number(x.total || 0), 0);
    const xlsxRows = r.rows.map((row: any) => ({
        'Internal ID':     row.internalId || '',
        'UUID':            row.uuid,
        'Status':          row.status,
        'Issuer Tax ID':   row.issuerId || '',
        'Issuer Name':     row.issuerName || '',
        'Receiver Tax ID': row.receiverId || '',
        'Receiver Name':   row.receiverName || '',
        'Date Issued':     fmtDate(row.dateTimeIssued),
        'Date Received':   fmtDate(row.dateTimeReceived),
        'Hours Late':      Math.round(Number(row.hours_late || 0) * 10) / 10,
        'Total':           Number(row.total || 0),
        'Currency':        row.currency || 'EGP',
    }));

    const xlsx = buildXlsx([{ name: 'Late_Submissions', rows: xlsxRows }]);

    const baseUrl = process.env.FRONTEND_URL || 'https://otax.onrender.com';
    const body = `
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
        ${statCard('Late > 48h', String(r.rows.length), `${fmtMoney(totalAmount)} EGP`, '#ea580c')}
      </div>
      <p style="color:#475569;font-size:13px;line-height:1.6;">
        These invoices were received by ETA more than 48 hours after their issue date —
        ETA may apply late-submission penalties. Review the attached Excel and fix any
        ERP latency or pipeline backlog causing the delay.
      </p>
    `;

    const stamp = ctx.windowEnd.toISOString().slice(0, 10);
    return {
        subject: `⏰ OTax — Late submissions (${r.rows.length}) — ${ctx.orgName}`,
        html: reportTemplate({
            title: `Late Submissions — ${ctx.orgName}`,
            intro: `${r.rows.length} invoice(s) submitted >48h after issue.`,
            body,
            accent: '#ea580c',
            ctaHref: `${baseUrl}/reports`,
            ctaLabel: 'Open Reports',
        }),
        attachment: {
            filename: `OTax-Late-${stamp}.xlsx`,
            content: xlsx,
        },
    };
};

// ─── Generator: Weekly Revenue Summary ──────────────────────────────────
//
// Weekly Excel: revenue this week vs last week, top customers, top invoices.

const genWeeklyRevenue = async (ctx: ReportContext): Promise<ReportResult> => {
    const t = await getDocsTable(ctx.pool, ctx.orgId, ctx.orgName);
    if (!t) return { subject: '', html: '', skip: true, skipReason: 'No documents table for this org yet' };

    // This-week vs prior-week totals.
    const weekAgo  = new Date(ctx.windowStart); weekAgo.setDate(weekAgo.getDate() - 7);
    const priorEnd = ctx.windowStart;

    const totals = await ctx.pool.query(
        `SELECT
            SUM(CASE WHEN "dateTimeIssued" >= $1 AND "dateTimeIssued" < $2 THEN total ELSE 0 END)::float AS this_total,
            SUM(CASE WHEN "dateTimeIssued" >= $3 AND "dateTimeIssued" < $1 THEN total ELSE 0 END)::float AS prior_total,
            COUNT(*) FILTER (WHERE "dateTimeIssued" >= $1 AND "dateTimeIssued" < $2)::int AS this_count
           FROM "InvoicesDb"."${t.docs}"
          WHERE direction = 'Sent' AND status = 'Valid'`,
        [ctx.windowStart, ctx.windowEnd, weekAgo]
    );
    const thisTotal  = Number(totals.rows[0]?.this_total  || 0);
    const priorTotal = Number(totals.rows[0]?.prior_total || 0);
    const thisCount  = Number(totals.rows[0]?.this_count  || 0);
    if (thisCount === 0) {
        return { subject: '', html: '', skip: true, skipReason: 'No Sent+Valid invoices this week' };
    }
    const wow = priorTotal > 0 ? ((thisTotal - priorTotal) / priorTotal) * 100 : null;

    // Top 5 customers by revenue this week.
    const topCustomers = await ctx.pool.query(
        `SELECT "receiverId", "receiverName", COUNT(*)::int AS count, SUM(total)::float AS amount
           FROM "InvoicesDb"."${t.docs}"
          WHERE direction = 'Sent' AND status = 'Valid'
            AND "dateTimeIssued" >= $1 AND "dateTimeIssued" < $2
            AND "receiverId" IS NOT NULL AND "receiverId" <> ''
       GROUP BY "receiverId", "receiverName"
       ORDER BY amount DESC LIMIT 5`,
        [ctx.windowStart, ctx.windowEnd]
    );

    // Top 5 invoices by value this week.
    const topInvoices = await ctx.pool.query(
        `SELECT "internalId", uuid, "receiverName", "dateTimeIssued", total
           FROM "InvoicesDb"."${t.docs}"
          WHERE direction = 'Sent' AND status = 'Valid'
            AND "dateTimeIssued" >= $1 AND "dateTimeIssued" < $2
       ORDER BY total DESC LIMIT 5`,
        [ctx.windowStart, ctx.windowEnd]
    );

    const summarySheet = [
        { Metric: 'Period',           Value: `${fmtDate(ctx.windowStart)} → ${fmtDate(ctx.windowEnd)}` },
        { Metric: 'Invoices',         Value: thisCount },
        { Metric: 'Revenue (EGP)',    Value: thisTotal },
        { Metric: 'Prior week (EGP)', Value: priorTotal },
        { Metric: 'Change %',         Value: wow == null ? '—' : Math.round(wow * 10) / 10 },
    ];
    const customersSheet = topCustomers.rows.map((row: any, i: number) => ({
        Rank:       i + 1,
        TaxID:      row.receiverId,
        Customer:   row.receiverName || '—',
        Invoices:   Number(row.count || 0),
        'Revenue (EGP)': Number(row.amount || 0),
    }));
    const invoicesSheet = topInvoices.rows.map((row: any, i: number) => ({
        Rank:         i + 1,
        'Internal ID': row.internalId || '',
        UUID:         row.uuid,
        Customer:     row.receiverName || '—',
        'Date':       fmtDate(row.dateTimeIssued),
        'Total (EGP)': Number(row.total || 0),
    }));

    const xlsx = buildXlsx([
        { name: 'Summary',        rows: summarySheet },
        { name: 'Top_Customers',  rows: customersSheet },
        { name: 'Top_Invoices',   rows: invoicesSheet },
    ]);

    const wowColor = wow == null ? '#64748b' : wow >= 0 ? '#059669' : '#dc2626';
    const baseUrl = process.env.FRONTEND_URL || 'https://otax.onrender.com';
    const body = `
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
        ${statCard('Revenue', `${fmtMoney(thisTotal)}`, `EGP`, '#1e40af')}
        ${statCard('Invoices', String(thisCount), 'sent + valid', '#0ea5e9')}
        ${statCard('vs prior week', wow == null ? '—' : `${wow >= 0 ? '+' : ''}${Math.round(wow * 10) / 10}%`, `${fmtMoney(priorTotal)} EGP last week`, wowColor)}
      </div>
      <p style="color:#475569;font-size:13px;line-height:1.6;">
        Detailed breakdown — top 5 customers and top 5 invoices for the week — is in the attached Excel.
      </p>
    `;

    const stamp = ctx.windowEnd.toISOString().slice(0, 10);
    return {
        subject: `📈 OTax — Weekly revenue summary — ${ctx.orgName}`,
        html: reportTemplate({
            title: `Weekly Revenue — ${ctx.orgName}`,
            intro: `Sent + Valid invoices in the last 7 days.`,
            body,
            accent: '#1e40af',
            ctaHref: `${baseUrl}/dashboard`,
            ctaLabel: 'Open Dashboard',
        }),
        attachment: {
            filename: `OTax-Weekly-${stamp}.xlsx`,
            content: xlsx,
        },
    };
};

// ─── Generator: Reconciliation Gaps ─────────────────────────────────────
//
// Weekly Excel: ETA invoices with no ERP match + ERP rows with no ETA match
// + Suggested matches awaiting approval. Driven off the per-org reconciliation
// tables when present (skip cleanly when reconciliation isn't in use).

const genReconciliationGaps = async (ctx: ReportContext): Promise<ReportResult> => {
    const tables = getOrgTableNames(ctx.orgId, ctx.orgName);
    const exists = await ctx.pool.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'InvoicesDb' AND table_name = $1) AS exists`,
        [tables.matches]
    );
    if (!exists.rows[0]?.exists) {
        return { subject: '', html: '', skip: true, skipReason: 'Reconciliation not configured for this org' };
    }

    // ETA invoices without a match
    const orphanEta = await ctx.pool.query(
        `SELECT d.uuid, d."internalId", d."receiverName", d."dateTimeIssued", d.total
           FROM "InvoicesDb"."${tables.documents}" d
          WHERE d.status = 'Valid' AND d.direction = 'Sent'
            AND d."dateTimeIssued" >= $1 AND d."dateTimeIssued" < $2
            AND NOT EXISTS (
                SELECT 1 FROM "InvoicesDb"."${tables.matches}" m
                 WHERE m.eta_uuid = d.uuid AND m.status IN ('SUGGESTED','ACCEPTED')
            )
          ORDER BY d."dateTimeIssued" DESC LIMIT 1000`,
        [ctx.windowStart, ctx.windowEnd]
    );

    // ERP rows without a match
    const orphanErp = await ctx.pool.query(
        `SELECT id, doc_number, counterparty_name, issue_date, amount
           FROM "InvoicesDb"."${tables.erp_transactions}"
          WHERE issue_date >= $1 AND issue_date < $2
            AND NOT EXISTS (
                SELECT 1 FROM "InvoicesDb"."${tables.matches}" m
                 WHERE m.erp_tx_id = "InvoicesDb"."${tables.erp_transactions}".id
                   AND m.status IN ('SUGGESTED','ACCEPTED')
            )
          ORDER BY issue_date DESC LIMIT 1000`,
        [ctx.windowStart, ctx.windowEnd]
    ).catch(() => ({ rows: [] as any[] }));

    // Suggested matches awaiting approval
    const suggested = await ctx.pool.query(
        `SELECT id, eta_uuid, erp_tx_id, bank_tx_id, match_type, confidence, amount_diff, created_at
           FROM "InvoicesDb"."${tables.matches}"
          WHERE status = 'SUGGESTED'
            AND created_at >= $1 AND created_at < $2
          ORDER BY confidence DESC LIMIT 1000`,
        [ctx.windowStart, ctx.windowEnd]
    );

    const totalGaps = orphanEta.rows.length + orphanErp.rows.length + suggested.rows.length;
    if (totalGaps === 0) {
        return { subject: '', html: '', skip: true, skipReason: 'No reconciliation gaps in the window' };
    }

    const xlsx = buildXlsx([
        {
            name: 'ETA_Without_ERP',
            rows: orphanEta.rows.map((r: any) => ({
                UUID: r.uuid, 'Internal ID': r.internalId || '', Customer: r.receiverName || '—',
                'Date Issued': fmtDate(r.dateTimeIssued), 'Total (EGP)': Number(r.total || 0),
            })),
        },
        {
            name: 'ERP_Without_ETA',
            rows: orphanErp.rows.map((r: any) => ({
                'ERP ID': r.id, 'Doc Number': r.doc_number || '', Counterparty: r.counterparty_name || '—',
                'Issue Date': fmtDate(r.issue_date), Amount: Number(r.amount || 0),
            })),
        },
        {
            name: 'Suggested_Matches',
            rows: suggested.rows.map((r: any) => ({
                'Match ID': r.id, 'ETA UUID': r.eta_uuid || '', 'ERP ID': r.erp_tx_id || '',
                'Bank ID': r.bank_tx_id || '', Type: r.match_type, 'Confidence %': r.confidence,
                'Amount Diff': Number(r.amount_diff || 0), Created: fmtDate(r.created_at),
            })),
        },
    ]);

    const baseUrl = process.env.FRONTEND_URL || 'https://otax.onrender.com';
    const body = `
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
        ${statCard('ETA Orphans', String(orphanEta.rows.length), 'no ERP match', '#dc2626')}
        ${statCard('ERP Orphans', String(orphanErp.rows.length), 'no ETA match', '#ea580c')}
        ${statCard('Suggested', String(suggested.rows.length), 'awaiting approval', '#1e40af')}
      </div>
      <p style="color:#475569;font-size:13px;line-height:1.6;">
        Three sheets in the attached Excel: ETA invoices without an ERP entry, ERP rows that
        haven't been linked to an ETA invoice, and the auto-suggested matches your team should
        review and accept/reject.
      </p>
    `;

    const stamp = ctx.windowEnd.toISOString().slice(0, 10);
    return {
        subject: `🔍 OTax — Reconciliation gaps (${totalGaps}) — ${ctx.orgName}`,
        html: reportTemplate({
            title: `Reconciliation Gaps — ${ctx.orgName}`,
            intro: `${totalGaps} item(s) need a human decision.`,
            body,
            accent: '#1e40af',
            ctaHref: `${baseUrl}/reconciliation`,
            ctaLabel: 'Open Reconciliation',
        }),
        attachment: {
            filename: `OTax-Reconciliation-${stamp}.xlsx`,
            content: xlsx,
        },
    };
};

// ─── Generator: Cancelled / Rejected Within Deadline ────────────────────
//
// ETA gives invoices a 72-hour reverse window (canbeCancelledUntil,
// canbeRejectedUntil). This report lists everything cancelled or rejected
// where the deadline hasn't passed yet — accounting can still issue a
// reverse / clarification before ETA locks the document.

const genCancelledWithinDeadline = async (ctx: ReportContext): Promise<ReportResult> => {
    const t = await getDocsTable(ctx.pool, ctx.orgId, ctx.orgName);
    if (!t) return { subject: '', html: '', skip: true, skipReason: 'No documents table for this org yet' };

    const r = await ctx.pool.query(
        `SELECT uuid, "internalId", status, direction,
                "issuerId", "issuerName", "receiverId", "receiverName",
                "dateTimeIssued", "dateTimeReceived",
                "cancelRequestDate", "rejectRequestDate",
                "canbeCancelledUntil", "canbeRejectedUntil",
                total, currency, "rejectionReasons"
           FROM "InvoicesDb"."${t.docs}"
          WHERE (
                  ("canbeCancelledUntil" IS NOT NULL AND "canbeCancelledUntil" > NOW())
               OR ("canbeRejectedUntil"  IS NOT NULL AND "canbeRejectedUntil"  > NOW())
                )
            AND COALESCE("dateTimeReceived","dateTimeIssued") >= $1
            AND COALESCE("dateTimeReceived","dateTimeIssued") <  $2
          ORDER BY COALESCE("canbeCancelledUntil","canbeRejectedUntil") ASC`,
        [ctx.windowStart, ctx.windowEnd]
    );

    if (r.rows.length === 0) {
        return { subject: '', html: '', skip: true, skipReason: 'No invoices in their reverse window' };
    }

    const xlsxRows = r.rows.map((row: any) => {
        const deadline = row.canbeCancelledUntil || row.canbeRejectedUntil;
        const hoursLeft = deadline ? Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 3_600_000)) : null;
        return {
            'UUID':            row.uuid,
            'Internal ID':     row.internalId || '',
            'Status':          row.status,
            'Direction':       row.direction || '',
            'Issuer Tax ID':   row.issuerId || '',
            'Receiver Tax ID': row.receiverId || '',
            'Receiver Name':   row.receiverName || '',
            'Date Issued':     fmtDate(row.dateTimeIssued),
            'Cancel Until':    fmtDate(row.canbeCancelledUntil),
            'Reject Until':    fmtDate(row.canbeRejectedUntil),
            'Hours Left':      hoursLeft ?? '',
            'Total':           Number(row.total || 0),
            'Currency':        row.currency || 'EGP',
            'Rejection Reasons': row.rejectionReasons || '',
        };
    });

    const xlsx = buildXlsx([{ name: 'Within_Deadline', rows: xlsxRows }]);
    const baseUrl = process.env.FRONTEND_URL || 'https://otax.onrender.com';
    const body = `
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
        ${statCard('In window', String(r.rows.length), 'still actionable', '#ea580c')}
      </div>
      <p style="color:#475569;font-size:13px;line-height:1.6;">
        These invoices are still within ETA's 72-hour reverse window. After the deadline they're locked
        and you'll need a manual ticket with ETA to undo them. The attached Excel includes the exact
        deadline + hours remaining for each.
      </p>
    `;

    const stamp = ctx.windowEnd.toISOString().slice(0, 10);
    return {
        subject: `🕒 OTax — ${r.rows.length} invoice(s) within reverse window — ${ctx.orgName}`,
        html: reportTemplate({
            title: `Within Reverse Window — ${ctx.orgName}`,
            intro: `${r.rows.length} cancelled/rejected invoice(s) still in their 72h window.`,
            body, accent: '#ea580c',
            ctaHref: `${baseUrl}/invoices`, ctaLabel: 'Open Invoices',
        }),
        attachment: { filename: `OTax-Reverse-Window-${stamp}.xlsx`, content: xlsx },
    };
};

// ─── Generator: Tax Breakdown (special taxes T1-T8) ─────────────────────
//
// Egyptian invoices can carry up to 8 tax slots per line — T1 (VAT) plus
// special taxes (state development fee, table tax, entertainment, etc.).
// This report aggregates per tax type for the prior month so the org can
// reconcile each tax with its own filing schedule.

const genTaxBreakdown = async (ctx: ReportContext): Promise<ReportResult> => {
    const t = await getDocsTable(ctx.pool, ctx.orgId, ctx.orgName);
    if (!t) return { subject: '', html: '', skip: true, skipReason: 'No documents table for this org yet' };

    // UNION the 8 tax slots into a single (type, amount) tuple. We aggregate
    // direction so the user sees Output vs Input separately for each tax type.
    const sql = `
      WITH lines_in_window AS (
        SELECT d.direction, l.*
          FROM "InvoicesDb"."${t.docs}" d
          JOIN "InvoicesDb"."${t.lines}" l ON l.document_uuid = d.uuid
         WHERE d.status = 'Valid'
           AND d."dateTimeIssued" >= $1 AND d."dateTimeIssued" < $2
      ),
      flat AS (
        SELECT direction, "tax1_type" AS tax_type, COALESCE("tax1_amount",0) AS amt FROM lines_in_window WHERE "tax1_type" IS NOT NULL
        UNION ALL SELECT direction, "tax2_type", COALESCE("tax2_amount",0) FROM lines_in_window WHERE "tax2_type" IS NOT NULL
        UNION ALL SELECT direction, "tax3_type", COALESCE("tax3_amount",0) FROM lines_in_window WHERE "tax3_type" IS NOT NULL
        UNION ALL SELECT direction, "tax4_type", COALESCE("tax4_amount",0) FROM lines_in_window WHERE "tax4_type" IS NOT NULL
        UNION ALL SELECT direction, "tax5_type", COALESCE("tax5_amount",0) FROM lines_in_window WHERE "tax5_type" IS NOT NULL
        UNION ALL SELECT direction, "tax6_type", COALESCE("tax6_amount",0) FROM lines_in_window WHERE "tax6_type" IS NOT NULL
        UNION ALL SELECT direction, "tax7_type", COALESCE("tax7_amount",0) FROM lines_in_window WHERE "tax7_type" IS NOT NULL
        UNION ALL SELECT direction, "tax8_type", COALESCE("tax8_amount",0) FROM lines_in_window WHERE "tax8_type" IS NOT NULL
      )
      SELECT direction, tax_type, COUNT(*)::int AS line_count, SUM(amt)::float AS total
        FROM flat
       GROUP BY direction, tax_type
       ORDER BY tax_type, direction
    `;
    const r = await ctx.pool.query(sql, [ctx.windowStart, ctx.windowEnd]);

    if (r.rows.length === 0) {
        return { subject: '', html: '', skip: true, skipReason: 'No tax lines in the prior month' };
    }

    const month = ctx.windowStart.toISOString().slice(0, 7);
    const xlsxRows = r.rows.map((row: any) => ({
        'Tax Type':    row.tax_type,
        'Direction':   row.direction || '',
        'Lines':       Number(row.line_count || 0),
        'Total (EGP)': Number(row.total || 0),
    }));

    // Pivot for the email body — one card per tax type, Output - Input.
    const byType = new Map<string, { sent: number; received: number }>();
    for (const row of r.rows) {
        const key = String(row.tax_type);
        if (!byType.has(key)) byType.set(key, { sent: 0, received: 0 });
        const entry = byType.get(key)!;
        if (row.direction === 'Sent') entry.sent += Number(row.total || 0);
        else                          entry.received += Number(row.total || 0);
    }

    const xlsx = buildXlsx([{ name: `Tax_${month}`, rows: xlsxRows }]);
    const cards = Array.from(byType.entries())
        .map(([type, v]) => statCard(type, fmtMoney(v.sent - v.received), `Sent ${fmtMoney(v.sent)} − Received ${fmtMoney(v.received)}`, '#1e40af'))
        .join('');

    const baseUrl = process.env.FRONTEND_URL || 'https://otax.onrender.com';
    const body = `
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
        ${cards}
      </div>
      <p style="color:#475569;font-size:13px;line-height:1.6;">
        Each card shows the net amount per ETA tax type for ${month}. Full breakdown per tax type
        × direction (Sent / Received) is in the attached Excel.
      </p>
    `;

    return {
        subject: `🧾 OTax — Tax breakdown ${month} — ${ctx.orgName}`,
        html: reportTemplate({
            title: `Tax Breakdown — ${month}`,
            intro: `Per-tax-type totals for ${ctx.orgName}.`,
            body, accent: '#1e40af',
            ctaHref: `${baseUrl}/reports`, ctaLabel: 'Open Reports',
        }),
        attachment: { filename: `OTax-Tax-Breakdown-${month}.xlsx`, content: xlsx },
    };
};

// ─── Generator: AR Aging Report ─────────────────────────────────────────
//
// Sent invoices grouped into aging buckets (0-30 / 31-60 / 61-90 / 90+ days
// from issue date). Cash-flow snapshot for the org's accounts receivable.

const genArAging = async (ctx: ReportContext): Promise<ReportResult> => {
    const t = await getDocsTable(ctx.pool, ctx.orgId, ctx.orgName);
    if (!t) return { subject: '', html: '', skip: true, skipReason: 'No documents table for this org yet' };

    const r = await ctx.pool.query(
        `SELECT uuid, "internalId", "receiverId", "receiverName",
                "dateTimeIssued", total, currency,
                EXTRACT(EPOCH FROM (NOW() - "dateTimeIssued")) / 86400.0 AS age_days
           FROM "InvoicesDb"."${t.docs}"
          WHERE direction = 'Sent' AND status = 'Valid'
            AND "dateTimeIssued" IS NOT NULL
          ORDER BY "dateTimeIssued" ASC`
    );

    if (r.rows.length === 0) {
        return { subject: '', html: '', skip: true, skipReason: 'No Valid Sent invoices for this org' };
    }

    const buckets = { '0-30': { count: 0, total: 0 }, '31-60': { count: 0, total: 0 }, '61-90': { count: 0, total: 0 }, '90+': { count: 0, total: 0 } };
    const xlsxRows = r.rows.map((row: any) => {
        const ageDays = Math.max(0, Math.round(Number(row.age_days || 0)));
        const bucket: keyof typeof buckets = ageDays <= 30 ? '0-30' : ageDays <= 60 ? '31-60' : ageDays <= 90 ? '61-90' : '90+';
        buckets[bucket].count += 1;
        buckets[bucket].total += Number(row.total || 0);
        return {
            'Internal ID':    row.internalId || '',
            'UUID':           row.uuid,
            'Customer Tax':   row.receiverId || '',
            'Customer Name':  row.receiverName || '',
            'Date Issued':    fmtDate(row.dateTimeIssued),
            'Age (days)':     ageDays,
            'Bucket':         bucket,
            'Total (EGP)':    Number(row.total || 0),
            'Currency':       row.currency || 'EGP',
        };
    });

    const summarySheet = (Object.keys(buckets) as Array<keyof typeof buckets>).map(b => ({
        Bucket:        b,
        Invoices:      buckets[b].count,
        'Total (EGP)': buckets[b].total,
    }));

    const xlsx = buildXlsx([
        { name: 'Summary', rows: summarySheet },
        { name: 'Detail',  rows: xlsxRows },
    ]);

    const baseUrl = process.env.FRONTEND_URL || 'https://otax.onrender.com';
    const body = `
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
        ${statCard('0-30 days',  String(buckets['0-30'].count),  `${fmtMoney(buckets['0-30'].total)} EGP`,  '#059669')}
        ${statCard('31-60 days', String(buckets['31-60'].count), `${fmtMoney(buckets['31-60'].total)} EGP`, '#1e40af')}
        ${statCard('61-90 days', String(buckets['61-90'].count), `${fmtMoney(buckets['61-90'].total)} EGP`, '#ea580c')}
        ${statCard('90+ days',   String(buckets['90+'].count),   `${fmtMoney(buckets['90+'].total)} EGP`,   '#dc2626')}
      </div>
      <p style="color:#475569;font-size:13px;line-height:1.6;">
        Aging buckets are computed from <strong>dateTimeIssued</strong>. Note: this report doesn't yet
        cross-check the bank reconciliation tables, so partially-paid invoices may still appear here
        at full value. Treat the older buckets as collection priorities.
      </p>
    `;

    const stamp = ctx.windowEnd.toISOString().slice(0, 10);
    return {
        subject: `💰 OTax — AR aging — ${ctx.orgName}`,
        html: reportTemplate({
            title: `AR Aging — ${ctx.orgName}`,
            intro: `Outstanding receivables by age bucket.`,
            body, accent: '#1e40af',
            ctaHref: `${baseUrl}/reports`, ctaLabel: 'Open Reports',
        }),
        attachment: { filename: `OTax-AR-Aging-${stamp}.xlsx`, content: xlsx },
    };
};

// ─── Generator: Duplicate Invoice Detection ─────────────────────────────
//
// Same internal_id appearing on more than one document — usually means the
// ERP re-submitted, or a typo in the manual entry. ETA accepts both, so it's
// up to us to flag.

const genDuplicateInvoices = async (ctx: ReportContext): Promise<ReportResult> => {
    const t = await getDocsTable(ctx.pool, ctx.orgId, ctx.orgName);
    if (!t) return { subject: '', html: '', skip: true, skipReason: 'No documents table for this org yet' };

    const r = await ctx.pool.query(
        `SELECT "internalId", direction, COUNT(*)::int AS dup_count,
                ARRAY_AGG(uuid ORDER BY "dateTimeIssued") AS uuids,
                ARRAY_AGG(status ORDER BY "dateTimeIssued") AS statuses,
                ARRAY_AGG("dateTimeIssued" ORDER BY "dateTimeIssued") AS dates,
                MIN("dateTimeIssued") AS first_seen,
                MAX("dateTimeIssued") AS last_seen,
                SUM(total)::float AS total_sum
           FROM "InvoicesDb"."${t.docs}"
          WHERE "internalId" IS NOT NULL AND "internalId" <> ''
       GROUP BY "internalId", direction
         HAVING COUNT(*) > 1
       ORDER BY dup_count DESC, last_seen DESC
          LIMIT 500`
    );

    if (r.rows.length === 0) {
        return { subject: '', html: '', skip: true, skipReason: 'No duplicate internal IDs detected' };
    }

    const xlsxRows = r.rows.map((row: any) => ({
        'Internal ID':  row.internalId,
        'Direction':    row.direction || '',
        'Count':        Number(row.dup_count || 0),
        'First Seen':   fmtDate(row.first_seen),
        'Last Seen':    fmtDate(row.last_seen),
        'UUIDs':        Array.isArray(row.uuids) ? row.uuids.join(' | ') : '',
        'Statuses':     Array.isArray(row.statuses) ? row.statuses.join(' | ') : '',
        'Total (sum)':  Number(row.total_sum || 0),
    }));
    const xlsx = buildXlsx([{ name: 'Duplicates', rows: xlsxRows }]);

    const baseUrl = process.env.FRONTEND_URL || 'https://otax.onrender.com';
    const body = `
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
        ${statCard('Duplicate Internal IDs', String(r.rows.length), 'distinct keys', '#dc2626')}
      </div>
      <p style="color:#475569;font-size:13px;line-height:1.6;">
        Each row is one Internal ID that appears on more than one document. Common causes: the ERP
        re-submitting with the same number, manual entry typo, or a credit/debit note re-using the
        original invoice's ID. Review and either cancel the duplicates or correct the ERP feed.
      </p>
    `;

    const stamp = ctx.windowEnd.toISOString().slice(0, 10);
    return {
        subject: `🔁 OTax — Duplicate invoices (${r.rows.length}) — ${ctx.orgName}`,
        html: reportTemplate({
            title: `Duplicate Internal IDs — ${ctx.orgName}`,
            intro: `${r.rows.length} duplicate Internal ID key(s) detected.`,
            body, accent: '#dc2626',
            ctaHref: `${baseUrl}/reports`, ctaLabel: 'Open Reports',
        }),
        attachment: { filename: `OTax-Duplicates-${stamp}.xlsx`, content: xlsx },
    };
};

// ─── Generator: High-Value Invoice Alert ────────────────────────────────
//
// Daily list of invoices issued in the window with total ≥ HIGH_VALUE_THRESHOLD.
// Useful for fraud/error catch on big-ticket sales — anything unexpectedly
// large should be reviewed before it's locked by ETA.

const HIGH_VALUE_THRESHOLD = Number(process.env.OTAX_HIGH_VALUE_THRESHOLD || 100_000);

const genHighValueInvoices = async (ctx: ReportContext): Promise<ReportResult> => {
    const t = await getDocsTable(ctx.pool, ctx.orgId, ctx.orgName);
    if (!t) return { subject: '', html: '', skip: true, skipReason: 'No documents table for this org yet' };

    const r = await ctx.pool.query(
        `SELECT uuid, "internalId", direction, status,
                "issuerName", "receiverId", "receiverName",
                "dateTimeIssued", total, currency
           FROM "InvoicesDb"."${t.docs}"
          WHERE total >= $1
            AND "dateTimeIssued" >= $2 AND "dateTimeIssued" < $3
          ORDER BY total DESC`,
        [HIGH_VALUE_THRESHOLD, ctx.windowStart, ctx.windowEnd]
    );

    if (r.rows.length === 0) {
        return { subject: '', html: '', skip: true, skipReason: `No invoices ≥ ${HIGH_VALUE_THRESHOLD} in the window` };
    }

    const totalSum = r.rows.reduce((s: number, x: any) => s + Number(x.total || 0), 0);
    const xlsxRows = r.rows.map((row: any) => ({
        'UUID':           row.uuid,
        'Internal ID':    row.internalId || '',
        'Direction':      row.direction || '',
        'Status':         row.status,
        'Issuer Name':    row.issuerName || '',
        'Customer Tax':   row.receiverId || '',
        'Customer Name':  row.receiverName || '',
        'Date Issued':    fmtDate(row.dateTimeIssued),
        'Total (EGP)':    Number(row.total || 0),
        'Currency':       row.currency || 'EGP',
    }));
    const xlsx = buildXlsx([{ name: 'High_Value', rows: xlsxRows }]);

    const baseUrl = process.env.FRONTEND_URL || 'https://otax.onrender.com';
    const body = `
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
        ${statCard(`≥ ${fmtMoney(HIGH_VALUE_THRESHOLD)} EGP`, String(r.rows.length), `${fmtMoney(totalSum)} EGP total`, '#1e40af')}
      </div>
      <p style="color:#475569;font-size:13px;line-height:1.6;">
        Threshold is currently <strong>${fmtMoney(HIGH_VALUE_THRESHOLD)} EGP</strong> (override via
        <code>OTAX_HIGH_VALUE_THRESHOLD</code>). Review each entry before ETA's reverse window closes —
        a typo in <code>quantity</code> or <code>unitPrice</code> can easily inflate by 10× or more.
      </p>
    `;

    const stamp = ctx.windowEnd.toISOString().slice(0, 10);
    return {
        subject: `💎 OTax — High-value invoices (${r.rows.length}) — ${ctx.orgName}`,
        html: reportTemplate({
            title: `High-Value Invoices — ${ctx.orgName}`,
            intro: `${r.rows.length} invoice(s) at or above the threshold.`,
            body, accent: '#1e40af',
            ctaHref: `${baseUrl}/invoices`, ctaLabel: 'Open Invoices',
        }),
        attachment: { filename: `OTax-HighValue-${stamp}.xlsx`, content: xlsx },
    };
};

// ─── Generator: Daily Sync Report ───────────────────────────────────────
//
// Operations dashboard for the last 24h: how many docs synced from ETA,
// how many ERP imports ran, signing-queue state. One sheet per source.

const genDailySync = async (ctx: ReportContext): Promise<ReportResult> => {
    const t = await getDocsTable(ctx.pool, ctx.orgId, ctx.orgName);
    if (!t) return { subject: '', html: '', skip: true, skipReason: 'No documents table for this org yet' };

    // ETA syncs — docs whose `synced_at` falls in the window, grouped by status.
    const etaCounts = await ctx.pool.query(
        `SELECT status, direction, COUNT(*)::int AS c, SUM(total)::float AS amt
           FROM "InvoicesDb"."${t.docs}"
          WHERE synced_at >= $1 AND synced_at < $2
       GROUP BY status, direction
       ORDER BY status, direction`,
        [ctx.windowStart, ctx.windowEnd]
    );

    // ERP runs in the window (best-effort — table may not exist).
    let erpRows: any[] = [];
    try {
        const r = await ctx.pool.query(
            `SELECT id, started_at, finished_at, status, fetched_count, submitted_count, failed_count, skipped_count, triggered_by, error_message
               FROM "otaxdb".erp_runs
              WHERE organization_id = $1
                AND started_at >= $2 AND started_at < $3
              ORDER BY started_at DESC LIMIT 200`,
            [ctx.orgId, ctx.windowStart, ctx.windowEnd]
        );
        erpRows = r.rows;
    } catch { /* erp_runs may not exist yet */ }

    // Signing queue snapshot (current state, not windowed).
    let queueRows: any[] = [];
    try {
        const r = await ctx.pool.query(
            `SELECT status, COUNT(*)::int AS c
               FROM "otaxdb".signing_queue
              WHERE org_id = $1
           GROUP BY status`,
            [ctx.orgId]
        );
        queueRows = r.rows;
    } catch { /* signing_queue may not exist yet */ }

    const totalSynced = etaCounts.rows.reduce((s: number, x: any) => s + Number(x.c || 0), 0);
    if (totalSynced === 0 && erpRows.length === 0) {
        return { subject: '', html: '', skip: true, skipReason: 'No sync activity in the window' };
    }

    const etaSheet = etaCounts.rows.map((r: any) => ({
        'Status':      r.status,
        'Direction':   r.direction || '',
        'Count':       Number(r.c || 0),
        'Total (EGP)': Number(r.amt || 0),
    }));
    const erpSheet = erpRows.map((r: any) => ({
        'Run ID':       r.id,
        'Started At':   fmtDate(r.started_at),
        'Finished At':  fmtDate(r.finished_at),
        'Status':       r.status,
        'Fetched':      r.fetched_count,
        'Submitted':    r.submitted_count,
        'Failed':       r.failed_count,
        'Skipped':      r.skipped_count,
        'Triggered By': r.triggered_by,
        'Error':        r.error_message || '',
    }));
    const queueSheet = queueRows.map((r: any) => ({
        'Status': r.status,
        'Count':  Number(r.c || 0),
    }));

    const xlsx = buildXlsx([
        { name: 'ETA_Sync',     rows: etaSheet.length ? etaSheet : [{ note: 'no rows' }] },
        { name: 'ERP_Runs',     rows: erpSheet.length ? erpSheet : [{ note: 'no rows' }] },
        { name: 'Signing_Queue', rows: queueSheet.length ? queueSheet : [{ note: 'no rows' }] },
    ]);

    const erpSucceeded = erpRows.filter(r => r.status === 'success').length;
    const erpFailed    = erpRows.filter(r => r.status === 'failed').length;
    const queueFailed  = queueRows.find(r => r.status === 'FAILED')?.c || 0;

    const baseUrl = process.env.FRONTEND_URL || 'https://otax.onrender.com';
    const body = `
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
        ${statCard('Synced from ETA', String(totalSynced), 'docs in 24h', '#1e40af')}
        ${statCard('ERP runs', `${erpSucceeded}/${erpRows.length}`, 'ok / total', erpFailed > 0 ? '#dc2626' : '#059669')}
        ${statCard('Signing queue', String(queueFailed), 'failed (current)', queueFailed > 0 ? '#dc2626' : '#059669')}
      </div>
      <p style="color:#475569;font-size:13px;line-height:1.6;">
        Ops snapshot — 24-hour activity from ETA (per status × direction), ERP Connector run history,
        and the current signing queue state. Anything anomalous shows up here before it bites in
        the morning.
      </p>
    `;

    const stamp = ctx.windowEnd.toISOString().slice(0, 10);
    return {
        subject: `🔧 OTax — Daily sync report — ${ctx.orgName}`,
        html: reportTemplate({
            title: `Daily Sync Report — ${ctx.orgName}`,
            intro: `Operational snapshot for the last 24 hours.`,
            body, accent: '#1e40af',
            ctaHref: `${baseUrl}/system-health`, ctaLabel: 'Open System Health',
        }),
        attachment: { filename: `OTax-DailySync-${stamp}.xlsx`, content: xlsx },
    };
};

// ─── Generator: Invoices & Tax (Daily) ──────────────────────────────────
//
// One-stop daily snapshot: every invoice in the last 24h with its VAT
// breakdown alongside it. Two perspectives (Sent / Received) on separate
// sheets so the org gets a single drop-in deliverable for daily
// reconciliation. Different from the monthly VAT pack — this is unfiltered
// (includes every status, not just Valid) and windowed at 24h.

const genInvoicesTaxDaily = async (ctx: ReportContext): Promise<ReportResult> => {
    const t = await getDocsTable(ctx.pool, ctx.orgId, ctx.orgName);
    if (!t) return { subject: '', html: '', skip: true, skipReason: 'No documents table for this org yet' };

    const sql = `
      SELECT d.uuid, d."internalId", d."submissionId", d.direction, d.status,
             d."issuerId", d."issuerName", d."receiverId", d."receiverName",
             d."dateTimeIssued", d."dateTimeReceived",
             d."totalSales", d."totalDiscount", d."netAmount", d.total, d.currency,
             d."typeName",
             COALESCE(SUM(
               CASE WHEN l."tax1_type" = 'T1' THEN COALESCE(l."tax1_amount",0) ELSE 0 END +
               CASE WHEN l."tax2_type" = 'T1' THEN COALESCE(l."tax2_amount",0) ELSE 0 END +
               CASE WHEN l."tax3_type" = 'T1' THEN COALESCE(l."tax3_amount",0) ELSE 0 END +
               CASE WHEN l."tax4_type" = 'T1' THEN COALESCE(l."tax4_amount",0) ELSE 0 END +
               CASE WHEN l."tax5_type" = 'T1' THEN COALESCE(l."tax5_amount",0) ELSE 0 END +
               CASE WHEN l."tax6_type" = 'T1' THEN COALESCE(l."tax6_amount",0) ELSE 0 END +
               CASE WHEN l."tax7_type" = 'T1' THEN COALESCE(l."tax7_amount",0) ELSE 0 END +
               CASE WHEN l."tax8_type" = 'T1' THEN COALESCE(l."tax8_amount",0) ELSE 0 END
             ), 0) AS vat_amount,
             COALESCE(SUM(
               COALESCE(l."tax1_amount",0) + COALESCE(l."tax2_amount",0) + COALESCE(l."tax3_amount",0) + COALESCE(l."tax4_amount",0) +
               COALESCE(l."tax5_amount",0) + COALESCE(l."tax6_amount",0) + COALESCE(l."tax7_amount",0) + COALESCE(l."tax8_amount",0)
             ), 0) AS all_tax_amount
        FROM "InvoicesDb"."${t.docs}" d
   LEFT JOIN "InvoicesDb"."${t.lines}" l ON l.document_uuid = d.uuid
       WHERE COALESCE(d."dateTimeReceived", d."dateTimeIssued") >= $1
         AND COALESCE(d."dateTimeReceived", d."dateTimeIssued") <  $2
    GROUP BY d.uuid, d."internalId", d."submissionId", d.direction, d.status,
             d."issuerId", d."issuerName", d."receiverId", d."receiverName",
             d."dateTimeIssued", d."dateTimeReceived",
             d."totalSales", d."totalDiscount", d."netAmount", d.total, d.currency,
             d."typeName"
    ORDER BY d."dateTimeIssued" DESC
    `;
    const r = await ctx.pool.query(sql, [ctx.windowStart, ctx.windowEnd]);

    if (r.rows.length === 0) {
        return { subject: '', html: '', skip: true, skipReason: 'No invoices in the window' };
    }

    const rowToXlsx = (row: any) => ({
        'Internal ID':     row.internalId || '',
        'UUID':            row.uuid,
        'Submission ID':   row.submissionId || '',
        'Type':            row.typeName || '',
        'Status':          row.status,
        'Issuer Tax ID':   row.issuerId || '',
        'Issuer Name':     row.issuerName || '',
        'Receiver Tax ID': row.receiverId || '',
        'Receiver Name':   row.receiverName || '',
        'Date Issued':     fmtDate(row.dateTimeIssued),
        'Date Received':   fmtDate(row.dateTimeReceived),
        'Total Sales':     Number(row.totalSales || 0),
        'Discount':        Number(row.totalDiscount || 0),
        'Net Amount':      Number(row.netAmount || 0),
        'VAT (T1)':        Number(row.vat_amount || 0),
        'All Taxes':       Number(row.all_tax_amount || 0),
        'Total':           Number(row.total || 0),
        'Currency':        row.currency || 'EGP',
    });

    const sent     = r.rows.filter((x: any) => x.direction === 'Sent');
    const received = r.rows.filter((x: any) => x.direction === 'Received');
    const sentRows     = sent.map(rowToXlsx);
    const receivedRows = received.map(rowToXlsx);

    const sumOf = (rows: any[], key: string) =>
        rows.reduce((s: number, x: any) => s + Number(x[key] || 0), 0);

    const sentTotal     = sumOf(sent, 'total');
    const receivedTotal = sumOf(received, 'total');
    const sentVat       = sumOf(sent, 'vat_amount');
    const receivedVat   = sumOf(received, 'vat_amount');

    const summaryRows = [
        { Metric: 'Window',                        Value: `${fmtDate(ctx.windowStart)} → ${fmtDate(ctx.windowEnd)}` },
        { Metric: 'Sent invoices (count)',         Value: sentRows.length },
        { Metric: 'Sent total (EGP)',              Value: sentTotal },
        { Metric: 'Sent VAT — T1 (EGP)',           Value: sentVat },
        { Metric: 'Received invoices (count)',     Value: receivedRows.length },
        { Metric: 'Received total (EGP)',          Value: receivedTotal },
        { Metric: 'Received VAT — T1 (EGP)',       Value: receivedVat },
        { Metric: 'Net VAT (Sent − Received, EGP)', Value: sentVat - receivedVat },
    ];

    const xlsx = buildXlsx([
        { name: 'Summary',  rows: summaryRows },
        { name: 'Sent',     rows: sentRows },
        { name: 'Received', rows: receivedRows },
    ]);

    const netVat = sentVat - receivedVat;
    const baseUrl = process.env.FRONTEND_URL || 'https://otax.onrender.com';
    const body = `
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
        ${statCard('Sent',     String(sentRows.length),     `${fmtMoney(sentTotal)} EGP`,     '#1e40af')}
        ${statCard('Received', String(receivedRows.length), `${fmtMoney(receivedTotal)} EGP`, '#0ea5e9')}
        ${statCard('Net VAT',  `${fmtMoney(netVat)}`,       'T1, EGP',                        netVat >= 0 ? '#059669' : '#dc2626')}
      </div>
      <p style="color:#475569;font-size:13px;line-height:1.6;">
        Daily snapshot of every invoice with its full tax breakdown. The attached XLSX has
        three sheets: <strong>Summary</strong>, <strong>Sent</strong> (output), and
        <strong>Received</strong> (input). Use it as a quick check on daily VAT exposure
        before the monthly filing locks in.
      </p>
    `;

    const stamp = ctx.windowEnd.toISOString().slice(0, 10);
    return {
        subject: `📄 OTax — Invoices & Tax (${r.rows.length}) — ${ctx.orgName}`,
        html: reportTemplate({
            title: `Invoices & Tax — ${ctx.orgName}`,
            intro: `${r.rows.length} invoice(s) in the last 24 hours, with VAT breakdown.`,
            body, accent: '#1e40af',
            ctaHref: `${baseUrl}/invoices`, ctaLabel: 'Open Invoices',
        }),
        attachment: { filename: `OTax-Invoices-Tax-${stamp}.xlsx`, content: xlsx },
    };
};

// ─── Catalogue (the worker walks this list) ─────────────────────────────

export const REPORT_CATALOGUE: ReportDefinition[] = [
    {
        id: 'invoices_tax_daily',
        label: 'Invoices & Tax Report',
        description: 'Daily XLSX with every invoice in the last 24h plus its VAT breakdown — Summary / Sent / Received sheets.',
        defaultCadence: 'daily',
        windowKind: 'last24h',
        generator: genInvoicesTaxDaily,
    },
    {
        id: 'invalid_invoices',
        label: 'Invalid / Rejected Invoices',
        description: 'XLSX with every Invalid or Rejected invoice in the period, including ETA rejection reasons. Best as Daily.',
        defaultCadence: 'daily',
        windowKind: 'last24h',
        generator: genInvalidInvoices,
    },
    {
        id: 'vat_pack',
        label: 'Pre-Filing VAT Pack',
        description: 'Monthly XLSX of every Valid invoice grouped Sent/Received with Output VAT, Input VAT, and Net Payable. Drop-in for the ETA filing portal.',
        defaultCadence: 'monthly',
        windowKind: 'priorMonth',
        generator: genVatPack,
    },
    {
        id: 'late_submissions',
        label: 'Late Submissions',
        description: 'XLSX of Sent invoices submitted >48h after issuance — flags ERP latency and avoids ETA penalties.',
        defaultCadence: 'daily',
        windowKind: 'last24h',
        generator: genLateSubmissions,
    },
    {
        id: 'weekly_revenue',
        label: 'Weekly Revenue Summary',
        description: 'Weekly XLSX: revenue this week vs prior, top 5 customers, top 5 invoices.',
        defaultCadence: 'weekly',
        windowKind: 'last7d',
        generator: genWeeklyRevenue,
    },
    {
        id: 'reconciliation_gaps',
        label: 'Reconciliation Gaps',
        description: 'Weekly XLSX: ETA invoices without ERP match, ERP rows without ETA match, and suggested matches awaiting approval.',
        defaultCadence: 'weekly',
        windowKind: 'last7d',
        generator: genReconciliationGaps,
    },
    {
        id: 'cancelled_within_deadline',
        label: 'Cancelled / Rejected Within Window',
        description: 'XLSX of invoices cancelled or rejected with ETA\'s 72-hour reverse window still open — fix before the deadline closes.',
        defaultCadence: 'daily',
        windowKind: 'last7d',
        generator: genCancelledWithinDeadline,
    },
    {
        id: 'tax_breakdown',
        label: 'Tax Breakdown (T1–T8)',
        description: 'Monthly XLSX aggregating each ETA tax type (T1 VAT, T2 special, etc.) by direction. Useful for non-VAT special-tax filings.',
        defaultCadence: 'monthly',
        windowKind: 'priorMonth',
        generator: genTaxBreakdown,
    },
    {
        id: 'ar_aging',
        label: 'AR Aging Report',
        description: 'Weekly XLSX bucketing every Sent + Valid invoice into 0-30 / 31-60 / 61-90 / 90+ days from issue.',
        defaultCadence: 'weekly',
        windowKind: 'last30d',
        generator: genArAging,
    },
    {
        id: 'duplicate_invoices',
        label: 'Duplicate Invoice Detection',
        description: 'Daily XLSX flagging Internal IDs that appear on more than one document — catches ERP re-submits and manual typos.',
        defaultCadence: 'daily',
        windowKind: 'last24h',
        generator: genDuplicateInvoices,
    },
    {
        id: 'high_value_invoices',
        label: 'High-Value Invoice Alert',
        description: 'XLSX of invoices with total ≥ threshold (default 100,000 EGP) issued in the window. Override via OTAX_HIGH_VALUE_THRESHOLD env var.',
        defaultCadence: 'daily',
        windowKind: 'last24h',
        generator: genHighValueInvoices,
    },
    {
        id: 'daily_sync',
        label: 'Daily Sync Report',
        description: 'Operations snapshot: ETA sync activity by status, ERP Connector run history, and current signing queue state.',
        defaultCadence: 'daily',
        windowKind: 'last24h',
        generator: genDailySync,
    },
];

export const REPORT_BY_ID: Record<string, ReportDefinition> = REPORT_CATALOGUE.reduce(
    (acc, r) => { acc[r.id] = r; return acc; },
    {} as Record<string, ReportDefinition>
);

// ─── Window helper ──────────────────────────────────────────────────────

export function computeWindow(kind: ReportDefinition['windowKind'], now: Date): { start: Date; end: Date } {
    const end = new Date(now);
    const start = new Date(now);
    switch (kind) {
        case 'last24h':    start.setHours(start.getHours() - 24); break;
        case 'last7d':     start.setDate(start.getDate() - 7); break;
        case 'last30d':    start.setDate(start.getDate() - 30); break;
        case 'priorMonth': {
            const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const firstOfPrev  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            return { start: firstOfPrev, end: firstOfMonth };
        }
        case 'thisMonth': {
            const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            return { start: firstOfMonth, end };
        }
    }
    return { start, end };
}
