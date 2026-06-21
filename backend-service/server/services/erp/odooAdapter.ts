/**
 * Odoo ERP adapter — talks to Odoo via JSON-RPC (Odoo also exposes XML-RPC,
 * but JSON-RPC is the same API with a JS-friendly transport, so we use it).
 *
 * Odoo's invoice model is `account.move` filtered on `move_type = 'out_invoice'`
 * (sales invoice). Lines are `account.move.line` joined via the `move_id`
 * field. Customer details come from the `res.partner` model joined via
 * `partner_id`.
 *
 * Auth flow:
 *   1. POST /jsonrpc to `service=common, method=authenticate` → uid
 *   2. Subsequent calls hit `service=object, method=execute_kw` with the uid
 *      and password to read records.
 *
 * The user types their Odoo URL into `host` (e.g. `https://erp.example.com`),
 * the database name into `database`, and an Odoo login + password into
 * `user`/`password`. We never store an API key — Odoo's RPC accepts the same
 * credentials a user logs in with.
 */

import type {
    ErpAdapter,
    ErpConnectionConfig,
    ErpInvoice,
    ErpInvoiceLine,
    FetchOptions,
    ConnectionTestResult,
} from './types.js';

interface OdooRpcRequest {
    service: 'common' | 'object' | 'db';
    method: string;
    args: any[];
}

export class OdooErpAdapter implements ErpAdapter {
    public readonly provider = 'odoo' as const;
    private uid: number | null = null;

    constructor(private cfg: ErpConnectionConfig) {}

