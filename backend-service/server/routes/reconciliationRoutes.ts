/**
 * Reconciliation Routes — Phase 2 (ERP × Bank × ETA matching)
 *
 * Mounted at: /api/reconciliation
 *
 * Phase 2.1 (this file): imports only.
 *   POST /imports/erp         → upload ERP CSV/XLSX (AR/AP)
 *   POST /imports/bank        → upload bank statement CSV/XLSX
 *   GET  /imports/erp         → paginated list (with batch filter)
 *   GET  /imports/bank        → paginated list (with batch filter)
 *   GET  /imports/history     → list of all batches (both sides)
 *   DELETE /imports/:side/:batchId → undo a specific upload
 *
 * Future (2.2+): auto-match engine, match CRUD.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize, blockDemo, logActivity } from '../middleware/auth.js';
import { bulkLimiter } from '../middleware/rateLimit.js';
import { ensureReconciliationTables, getOrgTableNames } from '../services/orgTables.js';
import { runAutoMatch } from '../services/matchEngine.js';

const router = Router();
const prisma = new PrismaClient();

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function getPool(req: Request): pg.Pool {
    return (req as any).app.get('pool');
}

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

// Thin wrapper around logActivity — swallows logging errors silently so the
// request itself never fails because the audit log had a hiccup.
function audit(req: Request, action: string, resourceId?: string, details?: any) {
    const u = (req as any).user;
    if (!u?.id) return;
    logActivity(u.id, u.username || 'user', action, 'reconciliation', 'reconciliation', resourceId, details, req).catch(() => { });
}

// 10 MB limit, accept CSV/XLSX only
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ok = /\.(csv|xlsx|xls)$/i.test(file.originalname);
        if (!ok) return cb(new Error('Only .csv, .xls or .xlsx files are accepted'));
        cb(null, true);
    },
});

// Normalize a header key for fuzzy matching: lowercase, remove non-alnum.
const normKey = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Find first row value by trying multiple possible header names (case-insensitive, non-alnum-tolerant).
function pickField(row: Record<string, any>, candidates: string[]): any {
    const normalized: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) normalized[normKey(k)] = v;
    for (const c of candidates) {
        const nk = normKey(c);
        if (normalized[nk] !== undefined && normalized[nk] !== null && String(normalized[nk]).trim() !== '') {
            return normalized[nk];
        }
    }
    return undefined;
}

function parseNumber(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v;
    const s = String(v).replace(/[,\s]/g, '').replace(/[^\d.\-]/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
}

function parseDate(v: any): string | null {
    if (v === null || v === undefined || v === '') return null;
    // XLSX may give us a Date object if cellDates:true was used; otherwise string/number.
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number') {
        // Excel serial date
        const d = XLSX.SSF.parse_date_code(v);
        if (d && d.y) return `${d.y.toString().padStart(4, '0')}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
    const s = String(v).trim();
    // Try common formats — let Date handle ISO, fall back for DD/MM/YYYY or DD-MM-YYYY
    const iso = new Date(s);
    if (!isNaN(iso.getTime())) return iso.toISOString().slice(0, 10);
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
        const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10);
        let yy = parseInt(m[3], 10);
        if (yy < 100) yy += 2000;
        const d = new Date(Date.UTC(yy, mm - 1, dd));
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return null;
}

// Hard cap per upload — protects the backend from OOM + keeps insert loops bounded.
// Large imports should be split into multiple files until we move parsing off the request thread.
const MAX_ROWS_PER_UPLOAD = 50_000;

function readSheet(buffer: Buffer, filename: string): Record<string, any>[] {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error('The file has no sheets');
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true }) as Record<string, any>[];
    if (rows.length > MAX_ROWS_PER_UPLOAD) {
        throw new Error(`File has ${rows.length} rows — exceeds limit of ${MAX_ROWS_PER_UPLOAD} per upload. Split the file and retry.`);
    }
    return rows;
}

// ──────────────────────────────────────────────────────────────
// POST /api/reconciliation/imports/erp
// ──────────────────────────────────────────────────────────────

router.post('/imports/erp', authenticate, blockDemo, authorize('reconciliation.manage'), bulkLimiter, upload.single('file'), async (req: Request, res: Response) => {
    const pool = getPool(req);
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded (field name: file)' });

    try {
        const { orgId, orgName } = await resolveOrg(req);
        const { erp_transactions } = await ensureReconciliationTables(pool, orgId, orgName);

        const rows = readSheet(req.file.buffer, req.file.originalname);
        if (rows.length === 0) return res.status(400).json({ success: false, message: 'File has no data rows' });

        const batchId = randomUUID();
        const userId = (req as any).user?.id || null;
        const inserted: any[] = [];
        const skipped: { row: number; reason: string }[] = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const type = String(pickField(row, ['type', 'tx_type', 'direction']) || '').toUpperCase().slice(0, 4);
            const normalizedType = (type === 'AR' || type === 'AP') ? type : (type === 'SALE' || type === 'INVOICE' ? 'AR' : (type === 'PURCHASE' || type === 'BILL' ? 'AP' : ''));
            if (!normalizedType) {
                skipped.push({ row: i + 2, reason: `Unknown type "${type || '(empty)'}" — expected AR/AP` });
                continue;
            }
            const amount = parseNumber(pickField(row, ['amount', 'total', 'grand_total', 'net_amount']));
            if (amount === null) {
                skipped.push({ row: i + 2, reason: 'Missing or unparseable amount' });
                continue;
            }

            const docNumber = pickField(row, ['doc_number', 'invoice_number', 'bill_number', 'document_number', 'reference_number']);
            const cpId = pickField(row, ['counterparty_id', 'tax_id', 'vendor_id', 'customer_id', 'party_tax_id']);
            const cpName = pickField(row, ['counterparty_name', 'customer_name', 'vendor_name', 'party_name', 'name']);
            const issueDate = parseDate(pickField(row, ['issue_date', 'invoice_date', 'date', 'doc_date']));
            const dueDate = parseDate(pickField(row, ['due_date', 'payment_due_date', 'maturity_date']));
            const currency = String(pickField(row, ['currency', 'ccy']) || 'EGP').toUpperCase().slice(0, 10);
            const status = pickField(row, ['status', 'payment_status', 'state']);
            const extRef = pickField(row, ['external_ref', 'reference', 'ref', 'notes']);

            const ins = await pool.query(
                `INSERT INTO "InvoicesDb"."${erp_transactions}"
                 (tx_type, doc_number, counterparty_id, counterparty_name, issue_date, due_date, amount, currency, status, external_ref, raw_data, import_batch_id, imported_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
                [
                    normalizedType,
                    docNumber ? String(docNumber).slice(0, 100) : null,
                    cpId ? String(cpId).slice(0, 100) : null,
                    cpName ? String(cpName).slice(0, 500) : null,
                    issueDate,
                    dueDate,
                    amount,
                    currency,
                    status ? String(status).slice(0, 50) : null,
                    extRef ? String(extRef).slice(0, 200) : null,
                    JSON.stringify(row),
                    batchId,
                    userId,
                ]
            );
            inserted.push(ins.rows[0].id);
        }

        audit(req, 'erp_import', batchId, { inserted: inserted.length, skipped: skipped.length, total: rows.length, filename: req.file?.originalname });
        res.json({
            success: true,
            batchId,
            insertedCount: inserted.length,
            skippedCount: skipped.length,
            skipped: skipped.slice(0, 20),
            totalRowsInFile: rows.length,
        });
    } catch (err: any) {
        console.error('[Reconciliation] ERP import error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────
// POST /api/reconciliation/imports/bank
// ──────────────────────────────────────────────────────────────

router.post('/imports/bank', authenticate, blockDemo, authorize('reconciliation.manage'), bulkLimiter, upload.single('file'), async (req: Request, res: Response) => {
    const pool = getPool(req);
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded (field name: file)' });

    const bankAccountLabel = String(req.body?.bank_account || '').trim().slice(0, 100) || null;

    try {
        const { orgId, orgName } = await resolveOrg(req);
        const { bank_statements } = await ensureReconciliationTables(pool, orgId, orgName);

        const rows = readSheet(req.file.buffer, req.file.originalname);
        if (rows.length === 0) return res.status(400).json({ success: false, message: 'File has no data rows' });

        const batchId = randomUUID();
        const userId = (req as any).user?.id || null;
        const inserted: number[] = [];
        const skipped: { row: number; reason: string }[] = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];

            // Try a single "amount" column first, else combine credit/debit.
            let amount = parseNumber(pickField(row, ['amount', 'signed_amount']));
            if (amount === null) {
                const credit = parseNumber(pickField(row, ['credit', 'deposit', 'in']));
                const debit = parseNumber(pickField(row, ['debit', 'withdrawal', 'out']));
                if (credit !== null || debit !== null) {
                    amount = (credit || 0) - (debit || 0);
                }
            }
            if (amount === null) {
                skipped.push({ row: i + 2, reason: 'Missing or unparseable amount (also no credit/debit split)' });
                continue;
            }

            const stmtDate = parseDate(pickField(row, ['date', 'statement_date', 'posting_date', 'transaction_date']));
            if (!stmtDate) {
                skipped.push({ row: i + 2, reason: 'Missing or unparseable date' });
                continue;
            }
            const valDate = parseDate(pickField(row, ['value_date', 'effective_date']));
            const description = pickField(row, ['description', 'details', 'narrative', 'memo']);
            const reference = pickField(row, ['reference', 'ref', 'transaction_id']);
            const balanceAfter = parseNumber(pickField(row, ['balance', 'balance_after', 'running_balance']));
            const currency = String(pickField(row, ['currency', 'ccy']) || 'EGP').toUpperCase().slice(0, 10);

            const ins = await pool.query(
                `INSERT INTO "InvoicesDb"."${bank_statements}"
                 (bank_account, statement_date, value_date, amount, currency, description, reference, balance_after, raw_data, import_batch_id, imported_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
                [
                    bankAccountLabel,
                    stmtDate,
                    valDate,
                    amount,
                    currency,
                    description ? String(description).slice(0, 2000) : null,
                    reference ? String(reference).slice(0, 200) : null,
                    balanceAfter,
                    JSON.stringify(row),
                    batchId,
                    userId,
                ]
            );
            inserted.push(ins.rows[0].id);
        }

        audit(req, 'bank_import', batchId, { inserted: inserted.length, skipped: skipped.length, total: rows.length, filename: req.file?.originalname, bankAccount: bankAccountLabel });
        res.json({
            success: true,
            batchId,
            bankAccount: bankAccountLabel,
            insertedCount: inserted.length,
            skippedCount: skipped.length,
            skipped: skipped.slice(0, 20),
            totalRowsInFile: rows.length,
        });
    } catch (err: any) {
        console.error('[Reconciliation] Bank import error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────
// GET list + history + delete
// ──────────────────────────────────────────────────────────────

router.get('/imports/erp', authenticate, authorize('reconciliation.view'), async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        const { erp_transactions } = getOrgTableNames(orgId, orgName);
        const pageNo = parseInt(req.query.pageNo as string) || 1;
        const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 500);
        const batchId = req.query.batchId as string | undefined;

        const where = batchId ? 'WHERE import_batch_id = $1' : '';
        const params: any[] = batchId ? [batchId] : [];
        const sql = `SELECT id, tx_type, doc_number, counterparty_id, counterparty_name, issue_date, due_date, amount, currency, status, external_ref, import_batch_id, imported_at
                     FROM "InvoicesDb"."${erp_transactions}" ${where}
                     ORDER BY imported_at DESC, id DESC
                     LIMIT ${pageSize} OFFSET ${(pageNo - 1) * pageSize}`;
        const countSql = `SELECT COUNT(*)::int AS total FROM "InvoicesDb"."${erp_transactions}" ${where}`;
        const [rows, count] = await Promise.all([
            pool.query(sql, params).catch(() => ({ rows: [] })),
            pool.query(countSql, params).catch(() => ({ rows: [{ total: 0 }] })),
        ]);
        res.json({ success: true, items: rows.rows, pageNo, pageSize, total: count.rows[0]?.total || 0 });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/imports/bank', authenticate, authorize('reconciliation.view'), async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        const { bank_statements } = getOrgTableNames(orgId, orgName);
        const pageNo = parseInt(req.query.pageNo as string) || 1;
        const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 500);
        const batchId = req.query.batchId as string | undefined;

        const where = batchId ? 'WHERE import_batch_id = $1' : '';
        const params: any[] = batchId ? [batchId] : [];
        const sql = `SELECT id, bank_account, statement_date, value_date, amount, currency, description, reference, balance_after, import_batch_id, imported_at
                     FROM "InvoicesDb"."${bank_statements}" ${where}
                     ORDER BY statement_date DESC NULLS LAST, id DESC
                     LIMIT ${pageSize} OFFSET ${(pageNo - 1) * pageSize}`;
        const countSql = `SELECT COUNT(*)::int AS total FROM "InvoicesDb"."${bank_statements}" ${where}`;
        const [rows, count] = await Promise.all([
            pool.query(sql, params).catch(() => ({ rows: [] })),
            pool.query(countSql, params).catch(() => ({ rows: [{ total: 0 }] })),
        ]);
        res.json({ success: true, items: rows.rows, pageNo, pageSize, total: count.rows[0]?.total || 0 });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/** GET /api/reconciliation/imports/history — one row per import batch, both sides combined. */
