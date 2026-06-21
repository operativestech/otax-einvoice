/**
 * orgTables — Create and manage per-organization tables
 *
 * Each org gets 3 tables:
 *   org_{id}_{safeName}_documents   — Invoice headers
 *   org_{id}_{safeName}_lines       — Invoice line items (with tax data stored as JSON)
 *   org_{id}_{safeName}_item_codes  — Item codes synced from ETA portal
 */

import pg from 'pg';

// ──────────────────────────────────────────────
// Utility: Build safe table name prefix
// ──────────────────────────────────────────────

export function getOrgTablePrefix(orgId: number, orgName: string): string {
    const safeName = (orgName || 'unknown')
        .replace(/[^a-zA-Z0-9]/g, '_')
        .toLowerCase()
        .substring(0, 30)
        .replace(/_+$/, ''); // remove trailing underscores
    return `org_${orgId}_${safeName}`;
}

export function getOrgTableNames(orgId: number, orgName: string) {
    const prefix = getOrgTablePrefix(orgId, orgName);
    return {
        documents: `${prefix}_documents`,
        lines: `${prefix}_lines`,
        item_codes: `${prefix}_item_codes`,
        erp_transactions: `${prefix}_erp_transactions`,
        bank_statements: `${prefix}_bank_statements`,
        matches: `${prefix}_matches`,
        customers: `${prefix}_customers`,   // master data: auto-populated from every invoice, unique by tax_id
    };
}

// ──────────────────────────────────────────────
// Create all org tables (2 tables now)
// ──────────────────────────────────────────────

