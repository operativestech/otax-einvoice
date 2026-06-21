-- ============================================
-- OTax Full Schema Recreation Script
-- Generated from schema.prisma
-- Uses IF NOT EXISTS — safe to run multiple times
-- ============================================

-- ── Create Schemas ──
CREATE SCHEMA IF NOT EXISTS "otaxdb";
CREATE SCHEMA IF NOT EXISTS "InvoicesDb";
-- public schema always exists

-- ============================================
-- SCHEMA: otaxdb
-- ============================================

-- 1. organizations (referenced by many tables)
CREATE TABLE IF NOT EXISTS "otaxdb"."organizations" (
    "id"                       SERIAL PRIMARY KEY,
    "name"                     VARCHAR(500) NOT NULL,
    "tax_id"                   VARCHAR(50) NOT NULL UNIQUE,
    "org_join_code"            VARCHAR(20) UNIQUE,
    "company_type"             VARCHAR(50),
    "email"                    VARCHAR(255),
    "phone"                    VARCHAR(50),
    "website"                  VARCHAR(255),
    "country"                  VARCHAR(100),
    "governorate"              VARCHAR(100),
    "city"                     VARCHAR(100),
    "street"                   VARCHAR(500),
    "building_number"          VARCHAR(50),
    "postal_code"              VARCHAR(20),
    "logo_url"                 TEXT,
    "primary_color"            VARCHAR(20) DEFAULT '#1e40af',
    "language"                 VARCHAR(10) DEFAULT 'en',
    "timezone"                 VARCHAR(50) DEFAULT 'Africa/Cairo',
    "currency"                 VARCHAR(10) DEFAULT 'EGP',
    "is_active"                BOOLEAN DEFAULT TRUE,
    "subscription_plan"        VARCHAR(50) DEFAULT 'free',
    "subscription_expires_at"  TIMESTAMP(6),
    "created_at"               TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "created_by"               INTEGER
);
CREATE INDEX IF NOT EXISTS "idx_org_active" ON "otaxdb"."organizations" ("is_active");
CREATE INDEX IF NOT EXISTS "idx_org_tax_id" ON "otaxdb"."organizations" ("tax_id");

