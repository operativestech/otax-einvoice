/**
 * MySQL ERP adapter — same shape as Postgres but using mysql2/promise.
 *
 * Most MySQL invoicing schemas in Egyptian SMB-land come from cPanel-hosted
 * legacy LAMP apps (osTicket-style invoicing, custom PHP CRMs). The data
 * model is similar enough to Postgres that we share the fuzzy-resolution
 * helper and the SQL-injection guard for table names.
 *
 * Differences from Postgres:
 *   - mysql2 uses `?` placeholders, not `$1` (the only IN(…) lookup in this
 *     adapter rebuilds the placeholder list explicitly)
 *   - we use a connection pool with limit:3 (same as Postgres) so tests can
 *     hammer it without exhausting the customer's max_connections
 *   - mysql2 throws synchronously on bad config — wrapped in testConnection
 */

import mysql from 'mysql2/promise';
import type {
    ErpAdapter,
    ErpConnectionConfig,
    ErpInvoice,
    ErpInvoiceLine,
    FetchOptions,
    ConnectionTestResult,
} from './types.js';

const normKey = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function pickField(row: Record<string, any>, candidates: string[]): any {
    const indexed: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) indexed[normKey(k)] = v;
    for (const c of candidates) {
        const nk = normKey(c);
        if (indexed[nk] !== undefined && indexed[nk] !== null && indexed[nk] !== '') return indexed[nk];
    }
    return undefined;
}

function asNumber(v: any, fallback = 0): number {
    if (v === null || v === undefined || v === '') return fallback;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return isNaN(n) ? fallback : n;
}