router.get('/imports/history', authenticate, authorize('reconciliation.view'), async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        const { erp_transactions, bank_statements } = getOrgTableNames(orgId, orgName);

        const erpQ = pool.query(
            `SELECT 'ERP' AS side, import_batch_id, COUNT(*)::int AS rows, MAX(imported_at) AS imported_at
             FROM "InvoicesDb"."${erp_transactions}" GROUP BY import_batch_id`
        ).catch(() => ({ rows: [] }));

        const bankQ = pool.query(
            `SELECT 'BANK' AS side, import_batch_id, COUNT(*)::int AS rows, MAX(imported_at) AS imported_at, MAX(bank_account) AS bank_account
             FROM "InvoicesDb"."${bank_statements}" GROUP BY import_batch_id`
        ).catch(() => ({ rows: [] }));

        const [erp, bank] = await Promise.all([erpQ, bankQ]);
        const items = [...erp.rows, ...bank.rows].sort(
            (a: any, b: any) => new Date(b.imported_at).getTime() - new Date(a.imported_at).getTime()
        );
        res.json({ success: true, items });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────
// Phase 2.2 — Auto-Match Engine + Match CRUD
// ──────────────────────────────────────────────────────────────

/**
 * POST /api/reconciliation/matches/auto-match
 * Body: { dateFrom: 'YYYY-MM-DD', dateTo: 'YYYY-MM-DD', minConfidence?: 0-100 }
 * Runs the scoring engine synchronously (small-to-medium data sets). Wipes prior
 * SUGGESTED rows and writes new ones.
 */
router.post('/matches/auto-match', authenticate, blockDemo, authorize('reconciliation.manage'), bulkLimiter, async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        const { dateFrom, dateTo, minConfidence } = req.body || {};
        if (!dateFrom || !dateTo) {
            return res.status(400).json({ success: false, message: 'dateFrom and dateTo are required (YYYY-MM-DD)' });
        }
        const result = await runAutoMatch(pool, {
            orgId,
            orgName,
            dateFrom,
            dateTo,
            minConfidence: typeof minConfidence === 'number' ? minConfidence : undefined,
        });
        audit(req, 'auto_match_run', undefined, { dateFrom, dateTo, suggestionsInserted: result.suggestionsInserted });
        res.json({ success: true, ...result });
    } catch (err: any) {
        console.error('[Reconciliation] Auto-match error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/reconciliation/matches
 * Query: status, pageNo, pageSize
 * Returns suggestions/accepted/rejected with joined ERP + bank fields so the UI
 * doesn't need a second round-trip.
 */
router.get('/matches', authenticate, authorize('reconciliation.view'), async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        const t = getOrgTableNames(orgId, orgName);
        const status = (req.query.status as string || '').toUpperCase();
        const pageNo = parseInt(req.query.pageNo as string) || 1;
        const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 500);
        const offset = (pageNo - 1) * pageSize;

        const whereParts: string[] = [];
        const params: any[] = [];
        if (['SUGGESTED', 'ACCEPTED', 'REJECTED'].includes(status)) {
            params.push(status);
            whereParts.push(`m.status = $${params.length}`);
        }
        const whereSQL = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

        const sql = `
            SELECT m.id, m.erp_tx_id, m.bank_tx_id, m.eta_uuid, m.match_type, m.confidence,
                   m.amount_diff, m.status, m.notes, m.created_at, m.reviewed_at,
                   e.tx_type AS erp_tx_type, e.doc_number AS erp_doc_number,
                   e.counterparty_id AS erp_counterparty_id, e.counterparty_name AS erp_counterparty_name,
                   e.issue_date AS erp_issue_date, e.amount AS erp_amount, e.currency AS erp_currency,
                   b.statement_date AS bank_statement_date, b.amount AS bank_amount,
                   b.currency AS bank_currency, b.description AS bank_description, b.reference AS bank_reference,
                   b.bank_account AS bank_account
            FROM "InvoicesDb"."${t.matches}" m
            LEFT JOIN "InvoicesDb"."${t.erp_transactions}" e ON e.id = m.erp_tx_id
            LEFT JOIN "InvoicesDb"."${t.bank_statements}" b ON b.id = m.bank_tx_id
            ${whereSQL}
            ORDER BY m.confidence DESC, m.created_at DESC
            LIMIT ${pageSize} OFFSET ${offset}
        `;
        const countSql = `SELECT COUNT(*)::int AS total FROM "InvoicesDb"."${t.matches}" m ${whereSQL}`;
        const [rows, count] = await Promise.all([
            pool.query(sql, params).catch(() => ({ rows: [] })),
            pool.query(countSql, params).catch(() => ({ rows: [{ total: 0 }] })),
        ]);
        res.json({ success: true, items: rows.rows, pageNo, pageSize, total: count.rows[0]?.total || 0 });
    } catch (err: any) {
        console.error('[Reconciliation] List matches error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PATCH /api/reconciliation/matches/:id
 * Body: { status?: 'ACCEPTED'|'REJECTED', notes? }
 */
router.patch('/matches/:id', authenticate, blockDemo, authorize('reconciliation.manage'), async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        const t = getOrgTableNames(orgId, orgName);
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

        const { status, notes } = req.body || {};
        const updates: string[] = [];
        const params: any[] = [];
        if (status && ['ACCEPTED', 'REJECTED', 'SUGGESTED'].includes(String(status).toUpperCase())) {
            params.push(String(status).toUpperCase());
            updates.push(`status = $${params.length}`);
            params.push((req as any).user?.id || null);
            updates.push(`reviewed_by = $${params.length}`);
            updates.push(`reviewed_at = NOW()`);
        }
        if (notes !== undefined) {
            params.push(String(notes).slice(0, 1000));
            updates.push(`notes = $${params.length}`);
        }
        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'Nothing to update' });
        }
        params.push(id);
        const idx = params.length;
        const r = await pool.query(
            `UPDATE "InvoicesDb"."${t.matches}" SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, status`,
            params
        );
        if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'Match not found' });
        audit(req, 'match_update', String(id), { status: status || null });
        res.json({ success: true, match: r.rows[0] });
    } catch (err: any) {
        console.error('[Reconciliation] Update match error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/reconciliation/matches
 * Body: { erp_tx_id?, bank_tx_id?, eta_uuid?, notes? }
 * Manually create a match (user decided to link specific rows).
 */
router.post('/matches', authenticate, blockDemo, authorize('reconciliation.manage'), async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        await ensureReconciliationTables(pool, orgId, orgName);
        const t = getOrgTableNames(orgId, orgName);
        const { erp_tx_id, bank_tx_id, eta_uuid, notes } = req.body || {};
        if (!erp_tx_id && !bank_tx_id && !eta_uuid) {
            return res.status(400).json({ success: false, message: 'At least one of erp_tx_id / bank_tx_id / eta_uuid is required' });
        }

        const userId = (req as any).user?.id || null;
        const r = await pool.query(
            `INSERT INTO "InvoicesDb"."${t.matches}"
             (erp_tx_id, bank_tx_id, eta_uuid, match_type, confidence, status, notes, created_by)
             VALUES ($1,$2,$3,'MANUAL',100,'ACCEPTED',$4,$5) RETURNING id`,
            [erp_tx_id || null, bank_tx_id || null, eta_uuid || null, notes || null, userId]
        );
        audit(req, 'match_manual_create', String(r.rows[0].id), { erp_tx_id, bank_tx_id, eta_uuid });
        res.json({ success: true, id: r.rows[0].id });
    } catch (err: any) {
        console.error('[Reconciliation] Manual match error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/reconciliation/summary?dateFrom=...&dateTo=...
 * Aggregate counters for a Reconciliation Summary report:
 *   - totals by match_type / status
 *   - unmatched ERP rows
 *   - unmatched bank rows
 *   - total amount matched (accepted)
 */
router.get('/summary', authenticate, authorize('reconciliation.view'), async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        const t = getOrgTableNames(orgId, orgName);
        const dateFrom = (req.query.dateFrom as string) || null;
        const dateTo = (req.query.dateTo as string) || null;

        const byStatusSql = `SELECT status, COUNT(*)::int AS count FROM "InvoicesDb"."${t.matches}" GROUP BY status`;
        const byTypeSql = `SELECT match_type, status, COUNT(*)::int AS count FROM "InvoicesDb"."${t.matches}" GROUP BY match_type, status`;
        const acceptedAmountSql = `
            SELECT COALESCE(SUM(ABS(e.amount)), 0)::float AS total_matched
            FROM "InvoicesDb"."${t.matches}" m
            JOIN "InvoicesDb"."${t.erp_transactions}" e ON e.id = m.erp_tx_id
            WHERE m.status = 'ACCEPTED'
        `;

        const erpWhere: string[] = [];
        const erpParams: any[] = [];
        if (dateFrom) { erpParams.push(dateFrom); erpWhere.push(`issue_date >= $${erpParams.length}`); }
        if (dateTo) { erpParams.push(dateTo); erpWhere.push(`issue_date <= $${erpParams.length}`); }
        const erpWhereSql = erpWhere.length ? 'WHERE ' + erpWhere.join(' AND ') : '';

        const erpUnmatchedSql = `
            SELECT COUNT(*)::int AS unmatched
            FROM "InvoicesDb"."${t.erp_transactions}" e
            ${erpWhereSql}
            ${erpWhere.length ? 'AND' : 'WHERE'} NOT EXISTS (
              SELECT 1 FROM "InvoicesDb"."${t.matches}" m
              WHERE m.erp_tx_id = e.id AND m.status = 'ACCEPTED'
            )
        `;
        const erpTotalSql = `SELECT COUNT(*)::int AS total FROM "InvoicesDb"."${t.erp_transactions}" ${erpWhereSql}`;

        const bankWhere: string[] = [];
        const bankParams: any[] = [];
        if (dateFrom) { bankParams.push(dateFrom); bankWhere.push(`statement_date >= $${bankParams.length}`); }
        if (dateTo) { bankParams.push(dateTo); bankWhere.push(`statement_date <= $${bankParams.length}`); }
        const bankWhereSql = bankWhere.length ? 'WHERE ' + bankWhere.join(' AND ') : '';
        const bankUnmatchedSql = `
            SELECT COUNT(*)::int AS unmatched
            FROM "InvoicesDb"."${t.bank_statements}" b
            ${bankWhereSql}
            ${bankWhere.length ? 'AND' : 'WHERE'} NOT EXISTS (
              SELECT 1 FROM "InvoicesDb"."${t.matches}" m
              WHERE m.bank_tx_id = b.id AND m.status = 'ACCEPTED'
            )
        `;
        const bankTotalSql = `SELECT COUNT(*)::int AS total FROM "InvoicesDb"."${t.bank_statements}" ${bankWhereSql}`;

        const [byStatus, byType, acceptedAmt, erpUnmatched, erpTotal, bankUnmatched, bankTotal] = await Promise.all([
            pool.query(byStatusSql).catch(() => ({ rows: [] })),
            pool.query(byTypeSql).catch(() => ({ rows: [] })),
            pool.query(acceptedAmountSql).catch(() => ({ rows: [{ total_matched: 0 }] })),
            pool.query(erpUnmatchedSql, erpParams).catch(() => ({ rows: [{ unmatched: 0 }] })),
            pool.query(erpTotalSql, erpParams).catch(() => ({ rows: [{ total: 0 }] })),
            pool.query(bankUnmatchedSql, bankParams).catch(() => ({ rows: [{ unmatched: 0 }] })),
            pool.query(bankTotalSql, bankParams).catch(() => ({ rows: [{ total: 0 }] })),
        ]);

        res.json({
            success: true,
            dateFrom,
            dateTo,
            byStatus: byStatus.rows,
            byType: byType.rows,
            totalAcceptedAmount: acceptedAmt.rows[0]?.total_matched || 0,
            erp: { total: erpTotal.rows[0]?.total || 0, unmatched: erpUnmatched.rows[0]?.unmatched || 0 },
            bank: { total: bankTotal.rows[0]?.total || 0, unmatched: bankUnmatched.rows[0]?.unmatched || 0 },
        });
    } catch (err: any) {
        console.error('[Reconciliation] Summary error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/imports/:side/:batchId', authenticate, blockDemo, authorize('reconciliation.manage'), async (req: Request, res: Response) => {
    const pool = getPool(req);
    const side = String(req.params.side || '').toLowerCase();
    const batchId = req.params.batchId;
    if (side !== 'erp' && side !== 'bank') {
        return res.status(400).json({ success: false, message: 'side must be "erp" or "bank"' });
    }
    try {
        const { orgId, orgName } = await resolveOrg(req);
        const tables = getOrgTableNames(orgId, orgName);
        const table = side === 'erp' ? tables.erp_transactions : tables.bank_statements;
        const r = await pool.query(
            `DELETE FROM "InvoicesDb"."${table}" WHERE import_batch_id = $1`,
            [batchId]
        );
        audit(req, `batch_delete_${side}`, batchId, { deletedCount: r.rowCount || 0 });
        res.json({ success: true, deletedCount: r.rowCount || 0 });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