-- 2. credentials
CREATE TABLE IF NOT EXISTS "otaxdb"."credentials" (
    "id"              BIGSERIAL PRIMARY KEY,
    "username"        VARCHAR(255) UNIQUE,
    "email"           VARCHAR(255) UNIQUE,
    "password"        VARCHAR(255),
    "hwid"            VARCHAR(255),
    "isValid"         BOOLEAN DEFAULT FALSE,
    "isDemo"          BOOLEAN,
    "email_verified"  BOOLEAN DEFAULT FALSE,
    "registerDate"    TIME(6) DEFAULT CURRENT_TIMESTAMP,
    "expiryDate"      TIMESTAMP(6) DEFAULT (CURRENT_TIMESTAMP + '9 days'::interval),
    "configHash"      VARCHAR,
    "organization_id" INTEGER REFERENCES "otaxdb"."organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "idx_credentials_org" ON "otaxdb"."credentials" ("organization_id");

-- 3. clients_info_new
CREATE TABLE IF NOT EXISTS "otaxdb"."clients_info_new" (
    "id"             BIGSERIAL,
    "hwid"           VARCHAR NOT NULL,
    "uid"            BIGINT NOT NULL,
    "property_name"  VARCHAR NOT NULL,
    "property_value" VARCHAR,
    "nonAdminEdit"   BOOLEAN,
    "modifyDate"     TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "modify_date"    TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("hwid", "uid", "property_name")
);

-- 4. roles
CREATE TABLE IF NOT EXISTS "otaxdb"."roles" (
    "id"           SERIAL PRIMARY KEY,
    "name"         VARCHAR(255) NOT NULL UNIQUE,
    "display_name" VARCHAR(255) NOT NULL,
    "description"  TEXT,
    "is_system"    BOOLEAN DEFAULT FALSE,
    "created_at"   TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

-- 5. permissions
CREATE TABLE IF NOT EXISTS "otaxdb"."permissions" (
    "id"           SERIAL PRIMARY KEY,
    "name"         VARCHAR(255) NOT NULL UNIQUE,
    "display_name" VARCHAR(255) NOT NULL,
    "description"  TEXT,
    "module"       VARCHAR(255) NOT NULL,
    "action"       VARCHAR(255) NOT NULL,
    "created_at"   TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

-- 6. user_roles
CREATE TABLE IF NOT EXISTS "otaxdb"."user_roles" (
    "id"          SERIAL PRIMARY KEY,
    "user_id"     BIGINT NOT NULL REFERENCES "otaxdb"."credentials"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    "role_id"     INTEGER NOT NULL REFERENCES "otaxdb"."roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    "assigned_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" BIGINT,
    UNIQUE("user_id", "role_id")
);

-- 7. role_permissions
CREATE TABLE IF NOT EXISTS "otaxdb"."role_permissions" (
    "id"            SERIAL PRIMARY KEY,
    "role_id"       INTEGER NOT NULL REFERENCES "otaxdb"."roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    "permission_id" INTEGER NOT NULL REFERENCES "otaxdb"."permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    "created_at"    TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("role_id", "permission_id")
);


-- 11. user_activity_logs
CREATE TABLE IF NOT EXISTS "otaxdb"."user_activity_logs" (
    "id"            SERIAL PRIMARY KEY,
    "user_id"       INTEGER NOT NULL,
    "username"      VARCHAR(255) NOT NULL,
    "action"        VARCHAR(255) NOT NULL,
    "module"        VARCHAR(255),
    "resource_type" VARCHAR(255),
    "resource_id"   VARCHAR(255),
    "details"       TEXT,
    "ip_address"    VARCHAR(50),
    "user_agent"    TEXT,
    "status"        VARCHAR(50) DEFAULT 'success',
    "error_message" TEXT,
    "created_at"    TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_user_activity_action"     ON "otaxdb"."user_activity_logs" ("action");
CREATE INDEX IF NOT EXISTS "idx_user_activity_created_at" ON "otaxdb"."user_activity_logs" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_user_activity_user_id"    ON "otaxdb"."user_activity_logs" ("user_id");

-- 12. user_login_history
CREATE TABLE IF NOT EXISTS "otaxdb"."user_login_history" (
    "id"               SERIAL PRIMARY KEY,
    "user_id"          INTEGER NOT NULL,
    "username"         VARCHAR(255) NOT NULL,
    "login_time"       TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "logout_time"      TIMESTAMP(6),
    "ip_address"       VARCHAR(50),
    "user_agent"       TEXT,
    "device"           VARCHAR(100),
    "browser"          VARCHAR(100),
    "os"               VARCHAR(100),
    "location"         VARCHAR(255),
    "session_duration" INTEGER,
    "status"           VARCHAR(50) DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS "idx_login_history_login_time" ON "otaxdb"."user_login_history" ("login_time");
CREATE INDEX IF NOT EXISTS "idx_login_history_user_id"    ON "otaxdb"."user_login_history" ("user_id");

-- 13. eta_sync_status
CREATE TABLE IF NOT EXISTS "otaxdb"."eta_sync_status" (
    "id"                 SERIAL PRIMARY KEY,
    "user_id"            INTEGER NOT NULL UNIQUE,
    "username"           VARCHAR(255) NOT NULL,
    "environment"        VARCHAR(20) DEFAULT 'PreProd',
    "last_sync_time"     TIMESTAMP(6),
    "next_sync_time"     TIMESTAMP(6),
    "sync_status"        VARCHAR(50) DEFAULT 'pending',
    "total_documents"    INTEGER DEFAULT 0,
    "valid_documents"    INTEGER DEFAULT 0,
    "invalid_documents"  INTEGER DEFAULT 0,
    "rejected_documents" INTEGER DEFAULT 0,
    "cancelled_documents" INTEGER DEFAULT 0,
    "submitted_documents" INTEGER DEFAULT 0,
    "last_error"         TEXT,
    "sync_duration"      INTEGER,
    "is_auto_sync"       BOOLEAN DEFAULT TRUE,
    "sync_interval"      INTEGER DEFAULT 300,
    "created_at"         TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "organization_id"    INTEGER REFERENCES "otaxdb"."organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "idx_eta_sync_last_sync" ON "otaxdb"."eta_sync_status" ("last_sync_time");
CREATE INDEX IF NOT EXISTS "idx_eta_sync_user_id"   ON "otaxdb"."eta_sync_status" ("user_id");

-- 14. eta_sync_history
CREATE TABLE IF NOT EXISTS "otaxdb"."eta_sync_history" (
    "id"                SERIAL PRIMARY KEY,
    "user_id"           INTEGER NOT NULL,
    "username"          VARCHAR(255) NOT NULL,
    "environment"       VARCHAR(20) NOT NULL,
    "sync_start_time"   TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "sync_end_time"     TIMESTAMP(6),
    "sync_duration"     INTEGER,
    "status"            VARCHAR(50) NOT NULL,
    "documents_found"   INTEGER DEFAULT 0,
    "documents_added"   INTEGER DEFAULT 0,
    "documents_updated" INTEGER DEFAULT 0,
    "documents_failed"  INTEGER DEFAULT 0,
    "error_message"     TEXT,
    "error_details"     TEXT,
    "api_calls_count"   INTEGER DEFAULT 0,
    "date_range_from"   TIMESTAMP(6),
    "date_range_to"     TIMESTAMP(6),
    "triggered_by"      VARCHAR(50) DEFAULT 'auto'
);
CREATE INDEX IF NOT EXISTS "idx_eta_history_start_time" ON "otaxdb"."eta_sync_history" ("sync_start_time");
CREATE INDEX IF NOT EXISTS "idx_eta_history_status"     ON "otaxdb"."eta_sync_history" ("status");
CREATE INDEX IF NOT EXISTS "idx_eta_history_user_id"    ON "otaxdb"."eta_sync_history" ("user_id");

-- 15. eta_credentials
CREATE TABLE IF NOT EXISTS "otaxdb"."eta_credentials" (
    "id"                SERIAL PRIMARY KEY,
    "user_id"           INTEGER NOT NULL,
    "environment"       VARCHAR(20) DEFAULT 'PreProd',
    "client_id"         TEXT,
    "client_secret"     TEXT,
    "tax_id"            VARCHAR(50),
    "is_active"         BOOLEAN DEFAULT TRUE,
    "last_validated"    TIMESTAMP(6),
    "validation_status" VARCHAR(50),
    "created_at"        TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "organization_id"   INTEGER REFERENCES "otaxdb"."organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "idx_eta_creds_user_id" ON "otaxdb"."eta_credentials" ("user_id");


-- 19. organization_audit_logs
CREATE TABLE IF NOT EXISTS "otaxdb"."organization_audit_logs" (
    "id"              SERIAL PRIMARY KEY,
    "organization_id" INTEGER NOT NULL REFERENCES "otaxdb"."organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    "user_id"         BIGINT REFERENCES "otaxdb"."credentials"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    "action"          VARCHAR(255) NOT NULL,
    "resource_type"   VARCHAR(100),
    "resource_id"     VARCHAR(100),
    "details"         TEXT,
    "ip_address"      VARCHAR(50),
    "user_agent"      TEXT,
    "created_at"      TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_org_audit_created" ON "otaxdb"."organization_audit_logs" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_org_audit_org"     ON "otaxdb"."organization_audit_logs" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_org_audit_user"    ON "otaxdb"."organization_audit_logs" ("user_id");

-- 20. organization_invitations
CREATE TABLE IF NOT EXISTS "otaxdb"."organization_invitations" (
    "id"              SERIAL PRIMARY KEY,
    "organization_id" INTEGER NOT NULL REFERENCES "otaxdb"."organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    "email"           VARCHAR(255) NOT NULL,
    "role_id"         INTEGER REFERENCES "otaxdb"."roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    "role_name"       VARCHAR(100),
    "token"           VARCHAR(255) NOT NULL UNIQUE,
    "status"          VARCHAR(50) DEFAULT 'pending',
    "invited_by"      BIGINT REFERENCES "otaxdb"."credentials"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    "accepted_by"     BIGINT REFERENCES "otaxdb"."credentials"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    "expires_at"      TIMESTAMP(6),
    "created_at"      TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "accepted_at"     TIMESTAMP(6)
);
CREATE INDEX IF NOT EXISTS "idx_org_inv_org"   ON "otaxdb"."organization_invitations" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_org_inv_token" ON "otaxdb"."organization_invitations" ("token");

-- 21. leads
CREATE TABLE IF NOT EXISTS "otaxdb"."leads" (
    "id"           SERIAL PRIMARY KEY,
    "email"        VARCHAR(255) NOT NULL UNIQUE,
    "name"         VARCHAR(255) NOT NULL,
    "phone"        VARCHAR(50),
    "company_name" VARCHAR(255),
    "tax_id"       VARCHAR(50),
    "plan"         VARCHAR(50),
    "status"       VARCHAR(50) NOT NULL DEFAULT 'NEW',
    "step"         INTEGER DEFAULT 1,
    "details"      TEXT,
    "created_at"   TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 22. otp_codes
CREATE TABLE IF NOT EXISTS "otaxdb"."otp_codes" (
    "id"         SERIAL PRIMARY KEY,
    "email"      VARCHAR(255) NOT NULL,
    "code"       VARCHAR(10) NOT NULL,
    "type"       VARCHAR(50) NOT NULL,
    "used"       BOOLEAN DEFAULT FALSE,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_otp_email_code" ON "otaxdb"."otp_codes" ("email", "code");
CREATE INDEX IF NOT EXISTS "idx_otp_expires"    ON "otaxdb"."otp_codes" ("expires_at");

-- 23. organization_settings
CREATE TABLE IF NOT EXISTS "otaxdb"."organization_settings" (
    "id"                        SERIAL PRIMARY KEY,
    "organization_id"           INTEGER NOT NULL UNIQUE REFERENCES "otaxdb"."organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    "eta_environment"           VARCHAR(20) DEFAULT 'PreProd',
    "eta_client_id"             TEXT,
    "eta_client_secret"         TEXT,
    "eta_preprod_client_id"     VARCHAR(255),
    "eta_preprod_client_secret" VARCHAR(255),
    "eta_prod_client_id"        VARCHAR(255),
    "eta_prod_client_secret"    VARCHAR(255),
    "eta_tax_id"                VARCHAR(50),
    "eta_last_sync_at"          TIMESTAMP(6),
    "eta_sync_status"           VARCHAR(20) DEFAULT 'never',
    "eta_auto_sync"             BOOLEAN DEFAULT TRUE,
    "eta_sync_interval"         INTEGER DEFAULT 300,
    "signing_method"            VARCHAR(20) DEFAULT 'agent',
    "certificate_pfx"           BYTEA,
    "certificate_password"      VARCHAR(255),
    "certificate_issuer"        VARCHAR(255),
    "certificate_subject"       VARCHAR(255),
    "certificate_thumbprint"    VARCHAR(100),
    "certificate_expires_at"    TIMESTAMP(6),
    "certificate_uploaded_at"   TIMESTAMP(6),
    "agent_company_id"          VARCHAR(100),
    "agent_node_id"             VARCHAR(100),
    "agent_last_seen"           TIMESTAMP(6),
    "invoice_prefix"            VARCHAR(20),
    "invoice_start_number"      INTEGER DEFAULT 1,
    "default_payment_terms"     INTEGER DEFAULT 30,
    "email_notifications"       BOOLEAN DEFAULT TRUE,
    "sms_notifications"         BOOLEAN DEFAULT FALSE,
    "webhook_url"               TEXT,
    "custom_settings"           TEXT,
    "created_at"                TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

-- 24. organization_subscriptions
CREATE TABLE IF NOT EXISTS "otaxdb"."organization_subscriptions" (
    "id"                     SERIAL PRIMARY KEY,
    "organization_id"        INTEGER NOT NULL REFERENCES "otaxdb"."organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    "plan"                   VARCHAR(50) NOT NULL,
    "status"                 VARCHAR(50) DEFAULT 'active',
    "max_users"              INTEGER DEFAULT 5,
    "max_invoices_per_month" INTEGER DEFAULT 100,
    "max_storage_gb"         INTEGER DEFAULT 5,
    "price_per_month"        DECIMAL(10,2),
    "billing_cycle"          VARCHAR(20) DEFAULT 'monthly',
    "starts_at"              TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "expires_at"             TIMESTAMP(6),
    "cancelled_at"           TIMESTAMP(6),
    "created_at"             TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_org_sub_org"    ON "otaxdb"."organization_subscriptions" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_org_sub_status" ON "otaxdb"."organization_subscriptions" ("status");

-- 25. portal_users
CREATE TABLE IF NOT EXISTS "otaxdb"."portal_users" (
    "id"              BIGSERIAL PRIMARY KEY,
    "email"           VARCHAR(255) NOT NULL UNIQUE,
    "username"        VARCHAR(255),
    "password"        VARCHAR(255) NOT NULL,
    "full_name"       VARCHAR(255),
    "phone"           VARCHAR(50),
    "is_active"       BOOLEAN NOT NULL DEFAULT TRUE,
    "email_verified"  BOOLEAN NOT NULL DEFAULT FALSE,
    "organization_id" INTEGER REFERENCES "otaxdb"."organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    "created_at"      TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "last_login_at"   TIMESTAMP(6)
);
CREATE INDEX IF NOT EXISTS "idx_portal_users_org"   ON "otaxdb"."portal_users" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_portal_users_email" ON "otaxdb"."portal_users" ("email");

-- 26. portal_user_roles
CREATE TABLE IF NOT EXISTS "otaxdb"."portal_user_roles" (
    "id"          SERIAL PRIMARY KEY,
    "user_id"     BIGINT NOT NULL REFERENCES "otaxdb"."portal_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    "role_id"     INTEGER NOT NULL REFERENCES "otaxdb"."roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    "assigned_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" BIGINT,
    UNIQUE("user_id", "role_id")
);


-- 27. super_admins (Platform-Level — No Org)
CREATE TABLE IF NOT EXISTS "otaxdb"."super_admins" (
    "id"              SERIAL PRIMARY KEY,
    "username"        VARCHAR(255) NOT NULL UNIQUE,
    "email"           VARCHAR(255) NOT NULL UNIQUE,
    "password"        VARCHAR(255) NOT NULL,
    "full_name"       VARCHAR(255),
    "is_active"       BOOLEAN DEFAULT TRUE,
    "last_login_at"   TIMESTAMP(6),
    "created_at"      TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SCHEMA: public
-- ============================================

-- 28. documents
CREATE TABLE IF NOT EXISTS "public"."documents" (
    "uuid"              VARCHAR(10000),
    "submissionId"      VARCHAR(10000),
    "rejectionReasons"  VARCHAR(100000),
    "internalId"        VARCHAR(10000),
    "id"                BIGSERIAL PRIMARY KEY,
    "submitted"         BOOLEAN,
    "longId"            VARCHAR(10000),
    "typeName"          VARCHAR(10000),
    "typeVersionName"   VARCHAR(10000),
    "issuerId"          VARCHAR(10000),
    "issuerName"        VARCHAR(10000),
    "receiverId"        VARCHAR(10000),
    "receiverName"      VARCHAR(10000),
    "dateTimeIssued"    TIMESTAMP(6),
    "dateTimeReceived"  TIMESTAMP(6),
    "totalSales"        DOUBLE PRECISION,
    "totalDiscount"     DOUBLE PRECISION,
    "netAmount"         DOUBLE PRECISION,
    "total"             DOUBLE PRECISION,
    "status"            VARCHAR(10000),
    "dateTimeCancelled" TIMESTAMP(6),
    "environment"       VARCHAR(10000),
    "fileName"          VARCHAR(100),
    "processDate"       TIMESTAMP(6),
    "documentBody"      TEXT,
    "credential_id"     INTEGER,
    "organization_id"   INTEGER REFERENCES "otaxdb"."organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "idx_documents_org" ON "public"."documents" ("organization_id");



-- 31. signing_nodes
CREATE TABLE IF NOT EXISTS "public"."signing_nodes" (
    "id"              SERIAL PRIMARY KEY,
    "company_id"      VARCHAR(100) NOT NULL UNIQUE,
    "node_id"         VARCHAR(100) NOT NULL,
    "agent_name"      VARCHAR(255),
    "cert_thumbprint" VARCHAR(100),
    "cert_pin"        VARCHAR(50),
    "cert_subject"    VARCHAR(500),
    "last_seen"       TIMESTAMP(6),
    "created_at"      TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SCHEMA: InvoicesDb (template tables)
-- ============================================

-- 32. org_documents (template / base table)
CREATE TABLE IF NOT EXISTS "InvoicesDb"."org_documents" (
    "id"                             BIGSERIAL PRIMARY KEY,
    "uuid"                           VARCHAR(500) UNIQUE,
    "submissionId"                   VARCHAR(500),
    "internalId"                     VARCHAR(500),
    "longId"                         VARCHAR(1000),
    "submitted"                      BOOLEAN DEFAULT TRUE,
    "typeName"                       VARCHAR(100),
    "typeVersionName"                VARCHAR(50),
    "issuerId"                       VARCHAR(100),
    "issuerName"                     VARCHAR(500),
    "receiverId"                     VARCHAR(100),
    "receiverName"                   VARCHAR(500),
    "dateTimeIssued"                 TIMESTAMP(6),
    "dateTimeReceived"               TIMESTAMP(6),
    "totalSales"                     DOUBLE PRECISION,
    "totalDiscount"                  DOUBLE PRECISION,
    "netAmount"                      DOUBLE PRECISION,
    "total"                          DOUBLE PRECISION,
    "status"                         VARCHAR(50),
    "direction"                      VARCHAR(20),
    "dateTimeCancelled"              TIMESTAMP(6),
    "environment"                    VARCHAR(20),
    "currency"                       VARCHAR(10) DEFAULT 'EGP',
    "activityCode"                   VARCHAR(20),
    "rejectionReasons"               TEXT,
    "documentBody"                   TEXT,
    "org_id"                         INTEGER,
    "synced_at"                      TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at"                     TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "publicUrl"                      TEXT,
    "totalItemsDiscountAmount"       DOUBLE PRECISION DEFAULT 0,
    "extraDiscountAmount"            DOUBLE PRECISION DEFAULT 0,
    "salesOrderReference"            VARCHAR(500),
    "salesOrderDescription"          VARCHAR(500),
    "purchaseOrderReference"         VARCHAR(500),
    "purchaseOrderDescription"       VARCHAR(500),
    "taxpayerActivityCode"           VARCHAR(50),
    "proformaInvoiceNumber"          VARCHAR(500),
    "currenciesSold"                 VARCHAR(20) DEFAULT 'EGP',
    "statusId"                       INTEGER,
    "documentStatusReason"           TEXT,
    "cancelRequestDate"              TIMESTAMP(6),
    "rejectRequestDate"              TIMESTAMP(6),
    "canbeCancelledUntil"            TIMESTAMP(6),
    "canbeRejectedUntil"             TIMESTAMP(6),
    "taxTotalsJson"                  TEXT,
    "issuerAddress"                  TEXT,
    "receiverAddress"                TEXT,
    "issuerType"                     VARCHAR(10),
    "receiverType"                   VARCHAR(10),
    "documentTypeNamePrimaryLang"    VARCHAR(200),
    "documentTypeNameSecondaryLang"  VARCHAR(200),
    -- Individual issuer address columns
    "issuer_address_country"         VARCHAR(10),
    "issuer_address_governate"       VARCHAR(200),
    "issuer_address_regionCity"      VARCHAR(200),
    "issuer_address_street"          VARCHAR(500),
    "issuer_address_buildingNumber"  VARCHAR(50),
    "issuer_address_postalCode"      VARCHAR(20),
    "issuer_address_room"            VARCHAR(50),
    "issuer_address_floor"           VARCHAR(50),
    "issuer_address_landmark"        VARCHAR(500),
    "issuer_address_additionalInformation" VARCHAR(500),
    "issuer_address_branchID"        VARCHAR(50),
    -- Individual receiver address columns
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
    -- Missing API fields
    "cancelRequestDelayedDate"       TIMESTAMP(6),
    "rejectRequestDelayedDate"       TIMESTAMP(6),
    "declineCancelRequestDate"       TIMESTAMP(6),
    "declineRejectRequestDate"       TIMESTAMP(6),
    "submissionChannel"              INTEGER,
    "transformationStatus"           VARCHAR(50),
    "signedBy"                       VARCHAR(500)
);
CREATE INDEX IF NOT EXISTS "idx_org_doc_status"    ON "InvoicesDb"."org_documents" ("status");
CREATE INDEX IF NOT EXISTS "idx_org_doc_date"      ON "InvoicesDb"."org_documents" ("dateTimeIssued");
CREATE INDEX IF NOT EXISTS "idx_org_doc_direction" ON "InvoicesDb"."org_documents" ("direction");
CREATE INDEX IF NOT EXISTS "idx_org_doc_org"       ON "InvoicesDb"."org_documents" ("org_id");

-- 33. org_document_lines (template / base table)
CREATE TABLE IF NOT EXISTS "InvoicesDb"."org_document_lines" (
    "id"                        BIGSERIAL PRIMARY KEY,
    "document_uuid"             VARCHAR(500) NOT NULL REFERENCES "InvoicesDb"."org_documents"("uuid") ON DELETE CASCADE ON UPDATE NO ACTION,
    "line_number"               INTEGER NOT NULL,
    "description"               VARCHAR(1000),
    "itemType"                  VARCHAR(20),
    "itemCode"                  VARCHAR(100),
    "internalCode"              VARCHAR(100),
    "unitType"                  VARCHAR(20) DEFAULT 'EA',
    "quantity"                  DOUBLE PRECISION,
    "unitPrice"                 DOUBLE PRECISION,
    "currency"                  VARCHAR(10) DEFAULT 'EGP',
    "exchangeRate"              DOUBLE PRECISION DEFAULT 0,
    "salesTotal"                DOUBLE PRECISION,
    "discountRate"              DOUBLE PRECISION DEFAULT 0,
    "discountAmount"            DOUBLE PRECISION DEFAULT 0,
    "netTotal"                  DOUBLE PRECISION,
    "totalTaxableFees"          DOUBLE PRECISION DEFAULT 0,
    "itemsDiscount"             DOUBLE PRECISION DEFAULT 0,
    "valueDifference"           DOUBLE PRECISION DEFAULT 0,
    "total"                     DOUBLE PRECISION,
    "org_id"                    INTEGER,
    "created_at"                TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "itemPrimaryName"           VARCHAR(1000),
    "itemSecondaryName"         VARCHAR(1000),
    "amountSold"                DOUBLE PRECISION DEFAULT 0,
    "amountEGP"                 DOUBLE PRECISION DEFAULT 0,
    "currencySold"              VARCHAR(20) DEFAULT 'EGP',
    "currencyExchangeRate"      DOUBLE PRECISION DEFAULT 0,
    "weightUnitType"            VARCHAR(20),
    "weightQuantity"            DOUBLE PRECISION DEFAULT 0,
    "salesTotalForeign"         DOUBLE PRECISION DEFAULT 0,
    "netTotalForeign"           DOUBLE PRECISION DEFAULT 0,
    "totalForeign"              DOUBLE PRECISION DEFAULT 0,
    "totalTaxableFeesForeign"   DOUBLE PRECISION DEFAULT 0,
    "itemsDiscountForeign"      DOUBLE PRECISION DEFAULT 0,
    "valueDifferenceForeign"    DOUBLE PRECISION DEFAULT 0,
    "discountAmountForeign"     DOUBLE PRECISION DEFAULT 0,
    "taxableItemsJson"          TEXT,
    -- Flat tax columns (up to 8 taxes per line)
    "tax1_type" VARCHAR(20), "tax1_amount" DOUBLE PRECISION, "tax1_subtype" VARCHAR(20), "tax1_rate" DOUBLE PRECISION,
    "tax2_type" VARCHAR(20), "tax2_amount" DOUBLE PRECISION, "tax2_subtype" VARCHAR(20), "tax2_rate" DOUBLE PRECISION,
    "tax3_type" VARCHAR(20), "tax3_amount" DOUBLE PRECISION, "tax3_subtype" VARCHAR(20), "tax3_rate" DOUBLE PRECISION,
    "tax4_type" VARCHAR(20), "tax4_amount" DOUBLE PRECISION, "tax4_subtype" VARCHAR(20), "tax4_rate" DOUBLE PRECISION,
    "tax5_type" VARCHAR(20), "tax5_amount" DOUBLE PRECISION, "tax5_subtype" VARCHAR(20), "tax5_rate" DOUBLE PRECISION,
    "tax6_type" VARCHAR(20), "tax6_amount" DOUBLE PRECISION, "tax6_subtype" VARCHAR(20), "tax6_rate" DOUBLE PRECISION,
    "tax7_type" VARCHAR(20), "tax7_amount" DOUBLE PRECISION, "tax7_subtype" VARCHAR(20), "tax7_rate" DOUBLE PRECISION,
    "tax8_type" VARCHAR(20), "tax8_amount" DOUBLE PRECISION, "tax8_subtype" VARCHAR(20), "tax8_rate" DOUBLE PRECISION,
    -- Error columns for rejection/invalid reasons
    "gettingError_1" TEXT,
    "gettingError_2" TEXT,
    "gettingError_3" TEXT,
    "gettingError_4" TEXT,
    "gettingError_5" TEXT,
    "gettingError_6" TEXT,
    "gettingError_7" TEXT,
    "gettingError_8" TEXT
);
CREATE INDEX IF NOT EXISTS "idx_org_line_doc"  ON "InvoicesDb"."org_document_lines" ("document_uuid");
CREATE INDEX IF NOT EXISTS "idx_org_line_item" ON "InvoicesDb"."org_document_lines" ("itemCode");

-- ============================================
-- SEED: Default Roles & Permissions
-- ============================================

-- Default roles (insert only if not exists)
INSERT INTO "otaxdb"."roles" ("name", "display_name", "description", "is_system")
VALUES
  ('super_admin', 'Super Admin', 'Full system access', TRUE),
  ('org_owner', 'Organization Owner', 'Full organization access', TRUE),
  ('org_admin', 'Organization Admin', 'Organization admin access', TRUE),
  ('accountant', 'Accountant', 'Invoice and reports access', TRUE),
  ('viewer', 'Viewer', 'Read-only access', TRUE)
ON CONFLICT ("name") DO NOTHING;

-- Default permissions
INSERT INTO "otaxdb"."permissions" ("name", "display_name", "module", "action")
VALUES
  ('dashboard.view',         'View Dashboard',           'dashboard',    'view'),
  ('invoices.view',          'View Invoices',            'invoices',     'view'),
  ('invoices.create',        'Create Invoices',          'invoices',     'create'),
  ('invoices.edit',          'Edit Invoices',            'invoices',     'edit'),
  ('invoices.delete',        'Delete Invoices',          'invoices',     'delete'),
  ('invoices.submit',        'Submit Invoices to ETA',   'invoices',     'submit'),
  ('reports.view',           'View Reports',             'reports',      'view'),
  ('reports.export',         'Export Reports',           'reports',      'export'),
  ('settings.view',          'View Settings',            'settings',     'view'),
  ('settings.edit',          'Edit Settings',            'settings',     'edit'),
  ('users.view',             'View Users',               'users',        'view'),
  ('users.create',           'Create Users',             'users',        'create'),
  ('users.edit',             'Edit Users',               'users',        'edit'),
  ('users.delete',           'Delete Users',             'users',        'delete'),
  ('roles.view',             'View Roles',               'roles',        'view'),
  ('roles.manage',           'Manage Roles',             'roles',        'manage'),
  ('organization.view',      'View Organization',        'organization', 'view'),
  ('organization.edit',      'Edit Organization',        'organization', 'edit'),
  ('eta.sync',               'Sync with ETA',            'eta',          'sync'),
  ('eta.configure',          'Configure ETA',            'eta',          'configure'),
  ('audit.view',             'View Audit Logs',          'audit',        'view'),
  -- Phase 1-4 additions
  ('packages.view',          'View Export Packages',     'packages',     'view'),
  ('packages.manage',        'Request Packages',         'packages',     'manage'),
  ('reconciliation.view',    'View Reconciliation',      'reconciliation','view'),
  ('reconciliation.manage',  'Manage Reconciliation',    'reconciliation','manage'),
  ('signing.view',           'View Signing Queue',       'signing',      'view'),
  ('signing.manage',         'Manage Signing Queue',     'signing',      'manage'),
  ('assistant.use',          'Use AI Assistant',         'assistant',    'use')
ON CONFLICT ("name") DO NOTHING;

-- Assign all permissions to super_admin role
INSERT INTO "otaxdb"."role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "otaxdb"."roles" r
CROSS JOIN "otaxdb"."permissions" p
WHERE r.name = 'super_admin'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- ============================================
-- Done! All tables created (or already exist)
-- ============================================