function asISODate(v: any): string {
    if (!v) return new Date().toISOString();
    if (v instanceof Date) return v.toISOString();
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** MySQL identifiers can be schema-qualified (`db.table`). Backticks are
 *  rejected here and added by the caller — that way the user can type
 *  `mydb.invoices` and we render it as `` `mydb`.`invoices` ``. */
function safeIdentifier(raw: string | null | undefined): string {
    const s = String(raw || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(s)) {
        throw new Error(`Invalid identifier "${s}" — only alphanumeric, underscore, and a single schema-prefixed dot are allowed.`);
    }
    // Add backticks so reserved words and uppercase tables still work.
    return s.split('.').map(p => `\`${p}\``).join('.');
}

export class MysqlErpAdapter implements ErpAdapter {
    public readonly provider = 'mysql' as const;
    private pool: mysql.Pool | null = null;

    constructor(private cfg: ErpConnectionConfig) {}

    private getPool(): mysql.Pool {
        if (this.pool) return this.pool;
        let host = this.cfg.host || 'localhost';
        let port = this.cfg.port || 3306;
        const colonIdx = host.indexOf(':');
        if (colonIdx >= 0 && !this.cfg.port) {
            const maybePort = parseInt(host.slice(colonIdx + 1), 10);
            if (!isNaN(maybePort)) { port = maybePort; host = host.slice(0, colonIdx); }
        }
        this.pool = mysql.createPool({
            host, port,
            database: this.cfg.database || undefined,
            user: this.cfg.user || undefined,
            password: this.cfg.password || undefined,
            connectTimeout: 5000,
            waitForConnections: true,
            connectionLimit: 3,
            queueLimit: 0,
            // Surface BIGINT and DECIMAL as JS numbers when they fit, otherwise
            // strings — mirrors what the Postgres adapter does via the pg
            // numeric-as-float cast.
            decimalNumbers: true,
        });
        return this.pool;
    }

    async testConnection(): Promise<ConnectionTestResult> {
        try {
            const pool = this.getPool();
            const [rows] = await pool.query('SELECT VERSION() AS v, DATABASE() AS db, CURRENT_USER() AS usr');
            const row = (rows as any[])[0] || {};
            // Probe configured views.
            const viewChecks: Record<string, any> = {};
            for (const [label, ident] of [
                ['headerView', this.cfg.headerView],
                ['linesView',  this.cfg.linesView],
            ] as const) {
                if (!ident) { viewChecks[label] = 'not configured'; continue; }
                try {
                    const safe = safeIdentifier(ident);
                    const [r2] = await pool.query(`SELECT COUNT(*) AS n FROM ${safe} LIMIT 1`);
                    viewChecks[label] = `OK (${(r2 as any[])[0]?.n ?? '?'} rows)`;
                } catch (e: any) {
                    viewChecks[label] = `ERROR: ${e.message}`;
                }
            }
            return {
                ok: true,
                message: `Connected to ${row.db || '(no DB)'} as ${row.usr || '(unknown)'}`,
                details: { server: String(row.v || '').split('-')[0], ...viewChecks },
            };
        } catch (e: any) {
            return { ok: false, message: e.message || String(e) };
        }
    }

    async fetchInvoices(opts: FetchOptions = {}): Promise<ErpInvoice[]> {
        if (!this.cfg.headerView) throw new Error('MySQL adapter: erp_headerView not configured.');
        const pool = this.getPool();
        const headerTable = safeIdentifier(this.cfg.headerView);
        const linesTable = this.cfg.linesView ? safeIdentifier(this.cfg.linesView) : null;

        // MySQL can't do COALESCE-on-multiple-aliased-columns the same way
        // pg does without erroring on missing columns, so we use a simpler
        // since/until clause that assumes a single timestamp column. For
        // schemas where the column has a different name, the user can pass
        // `since`/`until` from the UI to bracket the dataset and the adapter
        // will at least return the bounded set.
        const where: string[] = [];
        const params: any[] = [];
        if (opts.since) { params.push(opts.since); where.push(`updated_at >= ?`); }
        if (opts.until) { params.push(opts.until); where.push(`updated_at <  ?`); }
        const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const limit  = Math.max(1, Math.min(opts.limit ?? 100, 1000));
        const offset = Math.max(0, opts.offset ?? 0);

        // First attempt with `updated_at`. If that column doesn't exist on
        // the user's view, retry without the WHERE — the user is responsible
        // for narrowing via SQL view definition in that case.
        let rows: any[];
        try {
            const [r] = await pool.query(
                `SELECT * FROM ${headerTable} ${whereSQL} LIMIT ${limit} OFFSET ${offset}`,
                params
            );
            rows = r as any[];
        } catch (e: any) {
            if (/Unknown column/i.test(e.message)) {
                const [r] = await pool.query(
                    `SELECT * FROM ${headerTable} LIMIT ${limit} OFFSET ${offset}`,
                    []
                );
                rows = r as any[];
            } else {
                throw e;
            }
        }
        if (!rows.length) return [];

        const invoices: Record<string, ErpInvoice> = {};
        const internalIds: string[] = [];

        for (const row of rows) {
            const internalId = String(pickField(row, ['internal_id', 'internalId', 'doc_number', 'invoice_number', 'reference', 'id']) ?? '');
            if (!internalId) continue;
            const externalId = String(pickField(row, ['id', 'pk', 'doc_id', 'invoice_id']) ?? internalId);
            internalIds.push(internalId);

            invoices[internalId] = {
                externalId,
                INTERNAL_ID: internalId,
                DOCUMENT_TYPE: String(pickField(row, ['document_type', 'doc_type', 'type']) || 'I'),
                DOCUMENT_TYPE_VERSION: String(pickField(row, ['document_type_version', 'doc_version']) || (this.cfg.docTypeVersion || '0.9')),
                DATE_TIME_ISSUED: asISODate(pickField(row, ['issue_date', 'dateTimeIssued', 'date_issued', 'invoice_date', 'created_at'])),
                ISSUER_ID:        String(pickField(row, ['issuer_id', 'issuerId', 'seller_tax_id']) || '') || null,
                ISSUER_NAME:      String(pickField(row, ['issuer_name', 'issuerName', 'seller_name']) || '') || null,
                RECEIVER_TYPE:    String(pickField(row, ['receiver_type', 'receiverType', 'customer_type']) || 'B'),
                RECEIVER_ID:      String(pickField(row, ['receiver_id', 'receiverId', 'customer_tax_id', 'tax_id']) || ''),
                RECEIVER_NAME:    String(pickField(row, ['receiver_name', 'receiverName', 'customer_name', 'name']) || ''),
                RECEIVER_COUNTRY:        String(pickField(row, ['receiver_country', 'country']) || 'EG'),
                RECEIVER_GOVERNATE:      String(pickField(row, ['receiver_governate', 'governate', 'governorate']) || ''),
                RECEIVER_REGIONCITY:     String(pickField(row, ['receiver_region_city', 'region_city', 'city']) || ''),
                RECEIVER_STREET:         String(pickField(row, ['receiver_street', 'street']) || ''),
                RECEIVER_BUILDINGNUMBER: String(pickField(row, ['receiver_building_number', 'building_number']) || ''),
                RECEIVER_POSTALCODE:     String(pickField(row, ['receiver_postal_code', 'postal_code']) || ''),
                CURRENCY:               String(pickField(row, ['currency', 'ccy']) || 'EGP'),
                EXTRADISCOUNTAMOUNT:    asNumber(pickField(row, ['extra_discount', 'extraDiscountAmount']), 0),
                PURCHASEORDERREFERENCE: String(pickField(row, ['po_reference', 'purchaseOrderReference', 'po_number']) || ''),
                SALESORDERREFERENCE:    String(pickField(row, ['so_reference', 'salesOrderReference', 'so_number']) || ''),
                ISSUER_BRANCH_ID:       String(pickField(row, ['branch_id', 'branchId', 'issuer_branch_id']) || ''),
                lines: [],
            };
        }

        if (linesTable && internalIds.length) {
            // mysql2 doesn't support `= ANY($1::text[])`. We rebuild with a
            // `?, ?, ?…` placeholder list — internalIds is bounded to `limit`
            // (≤1000) so this is fine.
            const placeholders = internalIds.map(() => '?').join(', ');
            const [lineRows] = await pool.query(
                `SELECT * FROM ${linesTable}
                  WHERE COALESCE(internal_id, doc_number, invoice_number) IN (${placeholders})`,
                internalIds
            );
            for (const row of lineRows as any[]) {
                const linkId = String(pickField(row, ['internal_id', 'internalId', 'doc_number', 'invoice_number']) || '');
                if (!invoices[linkId]) continue;
                const line: ErpInvoiceLine = {
                    DESCRIPTION:        String(pickField(row, ['description', 'item_description', 'name']) || ''),
                    ITEMTYPE:           String(pickField(row, ['item_type', 'itemType']) || 'EGS'),
                    ITEMCODE:           String(pickField(row, ['item_code', 'itemCode', 'sku']) || ''),
                    ITEM_INTERNAL_CODE: String(pickField(row, ['item_internal_code', 'itemInternalCode']) || ''),
                    UNITTYPE:           String(pickField(row, ['unit_type', 'unitType', 'uom']) || 'EA'),
                    QUANTITY:           asNumber(pickField(row, ['quantity', 'qty']), 1),
                    AMOUNT:             asNumber(pickField(row, ['amount', 'unit_price', 'price', 'unitPrice']), 0),
                    CURRENCYSOLD:       String(pickField(row, ['currency_sold', 'currencySold', 'currency']) || 'EGP'),
                    CURRENCYEXCHANGERATE: asNumber(pickField(row, ['exchange_rate', 'currencyExchangeRate']), 0),
                    DIS_RATE:           asNumber(pickField(row, ['discount_rate', 'disRate', 'dis_rate']), 0),
                    DIS_AMOUNT:         asNumber(pickField(row, ['discount_amount', 'disAmount', 'dis_amount']), 0),
                    TAXABLE_ITEMS:      [],
                };
                const vatRate = pickField(row, ['vat_rate', 'vatPercent', 'tax_rate']);
                if (vatRate !== undefined && vatRate !== null && vatRate !== '') {
                    line.TAXABLE_ITEMS = [{ taxType: 'T1', subType: 'V001', rate: asNumber(vatRate) }];
                }
                invoices[linkId].lines.push(line);
            }
        }

        return Object.values(invoices);
    }

    async close(): Promise<void> {
        if (this.pool) { await this.pool.end(); this.pool = null; }
    }
}
