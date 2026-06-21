/**
 * Reports Routes — analytical reports over the per-org documents table.
 *
 * Every endpoint here:
 *   - resolves the caller's organization via `resolveOrg(req)`
 *   - scopes ALL data access to that org's `org_<id>_<name>_documents` /
 *     `…_lines` tables (no cross-org reads)
 *   - accepts optional `dateFrom` + `dateTo` (YYYY-MM-DD) filters
 *   - returns `{ success, rows / data, totals? }` for consistent consumption
 *
 * Mounted at `/api/reports` (in addition to the legacy `/api/reports/duplicates`
 * endpoint that still lives in server.ts — kept there for backward compat).
 */

import { Router, Request, Response } from 'express';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import archiver from 'archiver';
import * as XLSX from 'xlsx';
import { authenticate } from '../middleware/auth.js';
import { getOrgTableNames } from '../services/orgTables.js';
import { createETAServiceFromSettings } from '../services/etaService.js';
import { forecast as forecastSeries } from '../services/forecasting.js';
import { robustStats, scoreInvoice, type CustomerStats, type InvoiceForScoring } from '../services/anomalyDetection.js';

const router = Router();
const prisma = new PrismaClient();

function getPool(req: Request): pg.Pool { return (req as any).app.get('pool'); }

async function resolveOrg(req: Request): Promise<{ orgId: number; orgName: string }> {
    const user = (req as any).user;
    let orgId = user?.organizationId || null;
    if (!orgId) {
        const first = await prisma.organizations.findFirst({ where: { is_active: true }, orderBy: { id: 'asc' } });
        if (!first) throw new Error('No organization found');
        orgId = first.id;
    }
    const org = await prisma.organizations.findUnique({ where: { id: orgId } });
    if (!org) throw new Error('Organization not found');
    return { orgId, orgName: org.name };
}