export async function createOrgTables(
    pool: pg.Pool,
    orgId: number,
    orgName: string
): Promise<{ documents: string; lines: string; item_codes: string }> {
    const tables = getOrgTableNames(orgId, orgName);
    const client = await pool.connect();

    try {
        // Ensure InvoicesDb schema exists
        await client.query(`CREATE SCHEMA IF NOT EXISTS "InvoicesDb"`);

        // ── Table 1: Documents (Invoice Headers) ──
        await client.query(`
            CREATE TABLE IF NOT EXISTS "InvoicesDb"."${tables.documents}" (
                id                  BIGSERIAL PRIMARY KEY,
                uuid                VARCHAR(500) UNIQUE,
                "submissionId"      VARCHAR(500),
                "internalId"        VARCHAR(500),
                "longId"            VARCHAR(1000),
                submitted           BOOLEAN DEFAULT true,
                "typeName"          VARCHAR(100),
                "typeVersionName"   VARCHAR(50),
                "issuerId"          VARCHAR(100),
                "issuerName"        VARCHAR(500),
                "receiverId"        VARCHAR(100),
                "receiverName"      VARCHAR(500),
                "dateTimeIssued"    TIMESTAMP,
                "dateTimeReceived"  TIMESTAMP,
                "totalSales"        DOUBLE PRECISION,
                "totalDiscount"     DOUBLE PRECISION,
                "netAmount"         DOUBLE PRECISION,
                total               DOUBLE PRECISION,
                status              VARCHAR(50),
                direction           VARCHAR(20),
                "dateTimeCancelled" TIMESTAMP,
                environment         VARCHAR(20),
                currency            VARCHAR(10) DEFAULT 'EGP',
                "activityCode"      VARCHAR(20),
                "rejectionReasons"  TEXT,
                "documentBody"      TEXT,
                org_id              INTEGER DEFAULT ${orgId},
                synced_at           TIMESTAMP DEFAULT NOW(),
                created_at          TIMESTAMP DEFAULT NOW(),

                -- NEW columns from ETA Document Details API
                "publicUrl"             TEXT,
                "totalItemsDiscountAmount" DOUBLE PRECISION DEFAULT 0,
                "extraDiscountAmount"   DOUBLE PRECISION DEFAULT 0,
                "salesOrderReference"   VARCHAR(500),
                "salesOrderDescription" VARCHAR(500),
                "purchaseOrderReference" VARCHAR(500),
                "purchaseOrderDescription" VARCHAR(500),
                "taxpayerActivityCode"  VARCHAR(50),
                "proformaInvoiceNumber" VARCHAR(500),
                "currenciesSold"        VARCHAR(20) DEFAULT 'EGP',
                "statusId"              INTEGER,
                "documentStatusReason"  TEXT,
                "cancelRequestDate"     TIMESTAMP,
                "rejectRequestDate"     TIMESTAMP,
                "canbeCancelledUntil"   TIMESTAMP,
                "canbeRejectedUntil"    TIMESTAMP,
                "taxTotalsJson"         TEXT,
                "issuerAddress"         TEXT,
                "receiverAddress"       TEXT,
                "issuerType"            VARCHAR(10),
                "receiverType"          VARCHAR(10),
                "documentTypeNamePrimaryLang"   VARCHAR(200),
                "documentTypeNameSecondaryLang" VARCHAR(200),

                -- Task 1: Individual issuer address columns
                "issuer_address_country"       VARCHAR(10),
                "issuer_address_governate"     VARCHAR(200),
                "issuer_address_regionCity"    VARCHAR(200),
                "issuer_address_street"        VARCHAR(500),
                "issuer_address_buildingNumber" VARCHAR(50),
                "issuer_address_postalCode"    VARCHAR(20),
                "issuer_address_room"          VARCHAR(50),
                "issuer_address_floor"         VARCHAR(50),
                "issuer_address_landmark"      VARCHAR(500),
                "issuer_address_additionalInformation" VARCHAR(500),
                "issuer_address_branchID"      VARCHAR(50),

                -- Task 1: Individual receiver address columns
                "receiver_address_country"       VARCHAR(10),
                "receiver_address_governate"     VARCHAR(200),
                "receiver_address_regionCity"    VARCHAR(200),
                "receiver_address_street"        VARCHAR(500),
                "receiver_address_buildingNumber" VARCHAR(50),
                "receiver_address_postalCode"    VARCHAR(20),
                "receiver_address_room"          VARCHAR(50),
                "receiver_address_floor"         VARCHAR(50),
                "receiver_address_landmark"      VARCHAR(500),
                "receiver_address_additionalInformation" VARCHAR(500),
                "receiver_address_branchID"      VARCHAR(50),

                -- Task 4: Missing API fields
                "cancelRequestDelayedDate"     TIMESTAMP,
                "rejectRequestDelayedDate"     TIMESTAMP,
                "declineCancelRequestDate"     TIMESTAMP,
                "declineRejectRequestDate"     TIMESTAMP,
                "submissionChannel"            INTEGER,
                "transformationStatus"         VARCHAR(50),
                "signedBy"                     VARCHAR(500),

                -- Audit: remaining missing fields
                "maxPercision"                 INTEGER,
                "documentLinesTotalCount"       INTEGER,
                "lateSubmissionRequestNumber"   VARCHAR(500),
                "serviceDeliveryDate"           TIMESTAMP,
                "customsClearanceDate"          TIMESTAMP,
                "customsDeclarationNumber"      VARCHAR(500),
                "ePaymentNumber"               VARCHAR(500),
                "deliveryJson"                 TEXT,
                "paymentJson"                  TEXT,
                "freezeStatusJson"             TEXT,

                -- Audit 2: Final missing fields from Document.txt
                "validationResultsJson"        TEXT,
                "invoiceLineItemCodesJson"     TEXT,
                "additionalMetadataJson"       TEXT,

                -- Audit 4: Final remaining document fields
                "referencesJson"               TEXT,
                "currencySegmentsJson"         TEXT,
                "alertDetailsJson"             TEXT
            );
        `);

        // Indexes for documents
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.documents}_uuid" ON "InvoicesDb"."${tables.documents}" (uuid);`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.documents}_status" ON "InvoicesDb"."${tables.documents}" (status);`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.documents}_date" ON "InvoicesDb"."${tables.documents}" ("dateTimeIssued");`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.documents}_direction" ON "InvoicesDb"."${tables.documents}" (direction);`);
        // Composite index for the most common dashboard query: direction + status + date range
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.documents}_dir_status_date" ON "InvoicesDb"."${tables.documents}" (direction, status, "dateTimeIssued");`);
        // Counterparty lookups (used by reconciliation + reports)
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.documents}_receiver" ON "InvoicesDb"."${tables.documents}" ("receiverId");`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.documents}_issuer" ON "InvoicesDb"."${tables.documents}" ("issuerId");`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.documents}_submission" ON "InvoicesDb"."${tables.documents}" ("submissionId");`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.documents}_internalid" ON "InvoicesDb"."${tables.documents}" ("internalId");`);

        // ── Table 2: Invoice Lines (with taxable items stored as JSON) ──
        await client.query(`
            CREATE TABLE IF NOT EXISTS "InvoicesDb"."${tables.lines}" (
                id                  BIGSERIAL PRIMARY KEY,
                document_uuid       VARCHAR(500) NOT NULL,
                line_number         INTEGER NOT NULL,
                description         VARCHAR(1000),
                "itemType"          VARCHAR(20),
                "itemCode"          VARCHAR(100),
                "internalCode"      VARCHAR(100),
                "unitType"          VARCHAR(20) DEFAULT 'EA',
                quantity            DOUBLE PRECISION,
                "unitPrice"         DOUBLE PRECISION,
                currency            VARCHAR(10) DEFAULT 'EGP',
                "exchangeRate"      DOUBLE PRECISION DEFAULT 0,
                "salesTotal"        DOUBLE PRECISION,
                "discountRate"      DOUBLE PRECISION DEFAULT 0,
                "discountAmount"    DOUBLE PRECISION DEFAULT 0,
                "netTotal"          DOUBLE PRECISION,
                "totalTaxableFees"  DOUBLE PRECISION DEFAULT 0,
                "itemsDiscount"     DOUBLE PRECISION DEFAULT 0,
                "valueDifference"   DOUBLE PRECISION DEFAULT 0,
                total               DOUBLE PRECISION,
                org_id              INTEGER DEFAULT ${orgId},
                created_at          TIMESTAMP DEFAULT NOW(),

                -- NEW columns from ETA Document Details API
                "itemPrimaryName"       VARCHAR(1000),
                "itemSecondaryName"     VARCHAR(1000),
                "amountSold"            DOUBLE PRECISION DEFAULT 0,
                "amountEGP"             DOUBLE PRECISION DEFAULT 0,
                "currencySold"          VARCHAR(20) DEFAULT 'EGP',
                "currencyExchangeRate"  DOUBLE PRECISION DEFAULT 0,
                "weightUnitType"        VARCHAR(20),
                "weightQuantity"        DOUBLE PRECISION DEFAULT 0,
                "salesTotalForeign"     DOUBLE PRECISION DEFAULT 0,
                "netTotalForeign"       DOUBLE PRECISION DEFAULT 0,
                "totalForeign"          DOUBLE PRECISION DEFAULT 0,
                "totalTaxableFeesForeign" DOUBLE PRECISION DEFAULT 0,
                "itemsDiscountForeign"  DOUBLE PRECISION DEFAULT 0,
                "valueDifferenceForeign" DOUBLE PRECISION DEFAULT 0,
                "discountAmountForeign" DOUBLE PRECISION DEFAULT 0,
                "taxableItemsJson"      TEXT,

                -- Task 3: Flat tax columns (up to 8 taxes per line, 5 fields each)
                "tax1_type" VARCHAR(20), "tax1_amount" DOUBLE PRECISION, "tax1_subtype" VARCHAR(20), "tax1_rate" DOUBLE PRECISION, "tax1_amountForeign" DOUBLE PRECISION,
                "tax2_type" VARCHAR(20), "tax2_amount" DOUBLE PRECISION, "tax2_subtype" VARCHAR(20), "tax2_rate" DOUBLE PRECISION, "tax2_amountForeign" DOUBLE PRECISION,
                "tax3_type" VARCHAR(20), "tax3_amount" DOUBLE PRECISION, "tax3_subtype" VARCHAR(20), "tax3_rate" DOUBLE PRECISION, "tax3_amountForeign" DOUBLE PRECISION,
                "tax4_type" VARCHAR(20), "tax4_amount" DOUBLE PRECISION, "tax4_subtype" VARCHAR(20), "tax4_rate" DOUBLE PRECISION, "tax4_amountForeign" DOUBLE PRECISION,
                "tax5_type" VARCHAR(20), "tax5_amount" DOUBLE PRECISION, "tax5_subtype" VARCHAR(20), "tax5_rate" DOUBLE PRECISION, "tax5_amountForeign" DOUBLE PRECISION,
                "tax6_type" VARCHAR(20), "tax6_amount" DOUBLE PRECISION, "tax6_subtype" VARCHAR(20), "tax6_rate" DOUBLE PRECISION, "tax6_amountForeign" DOUBLE PRECISION,
                "tax7_type" VARCHAR(20), "tax7_amount" DOUBLE PRECISION, "tax7_subtype" VARCHAR(20), "tax7_rate" DOUBLE PRECISION, "tax7_amountForeign" DOUBLE PRECISION,
                "tax8_type" VARCHAR(20), "tax8_amount" DOUBLE PRECISION, "tax8_subtype" VARCHAR(20), "tax8_rate" DOUBLE PRECISION, "tax8_amountForeign" DOUBLE PRECISION,

                -- Task 5: Error columns for rejection/invalid reasons
                "gettingError_1" TEXT,
                "gettingError_2" TEXT,
                "gettingError_3" TEXT,
                "gettingError_4" TEXT,
                "gettingError_5" TEXT,
                "gettingError_6" TEXT,
                "gettingError_7" TEXT,
                "gettingError_8" TEXT,

                -- Audit: remaining missing line fields
                "itemPrimaryDescription"   VARCHAR(500),
                "itemSecondaryDescription" VARCHAR(500),
                "factoryUnitValueJson"     TEXT,

                -- Audit 3: Unit type name/description fields
                "unitTypePrimaryName"              VARCHAR(200),
                "unitTypePrimaryDescription"       VARCHAR(500),
                "unitTypeSecondaryName"            VARCHAR(200),
                "unitTypeSecondaryDescription"     VARCHAR(500),
                "weightUnitTypePrimaryName"        VARCHAR(200),
                "weightUnitTypePrimaryDescription"  VARCHAR(500),
                "weightUnitTypeSecondaryName"       VARCHAR(200),
                "weightUnitTypeSecondaryDescription" VARCHAR(500),

                -- Audit 4: discount rate foreign
                "discountRateForeign"          DOUBLE PRECISION DEFAULT 0
            );
        `);

        // Indexes for lines
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.lines}_doc" ON "InvoicesDb"."${tables.lines}" (document_uuid);`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.lines}_item" ON "InvoicesDb"."${tables.lines}" ("itemCode");`);

        // ── Table 3: Item Codes (synced from ETA portal) ──
        await client.query(`
            CREATE TABLE IF NOT EXISTS "InvoicesDb"."${tables.item_codes}" (
                id                  BIGSERIAL PRIMARY KEY,
                item_code           VARCHAR(100) UNIQUE,
                code_type           VARCHAR(20) DEFAULT 'EGS',
                code_name           VARCHAR(500),
                code_name_ar        VARCHAR(500),
                parent_code         VARCHAR(100),
                description         TEXT,
                description_ar      TEXT,
                active_from         TIMESTAMP,
                active_to           TIMESTAMP,
                status              VARCHAR(50) DEFAULT 'Submitted',
                request_id          VARCHAR(100),
                org_id              INTEGER DEFAULT ${orgId},
                synced_at           TIMESTAMP DEFAULT NOW(),
                created_at          TIMESTAMP DEFAULT NOW()
            );
        `);

        // Indexes for item_codes
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.item_codes}_code" ON "InvoicesDb"."${tables.item_codes}" (item_code);`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.item_codes}_type" ON "InvoicesDb"."${tables.item_codes}" (code_type);`);

        console.log(`[Org Tables] ✅ Created 3 tables for org ${orgId} (${orgName}):`,
            `\n  → ${tables.documents}`,
            `\n  → ${tables.lines}`,
            `\n  → ${tables.item_codes}`
        );

        return tables;
    } catch (err: any) {
        console.error(`[Org Tables] ❌ Error creating tables for org ${orgId}:`, err.message);
        throw err;
    } finally {
        client.release();
    }
}

