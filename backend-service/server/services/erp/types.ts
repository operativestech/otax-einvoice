/**
 * ERP adapter contract — every supported ERP type implements this same
 * interface so the importer + UI don't need branching per provider.
 *
 * Why an interface instead of a concrete adapter per route:
 *   - Lets us add SAP B1 / Microsoft Dynamics / Sage as drop-in modules
 *     without touching the orchestrator
 *   - Makes the importer trivially unit-testable (swap in a fake adapter)
 *   - Forces every adapter to expose the same contract so the UI can show
 *     consistent diagnostics + error messages
 *
 * The data shape `ErpInvoice` mirrors what /api/excel/submit expects so the
 * orchestrator can pass adapter output straight into the existing submission
 * pipeline without a second translation step.
 */

export type ErpProvider =
    | 'postgres'      // Native pg driver
    | 'npgsql'        // .NET-flavoured Postgres connection string — same engine
    | 'mysql'         // mysql2 driver
    | 'mssql'         // Microsoft SQL Server
    | 'oracle'        // Oracle Database via TCP / OCI string
    | 'odoo'          // Odoo XML-RPC API
    | 'sap_hana'      // SAP HANA Service Layer
    | 'sap_b1'        // SAP Business One DI-API
    | 'dynamics_bc'   // Microsoft Dynamics 365 Business Central OData
    | 'dynamics_ax'   // Microsoft Dynamics AX OData
    | 'sage'          // Sage 50 / 100 / 200 / X3
    | 'tally'         // Tally ERP 9 XML-RPC
    | 'excel'         // CSV/Excel watcher folder
    | 'custom_api';   // Generic REST endpoint described by user

/** Configuration we load from `org_integration_settings`. Every adapter
 *  picks the fields it needs and ignores the rest. */
export interface ErpConnectionConfig {
    provider: ErpProvider;
    host?: string | null;            // database host, ODBC server, or API base URL
    port?: number | null;
    database?: string | null;        // db name / Odoo db name / SAP company
    user?: string | null;            // login id / Odoo username / API key
    password?: string | null;        // cleartext password (decrypted by caller)
    legalEntity?: string | null;     // optional filter for multi-entity ERPs
    docTypeVersion?: string | null;  // version stamp for outgoing XML
    headerView?: string | null;      // SQL view / table name for invoice headers
    linesView?: string | null;       // SQL view / table name for invoice lines
}

/** What an adapter returns for a single invoice. Keys mirror the columns the
 *  /api/excel/submit handler expects (uppercase) so the orchestrator just
 *  forwards the array. */
export interface ErpInvoice {
    /** External id from the ERP — used to dedupe across runs. */
    externalId: string;

    INTERNAL_ID: string;
    DOCUMENT_TYPE?: string;            // 'I' | 'C' | 'D' | 'EI' | 'EC' | 'ED'
    DOCUMENT_TYPE_VERSION?: string;    // '0.9' | '1.0'
    DATE_TIME_ISSUED: string;          // ISO

    ISSUER_ID?: string | null;
    ISSUER_NAME?: string | null;

    RECEIVER_TYPE?: string;            // 'B' | 'P' | 'F'
    RECEIVER_ID: string;
    RECEIVER_NAME: string;
    RECEIVER_COUNTRY?: string;
    RECEIVER_GOVERNATE?: string;
    RECEIVER_REGIONCITY?: string;
    RECEIVER_STREET?: string;
    RECEIVER_BUILDINGNUMBER?: string;
    RECEIVER_POSTALCODE?: string;
    RECEIVER_FLOOR?: string;
    RECEIVER_ROOM?: string;

    CURRENCY?: string;                 // default 'EGP'
    EXTRADISCOUNTAMOUNT?: number;
    PURCHASEORDERREFERENCE?: string;
    PURCHASEORDERDESCRIPTION?: string;
    SALESORDERREFERENCE?: string;
    SALESORDERDESCRIPTION?: string;
    PROFORMAINVOICENUMBER?: string;
    ISSUER_BRANCH_ID?: string;

    lines: ErpInvoiceLine[];
}

export interface ErpInvoiceLine {
    DESCRIPTION: string;
    ITEMTYPE?: string;                  // 'EGS' | 'GS1' | 'GPC'
    ITEMCODE: string;
    ITEM_INTERNAL_CODE?: string;
    UNITTYPE: string;
    QUANTITY: number;
    AMOUNT: number;                     // unit price
    CURRENCYSOLD?: string;
    CURRENCYEXCHANGERATE?: number;
    DIS_RATE?: number;                  // discount %
    DIS_AMOUNT?: number;                // absolute discount
    /** Tax catalog entries — { taxType: 'T1', subType: 'V001', rate: 14 } etc. */
    TAXABLE_ITEMS?: Array<{ taxType: string; subType: string; rate: number }>;
}

export interface FetchOptions {
    /** Pull only invoices whose ERP-side timestamp is at-or-after this. */
    since?: Date;
    /** Pull only invoices whose ERP-side timestamp is before this. */
    until?: Date;
    /** Cap how many we pull in one go. */
    limit?: number;
    /** Skip the first N rows — for paging through large ERPs. */
    offset?: number;
}

export interface ConnectionTestResult {
    ok: boolean;
    /** Human-readable summary; safe to show in the UI. */
    message: string;
    /** Optional technical detail for the diagnostic panel. */
    details?: Record<string, any>;
}

/** Every adapter implements these three. `fetchInvoices` may be paginated by
 *  the caller via { offset, limit } — adapters should treat them as hints
 *  and return whatever's available within the bounds. */
export interface ErpAdapter {
    readonly provider: ErpProvider;
    testConnection(): Promise<ConnectionTestResult>;
    fetchInvoices(opts?: FetchOptions): Promise<ErpInvoice[]>;
    /** Optional cleanup — e.g. close pooled DB connections. */
    close?(): Promise<void>;
}
