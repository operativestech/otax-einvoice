/**
 * Postgres ERP adapter — reads invoices from a customer's PostgreSQL database
 * via two configurable views:
 *
 *   - erp_headerView : columns map to ErpInvoice header fields
 *   - erp_linesView  : columns map to ErpInvoiceLine fields, joined to the
 *                      header by an internal_id column the user provides
 *
 * We intentionally don't run user-supplied SQL — the user gives us a TABLE or
 * VIEW name; we issue parameterised SELECTs against it. That sidesteps the
 * SQL-injection problem from concatenating user input into the query string.
 *
 * Column-name resolution is fuzzy + case-insensitive (snake_case, camelCase,
 * UPPER, lowercase all match) so the adapter copes with the conventions of
 * different ERPs without bespoke per-vendor mapping.
 */

import pg from 'pg';
import type {
    ErpAdapter,
    ErpConnectionConfig,
    ErpInvoice,
    ErpInvoiceLine,
    FetchOptions,
    ConnectionTestResult,
} from './types.js';

// Same canonical-name map we use elsewhere — lowercase + strip non-alnum so
// "Internal ID", "internal_id", and "INTERNALID" all match the same key.
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

/** Whitelist a table/view identifier the user typed into Settings. We only
 *  accept identifiers built from letters, digits, underscores, and dots
 *  (schema.view). Anything else throws — that's the SQL-injection guard. */
function safeIdentifier(raw: string | null | undefined): string {
    const s = String(raw || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(s)) {
        throw new Error(`Invalid identifier "${s}" — only alphanumeric, underscore, and a single schema-prefixed dot are allowed.`);
    }
    return s;
}

export class PostgresErpAdapter implements ErpAdapter {
    public readonly provider = 'postgres' as const;
    private pool: pg.Pool | null = null;

    constructor(private cfg: ErpConnectionConfig) {}

    private getPool(): pg.Pool {
        if (this.pool) return this.pool;
        // Parse host:port if the user crammed both into one field
        let host = this.cfg.host || 'localhost';
        let port = this.cfg.port || 5432;
        const colonIdx = host.indexOf(':');
        if (colonIdx >= 0 && !this.cfg.port) {
            const maybePort = parseInt(host.slice(colonIdx + 1), 10);
            if (!isNaN(maybePort)) { port = maybePort; host = host.slice(0, colonIdx); }
        }
        this.pool = new pg.Pool({
            host, port,
            database: this.cfg.database || undefined,
            user: this.cfg.user || undefined,
            password: this.cfg.password || undefined,
            // Tight timeouts so a misconfigured host doesn't block the request
            // for the default 30s pg-pool timeout.
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 10_000,
            max: 3,
        });
        return this.pool;
    }

    async testConnection(): Promise<ConnectionTestResult> {
        try {
            const pool = this.getPool();
            const r = await pool.query('SELECT version() AS version, current_database() AS db, current_user AS usr');
            const row = r.rows[0] || {};
            // Sanity-check that the configured views actually exist + are readable.
            const viewChecks: Record<string, any> = {};
            for (const [label, ident] of [
                ['headerView', this.cfg.headerView],
                ['linesView',  this.cfg.linesView],
            ] as const) {
                if (!ident) { viewChecks[label] = 'not configured'; continue; }
                try {
                    const safe = safeIdentifier(ident);
                    const q = await pool.query(`SELECT COUNT(*)::int AS n FROM ${safe} LIMIT 1`);
                    viewChecks[label] = `OK (${q.rows[0]?.n ?? '?'} rows)`;
                } catch (e: any) {
                    viewChecks[label] = `ERROR: ${e.message}`;
                }
            }
            return {
                ok: true,
                message: `Connected to ${row.db} as ${row.usr}`,
                details: { server: String(row.version || '').split(' ')[0], ...viewChecks },
            };
        } catch (e: any) {
            return { ok: false, message: e.message || String(e) };
        }
    }