// ──────────────────────────────────────────────
// Master-data tables (customers — auto-populated from invoices)
// ── Idempotent: safe to call lazily on every master-data request or invoice ingest.
// ──────────────────────────────────────────────

export async function ensureMasterDataTables(
    pool: pg.Pool,
    orgId: number,
    orgName: string
): Promise<{ customers: string }> {
    const tables = getOrgTableNames(orgId, orgName);
    const client = await pool.connect();
    try {
        await client.query(`CREATE SCHEMA IF NOT EXISTS "InvoicesDb"`);

        // Customer master — one row per unique tax_id (no duplicates).
        // direction='Sent' means they're a receiver of our invoices (customer of ours)
        // direction='Received' means they're an issuer (supplier). A single tax_id can be both.
        await client.query(`
            CREATE TABLE IF NOT EXISTS "InvoicesDb"."${tables.customers}" (
                id                BIGSERIAL PRIMARY KEY,
                tax_id            VARCHAR(100) NOT NULL UNIQUE,
                name              VARCHAR(500),
                party_type        VARCHAR(4),                       -- 'B' Business, 'P' Person, 'F' Foreigner
                country           VARCHAR(10),
                governate         VARCHAR(200),
                region_city       VARCHAR(200),
                street            VARCHAR(500),
                building_number   VARCHAR(100),
                postal_code       VARCHAR(50),
                floor             VARCHAR(50),
                room              VARCHAR(50),
                landmark          VARCHAR(500),
                additional_info   VARCHAR(500),
                branch_id         VARCHAR(50),
                phone             VARCHAR(50),
                email             VARCHAR(200),
                tags              TEXT[] DEFAULT ARRAY[]::TEXT[],   -- free-form labels added by user
                notes             TEXT,
                directions        TEXT[] DEFAULT ARRAY[]::TEXT[],   -- 'Sent' / 'Received' (they can be both)
                invoice_count     INTEGER NOT NULL DEFAULT 0,
                total_amount      DOUBLE PRECISION NOT NULL DEFAULT 0,
                first_seen_at     TIMESTAMP,
                last_seen_at      TIMESTAMP,
                manually_added    BOOLEAN NOT NULL DEFAULT FALSE,
                created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
                org_id            INTEGER DEFAULT ${orgId}
            );
        `);
        await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_${tables.customers}_tax" ON "InvoicesDb"."${tables.customers}" (tax_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.customers}_name" ON "InvoicesDb"."${tables.customers}" (name);`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.customers}_tags" ON "InvoicesDb"."${tables.customers}" USING GIN (tags);`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.customers}_last_seen" ON "InvoicesDb"."${tables.customers}" (last_seen_at DESC NULLS LAST);`);

        return { customers: tables.customers };
    } finally {
        client.release();
    }
}