/** Common SQL date-range clause + params builder. */
function buildDateFilter(req: Request): { clause: string; params: any[] } {
    const params: any[] = [];
    const parts: string[] = [];
    if (req.query.dateFrom) {
        params.push(req.query.dateFrom);
        parts.push(`"dateTimeIssued" >= $${params.length}`);
    }
    if (req.query.dateTo) {
        params.push(String(req.query.dateTo) + 'T23:59:59Z');
        parts.push(`"dateTimeIssued" <= $${params.length}`);
    }
    return { clause: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
}

/** If the org's documents table doesn't exist yet, return an empty payload. */
async function ensureDocsTableOrEmpty<T>(
    pool: pg.Pool, orgId: number, orgName: string, res: Response, onReady: (docsTable: string, linesTable: string) => Promise<T>
): Promise<T | void> {
    const tables = getOrgTableNames(orgId, orgName);
    const exists = await pool.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'InvoicesDb' AND table_name = $1) AS exists`,
        [tables.documents]
    );
    if (!exists.rows[0]?.exists) {
        res.json({ success: true, rows: [], totals: {} });
        return;
    }
    return onReady(tables.documents, tables.lines);
}

// ──────────────────────────────────────────────────────────────────────
// 1. VAT Return Summary
//    Core report for the monthly VAT filing. Breaks down:
//      - Output VAT  (taxes collected on Sent invoices)
//      - Input VAT   (taxes paid on Received invoices)
//      - Net Payable = Output − Input
//    Detailed by month (row per month) + totals.
// ──────────────────────────────────────────────────────────────────────

router.get('/vat-summary', authenticate, async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        await ensureDocsTableOrEmpty(pool, orgId, orgName, res, async (docsTable, linesTable) => {
            const { clause, params } = buildDateFilter(req);

            // Sum VAT taxes per (month, direction). We only count rows whose
            // status allows the VAT to be claimed — 'Valid' on ETA. Rejected /
            // Cancelled invoices do not affect VAT.
            const sql = `
                WITH filtered AS (
                    SELECT d.uuid, d.direction,
                           to_char(d."dateTimeIssued", 'YYYY-MM') AS month,
                           d.status
                    FROM "InvoicesDb"."${docsTable}" d
                    WHERE d.status = 'Valid' ${clause}
                ),
                vat_per_doc AS (
                    SELECT f.uuid, f.direction, f.month,
                           COALESCE(SUM(
                             CASE
                               WHEN l."tax1_type" = 'T1' THEN COALESCE(l."tax1_amount", 0)
                               ELSE 0 END
                             + CASE WHEN l."tax2_type" = 'T1' THEN COALESCE(l."tax2_amount", 0) ELSE 0 END
                             + CASE WHEN l."tax3_type" = 'T1' THEN COALESCE(l."tax3_amount", 0) ELSE 0 END
                             + CASE WHEN l."tax4_type" = 'T1' THEN COALESCE(l."tax4_amount", 0) ELSE 0 END
                             + CASE WHEN l."tax5_type" = 'T1' THEN COALESCE(l."tax5_amount", 0) ELSE 0 END
                             + CASE WHEN l."tax6_type" = 'T1' THEN COALESCE(l."tax6_amount", 0) ELSE 0 END
                             + CASE WHEN l."tax7_type" = 'T1' THEN COALESCE(l."tax7_amount", 0) ELSE 0 END
                             + CASE WHEN l."tax8_type" = 'T1' THEN COALESCE(l."tax8_amount", 0) ELSE 0 END
                           ), 0) AS vat_amount,
                           COALESCE(SUM(l."netTotal"), 0) AS taxable_amount
                    FROM filtered f
                    LEFT JOIN "InvoicesDb"."${linesTable}" l ON l.document_uuid = f.uuid
                    GROUP BY f.uuid, f.direction, f.month
                )
                SELECT month,
                       SUM(CASE WHEN direction = 'Sent'     THEN taxable_amount ELSE 0 END)::float AS output_base,
                       SUM(CASE WHEN direction = 'Sent'     THEN vat_amount     ELSE 0 END)::float AS output_vat,
                       SUM(CASE WHEN direction = 'Received' THEN taxable_amount ELSE 0 END)::float AS input_base,
                       SUM(CASE WHEN direction = 'Received' THEN vat_amount     ELSE 0 END)::float AS input_vat,
                       COUNT(DISTINCT CASE WHEN direction = 'Sent'     THEN uuid END)::int AS sent_count,
                       COUNT(DISTINCT CASE WHEN direction = 'Received' THEN uuid END)::int AS received_count
                FROM vat_per_doc
                GROUP BY month
                ORDER BY month ASC
            `;
            const r = await pool.query(sql, params);

            const rows = r.rows.map((x: any) => ({
                month: x.month,
                outputBase: Number(x.output_base || 0),
                outputVat: Number(x.output_vat || 0),
                inputBase: Number(x.input_base || 0),
                inputVat: Number(x.input_vat || 0),
                netPayable: Number(x.output_vat || 0) - Number(x.input_vat || 0),
                sentCount: Number(x.sent_count || 0),
                receivedCount: Number(x.received_count || 0),
            }));

            const totals = rows.reduce((a, r) => ({
                outputBase: a.outputBase + r.outputBase,
                outputVat:  a.outputVat  + r.outputVat,
                inputBase:  a.inputBase  + r.inputBase,
                inputVat:   a.inputVat   + r.inputVat,
                netPayable: a.netPayable + r.netPayable,
                sentCount:  a.sentCount  + r.sentCount,
                receivedCount: a.receivedCount + r.receivedCount,
            }), { outputBase: 0, outputVat: 0, inputBase: 0, inputVat: 0, netPayable: 0, sentCount: 0, receivedCount: 0 });

            res.json({ success: true, rows, totals });
        });
    } catch (err: any) {
        console.error('[Reports] vat-summary error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// 2. Top Customers — aggregate receivers of OUR Sent invoices.
//    Ranks by total amount billed; also shows invoice count + last seen.
// ──────────────────────────────────────────────────────────────────────

router.get('/top-customers', authenticate, async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        await ensureDocsTableOrEmpty(pool, orgId, orgName, res, async (docsTable) => {
            const { clause, params } = buildDateFilter(req);
            const limit = Math.min(parseInt(String(req.query.limit || '50')) || 50, 500);
            const sql = `
                SELECT "receiverId", "receiverName",
                       COUNT(*)::int AS count,
                       ROUND(COALESCE(SUM(CAST(total AS NUMERIC)), 0), 2)::float AS total_amount,
                       ROUND(COALESCE(AVG(CAST(total AS NUMERIC)), 0), 2)::float AS avg_amount,
                       MAX("dateTimeIssued") AS last_seen,
                       MIN("dateTimeIssued") AS first_seen
                FROM "InvoicesDb"."${docsTable}"
                WHERE direction = 'Sent' AND status = 'Valid'
                  AND "receiverId" IS NOT NULL AND "receiverId" <> '' ${clause}
                GROUP BY "receiverId", "receiverName"
                ORDER BY total_amount DESC
                LIMIT ${limit}
            `;
            const r = await pool.query(sql, params);
            res.json({ success: true, rows: r.rows, limit });
        });
    } catch (err: any) {
        console.error('[Reports] top-customers error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// 3. Top Products / Items — aggregate line items across invoices.
//    Shows qty + revenue + appearance count per itemCode.
// ──────────────────────────────────────────────────────────────────────

router.get('/top-products', authenticate, async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        await ensureDocsTableOrEmpty(pool, orgId, orgName, res, async (docsTable, linesTable) => {
            const { clause, params } = buildDateFilter(req);
            const limit = Math.min(parseInt(String(req.query.limit || '50')) || 50, 500);

            // Join lines to documents so we can apply the date + status filters.
            const sql = `
                SELECT l."itemCode",
                       MAX(l.description) AS description,
                       MAX(l."itemType")   AS item_type,
                       COUNT(*)::int AS line_count,
                       COUNT(DISTINCT l.document_uuid)::int AS invoice_count,
                       ROUND(COALESCE(SUM(l.quantity), 0), 2)::float   AS total_qty,
                       ROUND(COALESCE(SUM(l."netTotal"), 0), 2)::float AS total_net,
                       ROUND(COALESCE(SUM(l.total), 0), 2)::float      AS total_amount
                FROM "InvoicesDb"."${linesTable}" l
                JOIN "InvoicesDb"."${docsTable}" d ON d.uuid = l.document_uuid
                WHERE d.direction = 'Sent' AND d.status = 'Valid'
                  AND l."itemCode" IS NOT NULL AND l."itemCode" <> '' ${clause}
                GROUP BY l."itemCode"
                ORDER BY total_amount DESC
                LIMIT ${limit}
            `;
            const r = await pool.query(sql, params);
            res.json({ success: true, rows: r.rows, limit });
        });
    } catch (err: any) {
        console.error('[Reports] top-products error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// 4. Rejected / Invalid Invoices — with rejection reasons aggregated.
//    Two views:
//      - grouped=true  → top rejection reasons + counts (for headline chart)
//      - grouped=false → flat list of the rejected invoices themselves
// ──────────────────────────────────────────────────────────────────────

router.get('/rejected', authenticate, async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        await ensureDocsTableOrEmpty(pool, orgId, orgName, res, async (docsTable) => {
            const { clause, params } = buildDateFilter(req);
            const grouped = String(req.query.grouped || 'false').toLowerCase() === 'true';

            if (grouped) {
                // We can't cleanly group by a TEXT column that may contain very long JSON.
                // Fallback strategy: hash the first 200 chars of rejectionReasons so similar
                // reasons group together, and return the top 50 reason shapes.
                const sql = `
                    SELECT COALESCE(NULLIF(SUBSTRING(COALESCE("rejectionReasons", ''), 1, 200), ''), '(no reason)') AS reason,
                           COUNT(*)::int AS count,
                           ROUND(COALESCE(SUM(CAST(total AS NUMERIC)), 0), 2)::float AS total_amount
                    FROM "InvoicesDb"."${docsTable}"
                    WHERE status IN ('Rejected', 'Invalid') ${clause}
                    GROUP BY reason
                    ORDER BY count DESC
                    LIMIT 50
                `;
                const r = await pool.query(sql, params);
                res.json({ success: true, rows: r.rows, grouped: true });
            } else {
                const sql = `
                    SELECT uuid, "internalId", direction, "receiverId", "receiverName",
                           "dateTimeIssued", "dateTimeReceived", status,
                           CAST(total AS FLOAT) AS total,
                           "rejectionReasons", "documentStatusReason"
                    FROM "InvoicesDb"."${docsTable}"
                    WHERE status IN ('Rejected', 'Invalid') ${clause}
                    ORDER BY "dateTimeIssued" DESC NULLS LAST
                    LIMIT 500
                `;
                const r = await pool.query(sql, params);
                res.json({ success: true, rows: r.rows, grouped: false });
            }
        });
    } catch (err: any) {
        console.error('[Reports] rejected error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// 5. Time Trends — monthly time series for a line chart.
//    Returns: revenue, tax, count × (Sent | Received) per month.
// ──────────────────────────────────────────────────────────────────────

router.get('/trends', authenticate, async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        await ensureDocsTableOrEmpty(pool, orgId, orgName, res, async (docsTable, linesTable) => {
            const { clause, params } = buildDateFilter(req);
            const sql = `
                WITH monthly AS (
                    SELECT to_char(d."dateTimeIssued", 'YYYY-MM') AS month,
                           d.direction,
                           d.uuid,
                           COALESCE(SUM(
                             COALESCE(l."tax1_amount",0) + COALESCE(l."tax2_amount",0) +
                             COALESCE(l."tax3_amount",0) + COALESCE(l."tax4_amount",0) +
                             COALESCE(l."tax5_amount",0) + COALESCE(l."tax6_amount",0) +
                             COALESCE(l."tax7_amount",0) + COALESCE(l."tax8_amount",0)
                           ), 0) AS tax_amount,
                           d.total::float AS doc_total
                    FROM "InvoicesDb"."${docsTable}" d
                    LEFT JOIN "InvoicesDb"."${linesTable}" l ON l.document_uuid = d.uuid
                    WHERE d.status = 'Valid' ${clause}
                    GROUP BY d.uuid, d.direction, d.total
                )
                SELECT month,
                       SUM(CASE WHEN direction = 'Sent'     THEN doc_total   ELSE 0 END)::float AS sent_revenue,
                       SUM(CASE WHEN direction = 'Received' THEN doc_total   ELSE 0 END)::float AS received_revenue,
                       SUM(CASE WHEN direction = 'Sent'     THEN tax_amount  ELSE 0 END)::float AS sent_tax,
                       SUM(CASE WHEN direction = 'Received' THEN tax_amount  ELSE 0 END)::float AS received_tax,
                       COUNT(DISTINCT CASE WHEN direction = 'Sent'     THEN uuid END)::int AS sent_count,
                       COUNT(DISTINCT CASE WHEN direction = 'Received' THEN uuid END)::int AS received_count
                FROM monthly
                GROUP BY month
                ORDER BY month ASC
            `;
            const r = await pool.query(sql, params);
            res.json({ success: true, rows: r.rows });
        });
    } catch (err: any) {
        console.error('[Reports] trends error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// 6. Tax by Activity Code — useful for taxpayers with multiple activities.
// ──────────────────────────────────────────────────────────────────────

router.get('/by-activity', authenticate, async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        await ensureDocsTableOrEmpty(pool, orgId, orgName, res, async (docsTable, linesTable) => {
            const { clause, params } = buildDateFilter(req);
            const sql = `
                SELECT COALESCE(NULLIF(d."taxpayerActivityCode", ''), '(none)') AS activity_code,
                       COUNT(*)::int AS count,
                       ROUND(COALESCE(SUM(CAST(d.total AS NUMERIC)), 0), 2)::float AS total_amount,
                       ROUND(COALESCE(SUM(
                         COALESCE(l."tax1_amount",0) + COALESCE(l."tax2_amount",0) +
                         COALESCE(l."tax3_amount",0) + COALESCE(l."tax4_amount",0) +
                         COALESCE(l."tax5_amount",0) + COALESCE(l."tax6_amount",0) +
                         COALESCE(l."tax7_amount",0) + COALESCE(l."tax8_amount",0)
                       ), 0), 2)::float AS total_tax
                FROM "InvoicesDb"."${docsTable}" d
                LEFT JOIN "InvoicesDb"."${linesTable}" l ON l.document_uuid = d.uuid
                WHERE d.status = 'Valid' AND d.direction = 'Sent' ${clause}
                GROUP BY activity_code
                ORDER BY total_amount DESC
                LIMIT 100
            `;
            const r = await pool.query(sql, params);
            res.json({ success: true, rows: r.rows });
        });
    } catch (err: any) {
        console.error('[Reports] by-activity error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// 7. Late Submissions — invoices whose submission-to-issue gap exceeds a
//    threshold (default 48h). Helps spot compliance risk.
// ──────────────────────────────────────────────────────────────────────

router.get('/late-submissions', authenticate, async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        await ensureDocsTableOrEmpty(pool, orgId, orgName, res, async (docsTable) => {
            const { clause, params } = buildDateFilter(req);
            const thresholdHours = Math.max(1, parseInt(String(req.query.thresholdHours || '48')) || 48);
            const sql = `
                SELECT uuid, "internalId", direction, status,
                       "dateTimeIssued", "dateTimeReceived",
                       CAST(total AS FLOAT) AS total,
                       "receiverName",
                       EXTRACT(EPOCH FROM ("dateTimeReceived" - "dateTimeIssued")) / 3600.0 AS lag_hours
                FROM "InvoicesDb"."${docsTable}"
                WHERE "dateTimeIssued" IS NOT NULL AND "dateTimeReceived" IS NOT NULL
                  AND direction = 'Sent'
                  AND EXTRACT(EPOCH FROM ("dateTimeReceived" - "dateTimeIssued")) / 3600.0 > $${params.length + 1}
                  ${clause}
                ORDER BY lag_hours DESC
                LIMIT 500
            `;
            const r = await pool.query(sql, [...params, thresholdHours]);
            res.json({
                success: true,
                rows: r.rows.map((x: any) => ({ ...x, lag_hours: Number(x.lag_hours || 0) })),
                thresholdHours,
            });
        });
    } catch (err: any) {
        console.error('[Reports] late-submissions error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// 8. VAT Forecast — project the next month's Output/Input/Net VAT using
//    simple linear regression over the trailing 6 months. This is deliberately
//    not ML: a linear trend is the best compromise between "noise-resistant"
//    and "understandable" for monthly tax figures. We also return the trailing
//    mean + stddev so the UI can show a confidence band.
// ──────────────────────────────────────────────────────────────────────

router.get('/forecast', authenticate, async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        await ensureDocsTableOrEmpty(pool, orgId, orgName, res, async (docsTable, linesTable) => {
            // Pull up to 36 full months so seasonality (12-month cycle) can
            // emerge in orgs that have ≥2 years of history. Anything longer
            // doesn't pay off — too much weight on stale tax-regime changes.
            const sql = `
                WITH per_doc AS (
                    SELECT to_char(d."dateTimeIssued", 'YYYY-MM') AS month, d.direction, d.uuid,
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
                    FROM "InvoicesDb"."${docsTable}" d
                    LEFT JOIN "InvoicesDb"."${linesTable}" l ON l.document_uuid = d.uuid
                    WHERE d.status = 'Valid'
                      AND d."dateTimeIssued" >= date_trunc('month', NOW() - INTERVAL '36 months')
                      AND d."dateTimeIssued" <  date_trunc('month', NOW())
                    GROUP BY d.direction, d.uuid, month
                )
                SELECT month,
                       SUM(CASE WHEN direction = 'Sent'     THEN vat_amount ELSE 0 END)::float AS output_vat,
                       SUM(CASE WHEN direction = 'Received' THEN vat_amount ELSE 0 END)::float AS input_vat
                FROM per_doc
                GROUP BY month
                ORDER BY month ASC
            `;
            const r = await pool.query(sql);
            const history = r.rows.map((x: any) => ({
                month:     String(x.month),
                outputVat: Number(x.output_vat || 0),
                inputVat:  Number(x.input_vat  || 0),
                netVat:    Number((x.output_vat || 0) - (x.input_vat || 0)),
            }));

            // Not enough history → return a "cannot forecast" response rather than
            // projecting off 1-2 data points, which would be misleading.
            if (history.length < 3) {
                return res.json({
                    success: true, history, forecast: null,
                    message: history.length === 0
                        ? 'No historical VAT data yet.'
                        : `Need at least 3 months of data for a reliable forecast (found ${history.length}).`,
                });
            }

            // Holt-Winters (24+ months → seasonal, 4-23 months → linear, 3 months → simple).
            // The shared helper picks the right model based on how much history we have.
            const outSeries = history.map(h => h.outputVat);
            const inSeries  = history.map(h => h.inputVat);
            const outF = forecastSeries(outSeries)!;
            const inF  = forecastSeries(inSeries)!;

            // Next month label (YYYY-MM)
            const now = new Date();
            const nextMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

            res.json({
                success: true,
                history,
                forecast: {
                    month: nextMonth,
                    outputVat: outF.projection,
                    inputVat:  inF.projection,
                    netPayable: outF.projection - inF.projection,
                    // RMSE on the in-sample fit gives a tighter confidence band
                    // than the raw stddev did — it reflects how well the model
                    // actually tracks this particular org's history, not just
                    // the variance of the series.
                    confidence: {
                        outputStddev: outF.rmse,
                        inputStddev:  inF.rmse,
                        outputRange: [Math.max(0, outF.projection - outF.rmse), outF.projection + outF.rmse],
                        inputRange:  [Math.max(0, inF.projection - inF.rmse),  inF.projection + inF.rmse],
                    },
                    slopeOutput: outF.trend,
                    slopeInput:  inF.trend,
                    method: outF.method,   // 'holt_winters_seasonal' | 'holt_linear' | 'simple_exponential'
                },
            });
        });
    } catch (err: any) {
        console.error('[Reports] forecast error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// 9. Anomaly Detection — flag invoices whose amount is statistically unusual
//    for its context. Two heuristics:
//      A. Per-customer z-score: if a customer has ≥5 historical invoices and
//         a new invoice's amount is > mean + 2.5·stddev, flag it.
//      B. New-customer big-ticket: if we've never billed this customer and
//         their first invoice is > 3× the org's median invoice total, flag it.
//    Plus returns a severity score so the UI can rank them.
// ──────────────────────────────────────────────────────────────────────

router.get('/anomalies', authenticate, async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        await ensureDocsTableOrEmpty(pool, orgId, orgName, res, async (docsTable) => {
            const lookbackDays = Math.max(1, Math.min(parseInt(String(req.query.lookbackDays || '30')) || 30, 365));

            // Pull every invoice in the relevant window — both the lookback
            // (which we score) and a longer trailing year (to compute robust
            // per-customer stats from raw amounts in JS rather than via SQL).
            // The all-rows scan is fine at our SaaS scale (≤25k rows/org/year);
            // we'd switch to a materialised view if any tenant got bigger.
            const sql = `
                SELECT uuid, "internalId", "receiverId", "receiverName",
                       "dateTimeIssued", CAST(total AS FLOAT) AS total
                FROM "InvoicesDb"."${docsTable}"
                WHERE direction = 'Sent' AND status = 'Valid'
                  AND "receiverId" IS NOT NULL AND "receiverId" <> ''
                  AND "dateTimeIssued" >= NOW() - INTERVAL '365 days'
                ORDER BY "dateTimeIssued" ASC
            `;
            const r = await pool.query(sql);

            const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

            // Build per-customer history from rows OLDER than the lookback
            // window, so we don't compare an invoice against itself.
            const historyByCustomer: Record<string, number[]> = {};
            const allTimesByCustomer: Record<string, number[]> = {};
            const allAmountsForOrg: number[] = [];
            let weekendCount = 0;

            for (const row of r.rows) {
                const t = new Date(row.dateTimeIssued).getTime();
                const amount = Number(row.total || 0);
                if (amount <= 0) continue;
                allAmountsForOrg.push(amount);
                const dow = new Date(row.dateTimeIssued).getDay();
                if (dow === 5 || dow === 6) weekendCount++;
                if (!allTimesByCustomer[row.receiverId]) allTimesByCustomer[row.receiverId] = [];
                allTimesByCustomer[row.receiverId].push(t);
                if (t < cutoff) {
                    if (!historyByCustomer[row.receiverId]) historyByCustomer[row.receiverId] = [];
                    historyByCustomer[row.receiverId].push(amount);
                }
            }

            // Org median + weekend ratio (for the off-hours heuristic).
            const orgStats = robustStats(allAmountsForOrg);
            const weekendRatio = allAmountsForOrg.length > 0 ? weekendCount / allAmountsForOrg.length : 0;

            // Customer stats — raw amount + log-transformed amount, so the
            // scorer can pick the right space for the comparison.
            const customerStats = new Map<string, CustomerStats>();
            for (const [receiverId, amounts] of Object.entries(historyByCustomer)) {
                const raw = robustStats(amounts);
                const logs = amounts.map(a => Math.log10(Math.max(1, a)));
                const log = robustStats(logs);
                customerStats.set(receiverId, {
                    receiverId,
                    historyCount: amounts.length,
                    median: raw.median,
                    mad: raw.mad,
                    logMedian: log.median,
                    logMad: log.mad,
                });
            }

            // Score every invoice INSIDE the lookback window.
            const recentInvoices: InvoiceForScoring[] = r.rows
                .filter((row: any) => new Date(row.dateTimeIssued).getTime() >= cutoff)
                .map((row: any) => ({
                    uuid: row.uuid,
                    internalId: row.internalId,
                    receiverId: row.receiverId,
                    receiverName: row.receiverName,
                    dateTimeIssued: row.dateTimeIssued,
                    total: Number(row.total || 0),
                }));

            const ctx = {
                orgMedian: orgStats.median,
                weekendRatio,
                customerStats,
                customerRecentTimes: new Map(Object.entries(allTimesByCustomer)),
            };

            const allFlags: any[] = [];
            for (const inv of recentInvoices) {
                allFlags.push(...scoreInvoice(inv, ctx));
            }
            // Most-suspicious first, cap to a reasonable page.
            allFlags.sort((a, b) => b.severity - a.severity);

            res.json({
                success: true,
                lookbackDays,
                totalScanned: recentInvoices.length,
                anomalies: allFlags.slice(0, 200),
                method: 'modified_z_log_space + velocity + off_hours',
                debug: {
                    historicalSamples: allAmountsForOrg.length,
                    customersWithHistory: customerStats.size,
                    weekendRatio: Number(weekendRatio.toFixed(3)),
                    orgMedian: orgStats.median,
                },
            });
        });
    } catch (err: any) {
        console.error('[Reports] anomalies error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// 10. Archive ZIP — bulk download of every invoice in a date range, packaged
//    as a ZIP containing one JSON file per invoice plus a manifest.csv at
//    the root. Useful for offline backup, audit, and tax consultant hand-off.
//
//    The response streams the ZIP as it's built so multi-thousand-invoice
//    exports don't balloon memory.
//
//    Safety:
//      - Hard limit 5000 invoices per archive (HTTP 400 if exceeded — the user
//        narrows the date range). Prevents accidental DoS.
//      - Per-org scoped; we never pull from another org's table.
// ──────────────────────────────────────────────────────────────────────

router.get('/archive', authenticate, async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        const tables = getOrgTableNames(orgId, orgName);
        const tableCheck = await pool.query(
            `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'InvoicesDb' AND table_name = $1) AS exists`,
            [tables.documents]
        );
        if (!tableCheck.rows[0]?.exists) {
            return res.status(404).json({ success: false, message: 'No invoices yet for this organization.' });
        }

        const { clause, params } = buildDateFilter(req);
        const status    = String(req.query.status    || '').trim();  // optional filter
        const direction = String(req.query.direction || '').trim();  // 'Sent' | 'Received'
        const extra: string[] = [];
        if (status && status !== 'All') { params.push(status); extra.push(`status = $${params.length}`); }
        if (direction && direction !== 'All') { params.push(direction); extra.push(`direction = $${params.length}`); }
        const extraSQL = extra.length ? ` AND ${extra.join(' AND ')}` : '';

        // Cheap count pass so we can refuse absurdly-large exports without
        // streaming anything.
        const countQ = await pool.query(
            `SELECT COUNT(*)::int AS n FROM "InvoicesDb"."${tables.documents}" WHERE 1=1 ${clause} ${extraSQL}`,
            params
        );
        const total = Number(countQ.rows[0]?.n || 0);
        const MAX = 5000;
        if (total === 0) {
            return res.status(404).json({ success: false, message: 'No invoices match the selected range.' });
        }
        if (total > MAX) {
            return res.status(400).json({
                success: false,
                message: `Archive contains ${total} invoices; the per-request cap is ${MAX}. Narrow the date range and try again.`,
            });
        }

        // Optional: when ?fetchMissing=true, fill in missing documentBody by
        // calling ETA's /documents/{uuid}/raw on the fly. We persist what we
        // fetch back into the row so subsequent archives don't re-pay the
        // network cost. Disabled by default — synced invoices already have a
        // useful structured-JSON fallback and ETA has tight rate limits.
        const fetchMissing = String(req.query.fetchMissing || '').toLowerCase() === 'true';
        let etaService: any = null;
        if (fetchMissing) {
            try {
                const settings = await prisma.organization_settings.findUnique({ where: { organization_id: orgId } });
                if (settings) etaService = createETAServiceFromSettings(orgId, settings);
            } catch { /* ignore — best-effort */ }
        }

        // Stream the ZIP to the client. Compression level 6 is a good balance.
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `OTax-Archive-${orgId}-${stamp}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        const archive = archiver('zip', { zlib: { level: 6 } });
        archive.on('error', (err) => {
            console.error('[Reports][archive] archiver error:', err);
            try { res.end(); } catch {}
        });
        archive.pipe(res);

        let etaFetchedCount = 0;
        let etaFetchFailedCount = 0;

        // Manifest CSV — one row per invoice, suitable for opening in Excel
        // without needing to unzip each JSON.
        const manifestHeader = [
            'uuid', 'internalId', 'direction', 'status',
            'dateTimeIssued', 'dateTimeReceived',
            'issuerId', 'issuerName', 'receiverId', 'receiverName',
            'totalSales', 'netAmount', 'total', 'currency', 'environment',
        ].join(',') + '\n';
        let manifestBody = '';

        // Paginated read — 500 rows at a time so we keep memory bounded even
        // as `archive.append` streams behind us.
        const PAGE = 500;
        for (let offset = 0; offset < total; offset += PAGE) {
            const rowsRes = await pool.query(
                `SELECT uuid, "internalId", direction, status,
                        "dateTimeIssued", "dateTimeReceived",
                        "issuerId", "issuerName", "receiverId", "receiverName",
                        CAST("totalSales" AS FLOAT) AS "totalSales",
                        CAST("netAmount"  AS FLOAT) AS "netAmount",
                        CAST(total        AS FLOAT) AS total,
                        currency, environment,
                        "documentBody"
                 FROM "InvoicesDb"."${tables.documents}"
                 WHERE 1=1 ${clause} ${extraSQL}
                 ORDER BY "dateTimeIssued" ASC
                 LIMIT ${PAGE} OFFSET ${offset}`,
                params
            );

            for (const r of rowsRes.rows) {
                const safeName = String(r.internalId || r.uuid || 'invoice')
                    .replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
                const entryName = `invoices/${String(r.direction || 'unknown').toLowerCase()}/${safeName}_${String(r.uuid).slice(0, 12)}.json`;

                // Prefer the raw documentBody if present (what we originally
                // submitted / received from ETA); otherwise either fetch it
                // from ETA on demand (?fetchMissing=true) or fall back to the
                // structured header row so the archive still has useful data.
                let body: string;
                if (r.documentBody && String(r.documentBody).trim().length > 0) {
                    body = String(r.documentBody);
                } else if (etaService) {
                    try {
                        const fetched = await etaService.getDocument(r.uuid);
                        body = typeof fetched === 'string' ? fetched : JSON.stringify(fetched, null, 2);
                        // Cache it back so the next archive doesn't re-fetch.
                        // Best-effort — never block the stream on a write hiccup.
                        pool.query(
                            `UPDATE "InvoicesDb"."${tables.documents}" SET "documentBody" = $1 WHERE uuid = $2`,
                            [body, r.uuid]
                        ).catch(() => {});
                        etaFetchedCount++;
                    } catch (fetchErr: any) {
                        etaFetchFailedCount++;
                        const clean = { ...r };
                        delete (clean as any).documentBody;
                        body = JSON.stringify({ ...clean, _eta_fetch_error: fetchErr.message || 'unknown' }, null, 2);
                    }
                } else {
                    const clean = { ...r };
                    delete (clean as any).documentBody;
                    body = JSON.stringify(clean, null, 2);
                }
                archive.append(body, { name: entryName });

                const cell = (v: any) => {
                    if (v === null || v === undefined) return '';
                    const s = String(v).replace(/"/g, '""');
                    return /[",\n]/.test(s) ? `"${s}"` : s;
                };
                manifestBody += [
                    cell(r.uuid), cell(r.internalId), cell(r.direction), cell(r.status),
                    cell(r.dateTimeIssued ? new Date(r.dateTimeIssued).toISOString() : ''),
                    cell(r.dateTimeReceived ? new Date(r.dateTimeReceived).toISOString() : ''),
                    cell(r.issuerId), cell(r.issuerName), cell(r.receiverId), cell(r.receiverName),
                    cell(r.totalSales), cell(r.netAmount), cell(r.total),
                    cell(r.currency), cell(r.environment),
                ].join(',') + '\n';
            }
        }

        // Add the manifest + a small README so the ZIP is self-describing.
        archive.append(manifestHeader + manifestBody, { name: 'manifest.csv' });
        archive.append(
            [
                `OTax Archive — ${orgName} (org #${orgId})`,
                `Generated: ${new Date().toISOString()}`,
                `Range: ${req.query.dateFrom || 'all'} → ${req.query.dateTo || 'now'}`,
                `Filters: direction=${direction || 'All'}, status=${status || 'All'}`,
                `Total invoices: ${total}`,
                fetchMissing
                    ? `Backfill from ETA: ON — fetched ${etaFetchedCount}, failed ${etaFetchFailedCount}`
                    : `Backfill from ETA: OFF (re-run with ?fetchMissing=true to pull raw bodies for old invoices)`,
                '',
                'Contents:',
                '  /invoices/sent/*.json      — invoices you issued',
                '  /invoices/received/*.json  — invoices you received',
                '  /manifest.csv              — summary row per invoice',
            ].join('\n'),
            { name: 'README.txt' }
        );

        await archive.finalize();
    } catch (err: any) {
        console.error('[Reports][archive] error:', err.message);
        if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
        else res.end();
    }
});