    async fetchInvoices(opts: FetchOptions = {}): Promise<ErpInvoice[]> {
        if (!this.cfg.headerView) throw new Error('Postgres adapter: erp_headerView not configured.');
        const pool = this.getPool();
        const headerTable = safeIdentifier(this.cfg.headerView);
        const linesTable = this.cfg.linesView ? safeIdentifier(this.cfg.linesView) : null;

        // Fetch header rows. We do NOT trust the user-supplied view to have
        // standardised column names — pickField does fuzzy resolution at the
        // application layer.
        const where: string[] = [];
        const params: any[] = [];
        if (opts.since) { params.push(opts.since); where.push(`COALESCE(updated_at, created_at, issue_date, "issueDate", "dateTimeIssued") >= $${params.length}`); }
        if (opts.until) { params.push(opts.until); where.push(`COALESCE(updated_at, created_at, issue_date, "issueDate", "dateTimeIssued") <  $${params.length}`); }
        // legal entity filter is best-effort — if the column doesn't exist
        // we just skip it (pg throws which the caller catches).
        if (this.cfg.legalEntity) {
            params.push(this.cfg.legalEntity);
            where.push(`(COALESCE(legal_entity, "legalEntity", entity_id, '') = $${params.length} OR TRUE)`);
        }
        const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const limit  = Math.max(1, Math.min(opts.limit ?? 100, 1000));
        const offset = Math.max(0, opts.offset ?? 0);

        const headerRes = await pool.query(
            `SELECT * FROM ${headerTable} ${whereSQL} ORDER BY 1 LIMIT ${limit} OFFSET ${offset}`,
            params
        );
        if (headerRes.rowCount === 0) return [];

        // Build a Map keyed by the same join key the lines table uses.
        const invoices: Record<string, ErpInvoice> = {};
        const internalIds: string[] = [];

        for (const row of headerRes.rows) {
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
                RECEIVER_FLOOR:          String(pickField(row, ['receiver_floor', 'floor']) || ''),
                RECEIVER_ROOM:           String(pickField(row, ['receiver_room', 'room']) || ''),
                CURRENCY:               String(pickField(row, ['currency', 'ccy']) || 'EGP'),
                EXTRADISCOUNTAMOUNT:    asNumber(pickField(row, ['extra_discount', 'extraDiscountAmount']), 0),
                PURCHASEORDERREFERENCE: String(pickField(row, ['po_reference', 'purchaseOrderReference', 'po_number']) || ''),
                SALESORDERREFERENCE:    String(pickField(row, ['so_reference', 'salesOrderReference', 'so_number']) || ''),
                PROFORMAINVOICENUMBER:  String(pickField(row, ['proforma_number', 'proformaInvoiceNumber']) || ''),
                ISSUER_BRANCH_ID:       String(pickField(row, ['branch_id', 'branchId', 'issuer_branch_id']) || ''),
                lines: [],
            };
        }

        // Fetch lines if a lines view is configured. We use IN(…) on the
        // collected internal ids — keeps the query single-trip even with 100s
        // of headers.
        if (linesTable && internalIds.length) {
            const lineRes = await pool.query(
                `SELECT * FROM ${linesTable} WHERE COALESCE(internal_id, "internalId", doc_number, invoice_number) = ANY($1::text[])`,
                [internalIds]
            );
            for (const row of lineRes.rows) {
                const linkId = String(pickField(row, ['internal_id', 'internalId', 'doc_number', 'invoice_number']) || '');
                if (!invoices[linkId]) continue;
                const line: ErpInvoiceLine = {
                    DESCRIPTION:      String(pickField(row, ['description', 'item_description', 'name']) || ''),
                    ITEMTYPE:         String(pickField(row, ['item_type', 'itemType']) || 'EGS'),
                    ITEMCODE:         String(pickField(row, ['item_code', 'itemCode', 'sku']) || ''),
                    ITEM_INTERNAL_CODE: String(pickField(row, ['item_internal_code', 'itemInternalCode']) || ''),
                    UNITTYPE:         String(pickField(row, ['unit_type', 'unitType', 'uom']) || 'EA'),
                    QUANTITY:         asNumber(pickField(row, ['quantity', 'qty']), 1),
                    AMOUNT:           asNumber(pickField(row, ['amount', 'unit_price', 'price', 'unitPrice']), 0),
                    CURRENCYSOLD:     String(pickField(row, ['currency_sold', 'currencySold', 'currency']) || 'EGP'),
                    CURRENCYEXCHANGERATE: asNumber(pickField(row, ['exchange_rate', 'currencyExchangeRate']), 0),
                    DIS_RATE:         asNumber(pickField(row, ['discount_rate', 'disRate', 'dis_rate']), 0),
                    DIS_AMOUNT:       asNumber(pickField(row, ['discount_amount', 'disAmount', 'dis_amount']), 0),
                    TAXABLE_ITEMS:    [],
                };
                // Optional: a single VAT% column gets mapped to a T1/V001 entry
                // so the orchestrator emits the right ETA tax block. Customers
                // with multi-tax setups should pre-populate a JSON column.
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