/**
 * Extract counterparty details from one invoice and upsert into the per-org customers table.
 *
 * "Counterparty" = the other party. For `direction='Sent'` that's the receiver (our customer);
 * for `direction='Received'` that's the issuer (our supplier). Keyed by tax_id (case-insensitive,
 * trimmed) so re-submitting an invoice doesn't create duplicates.
 *
 * ON CONFLICT: name + address update ONLY if the current value is NULL (don't overwrite user edits).
 * Counters always increment, last_seen_at always advances.
 */
export interface InvoiceFactsForCustomer {
    direction: 'Sent' | 'Received' | string | null | undefined;
    issuerId?: string | null;
    issuerName?: string | null;
    issuerType?: string | null;
    issuerAddress?: {
        country?: string | null; governate?: string | null; regionCity?: string | null;
        street?: string | null; buildingNumber?: string | null; postalCode?: string | null;
        floor?: string | null; room?: string | null; landmark?: string | null;
        additionalInformation?: string | null; branchID?: string | null;
    } | null;
    receiverId?: string | null;
    receiverName?: string | null;
    receiverType?: string | null;
    receiverAddress?: InvoiceFactsForCustomer['issuerAddress'];
    total?: number | null;
    dateTimeIssued?: string | Date | null;
}

export async function upsertCustomerFromDoc(
    pool: pg.Pool,
    orgId: number,
    orgName: string,
    doc: InvoiceFactsForCustomer
): Promise<void> {
    if (!doc) return;
    const direction = String(doc.direction || '').trim();
    // Counterparty = the opposite side of `direction`.
    const isSent = direction === 'Sent';
    const partyId = (isSent ? doc.receiverId : doc.issuerId) || null;
    if (!partyId || !String(partyId).trim()) return;   // no tax id → can't upsert uniquely

    const partyName = (isSent ? doc.receiverName : doc.issuerName) || null;
    const partyType = (isSent ? doc.receiverType : doc.issuerType) || null;
    const addr = (isSent ? doc.receiverAddress : doc.issuerAddress) || {};
    const taxId = String(partyId).trim();

    const tables = getOrgTableNames(orgId, orgName);
    const total = Number(doc.total || 0);
    const issuedAt = doc.dateTimeIssued ? new Date(doc.dateTimeIssued) : new Date();

    try {
        await pool.query(
            `INSERT INTO "InvoicesDb"."${tables.customers}"
             (tax_id, name, party_type,
              country, governate, region_city, street, building_number, postal_code,
              floor, room, landmark, additional_info, branch_id,
              directions, invoice_count, total_amount, first_seen_at, last_seen_at)
             VALUES ($1,$2,$3, $4,$5,$6,$7,$8,$9, $10,$11,$12,$13,$14,
                     ARRAY[$15]::TEXT[], 1, $16, $17, $17)
             ON CONFLICT (tax_id) DO UPDATE SET
                 name            = COALESCE("InvoicesDb"."${tables.customers}".name, EXCLUDED.name),
                 party_type      = COALESCE("InvoicesDb"."${tables.customers}".party_type, EXCLUDED.party_type),
                 country         = COALESCE("InvoicesDb"."${tables.customers}".country, EXCLUDED.country),
                 governate       = COALESCE("InvoicesDb"."${tables.customers}".governate, EXCLUDED.governate),
                 region_city     = COALESCE("InvoicesDb"."${tables.customers}".region_city, EXCLUDED.region_city),
                 street          = COALESCE("InvoicesDb"."${tables.customers}".street, EXCLUDED.street),
                 building_number = COALESCE("InvoicesDb"."${tables.customers}".building_number, EXCLUDED.building_number),
                 postal_code     = COALESCE("InvoicesDb"."${tables.customers}".postal_code, EXCLUDED.postal_code),
                 floor           = COALESCE("InvoicesDb"."${tables.customers}".floor, EXCLUDED.floor),
                 room            = COALESCE("InvoicesDb"."${tables.customers}".room, EXCLUDED.room),
                 landmark        = COALESCE("InvoicesDb"."${tables.customers}".landmark, EXCLUDED.landmark),
                 additional_info = COALESCE("InvoicesDb"."${tables.customers}".additional_info, EXCLUDED.additional_info),
                 branch_id       = COALESCE("InvoicesDb"."${tables.customers}".branch_id, EXCLUDED.branch_id),
                 directions      = (
                     SELECT ARRAY(SELECT DISTINCT unnest(array_cat("InvoicesDb"."${tables.customers}".directions, EXCLUDED.directions)))
                 ),
                 invoice_count   = "InvoicesDb"."${tables.customers}".invoice_count + 1,
                 total_amount    = "InvoicesDb"."${tables.customers}".total_amount + EXCLUDED.total_amount,
                 last_seen_at    = GREATEST(COALESCE("InvoicesDb"."${tables.customers}".last_seen_at, EXCLUDED.last_seen_at), EXCLUDED.last_seen_at),
                 updated_at      = NOW()`,
            [
                taxId,
                partyName ? String(partyName).slice(0, 500) : null,
                partyType ? String(partyType).slice(0, 4) : null,
                addr?.country || null,
                addr?.governate || null,
                addr?.regionCity || null,
                addr?.street || null,
                addr?.buildingNumber || null,
                addr?.postalCode || null,
                addr?.floor || null,
                addr?.room || null,
                addr?.landmark || null,
                addr?.additionalInformation || null,
                addr?.branchID || null,
                direction || 'Sent',
                total,
                issuedAt,
            ]
        );
    } catch (e: any) {
        // Table might not exist yet — create it lazily and retry once.
        if (/relation.*does not exist/i.test(e.message || '')) {
            await ensureMasterDataTables(pool, orgId, orgName);
            await upsertCustomerFromDoc(pool, orgId, orgName, doc);
            return;
        }
        console.warn(`[Customers] upsert failed for tax_id=${taxId}:`, e.message);
    }
}

