-- Package Requests table — tracks ETA Document Package export jobs per organization.
-- One row per call to POST /api/v1/documentPackages/requests.

CREATE SCHEMA IF NOT EXISTS "otaxdb";

CREATE TABLE IF NOT EXISTS "otaxdb".package_requests (
    id              SERIAL PRIMARY KEY,
    org_id          INTEGER NOT NULL,
    rid             VARCHAR(255),                      -- ETA-returned requestId (null until ETA accepts)
    type            VARCHAR(16) NOT NULL,              -- 'Summary' | 'Full'
    format          VARCHAR(16) NOT NULL,              -- 'JSON' | 'XML'
    date_from       TIMESTAMP NOT NULL,
    date_to         TIMESTAMP NOT NULL,
    statuses        TEXT[],                            -- e.g. ARRAY['Valid','Cancelled']
    document_types  TEXT[],                            -- e.g. ARRAY['I','C','D']
    is_intermediary BOOLEAN DEFAULT FALSE,
    representee_rin VARCHAR(32),
    status          VARCHAR(32) NOT NULL DEFAULT 'Pending',  -- Pending | Ready | Failed | Downloaded
    error_message   TEXT,
    created_by      INTEGER,                           -- user id
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    downloaded_at   TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_package_requests_org ON "otaxdb".package_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_package_requests_rid ON "otaxdb".package_requests(rid);
CREATE INDEX IF NOT EXISTS idx_package_requests_created ON "otaxdb".package_requests(created_at DESC);