// ──────────────────────────────────────────────────────────────────────
// 11b. Package export as XLSX — same filters the ETA package request uses
//      (date range + statuses + document types + Summary/Full), but produces
//      an Excel workbook from OUR local database instead of asking ETA.
//
//      Why local? ETA's package API only returns JSON or XML. Accountants
//      overwhelmingly want Excel, so we generate it locally, which has the
//      added benefits of being instant (no ETA wait) and offline-capable.
//
//      Output:
//        Summary  → 1 sheet   (document headers only)
//        Full     → 2 sheets  (Headers + Lines, with flat tax columns)
// ──────────────────────────────────────────────────────────────────────

router.get('/package-xlsx', authenticate, async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        const tables = getOrgTableNames(orgId, orgName);

        const tableCheck = await pool.query(
            `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'InvoicesDb' AND table_name = $1) AS exists`,
            [tables.documents]
        );
        if (!tableCheck.rows[0]?.exists) return res.status(404).json({ success: false, message: 'No invoices yet for this organization.' });

        const { clause, params } = buildDateFilter(req);
        const type = String(req.query.type || 'Summary').toLowerCase() === 'full' ? 'Full' : 'Summary';
        const rawStatuses = String(req.query.statuses || '').trim();
        const rawTypes = String(req.query.documentTypes || '').trim();
        const extra: string[] = [];
        if (rawStatuses) {
            const arr = rawStatuses.split(',').map(s => s.trim()).filter(Boolean);
            if (arr.length) { params.push(arr); extra.push(`status = ANY($${params.length}::text[])`); }
        }
        if (rawTypes) {
            const arr = rawTypes.split(',').map(s => s.trim()).filter(Boolean);
            if (arr.length) { params.push(arr); extra.push(`"typeName" = ANY($${params.length}::text[])`); }
        }
        const extraSQL = extra.length ? ` AND ${extra.join(' AND ')}` : '';

        // Hard cap — same pattern as the ZIP archive; keeps memory bounded.
        const MAX = 20000;
        const countRes = await pool.query(
            `SELECT COUNT(*)::int AS n FROM "InvoicesDb"."${tables.documents}" WHERE 1=1 ${clause} ${extraSQL}`,
            params
        );
        const total = Number(countRes.rows[0]?.n || 0);
        if (total === 0) return res.status(404).json({ success: false, message: 'No invoices match the selected range.' });
        if (total > MAX) {
            return res.status(400).json({
                success: false,
                message: `${total} invoices exceeds the ${MAX} cap for XLSX export — narrow the date range or use Archive ZIP for bulk downloads.`,
            });
        }

        const headersRes = await pool.query(
            `SELECT uuid, "internalId", "submissionId", "typeName", "typeVersionName",
                    status, direction, "dateTimeIssued", "dateTimeReceived",
                    "issuerId", "issuerName", "receiverId", "receiverName",
                    CAST("totalSales" AS FLOAT) AS "totalSales",
                    CAST("totalDiscount" AS FLOAT) AS "totalDiscount",
                    CAST("netAmount"  AS FLOAT) AS "netAmount",
                    CAST(total AS FLOAT) AS total,
                    currency, environment, "taxpayerActivityCode",
                    "rejectionReasons"
             FROM "InvoicesDb"."${tables.documents}"
             WHERE 1=1 ${clause} ${extraSQL}
             ORDER BY "dateTimeIssued" ASC`,
            params
        );

        const headerRows = headersRes.rows.map((d: any) => ({
            'UUID': d.uuid,
            'Internal ID': d.internalId || '',
            'Submission ID': d.submissionId || '',
            'Type': d.typeName || '',
            'Version': d.typeVersionName || '',
            'Status': d.status,
            'Direction': d.direction,
            'Issue Date': d.dateTimeIssued ? new Date(d.dateTimeIssued).toISOString() : '',
            'Receive Date': d.dateTimeReceived ? new Date(d.dateTimeReceived).toISOString() : '',
            'Issuer ID': d.issuerId || '',
            'Issuer Name': d.issuerName || '',
            'Receiver ID': d.receiverId || '',
            'Receiver Name': d.receiverName || '',
            'Sales Total': Number(d.totalSales || 0),
            'Discount Total': Number(d.totalDiscount || 0),
            'Net Amount': Number(d.netAmount || 0),
            'Total': Number(d.total || 0),
            'Currency': d.currency || 'EGP',
            'Env': d.environment || '',
            'Activity Code': d.taxpayerActivityCode || '',
            'Rejection Reasons': d.rejectionReasons || '',
        }));

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(headerRows), 'Headers');

        if (type === 'Full' && headerRows.length > 0) {
            // Pull every line for those invoices. For huge packages we page this
            // so the single-query result stays manageable.
            const uuids = headersRes.rows.map((h: any) => h.uuid);
            const linesRes = await pool.query(
                `SELECT document_uuid, line_number, description, "itemType", "itemCode", "internalCode",
                        "unitType", quantity, CAST("unitPrice" AS FLOAT) AS "unitPrice",
                        CAST("salesTotal" AS FLOAT) AS "salesTotal",
                        CAST("netTotal"  AS FLOAT) AS "netTotal",
                        CAST(total AS FLOAT) AS total,
                        CAST("discountAmount" AS FLOAT) AS "discountAmount",
                        "tax1_type", CAST("tax1_amount" AS FLOAT) AS "tax1_amount", "tax1_subtype", CAST("tax1_rate" AS FLOAT) AS "tax1_rate",
                        "tax2_type", CAST("tax2_amount" AS FLOAT) AS "tax2_amount", "tax2_subtype", CAST("tax2_rate" AS FLOAT) AS "tax2_rate",
                        "tax3_type", CAST("tax3_amount" AS FLOAT) AS "tax3_amount", "tax3_subtype", CAST("tax3_rate" AS FLOAT) AS "tax3_rate",
                        "tax4_type", CAST("tax4_amount" AS FLOAT) AS "tax4_amount", "tax4_subtype", CAST("tax4_rate" AS FLOAT) AS "tax4_rate"
                 FROM "InvoicesDb"."${tables.lines}"
                 WHERE document_uuid = ANY($1::text[])
                 ORDER BY document_uuid, line_number`,
                [uuids]
            );

            const lineRows = linesRes.rows.map((l: any) => ({
                'Invoice UUID': l.document_uuid,
                'Line #': l.line_number,
                'Description': l.description || '',
                'Item Type': l.itemType || '',
                'Item Code': l.itemCode || '',
                'Internal Code': l.internalCode || '',
                'Unit Type': l.unitType || '',
                'Quantity': Number(l.quantity || 0),
                'Unit Price': Number(l.unitPrice || 0),
                'Sales Total': Number(l.salesTotal || 0),
                'Discount': Number(l.discountAmount || 0),
                'Net Total': Number(l.netTotal || 0),
                'Total': Number(l.total || 0),
                'Tax1 Type':  l.tax1_type || '',  'Tax1 Sub': l.tax1_subtype || '', 'Tax1 %': Number(l.tax1_rate || 0), 'Tax1 Amount': Number(l.tax1_amount || 0),
                'Tax2 Type':  l.tax2_type || '',  'Tax2 Sub': l.tax2_subtype || '', 'Tax2 %': Number(l.tax2_rate || 0), 'Tax2 Amount': Number(l.tax2_amount || 0),
                'Tax3 Type':  l.tax3_type || '',  'Tax3 Sub': l.tax3_subtype || '', 'Tax3 %': Number(l.tax3_rate || 0), 'Tax3 Amount': Number(l.tax3_amount || 0),
                'Tax4 Type':  l.tax4_type || '',  'Tax4 Sub': l.tax4_subtype || '', 'Tax4 %': Number(l.tax4_rate || 0), 'Tax4 Amount': Number(l.tax4_amount || 0),
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lineRows), 'Lines');
        }

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `OTax-Package-${type}-${orgId}-${stamp}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (err: any) {
        console.error('[Reports] package-xlsx error:', err.message);
        if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
        else res.end();
    }
});

// ──────────────────────────────────────────────────────────────────────
// 12. Full invoice (header + lines + issuer) — used by the print-friendly view
//     so the client can render a clean A4 layout without going through the
//     ETA portal. Reads straight from the per-org documents + lines tables.
// ──────────────────────────────────────────────────────────────────────

router.get('/invoice/:uuid/full', authenticate, async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        const tables = getOrgTableNames(orgId, orgName);
        const uuid = String(req.params.uuid);

        const tableCheck = await pool.query(
            `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'InvoicesDb' AND table_name = $1) AS exists`,
            [tables.documents]
        );
        if (!tableCheck.rows[0]?.exists) return res.status(404).json({ success: false, message: 'No invoices yet.' });

        const [docR, linesR, orgR] = await Promise.all([
            pool.query(`SELECT * FROM "InvoicesDb"."${tables.documents}" WHERE uuid = $1 LIMIT 1`, [uuid]),
            pool.query(`SELECT * FROM "InvoicesDb"."${tables.lines}" WHERE document_uuid = $1 ORDER BY line_number ASC`, [uuid]),
            prisma.organizations.findUnique({ where: { id: orgId } }),
        ]);

        if (docR.rows.length === 0) return res.status(404).json({ success: false, message: 'Invoice not found.' });

        res.json({
            success: true,
            document: docR.rows[0],
            lines: linesR.rows,
            organization: orgR ? {
                id: orgR.id, name: orgR.name, tax_id: orgR.tax_id,
                company_type: orgR.company_type, country: orgR.country, city: orgR.city,
            } : null,
        });
    } catch (err: any) {
        console.error('[Reports] invoice/full error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