// ──────────────────────────────────────────────
// Reconciliation tables (ERP imports, bank statements, matches)
// ── Idempotent: safe to call on every reconciliation request.
// ──────────────────────────────────────────────

export async function ensureReconciliationTables(
    pool: pg.Pool,
    orgId: number,
    orgName: string
): Promise<{ erp_transactions: string; bank_statements: string; matches: string }> {
    const tables = getOrgTableNames(orgId, orgName);
    const client = await pool.connect();

    try {
        await client.query(`CREATE SCHEMA IF NOT EXISTS "InvoicesDb"`);

        // ── Table: ERP Transactions (AR/AP from ERP imports) ──
        await client.query(`
            CREATE TABLE IF NOT EXISTS "InvoicesDb"."${tables.erp_transactions}" (
                id                BIGSERIAL PRIMARY KEY,
                tx_type           VARCHAR(4) NOT NULL,              -- 'AR' | 'AP'
                doc_number        VARCHAR(100),                     -- invoice/bill number in ERP
                counterparty_id   VARCHAR(100),                     -- their tax ID / vendor code
                counterparty_name VARCHAR(500),
                issue_date        DATE,
                due_date          DATE,
                amount            DOUBLE PRECISION,
                currency          VARCHAR(10) DEFAULT 'EGP',
                status            VARCHAR(50),                      -- Open/Paid/Partial/Void
                external_ref      VARCHAR(200),
                raw_data          JSONB,
                import_batch_id   VARCHAR(64) NOT NULL,             -- groups rows from one upload
                imported_by       INTEGER,
                imported_at       TIMESTAMP NOT NULL DEFAULT NOW(),
                org_id            INTEGER DEFAULT ${orgId}
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.erp_transactions}_batch" ON "InvoicesDb"."${tables.erp_transactions}" (import_batch_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.erp_transactions}_type" ON "InvoicesDb"."${tables.erp_transactions}" (tx_type);`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.erp_transactions}_cp" ON "InvoicesDb"."${tables.erp_transactions}" (counterparty_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.erp_transactions}_date" ON "InvoicesDb"."${tables.erp_transactions}" (issue_date);`);

        // ── Table: Bank Statements (from bank CSV) ──
        await client.query(`
            CREATE TABLE IF NOT EXISTS "InvoicesDb"."${tables.bank_statements}" (
                id                BIGSERIAL PRIMARY KEY,
                bank_account      VARCHAR(100),                     -- user-tagged account label
                statement_date    DATE,                             -- posting date
                value_date        DATE,
                amount            DOUBLE PRECISION,                 -- +credit / -debit
                currency          VARCHAR(10) DEFAULT 'EGP',
                description       TEXT,
                reference         VARCHAR(200),
                balance_after     DOUBLE PRECISION,
                raw_data          JSONB,
                import_batch_id   VARCHAR(64) NOT NULL,
                imported_by       INTEGER,
                imported_at       TIMESTAMP NOT NULL DEFAULT NOW(),
                org_id            INTEGER DEFAULT ${orgId}
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.bank_statements}_batch" ON "InvoicesDb"."${tables.bank_statements}" (import_batch_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.bank_statements}_date" ON "InvoicesDb"."${tables.bank_statements}" (statement_date);`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.bank_statements}_acct" ON "InvoicesDb"."${tables.bank_statements}" (bank_account);`);

        // ── Table: Reconciliation Matches ──
        // Links an ERP row ↔ a bank row ↔ (optionally) an ETA document UUID.
        // Each of the three FK columns is nullable so partial matches (e.g. ERP+ETA w/o bank)
        // are still representable.
        await client.query(`
            CREATE TABLE IF NOT EXISTS "InvoicesDb"."${tables.matches}" (
                id             BIGSERIAL PRIMARY KEY,
                erp_tx_id      BIGINT,
                bank_tx_id     BIGINT,
                eta_uuid       VARCHAR(500),
                match_type     VARCHAR(16) NOT NULL,           -- PERFECT | WHT | FX | MANUAL
                confidence     INTEGER NOT NULL DEFAULT 0,     -- 0-100
                amount_diff    DOUBLE PRECISION DEFAULT 0,
                status         VARCHAR(16) NOT NULL DEFAULT 'SUGGESTED',  -- SUGGESTED|ACCEPTED|REJECTED
                notes          TEXT,
                created_by     INTEGER,
                created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
                reviewed_by    INTEGER,
                reviewed_at    TIMESTAMP,
                org_id         INTEGER DEFAULT ${orgId}
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.matches}_status" ON "InvoicesDb"."${tables.matches}" (status);`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.matches}_erp" ON "InvoicesDb"."${tables.matches}" (erp_tx_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.matches}_bank" ON "InvoicesDb"."${tables.matches}" (bank_tx_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tables.matches}_eta" ON "InvoicesDb"."${tables.matches}" (eta_uuid);`);

        return {
            erp_transactions: tables.erp_transactions,
            bank_statements: tables.bank_statements,
            matches: tables.matches,
        };
    } finally {
        client.release();
    }
}

