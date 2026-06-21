-- ═══════════════════════════════════════════════════════════
-- OTax Migration Script — Add All Missing Columns
-- Run this in pgAdmin → Query Tool on your OTax database
-- Safe to re-run (uses IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════

-- This script dynamically finds ALL org document/line tables
-- and adds the missing columns to each one.

DO $$
DECLARE
    doc_table TEXT;
    line_table TEXT;
BEGIN
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- PART 1: Add columns to ALL _documents tables
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    FOR doc_table IN
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'InvoicesDb'
          AND table_name LIKE 'org_%_documents'
    LOOP
        RAISE NOTICE 'Migrating documents table: InvoicesDb.%', doc_table;

        -- ── Existing extended columns (safe to re-run) ──
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "publicUrl" TEXT', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "totalItemsDiscountAmount" DOUBLE PRECISION DEFAULT 0', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "extraDiscountAmount" DOUBLE PRECISION DEFAULT 0', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "salesOrderReference" VARCHAR(500)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "salesOrderDescription" VARCHAR(500)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "purchaseOrderReference" VARCHAR(500)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "purchaseOrderDescription" VARCHAR(500)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "taxpayerActivityCode" VARCHAR(50)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "proformaInvoiceNumber" VARCHAR(500)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "currenciesSold" VARCHAR(20) DEFAULT ''EGP''', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "statusId" INTEGER', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "documentStatusReason" TEXT', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "cancelRequestDate" TIMESTAMP', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "rejectRequestDate" TIMESTAMP', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "canbeCancelledUntil" TIMESTAMP', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "canbeRejectedUntil" TIMESTAMP', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "taxTotalsJson" TEXT', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "issuerAddress" TEXT', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "receiverAddress" TEXT', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "issuerType" VARCHAR(10)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "receiverType" VARCHAR(10)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "documentTypeNamePrimaryLang" VARCHAR(200)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "documentTypeNameSecondaryLang" VARCHAR(200)', doc_table);

        -- ── Issuer address individual columns ──
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "issuer_address_country" VARCHAR(10)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "issuer_address_governate" VARCHAR(200)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "issuer_address_regionCity" VARCHAR(200)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "issuer_address_street" VARCHAR(500)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "issuer_address_buildingNumber" VARCHAR(50)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "issuer_address_postalCode" VARCHAR(20)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "issuer_address_room" VARCHAR(50)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "issuer_address_floor" VARCHAR(50)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "issuer_address_landmark" VARCHAR(500)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "issuer_address_additionalInformation" VARCHAR(500)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "issuer_address_branchID" VARCHAR(50)', doc_table);

        -- ── Receiver address individual columns ──
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "receiver_address_country" VARCHAR(10)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "receiver_address_governate" VARCHAR(200)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "receiver_address_regionCity" VARCHAR(200)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "receiver_address_street" VARCHAR(500)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "receiver_address_buildingNumber" VARCHAR(50)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "receiver_address_postalCode" VARCHAR(20)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "receiver_address_room" VARCHAR(50)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "receiver_address_floor" VARCHAR(50)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "receiver_address_landmark" VARCHAR(500)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "receiver_address_additionalInformation" VARCHAR(500)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "receiver_address_branchID" VARCHAR(50)', doc_table);

        -- ── Status/cancel/reject delay fields ──
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "cancelRequestDelayedDate" TIMESTAMP', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "rejectRequestDelayedDate" TIMESTAMP', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "declineCancelRequestDate" TIMESTAMP', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "declineRejectRequestDate" TIMESTAMP', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "submissionChannel" INTEGER', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "transformationStatus" VARCHAR(50)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "signedBy" VARCHAR(500)', doc_table);

        -- ── Audit batch 1: delivery, payment, freeze, misc ──
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "maxPercision" INTEGER', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "documentLinesTotalCount" INTEGER', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "lateSubmissionRequestNumber" VARCHAR(500)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "serviceDeliveryDate" TIMESTAMP', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "customsClearanceDate" TIMESTAMP', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "customsDeclarationNumber" VARCHAR(500)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "ePaymentNumber" VARCHAR(500)', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "deliveryJson" TEXT', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "paymentJson" TEXT', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "freezeStatusJson" TEXT', doc_table);

        -- ── Audit batch 2: document body + validation + codes ──
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "validationResultsJson" TEXT', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "invoiceLineItemCodesJson" TEXT', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "additionalMetadataJson" TEXT', doc_table);

        -- ── Audit 4: references, currencySegments, alertDetails ──
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "referencesJson" TEXT', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "currencySegmentsJson" TEXT', doc_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "alertDetailsJson" TEXT', doc_table);

        RAISE NOTICE '  ✅ Done: %', doc_table;
    END LOOP;

    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- PART 2: Add columns to ALL _lines tables
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    FOR line_table IN
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'InvoicesDb'
          AND table_name LIKE 'org_%_lines'
    LOOP
        RAISE NOTICE 'Migrating lines table: InvoicesDb.%', line_table;

        -- ── Extended line fields ──
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "itemPrimaryName" VARCHAR(1000)', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "itemSecondaryName" VARCHAR(1000)', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "amountSold" DOUBLE PRECISION DEFAULT 0', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "amountEGP" DOUBLE PRECISION DEFAULT 0', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "currencySold" VARCHAR(20) DEFAULT ''EGP''', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "currencyExchangeRate" DOUBLE PRECISION DEFAULT 0', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "weightUnitType" VARCHAR(20)', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "weightQuantity" DOUBLE PRECISION DEFAULT 0', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "salesTotalForeign" DOUBLE PRECISION DEFAULT 0', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "netTotalForeign" DOUBLE PRECISION DEFAULT 0', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "totalForeign" DOUBLE PRECISION DEFAULT 0', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "totalTaxableFeesForeign" DOUBLE PRECISION DEFAULT 0', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "itemsDiscountForeign" DOUBLE PRECISION DEFAULT 0', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "valueDifferenceForeign" DOUBLE PRECISION DEFAULT 0', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "discountAmountForeign" DOUBLE PRECISION DEFAULT 0', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "taxableItemsJson" TEXT', line_table);

        -- ── Flat tax columns (tax1 through tax8) ──
        FOR t IN 1..8 LOOP
            EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "tax%s_type" VARCHAR(20)', line_table, t);
            EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "tax%s_amount" DOUBLE PRECISION', line_table, t);
            EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "tax%s_subtype" VARCHAR(20)', line_table, t);
            EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "tax%s_rate" DOUBLE PRECISION', line_table, t);
            EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "tax%s_amountForeign" DOUBLE PRECISION', line_table, t);
        END LOOP;

        -- ── Error columns ──
        FOR e IN 1..8 LOOP
            EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "gettingError_%s" TEXT', line_table, e);
        END LOOP;

        -- ── Audit: item descriptions + factory unit value ──
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "itemPrimaryDescription" VARCHAR(500)', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "itemSecondaryDescription" VARCHAR(500)', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "factoryUnitValueJson" TEXT', line_table);

        -- ── Audit 3: Unit type names/descriptions ──
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "unitTypePrimaryName" VARCHAR(200)', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "unitTypePrimaryDescription" VARCHAR(500)', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "unitTypeSecondaryName" VARCHAR(200)', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "unitTypeSecondaryDescription" VARCHAR(500)', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "weightUnitTypePrimaryName" VARCHAR(200)', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "weightUnitTypePrimaryDescription" VARCHAR(500)', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "weightUnitTypeSecondaryName" VARCHAR(200)', line_table);
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "weightUnitTypeSecondaryDescription" VARCHAR(500)', line_table);

        -- ── Audit 4: discount rate foreign ──
        EXECUTE format('ALTER TABLE "InvoicesDb".%I ADD COLUMN IF NOT EXISTS "discountRateForeign" DOUBLE PRECISION DEFAULT 0', line_table);

        RAISE NOTICE '  ✅ Done: %', line_table;
    END LOOP;

    RAISE NOTICE '════════════════════════════════════════';
    RAISE NOTICE '✅ Migration complete for all org tables!';
    RAISE NOTICE '════════════════════════════════════════';
END $$;