    private get baseUrl(): string {
        const raw = this.cfg.host || '';
        if (!/^https?:\/\//.test(raw)) throw new Error(`Odoo URL must start with http:// or https:// (got "${raw}")`);
        return raw.replace(/\/+$/, '');
    }

    /** Low-level JSON-RPC call. Throws on transport error or odoo `error` field. */
    private async rpc<T = any>(payload: OdooRpcRequest): Promise<T> {
        const url = `${this.baseUrl}/jsonrpc`;
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 15_000);
        try {
            const r = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: payload }),
                signal: ctrl.signal,
            });
            if (!r.ok) throw new Error(`Odoo HTTP ${r.status} from ${url}`);
            const j: any = await r.json();
            if (j.error) {
                // Odoo error envelope: { code, message, data: { name, message, debug } }
                const debug = j.error?.data?.message || j.error?.message || 'unknown';
                throw new Error(`Odoo: ${debug}`);
            }
            return j.result as T;
        } finally {
            clearTimeout(timeout);
        }
    }

    private async authenticate(): Promise<number> {
        if (this.uid) return this.uid;
        if (!this.cfg.database) throw new Error('Odoo database name is required.');
        if (!this.cfg.user || !this.cfg.password) throw new Error('Odoo login + password are required.');
        const uid = await this.rpc<number | false>({
            service: 'common',
            method: 'authenticate',
            args: [this.cfg.database, this.cfg.user, this.cfg.password, {}],
        });
        if (!uid) throw new Error('Odoo authentication failed — check db / login / password.');
        this.uid = uid;
        return uid;
    }

    /** Wrapper for `execute_kw` — Odoo's primary read/write method. */
    private async exec<T = any>(model: string, method: string, args: any[], kwargs: Record<string, any> = {}): Promise<T> {
        const uid = await this.authenticate();
        return this.rpc<T>({
            service: 'object',
            method: 'execute_kw',
            args: [this.cfg.database, uid, this.cfg.password, model, method, args, kwargs],
        });
    }

    async testConnection(): Promise<ConnectionTestResult> {
        try {
            // 1. Server version (no auth required)
            const version = await this.rpc<any>({ service: 'common', method: 'version', args: [] });
            // 2. Authenticate to confirm credentials
            const uid = await this.authenticate();
            // 3. Sanity: count invoices visible to this user
            const invCount = await this.exec<number>('account.move', 'search_count',
                [[['move_type', '=', 'out_invoice'], ['state', '=', 'posted']]]);
            return {
                ok: true,
                message: `Connected to Odoo ${version.server_version || '?'} as user ${this.cfg.user}`,
                details: {
                    serverVersion: version.server_version,
                    serverSerie: version.server_serie,
                    uid,
                    visibleInvoices: invCount,
                },
            };
        } catch (e: any) {
            return { ok: false, message: e.message || String(e) };
        }
    }

    async fetchInvoices(opts: FetchOptions = {}): Promise<ErpInvoice[]> {
        // Build the Odoo "domain" filter — array of triples that AND together.
        const domain: any[] = [
            ['move_type', '=', 'out_invoice'],
            ['state', '=', 'posted'],            // skip drafts; only finalised invoices
        ];
        if (opts.since) domain.push(['invoice_date', '>=', opts.since.toISOString().slice(0, 10)]);
        if (opts.until) domain.push(['invoice_date', '<',  opts.until.toISOString().slice(0, 10)]);

        const limit  = Math.max(1, Math.min(opts.limit ?? 100, 1000));
        const offset = Math.max(0, opts.offset ?? 0);

        // Pull the headers — fields list keeps the payload small.
        const headerFields = [
            'id', 'name', 'invoice_date', 'amount_total', 'amount_untaxed', 'amount_tax',
            'currency_id', 'partner_id', 'state', 'move_type', 'invoice_line_ids',
            'invoice_origin', 'ref',
        ];
        const headers = await this.exec<any[]>('account.move', 'search_read', [domain],
            { fields: headerFields, limit, offset, order: 'invoice_date asc' });

        if (!headers.length) return [];

        // Resolve the partner (customer) records in one shot — much cheaper
        // than N+1 reads per invoice.
        const partnerIds = Array.from(new Set(headers.map(h => h.partner_id?.[0]).filter(Boolean)));
        const partnerMap: Record<number, any> = {};
        if (partnerIds.length) {
            const partners = await this.exec<any[]>('res.partner', 'read', [partnerIds],
                { fields: ['id', 'name', 'vat', 'country_id', 'state_id', 'city', 'street', 'street2', 'zip', 'company_type'] });
            for (const p of partners) partnerMap[p.id] = p;
        }

        // Resolve all line ids in one shot too.
        const lineIds = headers.flatMap(h => Array.isArray(h.invoice_line_ids) ? h.invoice_line_ids : []);
        const linesByMove: Record<number, ErpInvoiceLine[]> = {};
        if (lineIds.length) {
            const lineFields = [
                'id', 'move_id', 'name', 'product_id', 'quantity', 'price_unit',
                'discount', 'tax_ids', 'price_subtotal', 'price_total', 'product_uom_id',
            ];
            const lines = await this.exec<any[]>('account.move.line', 'read', [lineIds], { fields: lineFields });
            // Resolve tax records (id → percent) in one shot
            const taxIds = Array.from(new Set(lines.flatMap(l => Array.isArray(l.tax_ids) ? l.tax_ids : [])));
            const taxMap: Record<number, number> = {};
            if (taxIds.length) {
                const taxes = await this.exec<any[]>('account.tax', 'read', [taxIds], { fields: ['id', 'amount'] });
                for (const t of taxes) taxMap[t.id] = Number(t.amount || 0);
            }
            for (const ln of lines) {
                const moveId = Array.isArray(ln.move_id) ? ln.move_id[0] : ln.move_id;
                if (!moveId) continue;
                if (!linesByMove[moveId]) linesByMove[moveId] = [];
                const productCode = Array.isArray(ln.product_id) ? String(ln.product_id[1] || '').split(']')[0].replace('[', '') : '';
                const taxRate = Array.isArray(ln.tax_ids) && ln.tax_ids.length ? taxMap[ln.tax_ids[0]] || 0 : 0;
                linesByMove[moveId].push({
                    DESCRIPTION:        String(ln.name || ''),
                    ITEMTYPE:           'EGS',
                    ITEMCODE:           productCode || `ODOO-${ln.product_id?.[0] ?? ln.id}`,
                    ITEM_INTERNAL_CODE: String(ln.id),
                    UNITTYPE:           Array.isArray(ln.product_uom_id) ? String(ln.product_uom_id[1] || 'EA').slice(0, 10).toUpperCase() : 'EA',
                    QUANTITY:           Number(ln.quantity || 1),
                    AMOUNT:             Number(ln.price_unit || 0),
                    CURRENCYSOLD:       'EGP',
                    DIS_RATE:           Number(ln.discount || 0),
                    DIS_AMOUNT:         0,
                    TAXABLE_ITEMS:      taxRate ? [{ taxType: 'T1', subType: 'V001', rate: taxRate }] : [],
                });
            }
        }

        // Map to the canonical ErpInvoice shape.
        return headers.map(h => {
            const partner = partnerMap[h.partner_id?.[0]] || {};
            return {
                externalId: `odoo-${h.id}`,
                INTERNAL_ID: String(h.name || h.id),
                DOCUMENT_TYPE: 'I',
                DOCUMENT_TYPE_VERSION: this.cfg.docTypeVersion || '0.9',
                DATE_TIME_ISSUED: new Date(`${h.invoice_date}T12:00:00Z`).toISOString(),
                ISSUER_ID: null,
                ISSUER_NAME: null,
                RECEIVER_TYPE: partner.company_type === 'company' ? 'B' : 'P',
                RECEIVER_ID:   String(partner.vat || h.partner_id?.[1] || ''),
                RECEIVER_NAME: String(partner.name || h.partner_id?.[1] || ''),
                RECEIVER_COUNTRY:  Array.isArray(partner.country_id) ? String(partner.country_id[1]).slice(0, 2) : 'EG',
                RECEIVER_GOVERNATE: Array.isArray(partner.state_id) ? String(partner.state_id[1]) : '',
                RECEIVER_REGIONCITY: String(partner.city || ''),
                RECEIVER_STREET:   [partner.street, partner.street2].filter(Boolean).join(', '),
                RECEIVER_BUILDINGNUMBER: '',
                RECEIVER_POSTALCODE: String(partner.zip || ''),
                CURRENCY:          Array.isArray(h.currency_id) ? String(h.currency_id[1] || 'EGP') : 'EGP',
                EXTRADISCOUNTAMOUNT: 0,
                PURCHASEORDERREFERENCE: String(h.invoice_origin || ''),
                SALESORDERREFERENCE:    String(h.ref || ''),
                lines: linesByMove[h.id] || [],
            };
        });
    }
}