// ──────────────────────────────────────────────
// Migrate existing org tables (add new columns)
// ── Safely adds missing columns to existing tables
// ──────────────────────────────────────────────

export async function migrateOrgTables(
    pool: pg.Pool,
    orgId: number,
    orgName: string
): Promise<void> {
    const tables = getOrgTableNames(orgId, orgName);
    const client = await pool.connect();

    try {
        // New document columns to add
        const docColumns = [
            `"publicUrl" TEXT`,
            `"totalItemsDiscountAmount" DOUBLE PRECISION DEFAULT 0`,
            `"extraDiscountAmount" DOUBLE PRECISION DEFAULT 0`,
            `"salesOrderReference" VARCHAR(500)`,
            `"salesOrderDescription" VARCHAR(500)`,
            `"purchaseOrderReference" VARCHAR(500)`,
            `"purchaseOrderDescription" VARCHAR(500)`,
            `"taxpayerActivityCode" VARCHAR(50)`,
            `"proformaInvoiceNumber" VARCHAR(500)`,
            `"currenciesSold" VARCHAR(20) DEFAULT 'EGP'`,
            `"statusId" INTEGER`,
            `"documentStatusReason" TEXT`,
            `"cancelRequestDate" TIMESTAMP`,
            `"rejectRequestDate" TIMESTAMP`,
            `"canbeCancelledUntil" TIMESTAMP`,
            `"canbeRejectedUntil" TIMESTAMP`,
            `"taxTotalsJson" TEXT`,
            `"issuerAddress" TEXT`,
            `"receiverAddress" TEXT`,
            `"issuerType" VARCHAR(10)`,
            `"receiverType" VARCHAR(10)`,
            `"documentTypeNamePrimaryLang" VARCHAR(200)`,
            `"documentTypeNameSecondaryLang" VARCHAR(200)`,
            // Task 1: Individual issuer address columns
            `"issuer_address_country" VARCHAR(10)`,
            `"issuer_address_governate" VARCHAR(200)`,
            `"issuer_address_regionCity" VARCHAR(200)`,
            `"issuer_address_street" VARCHAR(500)`,
            `"issuer_address_buildingNumber" VARCHAR(50)`,
            `"issuer_address_postalCode" VARCHAR(20)`,
            `"issuer_address_room" VARCHAR(50)`,
            `"issuer_address_floor" VARCHAR(50)`,
            `"issuer_address_landmark" VARCHAR(500)`,
            `"issuer_address_additionalInformation" VARCHAR(500)`,
            `"issuer_address_branchID" VARCHAR(50)`,
            // Task 1: Individual receiver address columns
            `"receiver_address_country" VARCHAR(10)`,
            `"receiver_address_governate" VARCHAR(200)`,
            `"receiver_address_regionCity" VARCHAR(200)`,
            `"receiver_address_street" VARCHAR(500)`,
            `"receiver_address_buildingNumber" VARCHAR(50)`,
            `"receiver_address_postalCode" VARCHAR(20)`,
            `"receiver_address_room" VARCHAR(50)`,
            `"receiver_address_floor" VARCHAR(50)`,
            `"receiver_address_landmark" VARCHAR(500)`,
            `"receiver_address_additionalInformation" VARCHAR(500)`,
            `"receiver_address_branchID" VARCHAR(50)`,
            // Task 4: Missing API fields
            `"cancelRequestDelayedDate" TIMESTAMP`,
            `"rejectRequestDelayedDate" TIMESTAMP`,
            `"declineCancelRequestDate" TIMESTAMP`,
            `"declineRejectRequestDate" TIMESTAMP`,
            `"submissionChannel" INTEGER`,
            `"transformationStatus" VARCHAR(50)`,
            `"signedBy" VARCHAR(500)`,
            // Audit: remaining missing document fields
            `"maxPercision" INTEGER`,
            `"documentLinesTotalCount" INTEGER`,
            `"lateSubmissionRequestNumber" VARCHAR(500)`,
            `"serviceDeliveryDate" TIMESTAMP`,
            `"customsClearanceDate" TIMESTAMP`,
            `"customsDeclarationNumber" VARCHAR(500)`,
            `"ePaymentNumber" VARCHAR(500)`,
            `"deliveryJson" TEXT`,
            `"paymentJson" TEXT`,
            `"freezeStatusJson" TEXT`,
            // Audit 2: Final missing fields from Document.txt
            `"validationResultsJson" TEXT`,
            `"invoiceLineItemCodesJson" TEXT`,
            `"additionalMetadataJson" TEXT`,
            // Audit 4: Final remaining document fields
            `"referencesJson" TEXT`,
            `"currencySegmentsJson" TEXT`,
            `"alertDetailsJson" TEXT`,
        ];

        for (const col of docColumns) {
            const colName = col.split(' ')[0]; // e.g. "publicUrl"
            try {
                await client.query(`ALTER TABLE "InvoicesDb"."${tables.documents}" ADD COLUMN IF NOT EXISTS ${col}`);
            } catch (e: any) {
                // Ignore if column already exists (older Postgres without IF NOT EXISTS)
                if (!e.message.includes('already exists')) {
                    console.warn(`[Migration] Could not add ${colName} to ${tables.documents}: ${e.message}`);
                }
            }
        }

        // New line columns to add
        const lineColumns = [
            `"itemPrimaryName" VARCHAR(1000)`,
            `"itemSecondaryName" VARCHAR(1000)`,
            `"amountSold" DOUBLE PRECISION DEFAULT 0`,
            `"amountEGP" DOUBLE PRECISION DEFAULT 0`,
            `"currencySold" VARCHAR(20) DEFAULT 'EGP'`,
            `"currencyExchangeRate" DOUBLE PRECISION DEFAULT 0`,
            `"weightUnitType" VARCHAR(20)`,
            `"weightQuantity" DOUBLE PRECISION DEFAULT 0`,
            `"salesTotalForeign" DOUBLE PRECISION DEFAULT 0`,
            `"netTotalForeign" DOUBLE PRECISION DEFAULT 0`,
            `"totalForeign" DOUBLE PRECISION DEFAULT 0`,
            `"totalTaxableFeesForeign" DOUBLE PRECISION DEFAULT 0`,
            `"itemsDiscountForeign" DOUBLE PRECISION DEFAULT 0`,
            `"valueDifferenceForeign" DOUBLE PRECISION DEFAULT 0`,
            `"discountAmountForeign" DOUBLE PRECISION DEFAULT 0`,
            `"taxableItemsJson" TEXT`,
            // Task 3: Flat tax columns (5 fields each)
            `"tax1_type" VARCHAR(20)`, `"tax1_amount" DOUBLE PRECISION`, `"tax1_subtype" VARCHAR(20)`, `"tax1_rate" DOUBLE PRECISION`, `"tax1_amountForeign" DOUBLE PRECISION`,
            `"tax2_type" VARCHAR(20)`, `"tax2_amount" DOUBLE PRECISION`, `"tax2_subtype" VARCHAR(20)`, `"tax2_rate" DOUBLE PRECISION`, `"tax2_amountForeign" DOUBLE PRECISION`,
            `"tax3_type" VARCHAR(20)`, `"tax3_amount" DOUBLE PRECISION`, `"tax3_subtype" VARCHAR(20)`, `"tax3_rate" DOUBLE PRECISION`, `"tax3_amountForeign" DOUBLE PRECISION`,
            `"tax4_type" VARCHAR(20)`, `"tax4_amount" DOUBLE PRECISION`, `"tax4_subtype" VARCHAR(20)`, `"tax4_rate" DOUBLE PRECISION`, `"tax4_amountForeign" DOUBLE PRECISION`,
            `"tax5_type" VARCHAR(20)`, `"tax5_amount" DOUBLE PRECISION`, `"tax5_subtype" VARCHAR(20)`, `"tax5_rate" DOUBLE PRECISION`, `"tax5_amountForeign" DOUBLE PRECISION`,
            `"tax6_type" VARCHAR(20)`, `"tax6_amount" DOUBLE PRECISION`, `"tax6_subtype" VARCHAR(20)`, `"tax6_rate" DOUBLE PRECISION`, `"tax6_amountForeign" DOUBLE PRECISION`,
            `"tax7_type" VARCHAR(20)`, `"tax7_amount" DOUBLE PRECISION`, `"tax7_subtype" VARCHAR(20)`, `"tax7_rate" DOUBLE PRECISION`, `"tax7_amountForeign" DOUBLE PRECISION`,
            `"tax8_type" VARCHAR(20)`, `"tax8_amount" DOUBLE PRECISION`, `"tax8_subtype" VARCHAR(20)`, `"tax8_rate" DOUBLE PRECISION`, `"tax8_amountForeign" DOUBLE PRECISION`,
            // Task 5: Error columns
            `"gettingError_1" TEXT`,
            `"gettingError_2" TEXT`,
            `"gettingError_3" TEXT`,
            `"gettingError_4" TEXT`,
            `"gettingError_5" TEXT`,
            `"gettingError_6" TEXT`,
            `"gettingError_7" TEXT`,
            `"gettingError_8" TEXT`,
            // Audit: remaining missing line fields
            `"itemPrimaryDescription" VARCHAR(500)`,
            `"itemSecondaryDescription" VARCHAR(500)`,
            `"factoryUnitValueJson" TEXT`,
            // Audit 3: Unit type name/description fields
            `"unitTypePrimaryName" VARCHAR(200)`,
            `"unitTypePrimaryDescription" VARCHAR(500)`,
            `"unitTypeSecondaryName" VARCHAR(200)`,
            `"unitTypeSecondaryDescription" VARCHAR(500)`,
            `"weightUnitTypePrimaryName" VARCHAR(200)`,
            `"weightUnitTypePrimaryDescription" VARCHAR(500)`,
            `"weightUnitTypeSecondaryName" VARCHAR(200)`,
            `"weightUnitTypeSecondaryDescription" VARCHAR(500)`,
            // Audit 4: discount rate foreign
            `"discountRateForeign" DOUBLE PRECISION DEFAULT 0`,
        ];

        for (const col of lineColumns) {
            const colName = col.split(' ')[0];
            try {
                await client.query(`ALTER TABLE "InvoicesDb"."${tables.lines}" ADD COLUMN IF NOT EXISTS ${col}`);
            } catch (e: any) {
                if (!e.message.includes('already exists')) {
                    console.warn(`[Migration] Could not add ${colName} to ${tables.lines}: ${e.message}`);
                }
            }
        }

        console.log(`[Org Tables] ✅ Migration complete for org ${orgId} (${orgName})`);
    } catch (err: any) {
        console.error(`[Org Tables] ❌ Migration error for org ${orgId}:`, err.message);
    } finally {
        client.release();
    }
}

// ──────────────────────────────────────────────
// Ensure performance indexes on documents table
// ── Backfill helper for orgs whose tables predate the composite indexes.
//    Safe to call repeatedly — all CREATE INDEX use IF NOT EXISTS.
// ──────────────────────────────────────────────

export async function ensureDocumentIndexes(
    pool: pg.Pool,
    orgId: number,
    orgName: string
): Promise<void> {
    const tables = getOrgTableNames(orgId, orgName);
    const client = await pool.connect();
    try {
        const stmts = [
            `CREATE INDEX IF NOT EXISTS "idx_${tables.documents}_dir_status_date" ON "InvoicesDb"."${tables.documents}" (direction, status, "dateTimeIssued")`,
            `CREATE INDEX IF NOT EXISTS "idx_${tables.documents}_receiver" ON "InvoicesDb"."${tables.documents}" ("receiverId")`,
            `CREATE INDEX IF NOT EXISTS "idx_${tables.documents}_issuer" ON "InvoicesDb"."${tables.documents}" ("issuerId")`,
            `CREATE INDEX IF NOT EXISTS "idx_${tables.documents}_submission" ON "InvoicesDb"."${tables.documents}" ("submissionId")`,
            `CREATE INDEX IF NOT EXISTS "idx_${tables.documents}_internalid" ON "InvoicesDb"."${tables.documents}" ("internalId")`,
        ];
        for (const sql of stmts) {
            try { await client.query(sql); }
            catch (e: any) { console.warn(`[Indexes] Skipped: ${e.message}`); }
        }
    } finally {
        client.release();
    }
}

// ──────────────────────────────────────────────
// Check if org tables exist
// ──────────────────────────────────────────────

export async function orgTablesExist(
    pool: pg.Pool,
    orgId: number,
    orgName: string
): Promise<boolean> {
    const tables = getOrgTableNames(orgId, orgName);
    const client = await pool.connect();

    try {
        const result = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'InvoicesDb' 
                AND table_name = $1
            ) as exists
        `, [tables.documents]);

        return result.rows[0]?.exists || false;
    } finally {
        client.release();
    }
}

// ──────────────────────────────────────────────
// Find org table name from DB (by orgId)
// ── Searches for any table matching org_{id}_*_documents
// ──────────────────────────────────────────────

export async function findOrgTablePrefix(
    pool: pg.Pool,
    orgId: number
): Promise<string | null> {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'InvoicesDb' 
            AND table_name LIKE $1
            LIMIT 1
        `, [`org_${orgId}_%_documents`]);

        if (result.rows.length > 0) {
            // Extract prefix from "org_5_acme_documents" → "org_5_acme"
            const tableName = result.rows[0].table_name;
            return tableName.replace('_documents', '');
        }
        return null;
    } finally {
        client.release();
    }
}

// ──────────────────────────────────────────────
// Drop org tables (for cleanup/migration)
// ──────────────────────────────────────────────

export async function dropOrgTables(
    pool: pg.Pool,
    orgId: number,
    orgName: string
): Promise<void> {
    const tables = getOrgTableNames(orgId, orgName);
    const client = await pool.connect();

    try {
        const prefix = getOrgTablePrefix(orgId, orgName);
        // Drop legacy tax_items table if it exists
        await client.query(`DROP TABLE IF EXISTS "InvoicesDb"."${prefix}_tax_items" CASCADE;`);
        await client.query(`DROP TABLE IF EXISTS "InvoicesDb"."${tables.item_codes}" CASCADE;`);
        await client.query(`DROP TABLE IF EXISTS "InvoicesDb"."${tables.lines}" CASCADE;`);
        await client.query(`DROP TABLE IF EXISTS "InvoicesDb"."${tables.documents}" CASCADE;`);
        console.log(`[Org Tables] 🗑️ Dropped tables for org ${orgId} (${orgName})`);
    } finally {
        client.release();
    }
}
