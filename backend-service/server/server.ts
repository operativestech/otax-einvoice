
import express from 'express';
import pg from 'pg';
import dotenv from 'dotenv';
import cors from 'cors';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { exec } from 'child_process';
import util from 'util';
import crypto from 'crypto';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { readFileSync, existsSync } from 'fs';

// Local Modules
import { buildETADocument } from './etaBuilder.js';
import { signInvoiceWithCsharpSigner } from './csharpSignerIntegration.js';
import { listCertificatesViaCertutil } from './certListHelper.js';
import { calculateInvoice, validateInvoice } from './invoiceCalculator.js';
import { serializeInvoice, serializeETA, serializeReceiptBatch } from './etaSerialization.js';
import * as receiptService from './receiptService.js';
import { getOrgTableNames, createOrgTables, findOrgTablePrefix, ensureDocumentIndexes, upsertCustomerFromDoc } from './services/orgTables.js';
import { startSigningWorker } from './services/signingWorker.js';
import { startAutoSyncScheduler } from './services/autoSyncScheduler.js';
import { startNotificationsWorker } from './services/notificationsWorker.js';
import { startWebhookDispatcher, enqueueWebhookEvent } from './services/webhookDispatcher.js';
import webhookSubscriptionsRoutes from './routes/webhookSubscriptionsRoutes.js';
import dashboardLayoutRoutes from './routes/dashboardLayoutRoutes.js';
import erpConnectorRoutes from './routes/erpConnectorRoutes.js';
import { startErpScheduler } from './services/erp/scheduler.js';
import { startScheduledReportsWorker } from './services/scheduledReportsWorker.js';
import scheduledReportsRoutes from './routes/scheduledReportsRoutes.js';
import notificationsFeedRoutes from './routes/notificationsFeedRoutes.js';
import { encryptSecret, decryptSecret } from './services/secrets.js';
import {
    ORG_TABLE_FIELDS,
    ORG_SETTINGS_FIELDS,
    ORG_INTEGRATION_FIELDS,
    SECRET_PROPERTY_NAMES,
    SECRET_PLACEHOLDER,
    ENCRYPTED_INTEGRATION_COLUMNS,
    coerceForColumn,
} from './services/settingsRouting.js';
import { loadEffectiveSettings, makeGetProp } from './services/effectiveSettings.js';
import leadRoutes from './routes/leads.js';
import adminRoutes from './routes/admin.js';
import superAdminRoutes from './routes/superAdmin.js';
import authRoutes from './routes/authRoutes.js';
import etaRoutes from './routes/etaRoutes.js';
import signingRoutes from './routes/signingRoutes.js';
import reconciliationRoutes from './routes/reconciliationRoutes.js';
import assistantRoutes from './routes/assistantRoutes.js';
import masterDataRoutes from './routes/masterDataRoutes.js';
import reportsRoutes from './routes/reportsRoutes.js';
import apiKeysRoutes, { apiKeyAuth, apiKeyRateLimit } from './routes/apiKeysRoutes.js';
import branchesRoutes from './routes/branchesRoutes.js';
import apiDocsRoutes from './routes/apiDocsRoutes.js';
import twoFactorRoutes from './routes/twoFactorRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';

const listCertificates = listCertificatesViaCertutil;



// Define __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const execPromise = util.promisify(exec);

dotenv.config();

const { Pool } = pg;

const app = express();
const port = process.env.PORT || 3001;

// Load DB Config independently
let dbFileConfig: any = {};
try {
    const configPath = path.join(__dirname, 'db_config.json');
    dbFileConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    console.log('[Database] Loaded configuration from db_config.json');
} catch (e: any) {
    console.warn('[Database] db_config.json not found or invalid, using environment variables.');
}

// Database Connection - Prioritize File Config -> Env Vars
const pool = new Pool({
    host: dbFileConfig.host || process.env.PGHOST || process.env.DB_HOST,
    port: parseInt(dbFileConfig.port || process.env.PGPORT || process.env.DB_PORT || '5432'),
    database: dbFileConfig.database || process.env.PGDATABASE || process.env.DB_NAME,
    user: dbFileConfig.user || process.env.PGUSER || process.env.DB_USER,
    password: dbFileConfig.password || process.env.PGPASSWORD || process.env.DB_PASS,
    ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
    } : false
});

// Make pool available to routes via app.set
// (routes access it via req.app.get('pool'))
app.set('pool', pool);

// WebSocket Server for Live Operations Console
const wss = new WebSocketServer({ noServer: true });
const clients = new Set<WebSocket>();
const activeAgents = new Map<string, WebSocket>(); // CompanyID -> WS
const pendingRequests = new Map<string, { resolve: (val: any) => void, reject: (err: any) => void, isSign: boolean }>();

// Expose activeAgents to routes (for signing status checks)
app.set('activeAgents', activeAgents);

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('[WebSocket] Client connected');
    ws.send(JSON.stringify({ type: 'info', message: 'Connected to Cloud Server' }));

    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data.toString());

            // Agent Registration
            if (msg.type === 'register_agent') {
                const companyId = msg.companyId || 'default';
                const nodeId = msg.nodeId || 'legacy-agent';
                const agentName = msg.agentName || 'Unknown PC';

                try {
                    const client = await pool.connect();
                    try {
                        const res = await client.query('SELECT node_id FROM otaxdb.signing_nodes WHERE company_id = $1', [companyId]);

                        if (res.rows.length > 0) {
                            const registeredNode = res.rows[0].node_id;
                            if (registeredNode !== nodeId) {
                                console.warn(`[Bridge] Rejected Agent ${nodeId} for Company ${companyId}. Locked to ${registeredNode}.`);
                                ws.send(JSON.stringify({ type: 'error', message: 'Company is locked to another Signing PC. Contact Admin.' }));
                                return;
                            }
                            // Update last seen
                            await client.query('UPDATE otaxdb.signing_nodes SET last_seen = NOW(), agent_name = $2 WHERE company_id = $1', [companyId, agentName]);
                        } else {
                            // First time registration
                            await client.query('INSERT INTO otaxdb.signing_nodes (company_id, node_id, agent_name, last_seen) VALUES ($1, $2, $3, NOW())', [companyId, nodeId, agentName]);
                            console.log(`[Bridge] New Signing Node registered for ${companyId}: ${nodeId}`);
                        }
                    } finally {
                        client.release();
                    }
                } catch (dbErr: any) {
                    console.error('[Bridge] DB Error during registration:', dbErr.message);
                    // Fallback: Allow connection in memory if DB fails, to avoid total outage
                }

                activeAgents.set(companyId, ws);
                (ws as any).companyId = companyId;
                console.log(`[Bridge] Agent registered for Company: ${companyId}`);
                ws.send(JSON.stringify({ type: 'registered', status: 'success' }));
                broadcastLog(`[Bridge] Agent connected for Company: ${companyId}`, 'success');
            }

            // Response from Agent (List Certs or Sign)
            if (msg.type === 'response') {
                const { reqId, success, payload, error } = msg;
                const pending = pendingRequests.get(reqId);
                if (pending) {
                    if (success) {
                        pending.resolve(payload);
                    } else {
                        pending.reject(new Error(error || 'Unknown agent error'));
                    }
                    pendingRequests.delete(reqId);
                }
            }

            // Heartbeat from Agent — keep alive + update last_seen
            if (msg.type === 'heartbeat') {
                const companyId = msg.companyId || (ws as any).companyId;
                ws.send(JSON.stringify({ type: 'pong' }));
                // Update last_seen in DB (non-blocking)
                if (companyId) {
                    pool.query(
                        'UPDATE otaxdb.signing_nodes SET last_seen = NOW() WHERE company_id = $1',
                        [companyId]
                    ).catch(() => { });
                }
            }

        } catch (e) {
            console.error('[WebSocket] Message error:', e);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
        const companyId = (ws as any).companyId;
        if (companyId) {
            activeAgents.delete(companyId);
            console.log(`[Bridge] Agent disconnected for Company: ${companyId}`);
            broadcastLog(`[Bridge] Agent disconnected for Company: ${companyId}`, 'warning');
        }
    });
});

/**
 * Broadcast message to all connected Live Console clients
 */
function broadcastLog(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') {
    const payload = JSON.stringify({ message, type, timestamp: new Date().toLocaleTimeString() });
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

// Redirect important logs to broadcast
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = (...args: any[]) => {
    originalConsoleLog(...args);
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    // Only broadcast targeted logs to avoid flooding
    if (msg.includes('[Signer]') || msg.includes('[ETA]') || msg.includes('[Receipt]') || msg.includes('[DB]')) {
        broadcastLog(msg, 'info');
    }
};

console.error = (...args: any[]) => {
    originalConsoleError(...args);
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    // Only broadcast targeted errors to avoid flooding agent/clients with JWT, sync, etc. noise
    if (msg.includes('[Signer]') || msg.includes('[ETA]') || msg.includes('[Receipt]') || msg.includes('[DB]') || msg.includes('[Batch]')) {
        broadcastLog(msg, 'error');
    }
};

console.log('[Server] Starting up...');
console.log('[Server] Registering /api/sync/full-refresh endpoint...');

// [Moved DB Config to top]

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// API-key authentication MUST run before any route module so integrators
// who send `X-API-Key: otax_...` skip the JWT flow and land on a request
// with `req.user` already populated. It's a no-op when the header is absent,
// so normal portal users are unaffected.
app.use(apiKeyAuth(pool));
// Per-key rate limiting — only kicks in when apiKeyAuth populated req.user.
// JWT users continue to use the existing global limiters (etaLimiter, bulkLimiter).
app.use(apiKeyRateLimit());

// ── Mount Route Modules ──
app.use('/api/auth', adminRoutes);
app.use('/api/admin', adminRoutes);  // Frontend uses /api/admin/* for org management routes
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/eta', etaRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/signing', signingRoutes);
app.use('/api/reconciliation', reconciliationRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/master-data', masterDataRoutes);
// Analytical reports (VAT summary, top customers/products, rejected, trends, etc).
// Note: /api/reports/duplicates remains as a standalone endpoint in this file
// (below) — this router handles the newer report types.
app.use('/api/reports', reportsRoutes);
// API keys — CRUD lives here; the middleware is attached globally below so any
// request carrying `X-API-Key: otax_...` can skip JWT login.
app.use('/api/admin/api-keys', apiKeysRoutes);
// Outbound webhook subscriptions (sender side). Companion to the /api/webhooks
// receiver which is mounted further down — different feature, separate router.
app.use('/api/admin/webhooks', webhookSubscriptionsRoutes);
// Per-user dashboard layout customisation (which widgets show + order).
app.use('/api/dashboard/layout', dashboardLayoutRoutes);
// ERP Connector — pulls invoices from the customer's external ERP and pipes
// them through the standard /api/excel/submit pipeline.
app.use('/api/admin/erp', erpConnectorRoutes);
// Scheduled Reports — per-org cron config + send-now for the report emails.
app.use('/api/admin/scheduled-reports', scheduledReportsRoutes);
// In-app notifications feed — powers the bell drawer in the TopBar.
app.use('/api/notifications', notificationsFeedRoutes);
// Multi-branch support — CRUD for org_branches. Consumed by Manual Invoice +
// future Excel templates to stamp the correct branchID on each doc.
app.use('/api/admin/branches', branchesRoutes);
// Public API docs — no auth, HTML response at /api/docs.
app.use('/api/docs', apiDocsRoutes);
// 2FA (TOTP) — setup / verify / disable / status. Login enforcement happens
// inside the existing login handler via verifyTotpForLogin().
app.use('/api/auth/2fa', twoFactorRoutes);
// Public webhook receiver — for ETA / ERP / partner inbound notifications.
// HMAC-SHA256 signature verification lives inside the route handler.
app.use('/api/webhooks', webhookRoutes);

// Initialize Database Schema on Start
const initDbSchema = async () => {
    console.log('[DB Init] Checking database schema...');
    try {
        const client = await pool.connect();
        try {
            // 1. Documents Sequence and Table
            await client.query(`CREATE SEQUENCE IF NOT EXISTS public.documents_id_seq;`);
            await client.query(`
                CREATE TABLE IF NOT EXISTS public.documents (
                    uuid character varying(10000),
                    "submissionId" character varying(10000),
                    "rejectionReasons" character varying(100000),
                    "internalId" character varying(10000),
                    id bigint NOT NULL DEFAULT nextval('documents_id_seq'::regclass),
                    submitted boolean,
                    "longId" character varying(10000),
                    "typeName" character varying(10000),
                    "typeVersionName" character varying(10000),
                    "issuerId" character varying(10000),
                    "issuerName" character varying(10000),
                    "receiverId" character varying(10000),
                    "receiverName" character varying(10000),
                    "dateTimeIssued" timestamp without time zone,
                    "dateTimeReceived" timestamp without time zone,
                    "totalSales" double precision,
                    "totalDiscount" double precision,
                    "netAmount" double precision,
                    total double precision,
                    status character varying(10000),
                    "dateTimeCancelled" timestamp without time zone,
                    environment character varying(10000),
                    "fileName" character varying(100),
                    "processDate" timestamp without time zone,
                    "computerName" character varying,
                    "AppVersion" character varying,
                    "userName" character varying,
                    "Md5hash" character varying,
                    CONSTRAINT documents_pkey PRIMARY KEY (id)
                );
            `);

            // 2. Errors Sequence and Table
            await client.query(`CREATE SEQUENCE IF NOT EXISTS public.errors_id_seq;`);
            await client.query(`
                CREATE TABLE IF NOT EXISTS public.errors (
                    uuid character varying(10000),
                    "submissionError" character varying(10000),
                    "internalId" character varying(10000),
                    id bigint NOT NULL DEFAULT nextval('errors_id_seq'::regclass),
                    "gettingError_1" character varying(10000),
                    CONSTRAINT errors_pkey PRIMARY KEY (id)
                );
            `);

            // 2.5 Signing Nodes (SaaS Gateway)
            await client.query(`
                CREATE TABLE IF NOT EXISTS otaxdb.signing_nodes (
                    "company_id" character varying(255) NOT NULL,
                    "node_id" character varying(255) NOT NULL,
                    "agent_name" character varying(255),
                    "public_ip" character varying(50),
                    "cert_thumbprint" character varying(255),
                    "cert_subject" character varying(1000),
                    "cert_pin" character varying(255),
                    "registered_at" timestamp without time zone DEFAULT now(),
                    "last_seen" timestamp without time zone,
                    CONSTRAINT signing_nodes_pkey PRIMARY KEY ("company_id")
                );
            `);

            // 3. Clients Table
            await client.query(`
                CREATE TABLE IF NOT EXISTS public.clients (
                    id bigint NOT NULL,
                    "clientId" character varying(10000),
                    "clientSecret" character varying(10000),
                    CONSTRAINT "clientData_pkey" PRIMARY KEY (id)
                );
            `);

            // 4. Add credential_id column to documents for per-company isolation
            await client.query(`ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS credential_id INTEGER;`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_documents_credential_id ON public.documents (credential_id);`);

            // 5. Add organization_id column to documents for SaaS multi-tenancy
            await client.query(`ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS organization_id INTEGER;`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_documents_org_id ON public.documents (organization_id);`);

            // 4.5. Phase 1-4 RBAC permissions — idempotent; covers existing DBs that predate the feature.
            await client.query(`
                INSERT INTO "otaxdb"."permissions" ("name", "display_name", "module", "action") VALUES
                  ('packages.view',         'View Export Packages',   'packages',       'view'),
                  ('packages.manage',       'Request Packages',       'packages',       'manage'),
                  ('reconciliation.view',   'View Reconciliation',    'reconciliation', 'view'),
                  ('reconciliation.manage', 'Manage Reconciliation',  'reconciliation', 'manage'),
                  ('signing.view',          'View Signing Queue',     'signing',        'view'),
                  ('signing.manage',        'Manage Signing Queue',   'signing',        'manage'),
                  ('assistant.use',         'Use AI Assistant',       'assistant',      'use')
                ON CONFLICT ("name") DO NOTHING;
            `).catch((e: any) => console.warn('[DB Init] Permission seed skipped:', e.message));

            // Grant the new permissions to existing super_admin + org_admin roles so nobody gets locked out.
            await client.query(`
                INSERT INTO "otaxdb"."role_permissions" ("role_id", "permission_id")
                SELECT r.id, p.id
                FROM "otaxdb"."roles" r
                CROSS JOIN "otaxdb"."permissions" p
                WHERE r.name IN ('super_admin', 'org_admin', 'admin')
                  AND p.name IN ('packages.view','packages.manage','reconciliation.view','reconciliation.manage','signing.view','signing.manage','assistant.use')
                ON CONFLICT ("role_id", "permission_id") DO NOTHING;
            `).catch((e: any) => console.warn('[DB Init] Role-permission grant skipped:', e.message));

            // 4.6. Multi-role invitations — added 2026-04
            //   role_ids: JSON array of role IDs to assign on accept (in addition to legacy role_id)
            await client.query(`
                ALTER TABLE "otaxdb".organization_invitations
                ADD COLUMN IF NOT EXISTS role_ids TEXT;
            `).catch((e: any) => console.warn('[DB Init] organization_invitations.role_ids alter skipped:', e.message));

            // 4.7. Per-user permission overrides — added 2026-04
            //   When admin invites or creates a user with a customized permission subset (e.g. "Org Admin
            //   minus Reports"), we store the explicit permission IDs separately from the role. At login,
            //   if a user has any rows here, that set REPLACES the role-derived permissions for that user.
            await client.query(`
                ALTER TABLE "otaxdb".organization_invitations
                ADD COLUMN IF NOT EXISTS permission_ids TEXT;
            `).catch((e: any) => console.warn('[DB Init] organization_invitations.permission_ids alter skipped:', e.message));

            await client.query(`
                CREATE TABLE IF NOT EXISTS "otaxdb".portal_user_permissions (
                    id            SERIAL PRIMARY KEY,
                    user_id       BIGINT  NOT NULL REFERENCES "otaxdb".portal_users(id) ON DELETE CASCADE,
                    permission_id INTEGER NOT NULL REFERENCES "otaxdb".permissions(id)  ON DELETE CASCADE,
                    granted_at    TIMESTAMP NOT NULL DEFAULT NOW(),
                    granted_by    BIGINT,
                    UNIQUE (user_id, permission_id)
                );
            `).catch((e: any) => console.warn('[DB Init] portal_user_permissions create skipped:', e.message));
            await client.query(`CREATE INDEX IF NOT EXISTS idx_pup_user ON "otaxdb".portal_user_permissions(user_id);`)
                .catch(() => {});

            await client.query(`
                CREATE TABLE IF NOT EXISTS "otaxdb".user_permissions (
                    id            SERIAL PRIMARY KEY,
                    user_id       BIGINT  NOT NULL REFERENCES "otaxdb".credentials(id) ON DELETE CASCADE,
                    permission_id INTEGER NOT NULL REFERENCES "otaxdb".permissions(id) ON DELETE CASCADE,
                    granted_at    TIMESTAMP NOT NULL DEFAULT NOW(),
                    granted_by    BIGINT,
                    UNIQUE (user_id, permission_id)
                );
            `).catch((e: any) => console.warn('[DB Init] user_permissions create skipped:', e.message));
            await client.query(`CREATE INDEX IF NOT EXISTS idx_up_user ON "otaxdb".user_permissions(user_id);`)
                .catch(() => {});

            // 5a. Signing Queue (Phase 3.1) — tracks pending/failed sign jobs per org
            await client.query(`
                CREATE TABLE IF NOT EXISTS "otaxdb".signing_queue (
                    id              SERIAL PRIMARY KEY,
                    org_id          INTEGER NOT NULL,
                    document_uuid   VARCHAR(500),                 -- known only after successful sign + submit
                    internal_id     VARCHAR(200),                 -- user-facing identifier
                    document_body   JSONB NOT NULL,               -- the unsigned document payload
                    method          VARCHAR(16) NOT NULL DEFAULT 'auto', -- 'pfx' | 'agent' | 'auto'
                    status          VARCHAR(16) NOT NULL DEFAULT 'QUEUED', -- QUEUED|PROCESSING|SIGNED|FAILED
                    attempts        INTEGER NOT NULL DEFAULT 0,
                    last_error      TEXT,
                    enqueued_by     INTEGER,
                    enqueued_at     TIMESTAMP NOT NULL DEFAULT NOW(),
                    started_at      TIMESTAMP,
                    finished_at     TIMESTAMP,
                    submission_id   VARCHAR(200)
                );
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_signing_queue_org_status ON "otaxdb".signing_queue(org_id, status);`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_signing_queue_enqueued ON "otaxdb".signing_queue(enqueued_at DESC);`);

            // 5b. Per-org submit format preference (JSON vs XML) — added 2026-04
            await client.query(`
                ALTER TABLE "otaxdb".organization_settings
                ADD COLUMN IF NOT EXISTS eta_submit_format VARCHAR(8) DEFAULT 'JSON';
            `).catch((e: any) => console.warn('[DB Init] organization_settings.eta_submit_format alter skipped:', e.message));

            // 5c. Auto-sync scheduler settings — added 2026-04
            //   eta_sync_mode: 'off' | 'interval' | 'times'
            //   eta_sync_times: array of 'HH:MM' strings (up to 10)
            //   eta_last_auto_sync_at: bookkeeping so the scheduler doesn't re-fire
            await client.query(`
                ALTER TABLE "otaxdb".organization_settings
                ADD COLUMN IF NOT EXISTS eta_sync_mode VARCHAR(16) DEFAULT 'off';
            `).catch((e: any) => console.warn('[DB Init] organization_settings.eta_sync_mode alter skipped:', e.message));
            await client.query(`
                ALTER TABLE "otaxdb".organization_settings
                ADD COLUMN IF NOT EXISTS eta_sync_times TEXT[] DEFAULT ARRAY[]::TEXT[];
            `).catch((e: any) => console.warn('[DB Init] organization_settings.eta_sync_times alter skipped:', e.message));
            await client.query(`
                ALTER TABLE "otaxdb".organization_settings
                ADD COLUMN IF NOT EXISTS eta_last_auto_sync_at TIMESTAMP;
            `).catch((e: any) => console.warn('[DB Init] organization_settings.eta_last_auto_sync_at alter skipped:', e.message));

            // 6. Document Package Requests (ETA bulk export history)
            await client.query(`
                CREATE TABLE IF NOT EXISTS "otaxdb".package_requests (
                    id              SERIAL PRIMARY KEY,
                    org_id          INTEGER NOT NULL,
                    rid             VARCHAR(255),
                    type            VARCHAR(16) NOT NULL,
                    format          VARCHAR(16) NOT NULL,
                    date_from       TIMESTAMP NOT NULL,
                    date_to         TIMESTAMP NOT NULL,
                    statuses        TEXT[],
                    document_types  TEXT[],
                    is_intermediary BOOLEAN DEFAULT FALSE,
                    representee_rin VARCHAR(32),
                    status          VARCHAR(32) NOT NULL DEFAULT 'Pending',
                    error_message   TEXT,
                    created_by      INTEGER,
                    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
                    downloaded_at   TIMESTAMP
                );
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_package_requests_org ON "otaxdb".package_requests(org_id);`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_package_requests_rid ON "otaxdb".package_requests(rid);`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_package_requests_created ON "otaxdb".package_requests(created_at DESC);`);

            // One-time migration: copy per-user settings → per-org in clients_info_new.
            // Historical rows were keyed by numeric userId; new code keys them by `org_<id>`.
            // This copies any property that doesn't already exist at the org scope so
            // existing deployments don't appear to "lose" their settings after the fix.
            try {
                const mig = await client.query(`
                    INSERT INTO "otaxdb".clients_info_new (uid, hwid, property_name, property_value, "nonAdminEdit", modify_date)
                    SELECT DISTINCT ON (('org_' || pu.organization_id), ci.property_name)
                           'org_' || pu.organization_id,
                           COALESCE(ci.hwid, 'PORTAL-' || pu.id),
                           ci.property_name,
                           ci.property_value,
                           true,
                           NOW()
                    FROM "otaxdb".clients_info_new ci
                    JOIN "otaxdb".portal_users pu ON ci.uid = pu.id::text
                    WHERE NOT EXISTS (
                        SELECT 1 FROM "otaxdb".clients_info_new ci2
                        WHERE ci2.uid = 'org_' || pu.organization_id
                          AND ci2.property_name = ci.property_name
                    )
                    ON CONFLICT DO NOTHING
                `);
                if (mig.rowCount && mig.rowCount > 0) {
                    console.log(`[DB Init] Migrated ${mig.rowCount} per-user settings rows → per-org keys.`);
                }
            } catch (e: any) {
                console.warn('[DB Init] Per-org settings migration skipped:', e.message);
            }

            console.log('[DB Init] Schema verification completed successfully.');
        } finally {
            client.release();
        }
    } catch (err: any) {
        console.error('[DB Init] Failed to initialize schema:', err.message);
        // Don't crash, user might fix it later or manually
    }
};

// Run Init
initDbSchema();

// Backfill performance indexes for existing orgs' documents tables.
// Runs async after startup — cheap (CREATE INDEX IF NOT EXISTS) and non-blocking.
const backfillOrgIndexes = async () => {
    try {
        const orgs = await pool.query(`SELECT id, name FROM "otaxdb".organizations WHERE is_active = true`);
        for (const org of orgs.rows) {
            try { await ensureDocumentIndexes(pool, org.id, org.name); }
            catch (e: any) { console.warn(`[Indexes] Skipped org ${org.id}:`, e.message); }
        }
        if (orgs.rows.length > 0) console.log(`[Indexes] Backfilled document indexes for ${orgs.rows.length} active orgs.`);
    } catch (e: any) {
        console.warn('[Indexes] Backfill skipped:', e.message);
    }
};
setTimeout(backfillOrgIndexes, 3000); // let initDbSchema + route init settle first

// Start the Signing Queue worker (PFX path). Runs on its own interval; safe to no-op
// if the signing_queue table is empty. Controlled by env var SIGNING_WORKER=off to disable.
if (process.env.SIGNING_WORKER !== 'off') {
    setTimeout(() => startSigningWorker(pool, { bridge: bridgeService }), 5000);
}

// Auto-sync scheduler: ticks every 60s, fires /api/eta/sync/start for orgs whose
// schedule is due. Disable with env AUTO_SYNC_SCHEDULER=off.
if (process.env.AUTO_SYNC_SCHEDULER !== 'off') {
    setTimeout(() => startAutoSyncScheduler(pool), 7000);
}

// Notifications worker: ticks every 6 hours. Sends daily digest (rejected/late
// counts) + monthly VAT filing reminder. Disable with NOTIFICATIONS_WORKER=off.
setTimeout(() => startNotificationsWorker(pool), 10_000);
// Outbound webhook dispatcher — picks up deliveries queued by enqueueWebhookEvent
// and POSTs them to subscriber URLs with HMAC signing + retry backoff.
setTimeout(() => startWebhookDispatcher(pool), 12_000);
// ERP auto-import scheduler — fires runImport() per-org based on
// org_integration_settings.erp_auto_import_mode = 'interval'.
setTimeout(() => startErpScheduler(pool), 15_000);
// Scheduled Reports worker — fires per-org cron-style report emails
// (Invalid invoices XLSX, VAT pack, Late submissions, Weekly revenue, etc.)
// driven off otaxdb.org_scheduled_reports.
setTimeout(() => startScheduledReportsWorker(pool), 18_000);

// Helper to parse ADO.NET / OLEDB style connection strings
function parseConnectionString(connString: string) {
    const config: any = {};
    const parts = connString.split(';');
    parts.forEach(part => {
        const [key, value] = part.split('=').map(s => s.trim());
        if (!key || !value) return;
        const lowerKey = key.toLowerCase();

        if (lowerKey === 'server' || lowerKey === 'data source' || lowerKey === 'host') config.host = value;
        if (lowerKey === 'port') config.port = parseInt(value);
        if (lowerKey === 'database' || lowerKey === 'initial catalog') config.database = value;
        if (lowerKey === 'user id' || lowerKey === 'user' || lowerKey === 'uid') config.user = value;
        if (lowerKey === 'password' || lowerKey === 'pwd') config.password = value;
    });
    return config;
}

// Test DB Connection Endpoint
app.post('/api/test-db-connection', async (req, res) => {
    const { type, connectionString, host, port, user, password, database } = req.body;

    console.log(`[DB Test] Testing connection for ${type}...`);

    try {
        if (type === 'postgres' || type === 'npgsql') {
            // Parse connection string if provided
            let dbConfig = {};
            if (connectionString) {
                dbConfig = parseConnectionString(connectionString);
            } else {
                dbConfig = { host, port, user, password, database };
            }

            console.log('[DB Test] Postgres Config:', JSON.stringify({ ...dbConfig, password: '***' }));

            if (!dbConfig['host']) throw new Error('Host/Server is missing in connection string.');

            const client = new pg.Client(dbConfig);
            await client.connect();
            await client.query('SELECT 1');
            await client.end();
            return res.json({ success: true, message: 'Successfully connected to PostgreSQL database!' });
        }

        else if (type === 'oracle') {
            // Basic TCP Check since we might not have oracledb installed
            const targetHost = host || connectionString?.split('Host=')[1]?.split(';')[0]; // Simple fallback
            const targetPort = port || 1521;

            if (!targetHost) throw new Error('Host is required for Oracle test.');

            console.log(`[DB Test] TCP Ping to ${targetHost}:${targetPort}`);

            const net = await import('net');
            const socket = new net.Socket();

            return new Promise<void>((resolve) => {
                socket.setTimeout(3000);
                socket.on('connect', () => {
                    socket.destroy();
                    res.json({ success: true, message: `Successfully reached Oracle Server at ${targetHost}:${targetPort}` });
                    resolve();
                });
                socket.on('timeout', () => {
                    socket.destroy();
                    res.status(400).json({ success: false, message: 'Connection Timed Out (Check Host/Port/Firewall)' });
                    resolve();
                });
                socket.on('error', (err) => {
                    socket.destroy();
                    res.status(400).json({ success: false, message: 'Connection Failed: ' + err.message });
                    resolve();
                });
                socket.connect(targetPort, targetHost);
            });
        }

        return res.json({ success: false, message: 'Unknown DB Type' });

    } catch (error: any) {
        console.error('[DB Test] Error:', error.message);
        res.status(500).json({ success: false, message: error.message, details: error.toString() });
    }
});

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[Request] ${req.method} ${req.url}`);
    next();
});

// Force JSON 404 for API routes
// [REMOVED] Premature 404 handler that was blocking API routes


// Test Connection Endpoint
/**
 * Health check — probed by load balancers, uptime monitors, and the status page.
 *
 * Status: "OK" | "DEGRADED" | "ERROR"
 *   - OK        → DB reachable and all optional components healthy
 *   - DEGRADED  → DB ok but a non-critical component is missing (no agents connected,
 *                 queue has failures, etc.) — don't pull the instance out of rotation
 *   - ERROR     → DB is unreachable — failover should kick in
 *
 * Called via GET /api/health (unauthenticated on purpose — it shouldn't require a token).
 */
app.get('/api/health', async (req, res) => {
    const checks: Record<string, any> = {};
    let overall: 'OK' | 'DEGRADED' | 'ERROR' = 'OK';

    // DB — required
    try {
        const r = await pool.query('SELECT NOW() AS now');
        checks.db = { ok: true, time: r.rows[0].now, database: process.env.DB_NAME };
    } catch (err: any) {
        checks.db = { ok: false, error: err.message };
        overall = 'ERROR';
    }

    // Signing Queue health — counts per-status across all orgs (DEGRADED if any FAILED)
    try {
        const r = await pool.query(
            `SELECT status, COUNT(*)::int AS c FROM "otaxdb".signing_queue GROUP BY status`
        );
        const counts: Record<string, number> = { queued: 0, processing: 0, signed: 0, failed: 0 };
        for (const row of r.rows) counts[String(row.status).toLowerCase()] = row.c;
        checks.signingQueue = { ok: counts.failed === 0, ...counts };
        if (counts.failed > 0 && overall === 'OK') overall = 'DEGRADED';
    } catch {
        checks.signingQueue = { ok: false, error: 'queue table missing or unreachable' };
    }

    // Agent Bridge — number of connected signing agents (informational; not a failure)
    checks.agentBridge = {
        connectedAgents: activeAgents.size,
        active: activeAgents.size > 0,
    };

    // Feature flags
    checks.features = {
        signingWorker: process.env.SIGNING_WORKER !== 'off',
        gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    };

    // Uptime
    checks.uptimeSeconds = Math.round(process.uptime());
    checks.nodeVersion = process.version;

    const statusCode = overall === 'ERROR' ? 500 : 200;
    res.status(statusCode).json({ status: overall, timestamp: new Date().toISOString(), checks });
});

// Setup Database Schema


// ============================================
// SIGNER BRIDGE SERVICE (Cloud <-> Local)
// ============================================

const bridgeService = {
    async requestCertificates(companyId: string = 'default'): Promise<any[]> {
        return this.sendRequest(companyId, { cmd: 'list_certs' });
    },

    async signDocument(companyId: string = 'default', data: any): Promise<any> {
        // SaaS Gateway Update: Fetch registered certificate and PIN for this company
        console.log(`[Bridge] ====== SIGN REQUEST for ${companyId} ======`);
        console.log(`[Bridge] Incoming data - PIN: ${data.pin ? '****(len:' + data.pin.length + ')' : 'MISSING'}, CertIssuer: ${data.certificateIssuer || 'NONE'}, CertName: ${data.certificateName || 'NONE'}`);
        try {
            const resDb = await pool.query('SELECT cert_thumbprint, cert_pin, cert_subject FROM otaxdb.signing_nodes WHERE company_id = $1', [companyId]);
            if (resDb.rows.length > 0 && resDb.rows[0].cert_thumbprint) {
                // Use registered credentials from DB
                data.certificateName = resDb.rows[0].cert_thumbprint;
                data.pin = resDb.rows[0].cert_pin;
                // IMPORTANT: Do NOT set certificateIssuer to thumbprint!
                // The agent auto-detects the issuer CN from the cert store.
                // Thumbprint is NOT an issuer name — it's a hex hash.
                console.log(`[Bridge] DB Override - Thumbprint: ${resDb.rows[0].cert_thumbprint.substring(0, 10)}..., PIN: ****(len:${(resDb.rows[0].cert_pin || '').length}), Subject: ${resDb.rows[0].cert_subject || 'N/A'}`);
            } else {
                console.warn(`[Bridge] WARNING: No cert data found in signing_nodes for company ${companyId}. Using whatever the frontend sent.`);
            }
        } catch (dbErr) {
            console.error('[Bridge] Failed to fetch registered cert from DB:', dbErr);
        }

        // Ensure data includes serialized content if not already present
        if (!data.serialized && data.document) {
            data.serialized = serializeInvoice(data.document);
        }
        console.log(`[Bridge] Sending to agent - CertName: ${(data.certificateName || '').substring(0, 10)}..., PIN: ${data.pin ? '****(len:' + data.pin.length + ')' : 'MISSING'}`);
        return this.sendRequest(companyId, { cmd: 'sign', data });
    },

    sendRequest(companyId: string, payload: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const agentWs = activeAgents.get(companyId);
            if (!agentWs || agentWs.readyState !== WebSocket.OPEN) {
                return reject(new Error('Signing Agent is NOT connected. Please run the OTax Agent on the Master PC.'));
            }

            const reqId = crypto.randomUUID();
            pendingRequests.set(reqId, { resolve, reject, isSign: payload.cmd === 'sign' });

            // Timeout after 60 seconds (Increased for slower tokens/network)
            setTimeout(() => {
                if (pendingRequests.has(reqId)) {
                    pendingRequests.delete(reqId);
                    reject(new Error('Agent request timed out (60s). Check local agent responsiveness or increase timeout.'));
                }
            }, 60000);

            agentWs.send(JSON.stringify({ type: 'request', reqId, ...payload }));
        });
    }
};

// 0. Bridge Check / List Certs
app.get('/api/bridge/list-certs', async (req, res) => {
    try {
        const companyId = (req.query.companyId as string) || 'default';

        if (process.env.RENDER) {
            const certs = await bridgeService.requestCertificates(companyId);
            res.json({ success: true, certificates: certs });
        } else {
            const certs = await listCertificates();
            res.json({ success: true, certificates: certs });
        }
    } catch (e: any) {
        console.error('[Bridge] List Certs Error:', e);
        res.status(500).json({
            success: false,
            message: e.message,
            details: 'Ensure the OTax Agent is running and connected on the Master PC.'
        });
    }
});

app.get('/api/bridge/debug', (req, res) => {
    res.json({
        activeAgents: Array.from(activeAgents.keys()),
        pendingRequestsCount: pendingRequests.size,
        env: process.env.RENDER ? 'Production' : 'Local'
    });
});

// 1. Get Bridge/Node Status
app.get('/api/bridge/status', async (req, res) => {
    const companyId = (req.query.companyId as string) || 'default';
    try {
        const result = await pool.query('SELECT * FROM otaxdb.signing_nodes WHERE company_id = $1', [companyId]);
        const isOnline = activeAgents.has(companyId);

        if (result.rows.length > 0) {
            res.json({
                success: true,
                registered: true,
                online: isOnline,
                node: result.rows[0]
            });
        } else {
            res.json({
                success: true,
                registered: false,
                online: isOnline
            });
        }
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 2. Register Certificate (persist thumbprint and PIN)
app.post('/api/bridge/register-cert', async (req, res) => {
    const { companyId, thumbprint, subject, pin } = req.body;
    const cid = companyId || 'default';

    try {
        // We only update if a node is already registered for this company
        const result = await pool.query(
            `UPDATE otaxdb.signing_nodes 
             SET cert_thumbprint = COALESCE($1, cert_thumbprint), 
                 cert_subject = COALESCE($2, cert_subject), 
                 cert_pin = COALESCE($3, cert_pin) 
             WHERE company_id = $4`,
            [thumbprint, subject, pin, cid]
        );

        if (result.rowCount === 0) {
            // If no node exists, we create a placeholder (or they need to run the agent first)
            // Usually the agent creates the row, but let's be robust.
            await pool.query(
                `INSERT INTO otaxdb.signing_nodes (company_id, node_id, cert_thumbprint, cert_subject, cert_pin, last_seen)
                 VALUES ($1, 'placeholder', $2, $3, $4, NOW())
                 ON CONFLICT (company_id) DO UPDATE SET
                 cert_thumbprint = EXCLUDED.cert_thumbprint,
                 cert_subject = EXCLUDED.cert_subject,
                 cert_pin = EXCLUDED.cert_pin`,
                [cid, thumbprint, subject, pin]
            );
        }

        res.json({ success: true, message: 'Certificate registered successfully' });
    } catch (e: any) {
        console.error('[Bridge] Register Cert Error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 3. Reset Node (allow connecting a new PC)
app.post('/api/bridge/reset-node', async (req, res) => {
    const { companyId } = req.body;
    const cid = companyId || 'default';
    try {
        await pool.query('DELETE FROM otaxdb.signing_nodes WHERE company_id = $1', [cid]);
        res.json({ success: true, message: 'Node registered reset successfully' });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Embedded Agent Code (v3.0.0 - UTS + Legacy Fallback)
const AGENT_CODE_EMBEDDED = `import WebSocket from 'ws';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import http from 'http';
import { fileURLToPath } from 'url';

const execPromise = util.promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AGENT_VERSION = '3.0.0';
const CLOUD_URL = 'wss://e-invoice-545y.onrender.com';
const COMPANY_ID = process.env.OTAX_COMPANY_ID || 'default';
const RECONNECT_INTERVAL = 3000;
const UTS_PORT = 7777;
const UTS_TIMEOUT = 30000;

const getSignerDir = () => {
    const localPath = path.join(__dirname, 'EInvoicingSigner');
    const parentPath = path.resolve(__dirname, '..', 'EInvoicingSigner');
    if (fs.existsSync(localPath) && fs.existsSync(path.join(localPath, 'EInvoicingSigner.exe'))) return localPath;
    if (fs.existsSync(parentPath) && fs.existsSync(path.join(parentPath, 'EInvoicingSigner.exe'))) return parentPath;
    return localPath;
};

const SIGNER_DIR = getSignerDir();
const TEMP_DIR = path.join(SIGNER_DIR, 'temp');
const SIGNER_EXE = path.join(SIGNER_DIR, 'EInvoicingSigner.exe');

let socket: WebSocket | null = null;
let utsAvailable = false;
let utsSecret = '';
let signerValid = false;

const CONFIG_FILE = path.join(__dirname, 'agent_config.json');
const COMPANY_ID_FILE = path.join(__dirname, 'company_id.txt');

function getAgentConfig() {
    let config: any = {};
    if (fs.existsSync(CONFIG_FILE)) { try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) {} }
    if (fs.existsSync(COMPANY_ID_FILE)) { try { const cid = fs.readFileSync(COMPANY_ID_FILE, 'utf8').trim(); if (cid && cid !== 'default') config.companyId = cid; } catch (e) {} }
    if (!config.nodeId) { config.nodeId = crypto.randomUUID(); if (!config.companyId) config.companyId = COMPANY_ID; fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); }
    return config;
}

const agentConfig = getAgentConfig();
if (process.env.OTAX_COMPANY_ID) agentConfig.companyId = process.env.OTAX_COMPANY_ID;

// UTS HTTP Helper
function utsRequest(method: string, urlPath: string, body?: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const postData = body ? JSON.stringify(body) : undefined;
        const req = http.request({
            hostname: '127.0.0.1', port: UTS_PORT, path: urlPath, method,
            headers: { 'X-UTS-Secret': utsSecret, ...(postData ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } : {}) },
            timeout: UTS_TIMEOUT,
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 403) return reject(new Error('UTS rejected (invalid secret)'));
                if (res.statusCode && res.statusCode >= 400) return reject(new Error('UTS error ' + res.statusCode));
                try { resolve(JSON.parse(data)); } catch { resolve(data); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('UTS timeout')); });
        if (postData) req.write(postData);
        req.end();
    });
}

async function probeUTS(): Promise<boolean> {
    try {
        const sp = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'UniversalTokenSigner', 'settings.json');
        if (!fs.existsSync(sp)) return false;
        utsSecret = JSON.parse(fs.readFileSync(sp, 'utf8')).ApiSecret || '';
        await utsRequest('GET', '/status');
        console.log('[Agent] UTS connected!');
        return true;
    } catch (e: any) { console.warn('[Agent] UTS not available: ' + e.message); return false; }
}

function validateLegacySigner(): boolean {
    const missing = ['EInvoicingSigner.exe','EInvoicingSigner.dll','BouncyCastle.Crypto.dll'].filter(f => !fs.existsSync(path.join(SIGNER_DIR, f)));
    if (missing.length > 0) { console.warn('[Agent] Legacy signer missing: ' + missing.join(', ')); return false; }
    return true;
}

function connect() {
    socket = new WebSocket(CLOUD_URL);
    socket.on('open', () => {
        console.log('[Agent] Connected!');
        socket?.send(JSON.stringify({ type: 'register_agent', companyId: agentConfig.companyId || COMPANY_ID, nodeId: agentConfig.nodeId, agentName: os.hostname(), agentVersion: AGENT_VERSION }));
    });
    socket.on('message', async (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'request') handleRequest(msg);
            else if (msg.type === 'registered') console.log('Agent registered!');
            else if (msg.type === 'error') console.error('Cloud Error:', msg.message);
        } catch (e) {}
    });
    socket.on('close', () => { socket = null; setTimeout(connect, RECONNECT_INTERVAL); });
    socket.on('error', (err) => { console.error('[Agent] Error:', err.message); });
}

async function handleRequest(msg: any) {
    const { reqId, cmd, data } = msg;
    try {
        let payload = null;
        if (cmd === 'list_certs') payload = await listCertificates();
        else if (cmd === 'sign') payload = await signDocument(data, reqId);
        else throw new Error('Unknown: ' + cmd);
        sendResponse(reqId, true, payload);
    } catch (e: any) { sendResponse(reqId, false, null, e.message); }
}
function sendResponse(reqId: string, ok: boolean, payload: any, error: string | null = null) {
    if (!socket) return;
    socket.send(JSON.stringify({ type: 'response', reqId, success: ok, payload, error }));
}

async function listCertificates() {
    if (!utsAvailable) {
        utsAvailable = await probeUTS();
    }
    if (utsAvailable) {
        try {
            const certs = await utsRequest('GET', '/tokens') as any[];
            return certs.map(c => ({ Thumbprint: c.certIdBase64||c.CertIdBase64||'', Subject: c.subject||c.Subject||'', Issuer: c.issuer||c.Issuer||'', FriendlyName: c.label||c.Label||'', Source: 'UTS_PKCS11' }));
        } catch (e) { console.warn('[Agent] UTS certs failed, fallback...'); }
    }
    const { stdout } = await execPromise('powershell -NoProfile -Command "Get-ChildItem -Path Cert:\\\\\\\\CurrentUser\\\\\\\\My | Select-Object Thumbprint, Subject, Issuer, NotAfter, FriendlyName | ConvertTo-Json -Compress"', { timeout: 15000 });
    const certs: any[] = [];
    if (stdout && stdout.trim()) { let p = JSON.parse(stdout); if (!Array.isArray(p)) p = [p]; for (const c of p) { if (c.Thumbprint) certs.push({ Thumbprint: c.Thumbprint, Subject: c.Subject, Issuer: typeof c.Issuer==='string'?c.Issuer:(c.Issuer?.Name||''), FriendlyName: c.FriendlyName||'', NotAfter: c.NotAfter }); } }
    return certs;
}

async function signDocument(payload: any, reqId: string) {
    if (!utsAvailable) {
        utsAvailable = await probeUTS();
    }
    if (utsAvailable) {
        try {
            const { document, serialized, pin } = payload;
            if (!serialized) throw new Error('No serialized data');
            console.log('[Agent] 📡 Requesting CAdES-BES signature from UTS...');
            const r = await utsRequest('POST', '/sign-document-cades', { serializedData: serialized, pin, certIdBase64: null });
            const sig = r.signatureBase64 || r.SignatureBase64;
            if (!sig || sig.length < 500) throw new Error('Invalid UTS CAdES-BES signature');
            console.log('[Agent] UTS ✓ CAdES-BES signature received! Size: ' + sig.length + ' chars (~' + Math.round(sig.length * 0.75) + ' bytes)');
            const doc = JSON.parse(JSON.stringify(document));
            if (!doc.signatures) doc.signatures = [];
            doc.signatures.push({ signatureType: 'I', value: sig });
            return doc;
        } catch (e: any) { console.warn('[Agent] UTS failed: ' + e.message); if (!signerValid) throw e; }
    }
    return signDocumentLegacy(payload, reqId);
}

async function signDocumentLegacy(payload: any, reqId: string) {
    const { document, serialized, pin, certificateIssuer, certificateName } = payload;
    const thumbprint = certificateName || '';
    let issuer = certificateIssuer || '';
    if (issuer && /^[0-9A-Fa-f]{30,}$/.test(issuer)) issuer = '';
    if (!issuer && thumbprint && thumbprint.length > 30) {
        try { const ps = 'chcp 65001 >$null; $c = Get-Item "Cert:\\\\CurrentUser\\\\My\\\\'+thumbprint+'"; if ($c.Issuer -match "CN=([^,]+)") { $Matches[1] } else { $c.Issuer }';
        const { stdout } = await execPromise('powershell -NoProfile -EncodedCommand ' + Buffer.from(ps, 'utf16le').toString('base64'), { timeout: 10000 });
        if (stdout && stdout.trim()) issuer = stdout.trim(); } catch (e) {}
    }
    if (!issuer) {
        try { const ps2 = 'chcp 65001 >$null; $c = @(Get-ChildItem "Cert:\\\\CurrentUser\\\\My" | Where-Object { $_.HasPrivateKey })[0]; if ($c.Issuer -match "CN=([^,]+)") { $Matches[1] } else { $c.Issuer }';
        const { stdout } = await execPromise('powershell -NoProfile -EncodedCommand ' + Buffer.from(ps2, 'utf16le').toString('base64'), { timeout: 10000 });
        if (stdout && stdout.trim() && !/^[0-9A-Fa-f]{30,}$/.test(stdout.trim())) issuer = stdout.trim(); } catch (e) {}
    }
    if (!issuer) issuer = 'MCDR CA 2022';

    let exe = SIGNER_EXE;
    if (!fs.existsSync(exe)) { const alt = path.join(SIGNER_DIR, 'EtaSigner.exe'); if (fs.existsSync(alt)) exe = alt; else throw new Error('Signer not found'); }
    const tmpDir = path.join(TEMP_DIR, (reqId||crypto.randomUUID()).substring(0, 8));
    fs.mkdirSync(tmpDir, { recursive: true });
    const inFile = path.join(tmpDir, 'SourceDocumentJson.json');
    const canFile = path.join(tmpDir, 'CanonicalString.txt');
    const outFile = path.join(tmpDir, 'FullSignedDocument.json');
    try {
        fs.writeFileSync(inFile, JSON.stringify(document, null, 2), 'utf8');
        if (serialized) fs.writeFileSync(canFile, serialized, 'utf8');
        const raw = 'chcp 65001 >$null; & "'+exe+'" "'+tmpDir+'" "'+pin+'" "'+issuer+'"';
        const cmd = 'powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + Buffer.from(raw, 'utf16le').toString('base64');
        let stdout = '', stderr = '';
        try { const r = await execPromise(cmd, { cwd: SIGNER_DIR, timeout: 60000 }); stdout=r.stdout; stderr=r.stderr; } catch (e: any) { stdout=e.stdout||''; stderr=e.stderr||''; }
        if (!fs.existsSync(outFile)) throw new Error('Signed output not found. Check USB token and PIN.');
        const w = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        const doc = w.documents?.[0] || w;
        if (!doc.signatures?.length) throw new Error('No signature generated');
        if (doc.signatures[0].value.length < 100) throw new Error('Invalid signature');
        return doc;
    } finally { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {} }
}

async function main() {
    console.log('[Agent] OTax Signing Agent v' + AGENT_VERSION);
    console.log('[Agent] Company: ' + (agentConfig.companyId || COMPANY_ID));
    utsAvailable = await probeUTS();
    signerValid = validateLegacySigner();
    if (!utsAvailable && !signerValid) console.error('[Agent] No signer available!');
    connect();
}
main();
`;



// 0.05 Download Agent Bootstrapper
app.get('/api/bridge/download-agent', (req, res) => {
    const companyId = req.query.companyId || 'default';
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers.host;
    const SERVER_URL = protocol + '://' + host;

    // Build BAT script line by line to avoid template literal formatting issues
    const lines = [
        '@echo off',
        'setlocal enabledelayedexpansion',
        'chcp 65001 >nul',
        'cls',
        'echo ===================================================',
        'echo   OTax Agent Bootstrapper v3.1',
        'echo ===================================================',
        'echo.',
        '',
        'REM [1/7] Check Node.js',
        'echo [1/7] Checking Node.js...',
        'where node >nul 2>&1',
        'if errorlevel 1 (',
        '    echo ERROR: Node.js not found!',
        '    echo Download from: https://nodejs.org/',
        '    pause',
        '    exit /b 1',
        ')',
        'echo OK - Node.js found',
        'echo.',
        '',
        'REM [2/7] Setup directory',
        'echo [2/7] Setting up directory...',
        'set "INSTALL_DIR=%USERPROFILE%\\Downloads\\otax-agent"',
        'echo Installing to: %INSTALL_DIR%',
        'if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"',
        'cd /d "%INSTALL_DIR%"',
        'if not exist EInvoicingSigner mkdir EInvoicingSigner',
        'if not exist EInvoicingSigner\\runtimes\\win\\lib\\netcoreapp3.0 mkdir EInvoicingSigner\\runtimes\\win\\lib\\netcoreapp3.0',
        `echo ${companyId}> company_id.txt`,
        'echo OK - Directory ready',
        'echo.',
        '',
        'REM [3/7] Download signer files',
        'echo [3/7] Downloading signer files...',
        `set "SERVER=${SERVER_URL}"`,
        '',
        'echo Downloading EInvoicingSigner.exe...',
        'powershell -Command "Invoke-WebRequest -Uri \'%SERVER%/api/bridge/binaries/EInvoicingSigner.exe\' -OutFile \'EInvoicingSigner\\EInvoicingSigner.exe\' -UseBasicParsing"',
        '',
        'echo Downloading EInvoicingSigner.dll...',
        'powershell -Command "Invoke-WebRequest -Uri \'%SERVER%/api/bridge/binaries/EInvoicingSigner.dll\' -OutFile \'EInvoicingSigner\\EInvoicingSigner.dll\' -UseBasicParsing"',
        '',
        'echo Downloading EInvoicingSigner.deps.json...',
        'powershell -Command "Invoke-WebRequest -Uri \'%SERVER%/api/bridge/binaries/EInvoicingSigner.deps.json\' -OutFile \'EInvoicingSigner\\EInvoicingSigner.deps.json\' -UseBasicParsing"',
        '',
        'echo Downloading EInvoicingSigner.runtimeconfig.json...',
        'powershell -Command "Invoke-WebRequest -Uri \'%SERVER%/api/bridge/binaries/EInvoicingSigner.runtimeconfig.json\' -OutFile \'EInvoicingSigner\\EInvoicingSigner.runtimeconfig.json\' -UseBasicParsing"',
        '',
        'echo Downloading BouncyCastle.Crypto.dll...',
        'powershell -Command "Invoke-WebRequest -Uri \'%SERVER%/api/bridge/binaries/BouncyCastle.Crypto.dll\' -OutFile \'EInvoicingSigner\\BouncyCastle.Crypto.dll\' -UseBasicParsing"',
        '',
        'echo Downloading Newtonsoft.Json.dll...',
        'powershell -Command "Invoke-WebRequest -Uri \'%SERVER%/api/bridge/binaries/Newtonsoft.Json.dll\' -OutFile \'EInvoicingSigner\\Newtonsoft.Json.dll\' -UseBasicParsing"',
        '',
        'echo Downloading Pkcs11Interop.dll...',
        'powershell -Command "Invoke-WebRequest -Uri \'%SERVER%/api/bridge/binaries/Pkcs11Interop.dll\' -OutFile \'EInvoicingSigner\\Pkcs11Interop.dll\' -UseBasicParsing"',
        '',
        'echo Downloading System.Security.Cryptography.Pkcs.dll...',
        'powershell -Command "Invoke-WebRequest -Uri \'%SERVER%/api/bridge/binaries/System.Security.Cryptography.Pkcs.dll\' -OutFile \'EInvoicingSigner\\System.Security.Cryptography.Pkcs.dll\' -UseBasicParsing"',
        '',
        'echo OK - Signer files downloaded',
        'echo.',
        '',
        'REM [4/7] Download runtime DLL',
        'echo [4/7] Downloading runtime DLL...',
        'powershell -Command "Invoke-WebRequest -Uri \'%SERVER%/api/bridge/binaries/runtimes/win/lib/netcoreapp3.0/System.Security.Cryptography.Pkcs.dll\' -OutFile \'EInvoicingSigner\\runtimes\\win\\lib\\netcoreapp3.0\\System.Security.Cryptography.Pkcs.dll\' -UseBasicParsing"',
        'echo OK - Runtime DLL downloaded',
        'echo.',
        '',
        'REM [4.5/7] Copy PKCS11 token driver',
        'echo [4.5/7] Copying PKCS11 token middleware...',
        'if exist "C:\\Windows\\System32\\eps2003csp11.dll" (',
        '    copy /Y "C:\\Windows\\System32\\eps2003csp11.dll" "EInvoicingSigner\\eps2003csp11.dll" >nul',
        '    echo OK - eps2003csp11.dll copied from System32',
        ') else if exist "C:\\Windows\\SysWOW64\\eps2003csp11.dll" (',
        '    copy /Y "C:\\Windows\\SysWOW64\\eps2003csp11.dll" "EInvoicingSigner\\eps2003csp11.dll" >nul',
        '    echo OK - eps2003csp11.dll copied from SysWOW64',
        ') else (',
        '    echo WARNING: eps2003csp11.dll not found!',
        '    echo The USB Token driver ^(ePass2003^) must be installed.',
        ')',
        'echo.',
        '',
        'REM [5/7] Download agent code',
        'echo [5/7] Downloading agent code...',
        `powershell -Command "Invoke-WebRequest -Uri '%SERVER%/api/bridge/agent-code?companyId=${companyId}' -OutFile 'agent.ts' -UseBasicParsing"`,
        'if not exist "agent.ts" (',
        '    echo ERROR: Failed to download agent code!',
        '    pause',
        '    exit /b 1',
        ')',
        'echo OK - Agent code downloaded',
        'echo.',
        '',
        'REM [6/7] Install dependencies',
        'echo [6/7] Installing dependencies...',
        'echo {"private":true,"type":"module","dependencies":{"ws":"^8.18.0","tsx":"^4.21.0"}}> package.json',
        'call npm install --no-audit --no-fund --loglevel=error',
        'if errorlevel 1 (',
        '    echo ERROR: npm install failed!',
        '    pause',
        '    exit /b 1',
        ')',
        'echo OK - Dependencies installed',
        'echo.',
        '',
        'REM [7/7] Start agent (auto-restart loop)',
        'echo ===================================================',
        'echo   Starting OTax Agent',
        'echo   Installation: %INSTALL_DIR%',
        'echo   Agent will auto-restart if it stops.',
        'echo   Close this window to stop the agent.',
        'echo ===================================================',
        'echo.',
        ':restart_loop',
        'echo [%date% %time%] Starting agent...',
        'npx -y tsx agent.ts',
        'echo.',
        'echo [%date% %time%] Agent stopped. Restarting in 5 seconds...',
        'echo Press Ctrl+C to stop.',
        'timeout /t 5 /nobreak >nul',
        'goto restart_loop',
    ];

    const agentScript = lines.join('\r\n');
    res.setHeader('Content-Type', 'application/x-bat');
    res.setHeader('Content-Disposition', 'attachment; filename=run_otax_agent.bat');
    res.send(agentScript);
});

// 0.055 Download UniversalTokenSigner (UTS) Release
app.get('/api/bridge/download-uts', async (req, res) => {
    try {
        const archiver = await import('archiver');
        const fs = await import('fs');
        const path = await import('path');
        const url = await import('url');

        const __filename = url.fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);

        // Look for UTS release files
        const possiblePaths = [
            path.join(__dirname, '..', 'uts-release'),
            path.join(__dirname, '..', '..', 'UniversalTokenSigner', 'bin', 'Release', 'net8.0-windows'),
        ];

        let utsDir = '';
        for (const p of possiblePaths) {
            if (fs.existsSync(p) && fs.existsSync(path.join(p, 'UniversalTokenSigner.exe'))) {
                utsDir = p;
                break;
            }
        }

        if (!utsDir) {
            return res.status(404).json({ success: false, message: 'UTS release files not found on server' });
        }

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=UniversalTokenSigner.zip');

        const archive = archiver.default('zip', { zlib: { level: 9 } });
        archive.on('error', (err: any) => { throw err; });
        archive.pipe(res);

        // Add all files from the UTS release directory
        const files = fs.readdirSync(utsDir);
        for (const file of files) {
            const filePath = path.join(utsDir, file);
            const stat = fs.statSync(filePath);
            if (stat.isFile() && !file.endsWith('.pdb')) {
                archive.file(filePath, { name: file });
            }
        }

        await archive.finalize();
    } catch (err: any) {
        console.error('[UTS Download] Error:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to create UTS download: ' + err.message });
        }
    }
});

// 0.055b Download Complete OTax Setup ZIP (all-in-one)
app.get('/api/bridge/download-setup', async (req, res) => {
    try {
        const archiver = await import('archiver');
        const companyId = (req.query.companyId as string) || 'default';
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers.host;
        const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
        const CLOUD_URL = `${wsProtocol}://${host}`;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=OTax-Agent-Setup-${companyId}.zip`);

        const archive = archiver.default('zip', { zlib: { level: 9 } });
        archive.on('error', (err: any) => { throw err; });
        archive.pipe(res);

        // 1. README.txt — comprehensive step-by-step guide
        const readme = [
            '╔═══════════════════════════════════════════════════════════╗',
            '║         OTax Signing Agent - Setup Guide                 ║',
            '╚═══════════════════════════════════════════════════════════╝',
            '',
            `Company ID: ${companyId}`,
            `Cloud URL:  ${CLOUD_URL}`,
            '',
            '═══════════════════════════════════════════════════════════',
            '  STEP 1: Install Prerequisites (if not already installed)',
            '═══════════════════════════════════════════════════════════',
            '',
            '  1.1  Install Node.js (REQUIRED)',
            '       Download from: https://nodejs.org/',
            '       Choose: "LTS" version (v18 or higher)',
            '       Run the installer → click Next → Finish',
            '       RESTART your PC after installing Node.js',
            '',
            '  1.2  Install .NET 8 Desktop Runtime (for UniversalTokenSigner)',
            '       Download from: https://dotnet.microsoft.com/download/dotnet/8.0',
            '       Choose: ".NET Desktop Runtime 8.x" → Windows x64',
            '       Run the installer → click Install → Close',
            '',
            '  1.3  Install USB Token Driver (ePass2003)',
            '       If not already installed, download from: https://www.intesigroup.com',
            '       Or use the CD that came with your USB token',
            '       Run the installer → Finish',
            '       Plug in your USB token after driver installation',
            '',
            '',
            '═══════════════════════════════════════════════════════════',
            '  STEP 2: Extract & Install the Agent',
            '═══════════════════════════════════════════════════════════',
            '',
            '  2.1  Extract this ZIP to a folder on the PC',
            '       Example: C:\\OTaxAgent',
            '       (Right-click ZIP → Extract All → Choose folder)',
            '',
            '  2.2  Make sure your USB token is plugged in',
            '',
            '  2.3  Right-click "setup_agent.bat" → Run as Administrator',
            '       This will:',
            '       - Install Node.js dependencies',
            '       - Configure the PKCS11 token driver',
            '       - Configure UniversalTokenSigner',
            '       - Create auto-start service (starts with Windows)',
            '       - Start the agent in the background',
            '',
            '  2.4  Wait for "Setup Complete!" message',
            '       Press any key to close the setup window',
            '',
            '',
            '═══════════════════════════════════════════════════════════',
            '  STEP 3: Verify in Dashboard',
            '═══════════════════════════════════════════════════════════',
            '',
            '  3.1  Open the OTax Dashboard in your browser',
            '  3.2  Go to Settings → Token Signature',
            '  3.3  Agent status should show: "OTax Agent Connected ✓"',
            '       (green indicator with live pulse)',
            '  3.4  If the first time: Click "Scan for Certificates"',
            '       Select your certificate → Enter PIN → Save',
            '  3.5  Done! Users can now send invoices.',
            '',
            '',
            '═══════════════════════════════════════════════════════════',
            '  STEP 4 (OPTIONAL): Run UniversalTokenSigner Manually',
            '═══════════════════════════════════════════════════════════',
            '',
            '  If you want to test certificate detection separately:',
            '',
            '  4.1  Open the UniversalTokenSigner folder',
            '  4.2  Double-click "UniversalTokenSigner.exe"',
            '  4.3  A system tray icon will appear (bottom-right)',
            '  4.4  Right-click the tray icon → Settings',
            '  4.5  Set PKCS#11 Library Path to:',
            '       C:\\Windows\\System32\\eps2003csp11.dll',
            '       (or wherever your ePass2003 driver is installed)',
            '  4.6  Click Save',
            '',
            '  NOTE: The agent (setup_agent.bat) auto-configures this.',
            '        You only need this step for manual testing.',
            '',
            '',
            '═══════════════════════════════════════════════════════════',
            '  AFTER SETUP - How the Agent Runs',
            '═══════════════════════════════════════════════════════════',
            '',
            '  ✓  Agent runs SILENTLY in the background',
            '     (NO CMD window visible — this is normal!)',
            '  ✓  To verify: Open Task Manager → look for "node.exe"',
            '  ✓  Agent auto-starts when Windows starts',
            '  ✓  Agent auto-restarts if it crashes (every 5 seconds)',
            '  ✓  PIN is saved — no manual confirmation needed',
            '  ✓  Multiple users can sign invoices through this PC',
            '',
            '  To STOP the agent:',
            '     Open Task Manager → find "node.exe" → End Task',
            '',
            '  To RESTART the agent:',
            '     Double-click "run_agent.bat" (visible mode)',
            '     OR restart your PC (auto-starts silently)',
            '',
            '',
            '═══════════════════════════════════════════════════════════',
            '  TROUBLESHOOTING',
            '═══════════════════════════════════════════════════════════',
            '',
            '  Problem: Agent shows "Offline" in dashboard',
            '  Fix:     Double-click "run_agent.bat" to see error messages',
            '           Make sure USB token is plugged in',
            '           Check if Node.js is installed (open CMD, type: node -v)',
            '',
            '  Problem: "PKCS#11 library path not set"',
            '  Fix:     Re-run setup_agent.bat as Administrator',
            '           Or set it manually in UniversalTokenSigner tray icon',
            '',
            '  Problem: "No certificates found"',
            '  Fix:     Make sure USB token is plugged in',
            '           Install ePass2003 driver if not installed',
            '',
            '  Problem: Agent keeps restarting',
            '  Fix:     Open Task Manager, end "node.exe" processes',
            '           Then double-click "run_agent.bat" to see the error',
            '',
            '  Problem: "Company is locked to another Signing PC"',
            '  Fix:     Go to Dashboard → Settings → Token Signature',
            '           Click "Reset Node" button',
            '           Then re-run the agent',
            '',
            '  Problem: CMD window visible / not running in background',
            '  Fix:     Re-run setup_agent.bat as Administrator',
            '           It creates a Windows Scheduled Task for silent running',
            '           After setup, close the CMD window - agent continues',
            '',
            '',
            '═══════════════════════════════════════════════════════════',
            '  FILES IN THIS PACKAGE',
            '═══════════════════════════════════════════════════════════',
            '',
            '  README.txt                ← This file (setup guide)',
            '  setup_agent.bat           ← Run ONCE as Administrator to install',
            '  run_agent.bat             ← Agent runner (visible - for debugging)',
            '  run_agent_silent.vbs      ← Silent runner (created by setup)',
            '  agent.ts                  ← Agent code',
            '  agent_config.json         ← Configuration (pre-filled)',
            '  package.json              ← Node.js dependencies',
            '  EInvoicingSigner/         ← Legacy signer for ETA (CADES-BES)',
            '  UniversalTokenSigner/     ← Token manager for certificates',
            '',
            '',
            '═══════════════════════════════════════════════════════════',
            '  UNINSTALL',
            '═══════════════════════════════════════════════════════════',
            '',
            '  1. Open CMD as Administrator',
            '  2. Run: schtasks /delete /tn "OTaxSigningAgent" /f',
            '  3. Open Task Manager → End all "node.exe" processes',
            '  4. Delete the agent folder',
            '',
            '═══════════════════════════════════════════════════════════',
            '  OTax Support: Contact your OTax administrator',
            '═══════════════════════════════════════════════════════════',
        ].join('\r\n');
        archive.append(readme, { name: 'README.txt' });

        // 2. agent_config.json (pre-configured)
        const agentConfig = JSON.stringify({
            nodeId: `otax-${companyId}-${Date.now().toString(36)}`,
            companyId: companyId,
            cloudUrl: CLOUD_URL,
            agentName: 'OTax-PC'
        }, null, 4);
        archive.append(agentConfig, { name: 'agent_config.json' });

        // 3. package.json
        const packageJson = JSON.stringify({
            private: true,
            type: 'module',
            dependencies: { ws: '^8.18.0', tsx: '^4.21.0' }
        }, null, 4);
        archive.append(packageJson, { name: 'package.json' });

        // 4. agent.ts (embedded code with correct cloud URL)
        let agentCode = AGENT_CODE_EMBEDDED;
        agentCode = agentCode.replace(/const DEFAULT_CLOUD_URL = '.*?';/, `const DEFAULT_CLOUD_URL = '${CLOUD_URL}';`);
        archive.append(agentCode, { name: 'agent.ts' });

        // 5. run_agent.bat
        const runBat = [
            '@echo off', 'setlocal enabledelayedexpansion', 'chcp 65001 >nul',
            'set "AGENT_DIR=%~dp0"', 'cd /d "%AGENT_DIR%"', '',
            'where node >nul 2>&1',
            'if errorlevel 1 ( echo ERROR: Node.js not found! & pause & exit /b 1 )', '',
            'if not exist "node_modules\\ws" ( call npm install --no-audit --no-fund --loglevel=error )', '',
            'echo ===================================================',
            `echo   OTax Signing Agent - Company: ${companyId}`,
            'echo   Close this window to stop.', 'echo ===================================================', '',
            ':loop', 'echo [%date% %time%] Starting agent...', 'npx -y tsx agent.ts',
            'echo [%date% %time%] Restarting in 5s...', 'timeout /t 5 /nobreak >nul', 'goto loop'
        ].join('\r\n');
        archive.append(runBat, { name: 'run_agent.bat' });

        // 6. setup_agent.bat (one-time auto-start installer)
        const setupBat = [
            '@echo off', 'setlocal enabledelayedexpansion', 'chcp 65001 >nul', 'cls',
            'echo ===================================================',
            'echo   OTax Agent Setup - One Time Installation',
            'echo ===================================================', 'echo.', '',
            'net session >nul 2>&1',
            'if %errorlevel% neq 0 ( echo [ERROR] Run as Administrator! & pause & exit /b 1 )', '',
            'set "AGENT_DIR=%~dp0"',
            'echo [1/6] Checking Node.js...',
            'where node >nul 2>&1',
            'if %errorlevel% neq 0 ( echo [ERROR] Node.js not installed! & pause & exit /b 1 )',
            'echo       OK', '',
            'echo [2/6] Installing dependencies...',
            'cd /d "%AGENT_DIR%"',
            'call npm install --no-audit --no-fund --loglevel=error >nul 2>&1',
            'echo       OK', '',
            'echo [3/6] Configuring PKCS11 driver...',
            'set "PKCS11_DLL="',
            'if exist "C:\\Windows\\System32\\eps2003csp11.dll" set "PKCS11_DLL=C:\\Windows\\System32\\eps2003csp11.dll"',
            'if "%PKCS11_DLL%"=="" if exist "C:\\Windows\\SysWOW64\\eps2003csp11.dll" set "PKCS11_DLL=C:\\Windows\\SysWOW64\\eps2003csp11.dll"',
            'if not "%PKCS11_DLL%"=="" (',
            '    if exist "EInvoicingSigner" copy /Y "%PKCS11_DLL%" "EInvoicingSigner\\eps2003csp11.dll" >nul 2>&1',
            '    echo       Found: %PKCS11_DLL%',
            ') else (',
            '    echo       WARNING: eps2003csp11.dll not found. Install ePass2003 driver first.',
            ')', '',
            'echo [4/6] Configuring UniversalTokenSigner...',
            'set "UTS_SETTINGS_DIR=%APPDATA%\\UniversalTokenSigner"',
            'if not exist "%UTS_SETTINGS_DIR%" mkdir "%UTS_SETTINGS_DIR%"',
            'if not "%PKCS11_DLL%"=="" (',
            '    echo {"Pkcs11LibraryPath":"%PKCS11_DLL:\\=\\\\%","Port":7777,"ApiSecret":"","AllowedOrigins":[]}> "%UTS_SETTINGS_DIR%\\settings.json"',
            '    echo       UTS configured with PKCS11 driver.',
            ') else (',
            '    echo       Skipped - no PKCS11 driver found.',
            ')', '',
            'echo [5/6] Creating auto-start service...',
            '(echo Set WshShell = CreateObject^("WScript.Shell"^)',
            'echo WshShell.Run chr^(34^) ^& "%AGENT_DIR%run_agent.bat" ^& chr^(34^), 0, False',
            ') > "%AGENT_DIR%run_agent_silent.vbs"',
            'schtasks /delete /tn "OTaxSigningAgent" /f >nul 2>&1',
            'schtasks /create /tn "OTaxSigningAgent" /tr "\\"%AGENT_DIR%run_agent_silent.vbs\\"" /sc onlogon /rl highest /f >nul 2>&1',
            'if %errorlevel% neq 0 (',
            '    set "STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"',
            '    copy /Y "%AGENT_DIR%run_agent_silent.vbs" "!STARTUP!\\OTaxAgent.vbs" >nul 2>&1',
            ')',
            'echo       OK', '',
            'echo [6/6] Starting agent...',
            'start "" wscript.exe "%AGENT_DIR%run_agent_silent.vbs"', '',
            'echo.', 'echo ===================================================',
            'echo   Setup Complete! Agent is running in background.',
            'echo   It will auto-start with Windows.',
            'echo ===================================================', 'echo.', 'pause'
        ].join('\r\n');
        archive.append(setupBat, { name: 'setup_agent.bat' });

        // 7. EInvoicingSigner binaries
        const signerFiles = [
            'EInvoicingSigner.exe', 'EInvoicingSigner.dll', 'EInvoicingSigner.deps.json',
            'EInvoicingSigner.runtimeconfig.json', 'BouncyCastle.Crypto.dll',
            'Newtonsoft.Json.dll', 'Pkcs11Interop.dll', 'System.Security.Cryptography.Pkcs.dll'
        ];
        const signerSearchPaths = [
            path.join(process.cwd(), 'EInvoicingSigner'),
            path.join(process.cwd(), 'agent', 'EInvoicingSigner'),
        ];
        let signerDir = '';
        for (const p of signerSearchPaths) {
            if (fs.existsSync(path.join(p, 'EInvoicingSigner.exe'))) { signerDir = p; break; }
        }
        if (signerDir) {
            for (const file of signerFiles) {
                const fp = path.join(signerDir, file);
                if (fs.existsSync(fp)) archive.file(fp, { name: `EInvoicingSigner/${file}` });
            }
            const runtimeDll = path.join(signerDir, 'runtimes', 'win', 'lib', 'netcoreapp3.0', 'System.Security.Cryptography.Pkcs.dll');
            if (fs.existsSync(runtimeDll)) archive.file(runtimeDll, { name: 'EInvoicingSigner/runtimes/win/lib/netcoreapp3.0/System.Security.Cryptography.Pkcs.dll' });
        }

        // 8. UTS (UniversalTokenSigner) binaries
        const utsSearchPaths = [
            path.join(process.cwd(), 'uts-release'),
            path.join(process.cwd(), '..', 'UniversalTokenSigner', 'bin', 'Release', 'net8.0-windows'),
        ];
        let utsDir = '';
        for (const p of utsSearchPaths) {
            if (fs.existsSync(p) && fs.existsSync(path.join(p, 'UniversalTokenSigner.exe'))) { utsDir = p; break; }
        }
        if (utsDir) {
            const utsFiles = fs.readdirSync(utsDir);
            for (const file of utsFiles) {
                const fp = path.join(utsDir, file);
                if (fs.statSync(fp).isFile() && !file.endsWith('.pdb')) {
                    archive.file(fp, { name: `UniversalTokenSigner/${file}` });
                }
            }
        }

        await archive.finalize();
        console.log(`[Setup] ZIP created for company ${companyId} (signer: ${signerDir ? 'YES' : 'NO'}, UTS: ${utsDir ? 'YES' : 'NO'})`);
    } catch (err: any) {
        console.error('[Setup Download] Error:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to create setup: ' + err.message });
        }
    }
});


app.get('/api/bridge/status', async (req, res) => {
    const companyId = req.query.companyId as string || 'default';
    const isOnline = activeAgents.has(companyId);

    try {
        const client = await pool.connect();
        try {
            const dbRes = await client.query('SELECT * FROM otaxdb.signing_nodes WHERE company_id = $1', [companyId]);
            if (dbRes.rows.length > 0) {
                return res.json({
                    success: true,
                    registered: true,
                    online: isOnline,
                    node: dbRes.rows[0]
                });
            } else {
                return res.json({
                    success: true,
                    registered: false,
                    online: false
                });
            }
        } finally {
            client.release();
        }
    } catch (e: any) {
        console.error('[Bridge] Status Error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 0.07 Reset Node Registration
app.post('/api/bridge/reset-node', async (req, res) => {
    const { companyId } = req.body;
    if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

    try {
        const client = await pool.connect();
        try {
            await client.query('DELETE FROM otaxdb.signing_nodes WHERE company_id = $1', [companyId]);

            // If agent is currently connected, disconnect it to force restart
            const activeWs = activeAgents.get(companyId);
            if (activeWs) {
                activeWs.send(JSON.stringify({ type: 'error', message: 'Registration reset by admin.' }));
                activeWs.close();
                activeAgents.delete(companyId);
            }

            console.log(`[Bridge] Reset node registration for company: ${companyId} `);
            res.json({ success: true, message: 'Node reset successfully' });
        } finally {
            client.release();
        }
    } catch (e: any) {
        console.error('[Bridge] Reset Error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================
// SIGNING STATUS ENDPOINTS (inline, no RBAC)
// These mirror signingRoutes.ts but work without Prisma RBAC tables
// ============================================

// GET /api/signing/agent-status
app.get('/api/signing/agent-status', async (req, res) => {
    try {
        const companyId = (req.query.companyId as string) || 'default';
        const isOnline = activeAgents.has(companyId);

        // Try to get more info from signing_nodes
        let nodeInfo = null;
        try {
            const client = await pool.connect();
            try {
                const dbRes = await client.query(
                    'SELECT * FROM otaxdb.signing_nodes WHERE company_id = $1', [companyId]
                );
                if (dbRes.rows.length > 0) nodeInfo = dbRes.rows[0];
            } finally {
                client.release();
            }
        } catch (e) { /* DB not available, just return online status */ }

        res.json({
            success: true,
            online: isOnline,
            node: nodeInfo,
        });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// GET /api/signing/method
app.get('/api/signing/method', async (req, res) => {
    try {
        const companyId = (req.query.companyId as string) || 'default';
        const isOnline = activeAgents.has(companyId);

        // Try to get signing node info
        let nodeInfo = null;
        try {
            const client = await pool.connect();
            try {
                const dbRes = await client.query(
                    'SELECT * FROM otaxdb.signing_nodes WHERE company_id = $1', [companyId]
                );
                if (dbRes.rows.length > 0) nodeInfo = dbRes.rows[0];
            } finally {
                client.release();
            }
        } catch (e) { /* ignore */ }

        res.json({
            success: true,
            method: 'agent',  // Default to agent method
            agent: {
                configured: !!nodeInfo,
                companyId,
                nodeId: nodeInfo?.node_id,
                lastSeen: nodeInfo?.last_seen,
                online: isOnline,
            },
        });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// GET /api/signing/test - simple test endpoint
app.get('/api/signing/test', async (req, res) => {
    const companyId = (req.query.companyId as string) || 'default';
    const isOnline = activeAgents.has(companyId);
    res.json({
        success: true,
        agentOnline: isOnline,
        message: isOnline ? 'Agent is ready for signing' : 'Agent is not connected',
    });
});

app.get('/api/bridge/agent-code', (req, res) => {
    try {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers.host;
        const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
        const CLOUD_URL = `${wsProtocol}://${host}`;

        // FORCE use of embedded code to ensure newest v2.2+ features are active
        // This avoids Render serving stale agent.ts files from the repo
        let code = AGENT_CODE_EMBEDDED;

        const finalCode = code.replace(/const CLOUD_URL = '.*?';/, `const CLOUD_URL = '${CLOUD_URL}';`);
        res.setHeader('Content-Type', 'text/typescript');
        res.send(finalCode);
    } catch (e) {
        res.status(500).send('Agent code not found');
    }
});

app.get('/api/bridge/binaries/*', (req, res) => {
    // Get the path after /api/bridge/binaries/
    const requestedPath = req.params[0];

    // Security: prevent directory traversal
    if (requestedPath.includes('..') || requestedPath.includes('\\..') || requestedPath.startsWith('/')) {
        return res.status(403).send('Forbidden');
    }

    // Validate file extension
    const allowed = ['.exe', '.dll', '.json', '.config'];
    const ext = path.extname(requestedPath).toLowerCase();
    if (!allowed.includes(ext)) {
        return res.status(403).send('Forbidden');
    }

    // Try to find the file in possible locations
    const possiblePaths = [
        path.join(process.cwd(), 'EInvoicingSigner', requestedPath),
        path.join(process.cwd(), 'backend-service', 'EInvoicingSigner', requestedPath)
    ];

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            return res.sendFile(p);
        }
    }

    res.status(404).send('Not found');
});

// Duplicate bridge endpoints removed - Consolidated in SIGNER BRIDGE SERVICE section above.

// 1. Remote Sign Endpoint (Legacy/Secondary - Use /api/excel/submit for batches)
app.post('/api/bridge/sign', async (req, res) => {
    try {
        const companyId = (req.body.companyId as string) || 'default';
        console.log(`[Bridge Sign API] Received sign request for company: ${companyId}, has pin: ${!!req.body.pin}, has certIssuer: ${!!req.body.certificateIssuer}`);
        const result = await bridgeService.signDocument(companyId, {
            document: req.body.document || req.body,
            pin: req.body.pin,
            certificateIssuer: req.body.certificateIssuer,
            serialized: serializeInvoice(req.body.document || req.body)
        });
        res.json({ success: true, ...result });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 1. Parse Excel
app.post('/api/excel/parse', async (req, res) => {
    try {
        const { excelData } = req.body;
        if (!excelData) return res.status(400).json({ success: false, message: 'No file data provided' });

        const workbook = XLSX.read(Buffer.from(excelData, 'base64'), { type: 'buffer' });

        // Validation: Check for required sheets
        const sheetNames = workbook.SheetNames.map(s => s.toLowerCase());
        if (!sheetNames.includes('header') || !sheetNames.includes('detail')) {
            return res.status(400).json({ success: false, message: 'Excel file must contain "header" and "detail" sheets.' });
        }

        const headers = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames.find(s => s.toLowerCase() === 'header')!]);
        const details = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames.find(s => s.toLowerCase() === 'detail')!]);

        res.json({ success: true, data: { headers, details } });
    } catch (error: any) {
        console.error('[Excel Parse]', error);
        res.status(500).json({ success: false, message: 'Failed to parse Excel file', error: error.message });
    }
});

// 2. Calculate Invoices
app.post('/api/excel/calculate', async (req, res) => {
    console.log('[Excel Calc] Request received');
    try {
        const { headers, details } = req.body;

        // Log request size approximation
        const bodySize = JSON.stringify(req.body).length;
        console.log(`[Excel Calc] Payload size: ${(bodySize / 1024).toFixed(2)} KB`);
        console.log(`[Excel Calc] Headers count: ${headers?.length}, Details count: ${details?.length} `);

        if (!headers || !Array.isArray(headers)) throw new Error('Invalid or missing headers array');
        if (!details || !Array.isArray(details)) throw new Error('Invalid or missing details array');

        const invoices = [];

        // Helper to get value case-insensitively
        const getValue = (obj: any, candidates: string[]) => {
            if (!obj) return undefined;
            // 1. Direct match
            for (const key of candidates) {
                if (obj[key] !== undefined) return obj[key];
            }
            // 2. Case-insensitive match
            const keys = Object.keys(obj);
            for (const candidate of candidates) {
                const found = keys.find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === candidate.toLowerCase().replace(/[^a-z0-9]/g, ''));
                if (found) return obj[found];
            }
            return undefined;
        };

        for (const header of headers) {
            const internalId = getValue(header, ['internalId', 'InternalID', 'invoiceNumber', 'InvoiceNo']);
            if (!internalId) {
                console.log(`[Excel Calc] Skipping header row - No InternalID found.Keys: ${Object.keys(header).join(',')} `);
                continue;
            }

            // Filter details for this invoice
            const invoiceLines = details.filter((d: any) => {
                const dId = getValue(d, ['internalId', 'InternalID', 'invoiceNumber', 'InvoiceNo']);
                return dId == internalId;
            }).map((d: any) => ({
                description: getValue(d, ['description', 'Description', 'ItemName']),
                itemType: getValue(d, ['itemType', 'ItemType']) || 'GS1',
                itemCode: getValue(d, ['itemCode', 'ItemCode']),
                itemInternalCode: getValue(d, ['itemInternalCode', 'ItemInternalCode']) || '',
                unitType: getValue(d, ['unitType', 'UnitType']) || 'EA',
                quantity: Number(getValue(d, ['quantity', 'Quantity']) || 0),
                currencySold: getValue(d, ['currencySold', 'CurrencySold']) || 'EGP',
                amount: Number(getValue(d, ['amount', 'Amount', 'UnitPrice', 'Price']) || 0),
                currencyExchangeRate: Number(getValue(d, ['currencyExchangeRate', 'CurrencyExchangeRate']) || 0),
                disRate: Number(getValue(d, ['disRate', 'DisRate', 'DiscountRate']) || 0),
                disAmount: Number(getValue(d, ['disAmount', 'DisAmount', 'DiscountAmount']) || 0),
                tax_V001: Number(getValue(d, ['tax_V001', 'Tax_V001', 'T2']) || 0), // Table Tax
                tax_V009: Number(getValue(d, ['tax_V009', 'Tax_V009', 'T1']) || 0), // VAT
                tax_V003: Number(getValue(d, ['tax_V003', 'Tax_V003', 'T7']) || 0), // Ent Tax
                tax_W007: Number(getValue(d, ['tax_W007', 'Tax_W007', 'T4']) || 0)  // WHT
            }));

            if (invoiceLines.length === 0) {
                console.log(`[Excel Calc]Warning: No lines found for Invoice ${internalId}`);
            }

            // Map Header to Standard Format
            const invHeader = {
                internalId: String(internalId),
                receiverType: getValue(header, ['receiverType', 'ReceiverType']) || 'B',
                receiverId: getValue(header, ['receiverId', 'ReceiverID', 'ReceiverRegNo']) || '',
                receiverName: getValue(header, ['receiverName', 'ReceiverName']) || '',
                receiverCountry: getValue(header, ['receiverCountry', 'ReceiverCountry']) || 'EG',
                receiverGovernate: getValue(header, ['receiverGovernate', 'ReceiverGovernate']) || '',
                receiverRegionCity: getValue(header, ['receiverRegionCity', 'ReceiverRegionCity']) || '',
                receiverStreet: getValue(header, ['receiverStreet', 'ReceiverStreet']) || '',
                receiverBuildingNumber: getValue(header, ['receiverBuildingNumber', 'ReceiverBuildingNumber']) || '',
                receiverPostalCode: getValue(header, ['receiverPostalCode', 'ReceiverPostalCode']) || '',
                receiverFloor: getValue(header, ['receiverFloor', 'ReceiverFloor']) || '',
                receiverRoom: getValue(header, ['receiverRoom', 'ReceiverRoom']) || '',
                receiverLandmark: getValue(header, ['receiverLandmark', 'ReceiverLandmark']) || '',
                receiverAdditionalInformation: getValue(header, ['receiverAdditionalInformation', 'ReceiverAdditionalInformation']) || '',
                documentType: getValue(header, ['documentType', 'DocumentType']) || 'I',
                dateTimeIssued: getValue(header, ['dateTimeIssued', 'DateTimeIssued', 'Date']) || new Date().toISOString(),
                extraDiscountAmount: Number(getValue(header, ['extraDiscountAmount', 'ExtraDiscountAmount']) || 0)
            };

            // Run Calculations
            const result = calculateInvoice(invHeader, invoiceLines);
            // Run Validation
            const validation = validateInvoice(invHeader, invoiceLines);

            invoices.push({
                ...result,
                success: validation.isValid,
                errors: validation.errors,
                internalId: String(internalId)
            });
        }

        res.json({ success: true, invoices });
    } catch (error: any) {
        console.error('[Excel Calc]', error);
        res.status(500).json({ success: false, message: 'Calculation failed', error: error.message });
    }
});

// 3. Submit Invoices (Sign & Send)
// ============================================
// EXTERNAL MODULE ROUTES
// ============================================
app.use('/api/leads', leadRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/auth', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/eta', etaRoutes);
app.use('/api/signing', signingRoutes);
app.use('/api/reconciliation', reconciliationRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/master-data', masterDataRoutes);

console.log('[Server] External routes (Leads, Admin, Auth, AuthFlow, SuperAdmin, ETA, Signing, Reconciliation, Assistant, MasterData) registered.');

// ============================================
// OLD LOGIN ENDPOINT (LEGACY - Keep for backward compatibility)
// ============================================
// Login Endpoint
// Login Endpoint
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        // First, get the user by username only
        const query = `
      SELECT id, username, password, hwid, "isValid", "isDemo", "registerDate", "expiryDate", "configHash"
      FROM "otaxdb".credentials
      WHERE username = $1
    `;
        const result = await pool.query(query, [username]);

        if (result.rows.length > 0) {
            const user = result.rows[0];

            // Check if user is active
            if (user.isValid === false) {
                return res.status(403).json({ success: false, message: 'Account is disabled' });
            }

            // Check password - support both plain text (old) and bcrypt (new)
            let isValidPassword = false;

            // Check if password is hashed (bcrypt hashes start with $2a$, $2b$, or $2y$)
            if (user.password && user.password.startsWith('$2')) {
                // Use bcrypt for hashed passwords
                const bcrypt = await import('bcryptjs');
                isValidPassword = await bcrypt.default.compare(password, user.password);
            } else {
                // Plain text comparison for old users
                isValidPassword = user.password === password;
            }

            if (!isValidPassword) {
                return res.status(401).json({ success: false, message: 'Invalid username or password' });
            }

            // Fetch user specific info from clients_info_new using the UID (which is the credits.id)
            const infoQuery = `SELECT property_name, property_value, "nonAdminEdit", modify_date FROM "otaxdb".clients_info_new WHERE uid = $1`;
            const infoResult = await pool.query(infoQuery, [user.id]);

            res.json({
                success: true,
                user: {
                    id: user.id,
                    username: user.username,
                    hwid: user.hwid,
                    isDemo: user.isDemo,
                    properties: infoResult.rows
                }
            });
        } else {
            res.status(401).json({ success: false, message: 'Invalid username or password' });
        }
    } catch (err: any) {
        console.error('Login Error:', err);
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

// Smart Assistant Endpoint — now mounted via assistantRoutes (below).
// The previous inline handler has been moved to server/routes/assistantRoutes.ts
// and upgraded to use Gemini function-calling over live org data.

// Signup / Setup Endpoint
app.post('/api/signup', async (req, res) => {
    const { username, password, companyData } = req.body;
    const hwid = 'AUTO-' + Math.random().toString(36).substr(2, 9).toUpperCase();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Insert into credentials
        const credQuery = `
      INSERT INTO "otaxdb".credentials(username, password, hwid, "isValid", "isDemo", "registerDate")
VALUES($1, $2, $3, true, false, NOW())
      RETURNING id
    `;
        const credRes = await client.query(credQuery, [username, password, hwid]);
        const uid = credRes.rows[0].id;

        // 2. Insert into clients_info_new (properties)
        // Map companyData to properties
        const properties = [
            { name: 'legal_name', value: companyData.legalName },
            { name: 'tax_id', value: companyData.taxId },
            { name: 'tax_activity', value: companyData.taxActivity },
            { name: 'region', value: companyData.region }
        ];

        for (const prop of properties) {
            await client.query(`
            INSERT INTO "otaxdb".clients_info_new(hwid, uid, property_name, property_value, modify_date)
VALUES($1, $2, $3, $4, NOW())
    `, [hwid, uid, prop.name, prop.value]);
        }

        await client.query('COMMIT');
        res.json({ success: true, hwid });
    } catch (err: any) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ success: false, message: 'Signup failed', error: err.message });
    } finally {
        client.release();
    }
});

// Setup Wizard Endpoint (Full Registration)
app.post('/api/setup', async (req, res) => {
    const formData = req.body;
    const client = await pool.connect();
    // Import Prisma for Lead update
    // Note: We are mixing 'pg' pool and 'prisma' client here depending on the legacy vs new code. 
    // Ideally we should import prisma at top, but dynamic import or localized usage is fine if compatible.
    // For now, let's assume we can query "otaxdb".leads via raw SQL with the existing 'client' connection to avoid mixed ORM issues in this function.

    try {
        await client.query('BEGIN');

        // 1. Create User Credentials
        // Use adminName or adminEmail as username? Let's use adminEmail as unique username
        // and adminName as just a display name property
        const username = formData.adminEmail;
        const password = formData.adminPassword || Math.random().toString(36).slice(-10) + 'A1!';
        const hwid = 'SERVER-SETUP'; // Placeholder

        // Check if user exists
        const checkUser = await client.query('SELECT id FROM "otaxdb".credentials WHERE username = $1', [username]);
        if (checkUser.rows.length > 0) {
            throw new Error('User with this email already exists.');
        }

        const credQuery = `
            INSERT INTO "otaxdb".credentials(username, password, hwid, "isValid", "isDemo", "registerDate")
VALUES($1, $2, $3, true, false, NOW())
            RETURNING id
    `;
        const credRes = await client.query(credQuery, [username, password, hwid]);
        const uid = credRes.rows[0].id;

        // 2. Determine Environment Properties
        const isProd = formData.environment === 'Production';

        // 3. Map all wizard data to properties
        const properties = [

            // Company
            { name: 'issuer_name', value: formData.legalName },
            { name: 'issuer_id', value: formData.taxId },
            { name: 'issuer_activity_code', value: formData.activity },
            { name: 'issuer_region', value: formData.region },

            // Admin Details
            { name: 'admin_full_name', value: formData.adminName },
            { name: 'admin_email', value: formData.adminEmail },
            { name: 'admin_phone', value: formData.adminPhone },
            { name: 'subscription_plan', value: formData.pricingPlan },

            // ETA Config
            { name: 'signer_environment_type', value: isProd ? 'Prod' : 'PreProd' },
            { name: 'signer_token_path', value: formData.signerPath },
            { name: isProd ? 'signer_prodClientId' : 'signer_preProdClientId', value: formData.clientId },
            { name: isProd ? 'signer_prodClientSecret' : 'signer_preProdClientSecret', value: formData.clientSecret },

            // ERP Config
            { name: 'db_type', value: formData.erpType },
            { name: 'db_source_server', value: formData.erpHost }, // Naming convention aligned with Settings
            { name: 'db_source_name', value: formData.erpDb },
            { name: 'db_source_user', value: formData.erpUser },
            { name: 'db_source_password', value: formData.erpPass },

            // Storage & Rules
            { name: 'secondary_log_connection_string', value: formData.logDb }, // Aligned with settings
            { name: 'sync_backlog_days', value: formData.backlogDays },
            { name: 'date_processing_rule', value: formData.dateRule },
            { name: 'pdf_archive_path', value: formData.pdfPath }
        ];

        // 4. Insert Properties
        for (const prop of properties) {
            if (prop.value !== undefined && prop.value !== '') {
                await client.query(`
                    INSERT INTO "otaxdb".clients_info_new(hwid, uid, property_name, property_value, modify_date)
VALUES($1, $2, $3, $4, NOW())
    `, [hwid, uid, prop.name, String(prop.value)]);
            }
        }

        // 5. Update Lead Status (if exists)
        await client.query(`
            UPDATE "otaxdb".leads 
            SET status = 'CONVERTED', updated_at = NOW() 
            WHERE email = $1
    `, [formData.adminEmail]);

        await client.query('COMMIT');

        // 6. Auto-sync ETA invoices if clientId and clientSecret are available
        if (formData.clientId && formData.clientSecret) {
            const isProd = formData.environment === 'Production';
            const syncEnv = isProd ? 'Prod' : 'PreProd';
            const syncTaxId = formData.taxId || '';
            console.log(`[Setup] Auto-triggering ETA sync for new user ${uid} (${syncEnv})`);
            setTimeout(() => {
                getAllETADocuments(String(uid), formData.clientId, formData.clientSecret, syncEnv, syncTaxId, uid).catch(console.error);
            }, 100);
        }

        res.json({ success: true, uid, message: 'Setup completed successfully' });

    } catch (err: any) {
        await client.query('ROLLBACK');
        console.error('[Setup Error]', err);
        res.status(500).json({ success: false, message: err.message || 'Setup failed' });
    } finally {
        client.release();
    }
});



// Helper to sign invoice using Windows Certificate Store (Same as ETA Portal)
async function signInvoice(invoiceJson: any, certificateThumbprint: string, pin?: string): Promise<any> {
    const tempSerialized = path.join(__dirname, `temp_serialized_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`);
    const tempOutput = path.join(__dirname, `temp_signature_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`);

    // Path to the C# BouncyCastle signer
    const signerPath = path.join(__dirname, '..', 'EtaSigner', 'bin', 'Release', 'net6.0', 'EtaSigner.exe');

    // Canonicalized content for signing (ETA requires canonicalization)
    const serialized = serializeInvoice(invoiceJson);
    console.log(`[Signer] Serialized content length: ${serialized.length} `);
    console.log(`[Signer] Serialized prefix: ${serialized.substring(0, 100)}...`);

    // CRITICAL: Log SHA-256 hash of serialized content for verification
    const serializedBuffer = Buffer.from(serialized, 'utf8');
    const serializedHash = crypto.createHash('sha256').update(serializedBuffer).digest('hex');
    console.log(`[Signer] Serialized SHA - 256: ${serializedHash} `);
    console.log(`[Signer] Serialized UTF - 8 bytes: ${serializedBuffer.length} `);

    // CRITICAL: Check certificate.
    const LOCALHOST_THUMBPRINT = "5B91039210BBAADFA128ACAB11F9510F6F64EEAF";
    const OPERATIVES_TOKEN = "4D57D4B2A434E71665118691C0D04A830812D3A2";

    if (!certificateThumbprint || certificateThumbprint.length < 10 || certificateThumbprint.toUpperCase() === LOCALHOST_THUMBPRINT) {
        console.warn(`[Signer Warning] Localhost or missing thumbprint detected.Switching to OPERATIVES token.`);
        certificateThumbprint = OPERATIVES_TOKEN;
    }

    try {
        // CRITICAL FIX: Write explicit UTF-8 buffer to ensure exact bytes
        await fsPromises.writeFile(tempSerialized, serializedBuffer);

        // Use hardware token signer via Windows CNG
        const issuerName = "MCDR CA 2022";  // User's actual certificate issuer
        const command = pin
            ? `"${signerPath}" "${issuerName}" "${tempSerialized}" "${tempOutput}" "${pin}"`
            : `"${signerPath}" "${issuerName}" "${tempSerialized}" "${tempOutput}"`;

        console.log(`[Signing] Using Hardware Token Signer(Issuer: ${issuerName})`);

        const { stdout, stderr } = await execPromise(command);

        // Log any info/success messages from C# signer
        if (stdout) {
            const lines = stdout.split('\n');
            lines.forEach(line => {
                if (line.includes('INFO:') || line.includes('SUCCESS:')) {
                    console.log(`[Signer] ${line.trim()} `);
                }
            });
        }

        // Parse signature from output
        let signatureValue = '';
        if (stdout.includes('SIGNATURE:')) {
            const parts = stdout.split('SIGNATURE:');
            signatureValue = parts[parts.length - 1].trim();
        } else {
            // Try reading from output file
            try {
                signatureValue = (await fsPromises.readFile(tempOutput, 'utf8')).trim();
            } catch (e) {
                throw new Error(`Failed to extract signature: ${stdout} `);
            }
        }

        if (!signatureValue || signatureValue.length < 100) {
            throw new Error(`Invalid signature received: ${stdout} `);
        }

        // Log signature info
        const sigBytes = Math.round(signatureValue.length * 0.75);
        console.log(`[Signer] Detached CAdES - BES signature created: ${signatureValue.length} chars(${sigBytes} bytes)`);

        // Detached signatures should be 2-4KB typically
        if (signatureValue.length > 8000) {
            console.warn(`[Signer Warning] Signature is large(${signatureValue.length} chars).Might still be attached!`);
        } else {
            console.log(`[Signer Success] ✓ Signature size is appropriate for detached CAdES - BES`);
        }

        // Add signature to the invoice JSON
        const signedInvoiceJson = {
            ...invoiceJson,
            signatures: [
                {
                    signatureType: "I",
                    value: signatureValue
                }
            ]
        };

        console.log('[Signer] ✓ Returning signed JSON document with detached CAdES-BES signature');
        return signedInvoiceJson;

    } catch (err: any) {
        console.error('[Signer Error]', err);
        throw new Error(`Invoice signing failed: ${err.message} `);
    } finally {
        // Clean up temp files
        try {
            await fsPromises.unlink(tempSerialized);
            await fsPromises.unlink(tempOutput);
        } catch (cleanupErr) {
            // Ignore cleanup errors
        }
    }
}

/**
 * Sign invoice using WebSocket connection to eSign token
 * This is the CORRECT approach that produces valid 4096-byte detached CAdES-BES signatures
 * 
 * Requires: ETAHttpSignature WebSocket server running on port 18088
 * GitHub: https://github.com/mrkindy/ETAHttpSignature
 */
async function signInvoiceViaWebSocket(
    invoiceJson: any,
    tokenCertificate: string = 'Egypt Trust Sealing CA',
    password: string = ''
): Promise<any> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket('ws://localhost:18088');

        // Serialize the invoice (without signature)
        const serialized = serializeInvoice(invoiceJson);

        console.log(`[WebSocket Signer] Connecting to signing server...`);
        console.log(`[WebSocket Signer]Certificate: ${tokenCertificate} `);
        console.log(`[WebSocket Signer] Serialized length: ${serialized.length} chars`);

        // Calculate hash for verification
        const serializedBuffer = Buffer.from(serialized, 'utf8');
        const serializedHash = crypto.createHash('sha256').update(serializedBuffer).digest('hex');
        console.log(`[WebSocket Signer] Serialized SHA - 256: ${serializedHash} `);

        ws.on('open', () => {
            console.log('[WebSocket Signer] ✓ Connected to signing server');

            const request = {
                Type: "SIGN_DOCUMENT",
                Driver: "ePass2003",
                Document: serialized,
                TokenCertificate: tokenCertificate,
                Password: password
            };

            console.log('[WebSocket Signer] Sending document for signing...');
            ws.send(JSON.stringify(request));
        });

        ws.on('message', (data: Buffer) => {
            try {
                const response = JSON.parse(data.toString());

                // Check for errors
                const errorCodes = ['NO_SOLTS_FOUND', 'PASSWORD_INVAILD', 'CERTIFICATE_NOT_FOUND', 'NO_DEVICE_DETECTED'];

                if (!response.cades || errorCodes.includes(response.cades)) {
                    console.error(`[WebSocket Signer] ✗ Signing failed: ${response.cades} `);
                    ws.close();
                    reject(new Error(`eSign token error: ${response.cades} `));
                    return;
                }

                // Success!
                const signatureLength = response.cades.length;
                const signatureBytes = Math.round(signatureLength * 0.75); // base64 to bytes

                console.log(`[WebSocket Signer] ✓ Signature received!`);
                console.log(`[WebSocket Signer] Signature length: ${signatureLength} chars(${signatureBytes} bytes)`);

                // Verify signature size (should be ~4096 bytes for valid detached CAdES-BES)
                if (signatureBytes < 3000) {
                    console.warn(`[WebSocket Signer] ⚠ Warning: Signature seems small(${signatureBytes} bytes)`);
                    console.warn(`[WebSocket Signer]Expected: ~4096 bytes for valid detached signature`);
                } else {
                    console.log(`[WebSocket Signer] ✓ Signature size looks correct(~4096 bytes)`);
                }

                const signedInvoice = {
                    ...invoiceJson,
                    signatures: [{
                        signatureType: "I",
                        value: response.cades
                    }]
                };

                console.log('[WebSocket Signer] ✓ Invoice signed successfully with eSign token');
                ws.close();
                resolve(signedInvoice);

            } catch (err: any) {
                console.error('[WebSocket Signer] ✗ Error parsing response:', err.message);
                ws.close();
                reject(err);
            }
        });

        ws.on('error', (err) => {
            console.error('[WebSocket Signer] ✗ WebSocket error:', err.message);
            console.error('[WebSocket Signer] Make sure ETAHttpSignature server is running on port 18088');
            reject(new Error(`WebSocket connection failed: ${err.message} `));
        });

        ws.on('close', () => {
            console.log('[WebSocket Signer] Connection closed');
        });

        // Timeout after 30 seconds
        setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                console.error('[WebSocket Signer] ✗ Signing timeout (30s)');
                ws.close();
                reject(new Error('Signing timeout - eSign token did not respond'));
            }
        }, 30000);
    });
}

/**
 * Helper to sign receipt batch using the Windows Signer tool
 */
async function signReceiptBatch(batchJson: any, certificateThumbprint: string, pin?: string): Promise<any> {
    const tempSerialized = path.join(__dirname, `temp_serialized_batch_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`);
    const tempOutput = path.join(__dirname, `temp_signature_batch_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`);

    const signerPath = path.join(__dirname, '..', 'EtaSigner', 'bin', 'Release', 'net6.0', 'EtaSigner.exe');

    // Canonicalize the ENTIRE batch for e-Receipt signing
    const serialized = serializeReceiptBatch(batchJson);

    // Enforce valid thumbprint
    const CORRECT_THUMBPRINT = "4D57D4B2A434E71665118691C0D04A830812D3A2";
    if (!certificateThumbprint || certificateThumbprint.length < 10) {
        certificateThumbprint = CORRECT_THUMBPRINT;
    }

    try {
        await fsPromises.writeFile(tempSerialized, serialized, 'utf8');

        const command = pin
            ? `\"${signerPath}\" \"${certificateThumbprint}\" \"${tempSerialized}\" \"${tempOutput}\" \"${pin}\"`
            : `\"${signerPath}\" \"${certificateThumbprint}\" \"${tempSerialized}\" \"${tempOutput}\"`;

        console.log(`[Receipt Signer] Signing batch with ${batchJson.receipts.length} receipts...`);
        const { stdout } = await execPromise(command);

        // Parse result...
        const signature = (await fsPromises.readFile(tempOutput, 'utf8')).trim();

        // Clean up
        await fsPromises.unlink(tempSerialized);
        await fsPromises.unlink(tempOutput);

        if (!signature) throw new Error('Failed to generate batch signature');

        // Add signature to the batch JSON structure
        const signedBatch = {
            ...batchJson,
            signatures: [
                {
                    signatureType: "I",
                    value: signature
                }
            ]
        };

        return signedBatch;

    } catch (err: any) {
        console.error('[Receipt Signer Error]', err);
        throw new Error(`Receipt batch signing failed: ${err.message}`);
    } finally {
        try {
            await fsPromises.unlink(tempSerialized);
            await fsPromises.unlink(tempOutput);
        } catch (e) { }
    }
}

// Helper to build complete ETA document format
// Helper to build complete ETA document format (Moved to etaBuilder.ts)

// List Certificates Endpoint (Using certutil - Better for Smart Cards/Tokens)
app.get('/api/signer/list-certs', async (req, res) => {
    try {
        const certs = await listCertificatesViaCertutil();
        res.json({ success: true, certificates: certs });


    } catch (err: any) {
        console.error('[List Client Certs Error]', err);
        res.status(500).json({ success: false, message: err.message });
    }
});



// Test Signer Tool Endpoint
app.post('/api/signer/test', async (req, res) => {
    const userId = req.headers['x-user-id'] as string;

    try {
        let signerPath = req.body.path;

        // If path not provided in body, try to get from user config
        if (!signerPath && userId) {
            const client = await pool.connect();
            try {
                const infoQuery = `SELECT property_value FROM "otaxdb".clients_info_new WHERE uid = $1 AND property_name = 'signer_token_path'`;
                const result = await client.query(infoQuery, [userId]);
                if (result.rows.length > 0) {
                    signerPath = (result.rows[0] as any).property_value;
                }
            } finally {
                client.release();
            }
        }

        if (!signerPath) {
            return res.status(400).json({ success: false, message: 'Signer path is missing' });
        }

        // 1. Check if file exists
        try {
            await fsPromises.access(signerPath);
        } catch (err: any) {
            console.error(`Status check failed for: ${signerPath}`, err);
            // Distinguish between Not Found (ENOENT) and Permission Denied (EACCES)
            if (err.code === 'ENOENT') {
                return res.status(200).json({ success: false, message: 'File not found at specified path. Please double check the path.' });
            } else if (err.code === 'EACCES') {
                return res.status(200).json({ success: false, message: 'Permission denied. Server cannot access this file.' });
            }
            return res.status(200).json({ success: false, message: `Access error: ${err.message}` });
        }

        // 2. Try to get stats
        try {
            const stats = await fsPromises.stat(signerPath);
            res.json({
                success: true,
                message: 'Signer tool found and accessible',
                details: {
                    size: stats.size,
                    created: stats.birthtime,
                    modified: stats.mtime
                }
            });
        } catch (err: any) {
            return res.status(200).json({ success: false, message: `Stats error: ${err.message}` });
        }

    } catch (err: any) {
        console.error('[Signer Test Error]', err);
        // Always return 200 with error message to avoid "Network Error" on frontend fetch catch
        res.status(200).json({ success: false, message: `Server Error: ${err.message}` });
    }
});

// ETA Portal Helper Functions
const getETAHosts = (env: string) => {
    const isProd = env === 'Prod';
    return {
        id: isProd ? 'https://id.eta.gov.eg' : 'https://id.preprod.eta.gov.eg',
        api: isProd ? 'https://api.invoicing.eta.gov.eg' : 'https://api.preprod.invoicing.eta.gov.eg'
    };
};

const getETAToken = async (clientId: string, clientSecret: string, env: string) => {
    try {
        const hosts = getETAHosts(env);
        console.log(`[ETA Auth] Attempting token for CID: ${clientId.substring(0, 6)}... on ${env}`);
        console.log(`[ETA Auth DEBUG] Environment: ${env}`);
        console.log(`[ETA Auth DEBUG] ClientID Full: ${clientId}`);
        console.log(`[ETA Auth DEBUG] Secret First 5: ${clientSecret ? clientSecret.substring(0, 5) : 'UNDEFINED'}...`);
        const response = await axios.post(
            `${hosts.id}/connect/token`,
            new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: clientId,
                client_secret: clientSecret,
                scope: 'InvoicingAPI'
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        return response.data.access_token;
    } catch (err: any) {
        console.error('ETA Auth Error:', err.response?.data || err.message);
        throw new Error(`Failed to authenticate with ETA Portal. Used: Env=${env}, ID=${clientId}, Secret=${clientSecret?.substring(0, 5)}... DETAILS: ${JSON.stringify(err.response?.data || err.message)}`);
    }
};

// In-memory cache for sync progress and data
const syncCache: Record<string, {
    total: number, valid: number, rejected: number, invalid: number, cancelled: number, submitted: number,
    isSyncing: boolean,
    status?: string,
    env?: string,
    docs: any[],
    monitorStarted?: boolean,
    monitorIntervalId?: ReturnType<typeof setInterval>,
}> = {};

const getAllETADocuments = async (userId: string, clientId: string, clientSecret: string, env: string, taxId: string, credentialId?: number) => {
    try {
        const hosts = getETAHosts(env);
        // Initialize or reset cache
        if (!syncCache[userId]) {
            syncCache[userId] = { total: 0, valid: 0, rejected: 0, invalid: 0, cancelled: 0, submitted: 0, isSyncing: true, status: 'Starting', env: env, docs: [] };
        } else {
            syncCache[userId].isSyncing = true;
            syncCache[userId].status = 'Starting';
            syncCache[userId].env = env; // Update env
        }

        // === START CONTINUOUS MONITORING (POLLING) IMMEDIATELY ===
        if (!syncCache[userId].monitorStarted) {
            syncCache[userId].monitorStarted = true;
            console.log(`[ETA] Starting Live Monitor for User ${userId}`);

            // Poll every 10 seconds for new invoices (Forward Sync)
            syncCache[userId].monitorIntervalId = setInterval(async () => {
                try {
                    // Guard: if cache was deleted (env switch), stop this monitor
                    if (!syncCache[userId] || !syncCache[userId].docs) {
                        return;
                    }

                    // Monitor Window: Look back 10 mins to Capture delayed indexing
                    const monitorEnd = new Date();
                    const monitorStart = new Date(monitorEnd);
                    monitorStart.setMinutes(monitorStart.getMinutes() - 10);

                    const mFrom = monitorStart.toISOString().split('.')[0] + 'Z';
                    const mTo = monitorEnd.toISOString().split('.')[0] + 'Z';

                    // Refresh Token specifically for this poll
                    const freshToken = await getETAToken(clientId, clientSecret, env);

                    const response = await axios.get(`${hosts.api}/api/v1.0/documents/search`, {
                        headers: { 'Authorization': `Bearer ${freshToken}` },
                        params: {
                            pageSize: '50',
                            pageNo: '1',
                            submissionDateFrom: mFrom,
                            submissionDateTo: mTo
                        }
                    });

                    const result = response.data.result || [];
                    if (result.length > 0 && syncCache[userId]?.docs) {
                        result.forEach((d: any) => {
                            if (!syncCache[userId]?.docs) return;
                            // Deduplicate
                            if (syncCache[userId].docs.some(existing => existing.id === d.uuid)) return;

                            // Add new doc
                            syncCache[userId].total++;
                            const st = d.status;
                            if (st === 'Valid') syncCache[userId].valid++;
                            else if (st === 'Rejected') syncCache[userId].rejected++;
                            else if (st === 'Invalid') syncCache[userId].invalid++;
                            else if (st === 'Cancelled') syncCache[userId].cancelled++;
                            else if (st === 'Submitted') syncCache[userId].submitted++;

                            const getValue = (obj: any, key: string) => {
                                if (!obj) return undefined;
                                const foundKey = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
                                return foundKey ? obj[foundKey] : undefined;
                            };

                            const rawType = getValue(d, 'documentType') || getValue(d, 'typeName') || 'I';
                            let normalizedType = 'I';
                            const rt = String(rawType).toUpperCase();
                            if (rt.startsWith('C') || rt.includes('CREDIT')) normalizedType = 'C';
                            else if (rt.startsWith('D') || rt.includes('DEBIT')) normalizedType = 'D';

                            const direction = getValue(d, 'issuerId') === taxId ? 'Sent' : 'Received';

                            syncCache[userId].docs.push({
                                id: getValue(d, 'uuid'),
                                type: normalizedType,
                                direction: direction,
                                internalId: getValue(d, 'internalId') || getValue(d, 'uuid')?.slice(0, 8),
                                receiverName: getValue(d, 'receiverName') || 'N/A',
                                receiverId: getValue(d, 'receiverId') || 'N/A',
                                date: getValue(d, 'dateTimeIssued'),
                                total: getValue(d, 'totalAmount') || getValue(d, 'totalSalesAmount') || getValue(d, 'total') || 0,
                                currency: 'EGP',
                                status: getValue(d, 'status'),
                                errorCode: getValue(d, 'status') === 'Invalid' ? '4105' : undefined
                            });

                            console.log(`[ETA Monitor] New Invoice Found: ${getValue(d, 'internalId')}`);
                        });
                    }
                } catch (monitorErr: any) {
                    // Silent error log
                }
            }, 10000);
        }

        // Initial Token
        let token = await getETAToken(clientId, clientSecret, env);

        // Start 10 minutes ago to avoid ETA "future date" validation errors if server time drifts
        const endDate = new Date(Date.now() - 5 * 60 * 1000);
        let currentEnd = new Date(endDate);
        const limitDate = new Date('2020-01-01T00:00:00Z');

        console.log(`[ETA] Global Sync Started for User ${userId} (from ${currentEnd.toISOString()} back to 2020)...`);

        while (currentEnd > limitDate) {
            let currentStart = new Date(currentEnd);
            currentStart.setDate(currentStart.getDate() - 30);
            if (currentStart < limitDate) currentStart = limitDate;

            const fromStr = currentStart.toISOString().split('.')[0] + 'Z';
            const toStr = currentEnd.toISOString().split('.')[0] + 'Z';

            console.log(`[ETA] Syncing chunk: ${fromStr} to ${toStr}`);

            let retryCount = 0;
            const maxRetries = 3;
            let success = false;

            while (retryCount < maxRetries && !success) {
                try {
                    let pageNo = 1;
                    let totalPages = 1;

                    do {
                        const response = await axios.get(`${hosts.api}/api/v1.0/documents/search`, {
                            headers: { 'Authorization': `Bearer ${token}` },
                            params: {
                                pageSize: '50',
                                pageNo: pageNo.toString(),
                                submissionDateFrom: fromStr,
                                submissionDateTo: toStr
                            }
                        });

                        const result = response.data.result || [];
                        const metadata = response.data.metadata;
                        totalPages = metadata?.totalPages || 1;

                        if (result.length > 0) {
                            // Process each doc and save to DB
                            for (const d of result) {
                                // Deduplicate cache
                                if (!syncCache[userId]?.docs?.some(existing => existing.id === d.uuid)) {
                                    if (!syncCache[userId]) continue; // Guard: cache was deleted
                                    syncCache[userId].total++;
                                    const st = d.status;
                                    if (st === 'Valid') syncCache[userId].valid++;
                                    else if (st === 'Rejected') syncCache[userId].rejected++;
                                    else if (st === 'Invalid') syncCache[userId].invalid++;
                                    else if (st === 'Cancelled') syncCache[userId].cancelled++;
                                    else if (st === 'Submitted') syncCache[userId].submitted++;

                                    const getValue = (obj: any, key: string) => {
                                        if (!obj) return undefined;
                                        const foundKey = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
                                        return foundKey ? obj[foundKey] : undefined;
                                    };

                                    const rawType = getValue(d, 'documentType') || getValue(d, 'typeName') || 'I';
                                    let normalizedType = 'I';
                                    const rt = String(rawType).toUpperCase();
                                    if (rt.startsWith('C') || rt.includes('CREDIT')) normalizedType = 'C';
                                    else if (rt.startsWith('D') || rt.includes('DEBIT')) normalizedType = 'D';

                                    const direction = getValue(d, 'issuerId') === taxId ? 'Sent' : 'Received';

                                    syncCache[userId].docs.push({
                                        id: getValue(d, 'uuid'),
                                        type: normalizedType,
                                        direction: direction,
                                        internalId: getValue(d, 'internalId') || getValue(d, 'uuid')?.slice(0, 8),
                                        receiverName: getValue(d, 'receiverName') || 'N/A',
                                        receiverId: getValue(d, 'receiverId') || 'N/A',
                                        date: getValue(d, 'dateTimeIssued'),
                                        total: getValue(d, 'totalAmount') || getValue(d, 'totalSalesAmount') || getValue(d, 'total') || getValue(d, 'totalSales') || 0,
                                        currency: 'EGP',
                                        status: getValue(d, 'status'),
                                        errorCode: getValue(d, 'status') === 'Invalid' ? '4105' : undefined
                                    });

                                    console.log(`[ETA Monitor] New Invoice Found: ${getValue(d, 'internalId')}`);
                                }

                                // === DB UPSERT for PERSISTENCE ===
                                try {
                                    const uuid = d.uuid;
                                    const status = d.status;
                                    const updateRes = await pool.query('UPDATE public.documents SET status = $1 WHERE uuid = $2 AND (credential_id = $3 OR credential_id IS NULL)', [status, uuid, credentialId || null]);

                                    if (updateRes.rowCount === 0) {
                                        // Insert
                                        await pool.query(`
                                            INSERT INTO public.documents (
                                                uuid, "submissionId", "internalId", submitted, "typeName", "issuerId", "issuerName", 
                                                "receiverId", "receiverName", "dateTimeIssued", "totalSales", "totalDiscount", "netAmount", total, 
                                                status, environment, credential_id
                                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                                        `, [
                                            uuid,
                                            d.submissionUUID || d.submissionId,
                                            d.internalId,
                                            true,
                                            d.documentType,
                                            d.issuerId,
                                            d.issuerName,
                                            d.receiverId,
                                            d.receiverName,
                                            d.dateTimeIssued,
                                            d.totalSalesAmount || 0,
                                            d.totalDiscountAmount || 0,
                                            d.netAmount || 0,
                                            d.totalAmount || d.total || 0,
                                            status,
                                            env,
                                            credentialId || null
                                        ]);
                                        // console.log(`[DB Sync] Inserted ${d.internalId}`);
                                    }
                                } catch (err) {
                                    // console.error(`[DB Sync Error] ${d.internalId}`, err); 
                                    // Squelch duplicate errors if race condition
                                }
                            }
                        }
                        pageNo++;
                    } while (pageNo <= totalPages);
                    success = true;

                } catch (chunkErr: any) {
                    const status = chunkErr.response?.status;
                    if (status === 401) {
                        console.warn(`[ETA] Token expired for User ${userId}. Refreshing...`);
                        try {
                            token = await getETAToken(clientId, clientSecret, env);
                            retryCount++;
                            continue; // Retry immediately with new token
                        } catch (authErr) {
                            console.error(`[ETA] Critical: Failed to refresh token. Stopping sync.`, authErr);
                            throw authErr; // Stop entire sync
                        }
                    } else if (status === 429) {
                        console.warn(`[ETA] Rate limit hit. Waiting 10s...`);
                        await new Promise(r => setTimeout(r, 10000));
                        retryCount++;
                    } else {
                        console.error(`[ETA] Error in chunk ${fromStr} (Attempt ${retryCount + 1}):`, chunkErr.response?.data || chunkErr.message);
                        retryCount++;
                        await new Promise(r => setTimeout(r, 2000)); // Small backoff
                    }
                }
            }

            if (!success) {
                console.error(`[ETA] Failed to sync chunk ${fromStr} after ${maxRetries} attempts. Skipping.`);
            }

            currentEnd = currentStart;
        }

        console.log(`[ETA] Historical Sync Completed for User ${userId}. Total Docs: ${syncCache[userId].total}`);
        syncCache[userId].status = 'Live Monitor';
        syncCache[userId].isSyncing = false;



    } catch (err: any) {
        console.error('ETA Sync Fatal Error:', err.message);
        if (syncCache[userId]) syncCache[userId].isSyncing = false;
    }
};


/**
 * Helper: Get the company-specific table name for a userId
 */
async function getCompanyTableName(userId: string): Promise<string | null> {
    try {
        const credResult = await pool.query(
            `SELECT id, username FROM "otaxdb".credentials WHERE id = $1`,
            [parseInt(userId)]
        );
        if (credResult.rows.length === 0) return null;
        const { id, username } = credResult.rows[0];
        const safeName = (username || 'unknown').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().substring(0, 30);
        const tableName = `company_${id}_${safeName}_documents`;

        // Check if table exists
        const tableCheck = await pool.query(
            `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)`,
            [tableName]
        );
        if (tableCheck.rows[0].exists) return tableName;
        return null;
    } catch (err) {
        return null;
    }
}

// Dashboard Summary API
//
// Per-org isolation contract:
//   1. The caller's org is resolved from the JWT (preferred) or X-User-ID
//      header → portal_users / credentials → organization_id. Super admins can
//      override the scope via ?orgId=NN.
//   2. The in-memory ETA sync cache is keyed by `${userId}:${orgId}` so a user
//      switching orgs can never see another org's data, and a super admin who
//      flips the org scope query param gets a fresh background sync.
//   3. Documents are read from `InvoicesDb."org_<id>_<slug>_documents"` only —
//      the legacy per-user `clients_info_new` and `company_<uid>_*_documents`
//      paths are no longer consulted (those predated multi-tenancy).
app.get('/api/dashboard/summary', async (req, res) => {
    const period = ((req.query.period as string) || '7days').trim().toLowerCase();
    res.setHeader('Cache-Control', 'no-store');

    // Stable shape we return whenever the user has no org / no creds / a
    // crash hits — keeps the dashboard from blank-flashing.
    const safeEmpty = {
        success: true,
        isMock: true,
        summary: { total: '0', sent: '0', received: '0', valid: '0', invalid: '0', rejected: '0', cancelled: '0', submitted: '0', accuracy: 0 },
        kpis: [
            { label: 'Total Invoices', value: '0', trend: 0, icon: 'FileText' },
            { label: 'Sent',           value: '0', trend: 0, icon: 'Upload' },
            { label: 'Received',       value: '0', trend: 0, icon: 'Download' },
            { label: 'Valid',          value: '0', trend: 0, icon: 'CheckCircle' },
            { label: 'Invalid',        value: '0', trend: 0, icon: 'XCircle' },
            { label: 'Cancelled',      value: '0', trend: 0, icon: 'AlertCircle' },
            { label: 'Rejected',       value: '0', trend: 0, icon: 'XCircle' },
            { label: 'Submitted',      value: '0', trend: 0, icon: 'AlertCircle' },
        ],
        chartData: [],
        pieData: [],
    };

    try {
        // ── Step 1: Resolve userId from JWT (preferred) or X-User-ID fallback ──
        let userId: number | null = null;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            try {
                const jwt = await import('jsonwebtoken');
                const decoded = jwt.default.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production') as any;
                userId = Number(decoded.userId);
            } catch { /* invalid/expired token — fall through to header */ }
        }
        if (!userId) userId = parseInt(String(req.headers['x-user-id'] || '')) || null;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        // ── Step 2: Resolve the org we're scoping to ──
        let isSuperAdmin = false;
        try {
            const sa = await pool.query(
                `SELECT 1 FROM "otaxdb".super_admins WHERE id = $1 AND is_active = TRUE LIMIT 1`,
                [userId]
            );
            isSuperAdmin = sa.rows.length > 0;
        } catch { /* table may not exist — treat as non-super */ }

        let orgId: number | null = null;
        // Super admins can scope to any org via ?orgId=
        if (isSuperAdmin && req.query.orgId) {
            orgId = parseInt(String(req.query.orgId)) || null;
        }
        // portal_users (SaaS path)
        if (!orgId) {
            const r = await pool.query(
                `SELECT organization_id FROM "otaxdb".portal_users WHERE id = $1 LIMIT 1`,
                [userId]
            ).catch(() => ({ rows: [] }) as any);
            orgId = r.rows[0]?.organization_id || null;
        }
        // legacy credentials.organization_id (auto-resolved by /auth/login)
        if (!orgId) {
            const r = await pool.query(
                `SELECT organization_id FROM "otaxdb".credentials WHERE id = $1 LIMIT 1`,
                [userId]
            ).catch(() => ({ rows: [] }) as any);
            orgId = r.rows[0]?.organization_id || null;
        }
        if (!orgId) {
            // No org context at all → render an empty dashboard rather than 500.
            console.log(`[Dashboard] User ${userId} has no organization scope.`);
            return res.json(safeEmpty);
        }

        // ── Step 3: Look up the org row for table name + tax_id ──
        const orgRow = await pool.query(
            `SELECT name, tax_id FROM "otaxdb".organizations WHERE id = $1 LIMIT 1`,
            [orgId]
        );
        if (orgRow.rows.length === 0) return res.json(safeEmpty);
        const orgName = orgRow.rows[0].name || '';
        const orgTaxId = orgRow.rows[0].tax_id || '';

        // Cache key includes orgId so cross-org reads can never collide.
        const cacheKey = `${userId}:${orgId}`;
        console.log(`[Dashboard Path] user=${userId} org=${orgId} period="${period}"`);

        // ── Step 4: Spin up background ETA sync if creds are configured ──
        if (!syncCache[cacheKey]) {
            const credsRes = await pool.query(
                `SELECT eta_environment,
                        eta_preprod_client_id, eta_preprod_client_secret,
                        eta_prod_client_id,    eta_prod_client_secret,
                        eta_tax_id
                   FROM "otaxdb".organization_settings
                  WHERE organization_id = $1 LIMIT 1`,
                [orgId]
            ).catch(() => ({ rows: [] }) as any);

            if (credsRes.rows.length > 0) {
                const row = credsRes.rows[0];
                const env = row.eta_environment || 'PreProd';
                const clientId     = env === 'Prod' ? row.eta_prod_client_id     : row.eta_preprod_client_id;
                const clientSecret = env === 'Prod' ? row.eta_prod_client_secret : row.eta_preprod_client_secret;
                const credTaxId    = row.eta_tax_id || orgTaxId;

                if (clientId && clientSecret) {
                    // Env switch — clear stale cache for this user+org pair.
                    if (syncCache[cacheKey] && syncCache[cacheKey].env !== env) {
                        console.log(`[ETA] Env switch detected for ${cacheKey} (${syncCache[cacheKey].env} → ${env}). Clearing cache.`);
                        if (syncCache[cacheKey].monitorIntervalId) clearInterval(syncCache[cacheKey].monitorIntervalId);
                        delete syncCache[cacheKey];
                    }
                    if (!syncCache[cacheKey]) {
                        getAllETADocuments(cacheKey, clientId, clientSecret, env, credTaxId, userId)
                            .catch(err => console.error('[Dashboard] Background sync error:', err));
                    }
                }
                // No creds yet → fall through to the InvoicesDb read; the user
                // may still have historical data that was synced previously.
            }
        }

        // ── Step 5: Read docs from the per-org InvoicesDb table ──
        const data = syncCache[cacheKey] || { total: 0, valid: 0, rejected: 0, invalid: 0, cancelled: 0, submitted: 0, isSyncing: true, docs: [] };
        let docs = data.docs || [];

        if (docs.length === 0) {
            try {
                const tables = getOrgTableNames(orgId, orgName);
                const tableCheck = await pool.query(
                    `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'InvoicesDb' AND table_name = $1) as exists`,
                    [tables.documents]
                );
                if (tableCheck.rows[0]?.exists) {
                    const dbResult = await pool.query(`SELECT * FROM "InvoicesDb"."${tables.documents}" ORDER BY "dateTimeIssued" DESC LIMIT 5000`);
                    docs = dbResult.rows.map((row: any) => {
                        let type = 'I';
                        const tn = (row.typeName || '').toUpperCase();
                        if (tn.startsWith('C') || tn.includes('CREDIT')) type = 'C';
                        else if (tn.startsWith('D') || tn.includes('DEBIT')) type = 'D';
                        const direction = (() => {
                            if (orgTaxId && row.issuerId && row.issuerId === orgTaxId) return 'Sent';
                            if (orgTaxId && row.receiverId && row.receiverId === orgTaxId) return 'Received';
                            if (row.direction) return row.direction;
                            if (orgTaxId && row.issuerId && row.issuerId !== orgTaxId) return 'Received';
                            return 'Sent';
                        })();
                        return {
                            id: row.uuid, type, direction,
                            internalId: row.internalId || 'N/A',
                            receiverName: row.receiverName || 'N/A',
                            date: row.dateTimeIssued,
                            total: parseFloat(row.total || '0'),
                            status: row.status
                        };
                    });
                    console.log(`[Dashboard] org ${orgId}: loaded ${docs.length} docs from InvoicesDb."${tables.documents}"`);
                }
            } catch (orgErr: any) {
                console.warn('[Dashboard] InvoicesDb read failed:', orgErr.message);
            }
        }

        // Filter documents by period FIRST
        let filteredDocs = docs;

        if (period === 'today') {
            const todayStr = new Date().toLocaleDateString('en-CA');
            filteredDocs = docs.filter((d: any) => d.date && new Date(d.date).toLocaleDateString('en-CA') === todayStr);
        } else if (period === '1year' || period === 'yearly') {
            const oneYearAgo = new Date();
            oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
            filteredDocs = docs.filter((d: any) => d.date && new Date(d.date) >= oneYearAgo);
        } else if (period === '30days') {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            filteredDocs = docs.filter((d: any) => new Date(d.date) >= thirtyDaysAgo);
        } else {
            // 7 days default
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            filteredDocs = docs.filter((d: any) => new Date(d.date) >= sevenDaysAgo);
        }

        // ALL TIME status counts (for KPI cards - not affected by filter)
        const allTimeStatusCounts = {
            total: docs.length,
            sent: docs.filter((d: any) => d.direction === 'Sent').length,         // We are the issuer
            received: docs.filter((d: any) => d.direction === 'Received').length, // We are the receiver
            valid: docs.filter((d: any) => d.status === 'Valid').length,
            invalid: docs.filter((d: any) => d.status === 'Invalid').length,
            rejected: docs.filter((d: any) => d.status === 'Rejected').length,
            cancelled: docs.filter((d: any) => d.status === 'Cancelled').length,
            submitted: docs.filter((d: any) => d.status === 'Submitted').length
        };

        // Calculate totals for percentages from FILTERED documents (for charts)
        const totalCount = filteredDocs.length;

        // --- DEBUG CHART DATA ---
        console.log(`[Dashboard Debug] Period: ${period}`);
        console.log(`[Dashboard Debug] Docs in Cache: ${docs.length}`);
        console.log(`[Dashboard Debug] Filtered Count: ${totalCount}`);
        if (totalCount > 0) {
            const sample = filteredDocs[0];
            console.log(`[Debug] Sample Doc: ${sample.internalId} (${sample.date}) -> Local: ${new Date(sample.date).toLocaleDateString('en-CA')}`);
            // Log recent Internal IDs to verify existence
            console.log(`[Debug] IDs in View: ${filteredDocs.slice(0, 50).map((d: any) => d.internalId).join(', ')}`);
        }
        // ------------------------

        // Pie Data (Status) - as PERCENTAGES from FILTERED period
        const statusCounts = {
            valid: filteredDocs.filter((d: any) => d.status === 'Valid').length,
            invalid: filteredDocs.filter((d: any) => d.status === 'Invalid').length,
            rejected: filteredDocs.filter((d: any) => d.status === 'Rejected').length,
            cancelled: filteredDocs.filter((d: any) => d.status === 'Cancelled').length,
            submitted: filteredDocs.filter((d: any) => d.status === 'Submitted').length
        };

        const pieData = [
            { name: 'Valid', value: totalCount > 0 ? Math.round((statusCounts.valid / totalCount) * 100) : 0, color: '#10b981' },
            { name: 'Invalid', value: totalCount > 0 ? Math.round((statusCounts.invalid / totalCount) * 100) : 0, color: '#f43f5e' },
            { name: 'Rejected', value: totalCount > 0 ? Math.round((statusCounts.rejected / totalCount) * 100) : 0, color: '#f59e0b' },
            { name: 'Cancelled', value: totalCount > 0 ? Math.round((statusCounts.cancelled / totalCount) * 100) : 0, color: '#64748b' },
            { name: 'Submitted', value: totalCount > 0 ? Math.round((statusCounts.submitted / totalCount) * 100) : 0, color: '#3b82f6' }
        ].filter(d => d.value > 0);

        // Chart Data (Volume)
        let chartData: any[] = [];
        const now = new Date();

        if (period === 'today') {
            console.log('[Dashboard Path] Executing Hourly Logic');
            const hours = Array.from({ length: 24 }, (_, i) => ({
                label: `${i}:00`,
                val: i
            }));
            chartData = hours.map(h => {
                const count = filteredDocs.filter((d: any) => {
                    if (!d.date) return false;
                    return new Date(d.date).getHours() === h.val;
                }).length;
                return { name: h.label, count };
            });
        } else if (period === '1year' || period === 'yearly') {
            const months = Array.from({ length: 12 }, (_, i) => {
                const d = new Date();
                d.setMonth(d.getMonth() - (11 - i));
                return {
                    monthIndex: d.getMonth(),
                    year: d.getFullYear(),
                    label: d.toLocaleString('en-US', { month: 'short' })
                };
            });

            chartData = months.map(m => {
                const count = docs.filter((d: any) => {
                    const date = new Date(d.date);
                    return date.getFullYear() === m.year && date.getMonth() === m.monthIndex;
                }).length;
                return { name: m.label, count };
            });
        } else if (period === '30days') {
            // Last 30 Days (grouped by day)
            const days = Array.from({ length: 30 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() - (29 - i));
                return {
                    dateStr: d.toLocaleDateString('en-CA'),
                    label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                };
            });

            chartData = days.map(day => {
                const count = filteredDocs.filter((d: any) => {
                    if (!d.date) return false;
                    const docDate = new Date(d.date).toLocaleDateString('en-CA');
                    return docDate === day.dateStr;
                }).length;
                return { name: day.label, count };
            });
        } else {
            console.log('[Dashboard Path] Executing Default 7-Day Logic');
            // 7 Days (default)
            const days = Array.from({ length: 7 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() - (6 - i));
                return {
                    dateStr: d.toLocaleDateString('en-CA'),
                    label: d.toLocaleDateString('en-US', { weekday: 'short' })
                };
            });

            chartData = days.map(day => {
                const count = filteredDocs.filter((d: any) => {
                    if (!d.date) return false;
                    const docDate = new Date(d.date).toLocaleDateString('en-CA');
                    return docDate === day.dateStr;
                }).length;
                return { name: day.label, count };
            });
        }

        res.json({
            success: true,
            isSyncing: data.isSyncing,
            kpis: [
                { label: 'Total Invoices', value: allTimeStatusCounts.total.toLocaleString('en-US'), trend: 0, icon: 'LayoutPanelLeft' },
                { label: 'Sent', value: allTimeStatusCounts.sent.toLocaleString('en-US'), trend: 0, icon: 'Upload' },
                { label: 'Received', value: allTimeStatusCounts.received.toLocaleString('en-US'), trend: 0, icon: 'Download' },
                { label: 'Valid', value: allTimeStatusCounts.valid.toLocaleString('en-US'), trend: 0, icon: 'CheckCircle' },
                { label: 'Invalid', value: allTimeStatusCounts.invalid.toLocaleString('en-US'), trend: 0, icon: 'XCircle' },
                { label: 'Cancelled', value: allTimeStatusCounts.cancelled.toLocaleString('en-US'), trend: 0, icon: 'AlertCircle' },
                { label: 'Rejected', value: allTimeStatusCounts.rejected.toLocaleString('en-US'), trend: 0, icon: 'XCircle' },
                { label: 'Submitted', value: allTimeStatusCounts.submitted.toLocaleString('en-US'), trend: 0, icon: 'AlertCircle' },
            ],
            chartData,
            pieData
        });

    } catch (err: any) {
        // Dashboard is the first thing the user sees after login. A 500 here
        // breaks the whole layout (KPIs disappear, charts crash). Instead we
        // log the underlying issue and return a zero-data payload that lets
        // the rest of the page render gracefully.
        console.error('[Dashboard] Unhandled error, returning safe zeros:', err.message);
        res.json({
            success: true,
            isMock: true,
            degraded: true,
            errorReason: err.message,
            summary: { total: '0', sent: '0', received: '0', valid: '0', invalid: '0', rejected: '0', cancelled: '0', submitted: '0', accuracy: 0 },
            kpis: [
                { label: 'Total Invoices', value: '0', trend: 0, icon: 'FileText' },
                { label: 'Sent', value: '0', trend: 0, icon: 'Upload' },
                { label: 'Received', value: '0', trend: 0, icon: 'Download' },
                { label: 'Valid', value: '0', trend: 0, icon: 'CheckCircle' },
                { label: 'Invalid', value: '0', trend: 0, icon: 'XCircle' },
                { label: 'Cancelled', value: '0', trend: 0, icon: 'AlertCircle' },
                { label: 'Rejected', value: '0', trend: 0, icon: 'XCircle' },
                { label: 'Submitted', value: '0', trend: 0, icon: 'AlertCircle' },
            ],
            chartData: [], pieData: [],
        });
    }
});

// ============================================
// REPORTS API — filtered invoices for Excel export
// ============================================
app.get('/api/reports/invoices', async (req, res) => {
    try {
        // Auth
        let userId: number | null = null;
        let orgId: number | null = null;
        let orgName: string = '';
        let taxId: string = '';

        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            try {
                const jwt = await import('jsonwebtoken');
                const decoded = jwt.default.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production') as any;
                userId = decoded.userId;
            } catch (e) { /* */ }
        }
        if (!userId) userId = parseInt(req.headers['x-user-id'] as string) || null;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        // Get org info + tax_id
        try {
            const portalResult = await pool.query(
                `SELECT pu.organization_id, o.name, o.tax_id FROM "otaxdb".portal_users pu
                 LEFT JOIN "otaxdb".organizations o ON o.id = pu.organization_id
                 WHERE pu.id = $1 LIMIT 1`,
                [userId]
            );
            if (portalResult.rows.length > 0) {
                orgId = portalResult.rows[0].organization_id;
                orgName = portalResult.rows[0].name || '';
                taxId = portalResult.rows[0].tax_id || '';
            }
        } catch (e) { /* */ }

        if (!orgId) return res.json({ success: true, invoices: [] });

        // Get org table names
        const tables = getOrgTableNames(orgId, orgName);

        // Check table exists
        const tableCheck = await pool.query(
            `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'InvoicesDb' AND table_name = $1) as exists`,
            [tables.documents]
        );
        if (!tableCheck.rows[0]?.exists) {
            return res.json({ success: true, invoices: [] });
        }

        // Build filtered query
        const { dateFrom, dateTo, direction, status } = req.query;
        let whereClauses: string[] = [];
        let params: any[] = [];
        let paramIdx = 1;

        if (dateFrom) {
            whereClauses.push(`"dateTimeIssued" >= $${paramIdx}`);
            params.push(dateFrom);
            paramIdx++;
        }
        if (dateTo) {
            whereClauses.push(`"dateTimeIssued" <= $${paramIdx}`);
            params.push(dateTo + 'T23:59:59Z');
            paramIdx++;
        }
        // Direction filter — compute from issuerId vs org taxId
        if (direction && direction !== 'All' && taxId) {
            if (direction === 'Sent') {
                whereClauses.push(`"issuerId" = $${paramIdx}`);
                params.push(taxId);
                paramIdx++;
            } else if (direction === 'Received') {
                whereClauses.push(`"receiverId" = $${paramIdx}`);
                params.push(taxId);
                paramIdx++;
            }
        }
        if (status && status !== 'All') {
            whereClauses.push(`LOWER(status) = LOWER($${paramIdx})`);
            params.push(status);
            paramIdx++;
        }

        const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const result = await pool.query(`
            SELECT uuid, "internalId", "typeName", "typeVersionName", status, direction,
                   "dateTimeIssued", "dateTimeReceived", "issuerId", "issuerName",
                   "receiverId", "receiverName", "totalSales", "totalDiscount",
                   "netAmount", total, currency, environment,
                   "publicUrl", "taxpayerActivityCode", "statusId",
                   "totalItemsDiscountAmount", "extraDiscountAmount",
                   "cancelRequestDate", "rejectRequestDate",
                   "canbeCancelledUntil", "canbeRejectedUntil",
                   "taxTotalsJson"
            FROM "InvoicesDb"."${tables.documents}"
            ${whereSQL}
            ORDER BY "dateTimeIssued" DESC
            LIMIT 10000
        `, params);

        // Compute direction for each invoice
        const invoices = result.rows.map((row: any) => {
            let computedDirection = row.direction || 'Unknown';
            if (taxId) {
                if (row.issuerId === taxId) computedDirection = 'Sent';
                else if (row.receiverId === taxId) computedDirection = 'Received';
            }
            return { ...row, direction: computedDirection };
        });

        res.json({ success: true, invoices });
    } catch (err: any) {
        console.error('[Reports API] Error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================
// TAX ANALYSIS API — aggregated tax breakdown
// ============================================
app.get('/api/reports/tax-summary', async (req, res) => {
    try {
        // Auth (same pattern)
        let userId: number | null = null;
        let orgId: number | null = null;
        let orgName: string = '';
        let taxId: string = '';

        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            try {
                const jwt = await import('jsonwebtoken');
                const decoded = jwt.default.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production') as any;
                userId = decoded.userId;
            } catch (e) { /* */ }
        }
        if (!userId) userId = parseInt(req.headers['x-user-id'] as string) || null;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        try {
            const portalResult = await pool.query(
                `SELECT pu.organization_id, o.name, o.tax_id FROM "otaxdb".portal_users pu
                 LEFT JOIN "otaxdb".organizations o ON o.id = pu.organization_id
                 WHERE pu.id = $1 LIMIT 1`,
                [userId]
            );
            if (portalResult.rows.length > 0) {
                orgId = portalResult.rows[0].organization_id;
                orgName = portalResult.rows[0].name || '';
                taxId = portalResult.rows[0].tax_id || '';
            }
        } catch (e) { /* */ }

        if (!orgId) return res.json({ success: true, taxBreakdown: [], summary: {} });

        const tables = getOrgTableNames(orgId, orgName);

        // Build date filters
        const { dateFrom, dateTo, direction, status } = req.query;
        let docWhereClauses: string[] = [];
        let docParams: any[] = [];
        let paramIdx = 1;

        if (dateFrom) { docWhereClauses.push(`d."dateTimeIssued" >= $${paramIdx}`); docParams.push(dateFrom); paramIdx++; }
        if (dateTo) { docWhereClauses.push(`d."dateTimeIssued" <= $${paramIdx}`); docParams.push(dateTo + 'T23:59:59Z'); paramIdx++; }
        // Direction filter — compute from issuerId vs org taxId
        if (direction && direction !== 'All' && taxId) {
            if (direction === 'Sent') {
                docWhereClauses.push(`d."issuerId" = $${paramIdx}`);
                docParams.push(taxId);
                paramIdx++;
            } else if (direction === 'Received') {
                docWhereClauses.push(`d."receiverId" = $${paramIdx}`);
                docParams.push(taxId);
                paramIdx++;
            }
        }
        if (status && status !== 'All') { docWhereClauses.push(`LOWER(d.status) = LOWER($${paramIdx})`); docParams.push(status); paramIdx++; }

        const docWhereSQL = docWhereClauses.length > 0 ? `WHERE ${docWhereClauses.join(' AND ')}` : '';

        // 1. Get tax breakdown from lines.taxableItemsJson
        let taxBreakdown: any[] = [];
        try {
            // Check if lines table exists and has taxableItemsJson
            const linesTableCheck = await pool.query(
                `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'InvoicesDb' AND table_name = $1) as exists`,
                [tables.lines]
            );

            if (linesTableCheck.rows[0]?.exists) {
                // Fetch all taxableItemsJson from lines that belong to matching documents
                const linesResult = await pool.query(`
                    SELECT l."taxableItemsJson"
                    FROM "InvoicesDb"."${tables.lines}" l
                    INNER JOIN "InvoicesDb"."${tables.documents}" d ON d.uuid = l.document_uuid
                    ${docWhereSQL}
                `, docParams);

                // Aggregate tax data from JSON
                const taxMap = new Map<string, { taxType: string; subType: string; totalAmount: number; count: number; rates: number[] }>();
                for (const row of linesResult.rows) {
                    if (!row.taxableItemsJson) continue;
                    try {
                        const taxItems = JSON.parse(row.taxableItemsJson);
                        for (const tax of taxItems) {
                            const key = `${tax.taxType || 'Unknown'}_${tax.subType || 'N/A'}`;
                            if (!taxMap.has(key)) {
                                taxMap.set(key, { taxType: tax.taxType || 'Unknown', subType: tax.subType || 'N/A', totalAmount: 0, count: 0, rates: [] });
                            }
                            const entry = taxMap.get(key)!;
                            entry.totalAmount += parseFloat(tax.amount || '0');
                            entry.count++;
                            if (tax.rate) entry.rates.push(parseFloat(tax.rate));
                        }
                    } catch (_) { /* malformed JSON */ }
                }

                taxBreakdown = Array.from(taxMap.values()).map(v => ({
                    taxType: v.taxType,
                    subType: v.subType,
                    line_count: v.count,
                    avg_rate: v.rates.length > 0 ? Math.round((v.rates.reduce((a, b) => a + b, 0) / v.rates.length) * 100) / 100 : 0,
                    total_amount: Math.round(v.totalAmount * 100) / 100,
                })).sort((a, b) => b.total_amount - a.total_amount);
            }
        } catch (e: any) {
            console.warn('[Tax API] taxableItemsJson aggregation failed:', e.message);
        }

        // 2. Calculate document-level summary — use issuerId/receiverId for direction
        let summary: any = {};
        try {
            const docsTableCheck = await pool.query(
                `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'InvoicesDb' AND table_name = $1) as exists`,
                [tables.documents]
            );

            if (docsTableCheck.rows[0]?.exists) {
                // Use taxId-based direction calculation
                const taxIdParam = docParams.length + 1;
                const summaryResult = await pool.query(`
                    SELECT
                        COUNT(*) as total_docs,
                        ROUND(COALESCE(SUM(CAST("totalSales" AS NUMERIC)), 0), 2) as total_sales,
                        ROUND(COALESCE(SUM(CAST("totalDiscount" AS NUMERIC)), 0), 2) as total_discount,
                        ROUND(COALESCE(SUM(CAST("netAmount" AS NUMERIC)), 0), 2) as total_net,
                        ROUND(COALESCE(SUM(CAST(total AS NUMERIC)), 0), 2) as total_amount,
                        ROUND(COALESCE(SUM(CAST(total AS NUMERIC)) - SUM(CAST("netAmount" AS NUMERIC)), 0), 2) as total_tax,
                        COUNT(CASE WHEN "issuerId" = $${taxIdParam} THEN 1 END) as sent_count,
                        COUNT(CASE WHEN "receiverId" = $${taxIdParam} THEN 1 END) as received_count,
                        ROUND(COALESCE(SUM(CASE WHEN "issuerId" = $${taxIdParam} THEN CAST(total AS NUMERIC) ELSE 0 END), 0), 2) as sent_total,
                        ROUND(COALESCE(SUM(CASE WHEN "receiverId" = $${taxIdParam} THEN CAST(total AS NUMERIC) ELSE 0 END), 0), 2) as received_total
                    FROM "InvoicesDb"."${tables.documents}" d
                    ${docWhereSQL}
                `, [...docParams, taxId || '']);
                summary = summaryResult.rows[0] || {};
            }
        } catch (e: any) {
            console.warn('[Tax API] summary query failed:', e.message);
        }

        res.json({ success: true, taxBreakdown, summary });
    } catch (err: any) {
        console.error('[Tax API] Error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================
// GAP ANALYSIS API — Sent vs Received monthly comparison
// ============================================
app.get('/api/reports/gap-analysis', async (req, res) => {
    try {
        // Auth (same pattern as other reports)
        let userId: number | null = null;
        let orgId: number | null = null;
        let orgName: string = '';
        let taxId: string = '';

        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            try {
                const jwt = await import('jsonwebtoken');
                const decoded = jwt.default.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production') as any;
                userId = decoded.userId;
            } catch (e) { /* */ }
        }
        if (!userId) userId = parseInt(req.headers['x-user-id'] as string) || null;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        try {
            const portalResult = await pool.query(
                `SELECT pu.organization_id, o.name, o.tax_id FROM "otaxdb".portal_users pu
                 LEFT JOIN "otaxdb".organizations o ON o.id = pu.organization_id
                 WHERE pu.id = $1 LIMIT 1`,
                [userId]
            );
            if (portalResult.rows.length > 0) {
                orgId = portalResult.rows[0].organization_id;
                orgName = portalResult.rows[0].name || '';
                taxId = portalResult.rows[0].tax_id || '';
            }
        } catch (e) { /* */ }

        if (!orgId || !taxId) return res.json({ success: true, months: [], totals: {} });

        const tables = getOrgTableNames(orgId, orgName);

        // Check table exists
        const tableCheck = await pool.query(
            `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'InvoicesDb' AND table_name = $1) as exists`,
            [tables.documents]
        );
        if (!tableCheck.rows[0]?.exists) {
            return res.json({ success: true, months: [], totals: {} });
        }

        // Date filters
        const { dateFrom, dateTo } = req.query;
        let whereClauses: string[] = [];
        let params: any[] = [taxId]; // $1 = taxId
        let paramIdx = 2;

        if (dateFrom) { whereClauses.push(`"dateTimeIssued" >= $${paramIdx}`); params.push(dateFrom); paramIdx++; }
        if (dateTo) { whereClauses.push(`"dateTimeIssued" <= $${paramIdx}`); params.push(dateTo + 'T23:59:59Z'); paramIdx++; }

        const dateWhereSQL = whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : '';

        // Monthly aggregation: Sent vs Received
        const gapResult = await pool.query(`
            SELECT
                TO_CHAR("dateTimeIssued"::timestamp, 'YYYY-MM') as month,
                -- Sent (Portal Liability) = invoices YOU sent (you are issuer)
                COUNT(CASE WHEN "issuerId" = $1 THEN 1 END) as sent_count,
                ROUND(COALESCE(SUM(CASE WHEN "issuerId" = $1 THEN CAST("totalSales" AS NUMERIC) ELSE 0 END), 0), 2) as sent_sales,
                ROUND(COALESCE(SUM(CASE WHEN "issuerId" = $1 THEN CAST("netAmount" AS NUMERIC) ELSE 0 END), 0), 2) as sent_net,
                ROUND(COALESCE(SUM(CASE WHEN "issuerId" = $1 THEN CAST(total AS NUMERIC) ELSE 0 END), 0), 2) as sent_total,
                ROUND(COALESCE(SUM(CASE WHEN "issuerId" = $1 THEN CAST(total AS NUMERIC) - CAST("netAmount" AS NUMERIC) ELSE 0 END), 0), 2) as sent_tax,
                -- Received (ERP Liability) = invoices you RECEIVED (you are receiver)
                COUNT(CASE WHEN "receiverId" = $1 THEN 1 END) as received_count,
                ROUND(COALESCE(SUM(CASE WHEN "receiverId" = $1 THEN CAST("totalSales" AS NUMERIC) ELSE 0 END), 0), 2) as received_sales,
                ROUND(COALESCE(SUM(CASE WHEN "receiverId" = $1 THEN CAST("netAmount" AS NUMERIC) ELSE 0 END), 0), 2) as received_net,
                ROUND(COALESCE(SUM(CASE WHEN "receiverId" = $1 THEN CAST(total AS NUMERIC) ELSE 0 END), 0), 2) as received_total,
                ROUND(COALESCE(SUM(CASE WHEN "receiverId" = $1 THEN CAST(total AS NUMERIC) - CAST("netAmount" AS NUMERIC) ELSE 0 END), 0), 2) as received_tax
            FROM "InvoicesDb"."${tables.documents}"
            WHERE ("issuerId" = $1 OR "receiverId" = $1) ${dateWhereSQL}
            GROUP BY TO_CHAR("dateTimeIssued"::timestamp, 'YYYY-MM')
            ORDER BY month DESC
        `, params);

        // Calculate gaps
        const months = gapResult.rows.map((row: any) => {
            const sentTotal = parseFloat(row.sent_total) || 0;
            const receivedTotal = parseFloat(row.received_total) || 0;
            const sentTax = parseFloat(row.sent_tax) || 0;
            const receivedTax = parseFloat(row.received_tax) || 0;
            const gap = sentTotal - receivedTotal;
            const taxGap = sentTax - receivedTax;
            const gapPercentage = receivedTotal > 0 ? ((gap / receivedTotal) * 100) : (sentTotal > 0 ? 100 : 0);

            return {
                month: row.month,
                sent: { count: parseInt(row.sent_count), sales: parseFloat(row.sent_sales), net: parseFloat(row.sent_net), total: sentTotal, tax: sentTax },
                received: { count: parseInt(row.received_count), sales: parseFloat(row.received_sales), net: parseFloat(row.received_net), total: receivedTotal, tax: receivedTax },
                gap: Math.round(gap * 100) / 100,
                taxGap: Math.round(taxGap * 100) / 100,
                gapPercentage: Math.round(gapPercentage * 100) / 100,
            };
        });

        // Grand totals
        const totals = months.reduce((acc: any, m: any) => ({
            sentCount: (acc.sentCount || 0) + m.sent.count,
            sentTotal: (acc.sentTotal || 0) + m.sent.total,
            sentTax: (acc.sentTax || 0) + m.sent.tax,
            receivedCount: (acc.receivedCount || 0) + m.received.count,
            receivedTotal: (acc.receivedTotal || 0) + m.received.total,
            receivedTax: (acc.receivedTax || 0) + m.received.tax,
            totalGap: (acc.totalGap || 0) + m.gap,
            totalTaxGap: (acc.totalTaxGap || 0) + m.taxGap,
        }), {});
        totals.gapPercentage = totals.receivedTotal > 0 ? Math.round((totals.totalGap / totals.receivedTotal) * 10000) / 100 : 0;

        res.json({ success: true, months, totals });
    } catch (err: any) {
        console.error('[Gap Analysis API] Error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================
// STATISTICS API — advanced analytics (invoices by status, monthly trends, top entities, growth)
// ============================================
app.get('/api/reports/statistics', async (req, res) => {
    try {
        // Auth
        let userId: number | null = null;
        let orgId: number | null = null;
        let orgName: string = '';
        let taxId: string = '';

        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            try {
                const jwt = await import('jsonwebtoken');
                const decoded = jwt.default.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production') as any;
                userId = decoded.userId;
            } catch (e) { /* */ }
        }
        if (!userId) userId = parseInt(req.headers['x-user-id'] as string) || null;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        try {
            const portalResult = await pool.query(
                `SELECT pu.organization_id, o.name, o.tax_id FROM "otaxdb".portal_users pu
                 LEFT JOIN "otaxdb".organizations o ON o.id = pu.organization_id
                 WHERE pu.id = $1 LIMIT 1`,
                [userId]
            );
            if (portalResult.rows.length > 0) {
                orgId = portalResult.rows[0].organization_id;
                orgName = portalResult.rows[0].name || '';
                taxId = portalResult.rows[0].tax_id || '';
            }
        } catch (e) { /* */ }

        if (!orgId) return res.json({ success: true, stats: {} });

        const tables = getOrgTableNames(orgId, orgName);

        const tableCheck = await pool.query(
            `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'InvoicesDb' AND table_name = $1) as exists`,
            [tables.documents]
        );
        if (!tableCheck.rows[0]?.exists) return res.json({ success: true, stats: {} });

        // Date filters
        const { dateFrom, dateTo } = req.query;
        let whereClauses: string[] = [];
        let params: any[] = [];
        let paramIdx = 1;

        if (dateFrom) { whereClauses.push(`"dateTimeIssued" >= $${paramIdx}`); params.push(dateFrom); paramIdx++; }
        if (dateTo) { whereClauses.push(`"dateTimeIssued" <= $${paramIdx}`); params.push(dateTo + 'T23:59:59Z'); paramIdx++; }

        const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // 1. Invoices by Status
        const statusResult = await pool.query(`
            SELECT COALESCE(status, 'Unknown') as status, COUNT(*) as count,
                   ROUND(COALESCE(SUM(CAST(total AS NUMERIC)), 0), 2) as total
            FROM "InvoicesDb"."${tables.documents}" ${whereSQL}
            GROUP BY status ORDER BY count DESC
        `, params);

        // 2. Invoices by Month (trend)
        const monthlyResult = await pool.query(`
            SELECT TO_CHAR("dateTimeIssued"::timestamp, 'YYYY-MM') as month,
                   COUNT(*) as count,
                   ROUND(COALESCE(SUM(CAST(total AS NUMERIC)), 0), 2) as total,
                   ROUND(COALESCE(SUM(CAST(total AS NUMERIC) - CAST("netAmount" AS NUMERIC)), 0), 2) as tax,
                   ROUND(COALESCE(AVG(CAST(total AS NUMERIC)), 0), 2) as avg_value
            FROM "InvoicesDb"."${tables.documents}" ${whereSQL}
            GROUP BY TO_CHAR("dateTimeIssued"::timestamp, 'YYYY-MM')
            ORDER BY month ASC
        `, params);

        // 3. Top 10 Receivers (customers you invoice)
        const taxIdParamIdx = paramIdx;
        const topReceiversResult = await pool.query(`
            SELECT "receiverName" as name, "receiverId" as tax_id, COUNT(*) as count,
                   ROUND(COALESCE(SUM(CAST(total AS NUMERIC)), 0), 2) as total
            FROM "InvoicesDb"."${tables.documents}"
            ${whereSQL ? whereSQL + ` AND "issuerId" = $${taxIdParamIdx}` : `WHERE "issuerId" = $${taxIdParamIdx}`}
            GROUP BY "receiverName", "receiverId"
            ORDER BY total DESC LIMIT 10
        `, [...params, taxId || '']);

        // 4. Top 10 Issuers (suppliers who invoice you)
        const topIssuersResult = await pool.query(`
            SELECT "issuerName" as name, "issuerId" as tax_id, COUNT(*) as count,
                   ROUND(COALESCE(SUM(CAST(total AS NUMERIC)), 0), 2) as total
            FROM "InvoicesDb"."${tables.documents}"
            ${whereSQL ? whereSQL + ` AND "receiverId" = $${taxIdParamIdx}` : `WHERE "receiverId" = $${taxIdParamIdx}`}
            GROUP BY "issuerName", "issuerId"
            ORDER BY total DESC LIMIT 10
        `, [...params, taxId || '']);

        // 5. Overall stats
        const overallResult = await pool.query(`
            SELECT COUNT(*) as total_docs,
                   ROUND(COALESCE(SUM(CAST(total AS NUMERIC)), 0), 2) as total_amount,
                   ROUND(COALESCE(AVG(CAST(total AS NUMERIC)), 0), 2) as avg_value,
                   ROUND(COALESCE(MAX(CAST(total AS NUMERIC)), 0), 2) as max_value,
                   ROUND(COALESCE(MIN(CAST(total AS NUMERIC)), 0), 2) as min_value,
                   ROUND(COALESCE(SUM(CAST(total AS NUMERIC) - CAST("netAmount" AS NUMERIC)), 0), 2) as total_tax
            FROM "InvoicesDb"."${tables.documents}" ${whereSQL}
        `, params);

        // 6. Growth rate (compare current period total to previous same-length period)
        let growthRate = 0;
        if (dateFrom && dateTo) {
            const from = new Date(dateFrom as string);
            const to = new Date(dateTo as string);
            const periodMs = to.getTime() - from.getTime();
            const prevFrom = new Date(from.getTime() - periodMs);
            const prevTo = new Date(from.getTime() - 1);

            const prevResult = await pool.query(`
                SELECT ROUND(COALESCE(SUM(CAST(total AS NUMERIC)), 0), 2) as prev_total
                FROM "InvoicesDb"."${tables.documents}"
                WHERE "dateTimeIssued" >= $1 AND "dateTimeIssued" <= $2
            `, [prevFrom.toISOString(), prevTo.toISOString()]);

            const prevTotal = parseFloat(prevResult.rows[0]?.prev_total || '0');
            const currentTotal = parseFloat(overallResult.rows[0]?.total_amount || '0');
            if (prevTotal > 0) {
                growthRate = Math.round(((currentTotal - prevTotal) / prevTotal) * 10000) / 100;
            }
        }

        const stats = {
            invoicesByStatus: statusResult.rows.map((r: any) => ({
                status: r.status,
                count: parseInt(r.count),
                total: parseFloat(r.total),
            })),
            invoicesByMonth: monthlyResult.rows.map((r: any) => ({
                month: r.month,
                count: parseInt(r.count),
                total: parseFloat(r.total),
                tax: parseFloat(r.tax),
                avgValue: parseFloat(r.avg_value),
            })),
            topReceivers: topReceiversResult.rows.map((r: any) => ({
                name: r.name,
                taxId: r.tax_id,
                count: parseInt(r.count),
                total: parseFloat(r.total),
            })),
            topIssuers: topIssuersResult.rows.map((r: any) => ({
                name: r.name,
                taxId: r.tax_id,
                count: parseInt(r.count),
                total: parseFloat(r.total),
            })),
            overall: {
                totalDocs: parseInt(overallResult.rows[0]?.total_docs || '0'),
                totalAmount: parseFloat(overallResult.rows[0]?.total_amount || '0'),
                avgValue: parseFloat(overallResult.rows[0]?.avg_value || '0'),
                maxValue: parseFloat(overallResult.rows[0]?.max_value || '0'),
                minValue: parseFloat(overallResult.rows[0]?.min_value || '0'),
                totalTax: parseFloat(overallResult.rows[0]?.total_tax || '0'),
            },
            growthRate,
        };

        res.json({ success: true, stats });
    } catch (err: any) {
        console.error('[Statistics API] Error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/reports/duplicates?mode=all|valid
 * Finds invoices whose internalId appears more than once.
 *
 * Two modes (frontend toggle):
 *   mode=all    → ANY internalId that repeats, regardless of status.
 *                 Useful for spotting every duplicate the portal has seen,
 *                 including Cancelled/Rejected/Invalid re-submissions.
 *
 *   mode=valid  → (default) ONLY groups whose rows are ALL 'Valid'.
 *                 A Valid+Cancelled pair is a legitimate re-submission and
 *                 is NOT flagged here.
 *
 * Response: { rows: [{ internalId, validCount, totalAmount, invoices: [...] }], totalGroups, mode }
 */
app.get('/api/reports/duplicates', async (req, res) => {
    try {
        let userId: number | null = null;
        let orgId: number | null = null;
        let orgName: string = '';

        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            try {
                const jwt = await import('jsonwebtoken');
                const decoded = jwt.default.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production') as any;
                userId = decoded.userId;
            } catch (e) { /* */ }
        }
        if (!userId) userId = parseInt(req.headers['x-user-id'] as string) || null;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        try {
            const portalResult = await pool.query(
                `SELECT pu.organization_id, o.name FROM "otaxdb".portal_users pu
                 LEFT JOIN "otaxdb".organizations o ON o.id = pu.organization_id
                 WHERE pu.id = $1 LIMIT 1`,
                [userId]
            );
            if (portalResult.rows.length > 0) {
                orgId = portalResult.rows[0].organization_id;
                orgName = portalResult.rows[0].name || '';
            }
        } catch (e) { /* */ }
        if (!orgId) return res.json({ success: true, rows: [], totalGroups: 0 });

        const tables = getOrgTableNames(orgId, orgName);
        const tableCheck = await pool.query(
            `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'InvoicesDb' AND table_name = $1) as exists`,
            [tables.documents]
        );
        if (!tableCheck.rows[0]?.exists) return res.json({ success: true, rows: [], totalGroups: 0 });

        const { dateFrom, dateTo } = req.query;
        const mode = String(req.query.mode || 'valid').toLowerCase() === 'all' ? 'all' : 'valid';
        const dateClauses: string[] = [];
        const params: any[] = [];
        if (dateFrom) { params.push(dateFrom); dateClauses.push(`"dateTimeIssued" >= $${params.length}`); }
        if (dateTo) { params.push(dateTo + 'T23:59:59Z'); dateClauses.push(`"dateTimeIssued" <= $${params.length}`); }
        const dateSQL = dateClauses.length ? ` AND ${dateClauses.join(' AND ')}` : '';

        // Two modes:
        //
        // mode='all':   Any internalId that repeats within the date range. Counts include
        //               all statuses; we also expose a `validCount` so the UI can show
        //               "how many of these N rows are Valid".
        //
        // mode='valid': Only groups whose rows are ALL 'Valid'. Legitimate re-submissions
        //               (Valid + Cancelled) are filtered out.
        const havingSQL = mode === 'all'
            ? `HAVING COUNT(*) > 1`
            : `HAVING COUNT(*) > 1
                  AND COUNT(DISTINCT COALESCE(status, '')) = 1
                  AND MAX(status) = 'Valid'`;

        const groupsSql = `
            SELECT "internalId",
                   COUNT(*)::int AS total_count,
                   SUM(CASE WHEN status = 'Valid' THEN 1 ELSE 0 END)::int AS valid_count,
                   ROUND(COALESCE(SUM(CAST(total AS NUMERIC)), 0), 2)::float AS total_amount
            FROM "InvoicesDb"."${tables.documents}"
            WHERE "internalId" IS NOT NULL
              AND "internalId" <> ''
              ${dateSQL}
            GROUP BY "internalId"
            ${havingSQL}
            ORDER BY COUNT(*) DESC, "internalId" ASC
            LIMIT 500
        `;
        const groups = await pool.query(groupsSql, params);

        if (groups.rows.length === 0) {
            return res.json({ success: true, rows: [], totalGroups: 0, mode });
        }

        // Pull per-invoice details. In 'all' mode we return every row; in 'valid' mode
        // only the Valid rows (matches the original behavior).
        const ids = groups.rows.map((r: any) => r.internalId);
        const statusFilter = mode === 'all' ? '' : `AND status = 'Valid'`;
        const detailsSql = `
            SELECT "internalId", uuid, "dateTimeIssued", "receiverName", "receiverId",
                   "totalSales"::float AS "totalSales", total::float AS total, status, direction
            FROM "InvoicesDb"."${tables.documents}"
            WHERE "internalId" = ANY($1::text[]) ${statusFilter}
            ORDER BY "internalId", "dateTimeIssued"
        `;
        const details = await pool.query(detailsSql, [ids]);

        const byId: Record<string, any[]> = {};
        for (const d of details.rows) {
            const key = d.internalId;
            if (!byId[key]) byId[key] = [];
            byId[key].push(d);
        }

        const rows = groups.rows.map((g: any) => ({
            internalId: g.internalId,
            totalCount: g.total_count,    // how many rows total (all statuses)
            validCount: g.valid_count,    // how many of those are Valid
            totalAmount: g.total_amount,
            invoices: byId[g.internalId] || [],
        }));

        res.json({ success: true, rows, totalGroups: rows.length, mode });
    } catch (err: any) {
        console.error('[Duplicates API] Error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Invoices List API — reads from organization_settings + organizations (portal users)
app.get('/api/invoices', async (req, res) => {
    try {
        // Auth: JWT first, then x-user-id fallback
        let userId: number | null = null;
        let orgId: number | null = null;
        let orgName: string = '';

        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            try {
                const jwt = await import('jsonwebtoken');
                const decoded = jwt.default.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production') as any;
                userId = decoded.userId;
            } catch (e) { /* invalid token */ }
        }
        if (!userId) userId = parseInt(req.headers['x-user-id'] as string) || null;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        // Get org info for this user
        try {
            const portalResult = await pool.query(
                `SELECT pu.organization_id, o.name, o.tax_id 
                 FROM "otaxdb".portal_users pu
                 LEFT JOIN "otaxdb".organizations o ON o.id = pu.organization_id
                 WHERE pu.id = $1 LIMIT 1`,
                [userId]
            );
            if (portalResult.rows.length > 0) {
                orgId = portalResult.rows[0].organization_id;
                orgName = portalResult.rows[0].name || '';
            }
        } catch (e) { /* portal_users may not exist */ }

        if (!orgId) {
            return res.json({ success: true, invoices: [], isSyncing: false });
        }

        // Read credentials from organization_settings
        let env = 'PreProd';
        let clientId = '';
        let clientSecret = '';
        let taxId = '';

        try {
            const settingsResult = await pool.query(
                `SELECT * FROM "otaxdb".organization_settings WHERE organization_id = $1`,
                [orgId]
            );
            if (settingsResult.rows.length > 0) {
                const s = settingsResult.rows[0];
                env = s.eta_environment || 'PreProd';
                if (env === 'Prod') {
                    clientId = s.eta_prod_client_id || s.eta_preprod_client_id || '';
                    clientSecret = s.eta_prod_client_secret || s.eta_preprod_client_secret || '';
                } else {
                    clientId = s.eta_preprod_client_id || s.eta_prod_client_id || '';
                    clientSecret = s.eta_preprod_client_secret || s.eta_prod_client_secret || '';
                }
            }

            const orgResult = await pool.query(
                `SELECT tax_id FROM "otaxdb".organizations WHERE id = $1`,
                [orgId]
            );
            if (orgResult.rows.length > 0) {
                taxId = orgResult.rows[0].tax_id || '';
            }
        } catch (e) { /* */ }

        // Check Environment Mismatch
        const cacheKey = String(userId);
        if (syncCache[cacheKey] && syncCache[cacheKey].env !== env) {
            console.log(`[Invoices API] Environment switch detected. Clearing cache.`);
            delete syncCache[cacheKey];
        }

        // Trigger Sync if not started and credentials exist
        if (!syncCache[cacheKey] && clientId && clientSecret) {
            setTimeout(() => {
                getAllETADocuments(cacheKey, clientId, clientSecret, env, taxId, userId).catch(console.error);
            }, 50);
        }

        // Read from org-specific InvoicesDb table
        let localDocs: any[] = [];
        try {
            const tables = getOrgTableNames(orgId, orgName);

            // Check if org table exists
            const tableCheck = await pool.query(
                `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'InvoicesDb' AND table_name = $1) as exists`,
                [tables.documents]
            );

            if (tableCheck.rows[0]?.exists) {
                console.log(`[Invoices API] Reading from org table: InvoicesDb.${tables.documents}`);
                const localResult = await pool.query(`
                    SELECT * FROM "InvoicesDb"."${tables.documents}" 
                    ORDER BY "dateTimeIssued" DESC 
                    LIMIT 5000 
                `);
                localDocs = localResult.rows.map(row => {
                    let type = 'I';
                    const tn = (row.typeName || '').toUpperCase();
                    if (tn.startsWith('C') || tn.includes('CREDIT')) type = 'C';
                    else if (tn.startsWith('D') || tn.includes('DEBIT')) type = 'D';

                    const direction = (() => {
                        // Determine direction: compare org taxId to issuerId and receiverId
                        if (taxId && row.issuerId && row.issuerId === taxId) return 'Sent';
                        if (taxId && row.receiverId && row.receiverId === taxId) return 'Received';
                        // Fallback to stored direction
                        if (row.direction) return row.direction;
                        // If we have issuerId but it doesn't match our taxId, it's probably received
                        if (taxId && row.issuerId && row.issuerId !== taxId) return 'Received';
                        return 'Sent';
                    })();

                    return {
                        id: row.uuid,
                        type,
                        direction,
                        internalId: row.internalId || 'N/A',
                        receiverName: row.receiverName || 'N/A',
                        receiverId: row.receiverId || 'N/A',
                        date: row.dateTimeIssued,
                        total: parseFloat(row.total || row.totalSales || '0'),
                        currency: 'EGP',
                        status: row.status,
                        errorCode: undefined
                    };
                });
            } else {
                // Fallback: try legacy company table
                const companyTable = await getCompanyTableName(String(userId));
                if (companyTable) {
                    console.log(`[Invoices API] Fallback to legacy company table: ${companyTable}`);
                    const localResult = await pool.query(`
                        SELECT * FROM public."${companyTable}" ORDER BY "dateTimeIssued" DESC LIMIT 5000
                    `);
                    localDocs = localResult.rows.map(row => ({
                        id: row.uuid,
                        type: 'I',
                        direction: 'Sent',
                        internalId: row.internalId || 'N/A',
                        receiverName: row.receiverName || 'N/A',
                        receiverId: row.receiverId || 'N/A',
                        date: row.dateTimeIssued,
                        total: parseFloat(row.total || row.totalSales || '0'),
                        currency: 'EGP',
                        status: row.status,
                        errorCode: undefined
                    }));
                }
            }
        } catch (dbErr: any) {
            console.error('[Invoices API] DB error:', dbErr.message);
        }

        const invoices = localDocs.map(d => ({
            ...d,
            date: d.date ? new Date(d.date).toLocaleDateString('en-US') : ''
        }));

        res.json({
            success: true,
            invoices,
            isSyncing: syncCache[cacheKey]?.isSyncing || false
        });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Manual Sync Trigger Endpoint — reads from organization_settings
app.post('/api/sync/full-refresh', async (req, res) => {
    console.log('[API] /api/sync/full-refresh called');

    try {
        // Auth: JWT first, then x-user-id fallback
        let userId: number | null = null;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            try {
                const jwt = await import('jsonwebtoken');
                const decoded = jwt.default.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production') as any;
                userId = decoded.userId;
            } catch (e) { /* */ }
        }
        if (!userId) userId = parseInt(req.headers['x-user-id'] as string) || null;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        // Get org
        const portalResult = await pool.query(
            `SELECT pu.organization_id, o.tax_id FROM "otaxdb".portal_users pu
             LEFT JOIN "otaxdb".organizations o ON o.id = pu.organization_id
             WHERE pu.id = $1 LIMIT 1`,
            [userId]
        );
        if (portalResult.rows.length === 0) return res.status(400).json({ success: false, message: 'User not found' });

        const orgId = portalResult.rows[0].organization_id;
        const taxId = portalResult.rows[0].tax_id || '';

        // Read credentials from organization_settings
        const settingsResult = await pool.query(
            `SELECT * FROM "otaxdb".organization_settings WHERE organization_id = $1`,
            [orgId]
        );
        if (settingsResult.rows.length === 0) return res.status(400).json({ success: false, message: 'No settings configured' });

        const s = settingsResult.rows[0];
        const env = s.eta_environment || 'PreProd';
        let clientId = env === 'Prod' ? (s.eta_prod_client_id || s.eta_preprod_client_id) : (s.eta_preprod_client_id || s.eta_prod_client_id);
        let clientSecret = env === 'Prod' ? (s.eta_prod_client_secret || s.eta_preprod_client_secret) : (s.eta_preprod_client_secret || s.eta_prod_client_secret);

        if (!clientId || !clientSecret) return res.status(400).json({ success: false, message: 'Missing API Credentials in organization settings' });

        const cacheKey = String(userId);
        if (syncCache[cacheKey]) {
            syncCache[cacheKey].isSyncing = false;
        }

        // Start Sync in Background
        getAllETADocuments(cacheKey, clientId, clientSecret, env, taxId, userId).catch(console.error);

        res.json({ success: true, message: 'Full Sync Started. Data is populating in the background.' });

    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================
// PER-COMPANY TABLE SYNC SYSTEM
// ============================================

/**
 * Create a dedicated table for a specific company
 * Table name format: company_{id}_{sanitized_username}_documents
 */
async function createCompanyTable(credentialId: number, username: string): Promise<string> {
    const safeName = (username || 'unknown').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().substring(0, 30);
    const tableName = `company_${credentialId}_${safeName}_documents`;

    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS public."${tableName}" (
                id BIGSERIAL PRIMARY KEY,
                uuid VARCHAR(10000),
                "submissionId" VARCHAR(10000),
                "internalId" VARCHAR(10000),
                "longId" VARCHAR(10000),
                submitted BOOLEAN DEFAULT true,
                "typeName" VARCHAR(10000),
                "typeVersionName" VARCHAR(10000),
                "issuerId" VARCHAR(10000),
                "issuerName" VARCHAR(10000),
                "receiverId" VARCHAR(10000),
                "receiverName" VARCHAR(10000),
                "dateTimeIssued" TIMESTAMP,
                "dateTimeReceived" TIMESTAMP,
                "totalSales" DOUBLE PRECISION,
                "totalDiscount" DOUBLE PRECISION,
                "netAmount" DOUBLE PRECISION,
                total DOUBLE PRECISION,
                status VARCHAR(10000),
                "dateTimeCancelled" TIMESTAMP,
                environment VARCHAR(10000),
                "rejectionReasons" VARCHAR(100000),
                "documentBody" TEXT,
                credential_id INTEGER DEFAULT ${credentialId},
                created_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT "${tableName}_uuid_unique" UNIQUE (uuid)
            );
        `);
        // Create index on uuid for fast lookup
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tableName}_uuid" ON public."${tableName}" (uuid);`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tableName}_status" ON public."${tableName}" (status);`);
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tableName}_date" ON public."${tableName}" ("dateTimeIssued");`);

        console.log(`[Company Tables] ✅ Created table: ${tableName}`);
        return tableName;
    } finally {
        client.release();
    }
}

/**
 * Sync ETA documents for a specific company into its dedicated table
 */
async function syncCompanyFromETA(
    credentialId: number,
    username: string,
    clientId: string,
    clientSecret: string,
    env: string,
    tableName: string
): Promise<{ success: boolean; message: string; documentsCount: number }> {
    console.log(`[Company Sync] Starting sync for Company ${credentialId} (${username}) → table: ${tableName}`);

    try {
        // 1. Validate credentials by getting a token
        const token = await getETAToken(clientId, clientSecret, env);
        console.log(`[Company Sync] ✅ Token obtained for Company ${credentialId}`);

        const hosts = getETAHosts(env);
        let totalDocuments = 0;

        // 2. Fetch all documents from ETA (going back to 2020)
        const endDate = new Date(Date.now() - 5 * 60 * 1000);
        let currentEnd = new Date(endDate);
        const limitDate = new Date('2020-01-01T00:00:00Z');
        let currentToken = token;

        while (currentEnd > limitDate) {
            let currentStart = new Date(currentEnd);
            currentStart.setDate(currentStart.getDate() - 30);
            if (currentStart < limitDate) currentStart = limitDate;

            const fromStr = currentStart.toISOString().split('.')[0] + 'Z';
            const toStr = currentEnd.toISOString().split('.')[0] + 'Z';

            let retryCount = 0;
            const maxRetries = 3;
            let chunkSuccess = false;

            while (retryCount < maxRetries && !chunkSuccess) {
                try {
                    let pageNo = 1;
                    let totalPages = 1;

                    do {
                        const response = await axios.get(`${hosts.api}/api/v1.0/documents/search`, {
                            headers: { 'Authorization': `Bearer ${currentToken}` },
                            params: {
                                pageSize: '50',
                                pageNo: pageNo.toString(),
                                submissionDateFrom: fromStr,
                                submissionDateTo: toStr
                            }
                        });

                        const result = response.data.result || [];
                        const metadata = response.data.metadata;
                        totalPages = metadata?.totalPages || 1;

                        if (result.length > 0) {
                            for (const d of result) {
                                try {
                                    // Upsert into company-specific table
                                    await pool.query(`
                                        INSERT INTO public."${tableName}" (
                                            uuid, "submissionId", "internalId", submitted, "typeName",
                                            "issuerId", "issuerName", "receiverId", "receiverName",
                                            "dateTimeIssued", "totalSales", "totalDiscount", "netAmount",
                                            total, status, environment, credential_id, "documentBody"
                                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                                        ON CONFLICT (uuid) DO UPDATE SET
                                            status = EXCLUDED.status,
                                            "documentBody" = EXCLUDED."documentBody"
                                    `, [
                                        d.uuid,
                                        d.submissionUUID || d.submissionId,
                                        d.internalId,
                                        true,
                                        d.documentType || d.typeName,
                                        d.issuerId,
                                        d.issuerName,
                                        d.receiverId,
                                        d.receiverName,
                                        d.dateTimeIssued,
                                        d.totalSalesAmount || 0,
                                        d.totalDiscountAmount || 0,
                                        d.netAmount || 0,
                                        d.totalAmount || d.total || 0,
                                        d.status,
                                        env,
                                        credentialId,
                                        JSON.stringify(d)
                                    ]);
                                    totalDocuments++;
                                } catch (insertErr) {
                                    // Silently skip duplicate errors
                                }
                            }
                        }
                        pageNo++;
                    } while (pageNo <= totalPages);
                    chunkSuccess = true;

                } catch (chunkErr: any) {
                    const status = chunkErr.response?.status;
                    if (status === 401) {
                        try {
                            currentToken = await getETAToken(clientId, clientSecret, env);
                            retryCount++;
                            continue;
                        } catch (authErr) {
                            throw authErr;
                        }
                    } else if (status === 429) {
                        await new Promise(r => setTimeout(r, 10000));
                        retryCount++;
                    } else {
                        retryCount++;
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }
            }

            currentEnd = currentStart;
        }

        console.log(`[Company Sync] ✅ Completed sync for Company ${credentialId}. Total: ${totalDocuments} documents.`);

        // === START LIVE MONITOR: Poll every 30s for new invoices ===
        console.log(`[Company Monitor] 🔄 Starting live monitor for Company ${credentialId} — checking every 30s`);

        setInterval(async () => {
            try {
                // Look back 10 minutes to catch delayed indexing
                const monitorEnd = new Date();
                const monitorStart = new Date(monitorEnd);
                monitorStart.setMinutes(monitorStart.getMinutes() - 10);

                const mFrom = monitorStart.toISOString().split('.')[0] + 'Z';
                const mTo = monitorEnd.toISOString().split('.')[0] + 'Z';

                const freshToken = await getETAToken(clientId, clientSecret, env);
                const response = await axios.get(`${hosts.api}/api/v1.0/documents/search`, {
                    headers: { 'Authorization': `Bearer ${freshToken}` },
                    params: {
                        pageSize: '50',
                        pageNo: '1',
                        submissionDateFrom: mFrom,
                        submissionDateTo: mTo
                    }
                });

                const result = response.data.result || [];
                let newCount = 0;

                for (const d of result) {
                    try {
                        const upsertResult = await pool.query(`
                            INSERT INTO public."${tableName}" (
                                uuid, "submissionId", "internalId", submitted, "typeName",
                                "issuerId", "issuerName", "receiverId", "receiverName",
                                "dateTimeIssued", "totalSales", "totalDiscount", "netAmount",
                                total, status, environment, credential_id, "documentBody"
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                            ON CONFLICT (uuid) DO UPDATE SET
                                status = EXCLUDED.status,
                                "documentBody" = EXCLUDED."documentBody"
                        `, [
                            d.uuid,
                            d.submissionUUID || d.submissionId,
                            d.internalId,
                            true,
                            d.documentType || d.typeName,
                            d.issuerId,
                            d.issuerName,
                            d.receiverId,
                            d.receiverName,
                            d.dateTimeIssued,
                            d.totalSalesAmount || 0,
                            d.totalDiscountAmount || 0,
                            d.netAmount || 0,
                            d.totalAmount || d.total || 0,
                            d.status,
                            env,
                            credentialId,
                            JSON.stringify(d)
                        ]);
                        // If rowCount > 0 and it was an INSERT (not update), count as new
                        if (upsertResult.rowCount && upsertResult.rowCount > 0) newCount++;
                    } catch (e) {
                        // skip
                    }
                }

                if (newCount > 0) {
                    console.log(`[Company Monitor] 🆕 Company ${credentialId}: ${newCount} new/updated invoices found`);
                }
            } catch (monitorErr: any) {
                // Silent — don't stop monitoring on error
            }
        }, 30000); // Every 30 seconds

        return { success: true, message: `Synced ${totalDocuments} documents. Live monitor started.`, documentsCount: totalDocuments };

    } catch (err: any) {
        console.error(`[Company Sync] ❌ Failed for Company ${credentialId}:`, err.message);
        return { success: false, message: err.message, documentsCount: 0 };
    }
}

/**
 * ENDPOINT: Scan all credentials, create per-company tables, validate, and sync
 */
app.post('/api/sync/init-all-companies', async (req, res) => {
    console.log('[Init All Companies] Starting scan of all credentials...');

    try {
        // 1. Get all credentials
        const credResult = await pool.query(`
            SELECT id, username, "isValid" 
            FROM "otaxdb".credentials 
            WHERE "isValid" = true
            ORDER BY id
        `);

        const companies = credResult.rows;
        console.log(`[Init All Companies] Found ${companies.length} active credentials`);

        const results: any[] = [];

        // 2. Process each credential
        for (const company of companies) {
            const companyId = company.id;
            const username = company.username || `user_${companyId}`;

            console.log(`[Init All Companies] Processing Company ${companyId} (${username})...`);

            // Phase A-G aware: pull ETA creds from org_settings first, fall
            // back to clients_info_new for legacy installs.
            const props = await loadEffectiveSettings(pool, Number(companyId));
            const getProp = (name: string) => makeGetProp(props)(name)?.trim();

            const env = getProp('signer_environment_type') || 'PreProd';
            const clientId = env === 'Prod' ? getProp('signer_prodClientId') : getProp('signer_preProdClientId');
            const clientSecret = env === 'Prod' ? getProp('signer_prodClientSecret') : getProp('signer_preProdClientSecret');

            // Create table regardless
            let tableName: string;
            try {
                tableName = await createCompanyTable(companyId, username);
            } catch (tableErr: any) {
                results.push({
                    id: companyId,
                    username,
                    status: 'error',
                    message: `Table creation failed: ${tableErr.message}`,
                    tableName: null
                });
                continue;
            }

            // Check if credentials exist
            if (!clientId || !clientSecret) {
                results.push({
                    id: companyId,
                    username,
                    status: 'no_credentials',
                    message: 'No Client ID / Client Secret found',
                    tableName,
                    env
                });
                continue;
            }

            // Validate credentials and start sync in background
            try {
                // Quick validation - just try to get a token
                await getETAToken(clientId, clientSecret, env);

                // Start sync in background (don't await)
                syncCompanyFromETA(companyId, username, clientId, clientSecret, env, tableName)
                    .then(syncResult => {
                        console.log(`[Init All Companies] Sync result for ${companyId}: ${syncResult.message}`);
                    })
                    .catch(err => {
                        console.error(`[Init All Companies] Sync error for ${companyId}:`, err.message);
                    });

                results.push({
                    id: companyId,
                    username,
                    status: 'syncing',
                    message: 'Credentials valid. Sync started in background.',
                    tableName,
                    env,
                    hasClientId: true
                });

            } catch (authErr: any) {
                results.push({
                    id: companyId,
                    username,
                    status: 'auth_failed',
                    message: `Authentication failed: ${authErr.message}`,
                    tableName,
                    env,
                    hasClientId: true
                });
            }
        }

        res.json({
            success: true,
            totalCompanies: companies.length,
            results
        });

    } catch (err: any) {
        console.error('[Init All Companies] Error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * ENDPOINT: Sync a single company by credential ID
 */
app.post('/api/sync/company/:id', async (req, res) => {
    const companyId = parseInt(req.params.id);
    if (isNaN(companyId)) return res.status(400).json({ success: false, message: 'Invalid company ID' });

    try {
        // Get credential info
        const credResult = await pool.query(
            `SELECT id, username FROM "otaxdb".credentials WHERE id = $1`,
            [companyId]
        );
        if (credResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        const username = credResult.rows[0].username || `user_${companyId}`;

        // Phase A-G aware: org_settings → clients_info_new fallback.
        const props = await loadEffectiveSettings(pool, Number(companyId));
        const getProp = (name: string) => makeGetProp(props)(name)?.trim();

        const env = getProp('signer_environment_type') || 'PreProd';
        const clientId = env === 'Prod' ? getProp('signer_prodClientId') : getProp('signer_preProdClientId');
        const clientSecret = env === 'Prod' ? getProp('signer_prodClientSecret') : getProp('signer_preProdClientSecret');

        if (!clientId || !clientSecret) {
            return res.status(400).json({ success: false, message: 'No Client ID / Client Secret configured for this company' });
        }

        // Create table
        const tableName = await createCompanyTable(companyId, username);

        // Start sync in background
        syncCompanyFromETA(companyId, username, clientId, clientSecret, env, tableName)
            .then(syncResult => {
                console.log(`[Company Sync] Result for ${companyId}: ${syncResult.message}`);
            })
            .catch(err => {
                console.error(`[Company Sync] Error for ${companyId}:`, err.message);
            });

        res.json({
            success: true,
            message: `Sync started for company ${companyId} (${username})`,
            tableName,
            env
        });

    } catch (err: any) {
        console.error(`[Company Sync] Error for ${companyId}:`, err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * ENDPOINT: List all company tables and their document counts
 */
app.get('/api/sync/companies-status', async (req, res) => {
    try {
        // Get all credentials
        const credResult = await pool.query(`
            SELECT c.id, c.username, c."isValid"
            FROM "otaxdb".credentials c
            WHERE c."isValid" = true
            ORDER BY c.id
        `);

        const statuses: any[] = [];

        for (const cred of credResult.rows) {
            const safeName = (cred.username || 'unknown').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().substring(0, 30);
            const tableName = `company_${cred.id}_${safeName}_documents`;

            let docCount = 0;
            let tableExists = false;

            try {
                const countResult = await pool.query(`SELECT COUNT(*) as cnt FROM public."${tableName}"`);
                docCount = parseInt(countResult.rows[0].cnt);
                tableExists = true;
            } catch (e) {
                // Table doesn't exist yet
            }

            // Phase A-G aware: org_settings → clients_info_new fallback.
            const props = await loadEffectiveSettings(pool, Number(cred.id));
            const getProp = (name: string) => makeGetProp(props)(name)?.trim();

            const env = getProp('signer_environment_type') || 'PreProd';
            const hasClientId = !!(env === 'Prod' ? getProp('signer_prodClientId') : getProp('signer_preProdClientId'));
            const hasClientSecret = !!(env === 'Prod' ? getProp('signer_prodClientSecret') : getProp('signer_preProdClientSecret'));

            statuses.push({
                id: cred.id,
                username: cred.username,
                tableName,
                tableExists,
                documentsCount: docCount,
                hasClientId,
                hasClientSecret,
                environment: env,
                ready: hasClientId && hasClientSecret
            });
        }

        res.json({ success: true, companies: statuses });

    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Get Full Document Details (Raw JSON)
app.get('/api/invoices/:uuid/details', async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    const uuid = req.params.uuid;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    try {
        console.log(`[Details] Fetching full doc ${uuid}`);
        // Phase A-G aware: read ETA creds from organization_settings first,
        // fall back to clients_info_new for legacy installs.
        const props = await loadEffectiveSettings(pool, Number(userId));
        const getProp = (name: string) => makeGetProp(props)(name)?.trim();

        const env = getProp('signer_environment_type') || 'PreProd';
        const clientId = env === 'Prod' ? getProp('signer_prodClientId') : getProp('signer_preProdClientId');
        const clientSecret = env === 'Prod' ? getProp('signer_prodClientSecret') : getProp('signer_preProdClientSecret');

        if (!clientId || !clientSecret) return res.status(400).json({ success: false, message: 'Missing Creds' });

        const token = await getETAToken(clientId, clientSecret, env);
        const hosts = getETAHosts(env);

        // USE /details ENDPOINT (Try ETA First)
        try {
            const response = await axios.get(`${hosts.api}/api/v1.0/documents/${uuid}/details`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            console.log(`[Details] Fetched ${uuid} from ETA.`);
            return res.json({ success: true, document: response.data });
        } catch (etaErr: any) {
            console.warn(`[Details] ETA fetch failed for ${uuid}: ${etaErr.message}. Trying local DB...`);
        }

        // Fallback: Try local DB by UUID
        try {
            const localRes = await pool.query(`SELECT "documentBody" FROM public.documents WHERE uuid = $1`, [uuid]);
            if (localRes.rows.length > 0 && localRes.rows[0].documentBody) {
                const doc = JSON.parse(localRes.rows[0].documentBody);
                console.log(`[Details] Fetched ${uuid} from local DB by UUID.`);
                return res.json({ success: true, document: doc });
            }

            // Secondary Fallback: Try searching for internalId inside documentBody JSON
            // Useful if the ID passed is actually the internalId (e.g. from Excel import)
            const internalRes = await pool.query(
                `SELECT "documentBody" FROM public.documents WHERE "documentBody"::jsonb->>'internalId' = $1 LIMIT 1`,
                [uuid]
            );
            if (internalRes.rows.length > 0 && internalRes.rows[0].documentBody) {
                const doc = JSON.parse(internalRes.rows[0].documentBody);
                console.log(`[Details] Fetched ${uuid} from local DB by matching internalId.`);
                return res.json({ success: true, document: doc });
            }
        } catch (dbErr) {
            console.error('[Details] Local DB fetch failed:', dbErr);
        }

        res.status(404).json({ success: false, message: 'Document details not found (Not on ETA and not in local DB)' });
    } catch (err: any) {
        console.error(`[Details] Error:`, err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch details' });
    }
});

// Cancel Document Endpoint
app.put('/api/documents/:uuid/cancel', async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    const uuid = req.params.uuid;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    try {
        // Phase A-G aware: pulls ETA creds from organization_settings, falls
        // back to clients_info_new only when the org tables are empty.
        const props = await loadEffectiveSettings(pool, Number(userId));
        const getProp = (name: string) => makeGetProp(props)(name)?.trim();

        const env = getProp('signer_environment_type') || 'PreProd';
        const clientId = env === 'Prod' ? getProp('signer_prodClientId') : getProp('signer_preProdClientId');
        const clientSecret = env === 'Prod' ? getProp('signer_prodClientSecret') : getProp('signer_preProdClientSecret');

        if (!clientId || !clientSecret) return res.status(400).json({ success: false, message: 'Missing Credentials' });

        const token = await getETAToken(clientId, clientSecret, env);
        const hosts = getETAHosts(env);

        console.log(`[Cancel] Cancelling ${uuid}...`);

        await axios.put(`${hosts.api}/api/v1.0/documents/state/${uuid}/state`,
            { status: "cancelled", reason: "Cancelled by User via Middleware" },
            { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
        );

        console.log(`[Cancel] Success ${uuid}`);
        // Update Local DB
        const updateRes = await pool.query(`UPDATE public.documents SET status = 'Cancelled' WHERE uuid = $1`, [uuid]);

        // If not found in local DB, insert it mechanism to ensure immediate feedback works
        if (updateRes.rowCount === 0 && syncCache[userId]) {
            const cachedDoc = syncCache[userId].docs.find(d => d.id === uuid);
            if (cachedDoc) {
                console.log(`[Cancel] Document ${uuid} not in local DB. Inserting override.`);
                try {
                    await pool.query(`
                        INSERT INTO public.documents (
                            uuid, "internalId", "receiverName", "receiverId", "dateTimeIssued", 
                            total, status, environment, "typeName"
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    `, [
                        uuid,
                        cachedDoc.internalId || 'N/A',
                        cachedDoc.receiverName || 'N/A',
                        cachedDoc.receiverId || 'N/A',
                        cachedDoc.date || new Date().toISOString(),
                        cachedDoc.total || 0,
                        'Cancelled',
                        env,
                        cachedDoc.type // 'I', 'C', or 'D'
                    ]);
                } catch (e) { console.error("Cancel Insert Error", e); }
            }
        }

        // Update Cache
        if (syncCache[userId]) {
            const cachedDoc = syncCache[userId].docs.find(d => d.id === uuid);
            if (cachedDoc) cachedDoc.status = 'Cancelled';
        }

        res.json({ success: true, message: 'Document Cancelled Successfully' });
    } catch (err: any) {
        console.error(`[Cancel] Error:`, err.message);
        const details = err.response?.data?.error || err.message;
        res.status(500).json({ success: false, message: 'Failed to cancel document', details });
    }
});

// Reject Document Endpoint
app.put('/api/documents/:uuid/reject', async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    const uuid = req.params.uuid;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    try {
        // Phase A-G aware: pulls ETA creds from organization_settings, falls
        // back to clients_info_new only when the org tables are empty.
        const props = await loadEffectiveSettings(pool, Number(userId));
        const getProp = (name: string) => makeGetProp(props)(name)?.trim();

        const env = getProp('signer_environment_type') || 'PreProd';
        const clientId = env === 'Prod' ? getProp('signer_prodClientId') : getProp('signer_preProdClientId');
        const clientSecret = env === 'Prod' ? getProp('signer_prodClientSecret') : getProp('signer_preProdClientSecret');

        if (!clientId || !clientSecret) return res.status(400).json({ success: false, message: 'Missing Credentials' });

        const token = await getETAToken(clientId, clientSecret, env);
        const hosts = getETAHosts(env);

        console.log(`[Reject] Rejecting ${uuid}...`);

        await axios.put(`${hosts.api}/api/v1.0/documents/state/${uuid}/decline/rejection`,
            { status: "rejected", reason: "Rejected by User via Middleware" },
            { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
        );

        console.log(`[Reject] Success ${uuid}`);
        // Update Local DB
        const updateRes = await pool.query(`UPDATE public.documents SET status = 'Rejected' WHERE uuid = $1`, [uuid]);

        // If not found in local DB, insert it mechanism to ensure immediate feedback works
        if (updateRes.rowCount === 0 && syncCache[userId]) {
            const cachedDoc = syncCache[userId].docs.find(d => d.id === uuid);
            if (cachedDoc) {
                console.log(`[Reject] Document ${uuid} not in local DB. Inserting override.`);
                try {
                    await pool.query(`
                        INSERT INTO public.documents (
                            uuid, "internalId", "receiverName", "receiverId", "dateTimeIssued", 
                            total, status, environment, "typeName"
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    `, [
                        uuid,
                        cachedDoc.internalId || 'N/A',
                        cachedDoc.receiverName || 'N/A',
                        cachedDoc.receiverId || 'N/A',
                        cachedDoc.date || new Date().toISOString(),
                        cachedDoc.total || 0,
                        'Rejected',
                        env,
                        cachedDoc.type // 'I', 'C', or 'D'
                    ]);
                } catch (e) { console.error("Reject Insert Error", e); }
            }
        }

        // Update Cache
        if (syncCache[userId]) {
            const cachedDoc = syncCache[userId].docs.find(d => d.id === uuid);
            if (cachedDoc) cachedDoc.status = 'Rejected';
        }

        res.json({ success: true, message: 'Document Rejected Successfully' });
    } catch (err: any) {
        console.error(`[Reject] Error:`, err.message);
        const details = err.response?.data?.error || err.message;
        res.status(500).json({ success: false, message: 'Failed to reject document', details });
    }
});

// Test ETA Credentials Endpoint
app.post('/api/test-credentials', async (req, res) => {
    const { clientId, clientSecret, env } = req.body;

    if (!clientId || !clientSecret) {
        return res.status(400).json({ success: false, message: 'Missing Client ID or Secret' });
    }

    try {
        console.log(`[Test Connection] Testing ${env} credentials...`);
        const token = await getETAToken(clientId, clientSecret, env);
        if (token && token.length > 20) {
            return res.json({ success: true, message: 'Connection Successful! Token retrieved.' });
        } else {
            throw new Error('Retrieved token is empty or invalid.');
        }
    } catch (err: any) {
        console.error('[Test Connection] Failed:', err.message);
        // Return detailed error from ETA if available
        const details = err.response?.data?.error || err.message;
        res.status(401).json({ success: false, message: 'Connection Failed', details });
    }
});

// Update User Settings Endpoint
// ============================================================
// Load Settings from DB — fetches fresh data for current user
// ============================================================
app.get('/api/settings/load', async (req, res) => {
    try {
        // Get userId from JWT token or x-user-id header
        let userId: number | null = null;

        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            try {
                const jwt = await import('jsonwebtoken');
                const decoded = jwt.default.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production') as any;
                userId = decoded.userId;
            } catch (e) { /* invalid token */ }
        }

        if (!userId) {
            userId = parseInt(req.headers['x-user-id'] as string);
        }

        if (!userId || isNaN(userId)) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const properties: { property_name: string; property_value: string }[] = [];
        const seen = new Set<string>();

        // ANY property name that has an org-scoped destination is locked from the
        // per-user clients_info_new fallback. Without this lock, an admin clearing
        // a setting (e.g. ERP Login Username) saves an empty org row, but a stale
        // per-user row from before the org migration shadows the empty and brings
        // the old value back on next load. Locking up-front prevents that.
        for (const name of Object.keys(ORG_TABLE_FIELDS)) seen.add(name.toLowerCase());
        for (const name of Object.keys(ORG_SETTINGS_FIELDS)) seen.add(name.toLowerCase());
        for (const name of Object.keys(ORG_INTEGRATION_FIELDS)) seen.add(name.toLowerCase());

        // Org-scoped pushes never need to check `seen` — the routing-map names
        // are pre-locked above, and any other org-scoped name (org_join_code, etc.)
        // is only emitted from one place.
        const pushOrg = (name: string, value: any) => {
            if (value === null || value === undefined || value === '') return;
            properties.push({ property_name: name, property_value: String(value) });
        };
        // Per-user fallback (clients_info_new). Only fills in fields that no
        // org-scoped table owns. Empty values skip — there's nothing to fall back to.
        const push = (name: string, value: any) => {
            if (value === null || value === undefined || value === '') return;
            if (seen.has(name.toLowerCase())) return;
            seen.add(name.toLowerCase());
            properties.push({ property_name: name, property_value: String(value) });
        };

        // Resolve user type + scoped org id (super-admins can view any org via ?orgId=)
        let isPortalUser = false;
        let isSuperAdmin = false;
        try {
            const superResult = await pool.query(
                `SELECT id FROM "otaxdb".super_admins WHERE id = $1 LIMIT 1`,
                [userId]
            );
            if (superResult.rows.length > 0) isSuperAdmin = true;
        } catch (e) { /* super_admins table may not exist */ }

        const scopedOrgId = req.query.orgId ? parseInt(req.query.orgId as string) : null;

        let resolvedOrgId: number | null = scopedOrgId;
        try {
            const portalResult = await pool.query(
                `SELECT id, organization_id FROM "otaxdb".portal_users WHERE id = $1 LIMIT 1`,
                [userId]
            );
            if (portalResult.rows.length > 0) {
                isPortalUser = true;
                if (!resolvedOrgId) resolvedOrgId = portalResult.rows[0].organization_id;
            }
        } catch (e) { /* portal_users table may not exist */ }

        // ── 1. organizations (company identity + address) ──
        if (resolvedOrgId) {
            try {
                const orgResult = await pool.query(
                    `SELECT name, tax_id, company_type, country, city, region_city, street,
                            building_number, postal_code, floor, room, landmark, additional_info,
                            branch_id, logo_url
                     FROM "otaxdb".organizations WHERE id = $1`,
                    [resolvedOrgId]
                );
                if (orgResult.rows.length > 0) {
                    const o = orgResult.rows[0];
                    pushOrg('issuer_name', o.name);
                    pushOrg('issuer_id', o.tax_id);
                    pushOrg('user_type', o.company_type);
                    pushOrg('issuer_country', o.country);
                    pushOrg('issuer_governorate', o.city);
                    pushOrg('issuer_regionCity', o.region_city);
                    pushOrg('issuer_street', o.street);
                    pushOrg('issuer_buildingNumber', o.building_number);
                    pushOrg('issuer_postalCode', o.postal_code);
                    pushOrg('issuer_floor', o.floor);
                    pushOrg('issuer_room', o.room);
                    pushOrg('issuer_landmark', o.landmark);
                    pushOrg('issuer_additionalInfo', o.additional_info);
                    pushOrg('issuer_branchId', o.branch_id);
                    pushOrg('issuer_logo_url', o.logo_url);
                }
            } catch (e: any) { console.warn('[Settings/load] organizations:', e.message); }

            // ── 2. organization_settings (ETA env + creds + export rules + language) ──
            try {
                const sRes = await pool.query(
                    `SELECT eta_environment, eta_preprod_client_id, eta_preprod_client_secret,
                            eta_prod_client_id, eta_prod_client_secret, eta_submit_format,
                            export_date_format, export_auto_convert_utf8, export_use_old_field_names,
                            export_no_of_days, export_replace_date_with_current, export_reduce_hours,
                            default_language, tax_activity_code
                     FROM "otaxdb".organization_settings WHERE organization_id = $1`,
                    [resolvedOrgId]
                );
                if (sRes.rows.length > 0) {
                    const s = sRes.rows[0];
                    pushOrg('signer_environment_type', s.eta_environment);
                    pushOrg('signer_preProdClientId', s.eta_preprod_client_id);
                    // Secrets: never leak the cleartext. Send a sentinel so the UI can
                    // render bullets and the save handler knows to preserve the existing
                    // value when the user submits without typing anything.
                    pushOrg('signer_preProdClientSecret', s.eta_preprod_client_secret ? SECRET_PLACEHOLDER : '');
                    pushOrg('signer_prodClientId', s.eta_prod_client_id);
                    pushOrg('signer_prodClientSecret', s.eta_prod_client_secret ? SECRET_PLACEHOLDER : '');
                    pushOrg('eta_submit_format', s.eta_submit_format);
                    pushOrg('dateTimeIssued_Format', s.export_date_format);
                    if (s.export_auto_convert_utf8 !== null) pushOrg('export_autoConvertUtf8', s.export_auto_convert_utf8);
                    if (s.export_use_old_field_names !== null) pushOrg('export_useOldFieldNames', s.export_use_old_field_names);
                    pushOrg('export_noOfDays', s.export_no_of_days);
                    if (s.export_replace_date_with_current !== null) pushOrg('export_replaceDateWithCurrent', s.export_replace_date_with_current);
                    pushOrg('export_reduceHours', s.export_reduce_hours);
                    pushOrg('user_language', s.default_language);
                    pushOrg('tax_payer_activity_code', s.tax_activity_code);
                }
            } catch (e: any) { console.warn('[Settings/load] organization_settings:', e.message); }

            // ── 3. org_integration_settings (ERP + Log DB) ──
            try {
                const iRes = await pool.query(
                    `SELECT erp_provider, erp_host, erp_db, erp_user, erp_password_encrypted,
                            erp_legal_entity, erp_doc_type_version, erp_header_view, erp_lines_view,
                            logdb_mode, logdb_provider, logdb_host, logdb_port, logdb_db,
                            logdb_user, logdb_password_encrypted
                     FROM "otaxdb".org_integration_settings WHERE organization_id = $1`,
                    [resolvedOrgId]
                );
                if (iRes.rows.length > 0) {
                    const i = iRes.rows[0];
                    pushOrg('selected_erp', i.erp_provider);
                    pushOrg('invoices_Server', i.erp_host);
                    pushOrg('invoices_ServerDB', i.erp_db);
                    pushOrg('invoices_ServerUID', i.erp_user);
                    pushOrg('invoices_ServerPWD', i.erp_password_encrypted ? SECRET_PLACEHOLDER : '');
                    pushOrg('legal_Entity', i.erp_legal_entity);
                    pushOrg('xml_Auto_Export_documentTypeVersion', i.erp_doc_type_version);
                    pushOrg('erp_headerView', i.erp_header_view);
                    pushOrg('erp_linesView', i.erp_lines_view);
                    pushOrg('logdb_mode', i.logdb_mode);
                    pushOrg('log_ServerProvider', i.logdb_provider);
                    pushOrg('log_ServerHost', i.logdb_host);
                    pushOrg('log_ServerPort', i.logdb_port);
                    pushOrg('log_ServerDB', i.logdb_db);
                    pushOrg('log_ServerUser', i.logdb_user);
                    pushOrg('log_ServerPass', i.logdb_password_encrypted ? SECRET_PLACEHOLDER : '');
                }
            } catch (e: any) { console.warn('[Settings/load] org_integration_settings:', e.message); }
        }

        // ── 4. clients_info_new (per-user fallback for anything not org-routed) ──
        try {
            const infoResult = await pool.query(
                `SELECT property_name, property_value FROM "otaxdb".clients_info_new WHERE uid = $1`,
                [userId]
            );
            for (const row of infoResult.rows) {
                // Hide per-user secrets behind the same placeholder protocol used
                // by org-scoped secrets above. Backend signing flows that need the
                // real PIN read clients_info_new directly, so they don't go through
                // this load endpoint and aren't affected.
                if (SECRET_PROPERTY_NAMES.has(row.property_name)) {
                    if (row.property_value) push(row.property_name, SECRET_PLACEHOLDER);
                    continue;
                }
                push(row.property_name, row.property_value);
            }
        } catch (e: any) { console.warn('[Settings/load] clients_info_new:', e.message); }

        console.log(`[Settings] Loaded ${properties.length} properties for user ${userId} (portal=${isPortalUser}, super=${isSuperAdmin}, org=${resolvedOrgId})`);
        res.json({ success: true, properties });

    } catch (err: any) {
        console.error('[Settings] Load error:', err);
        res.status(500).json({ success: false, message: 'Failed to load settings: ' + err.message });
    }
});

// Debug marker — bumped whenever the settings-save/load logic changes so we
// can verify the running backend has the latest code (especially in dev where
// tsx watch sometimes lags behind file edits).
app.get('/api/settings/_debug_version', (_req, res) => {
    res.json({ version: '2026-04-29-shadow-fix-v3', ts: new Date().toISOString() });
});

// ─── Reveal a single secret in cleartext (for "verify what was saved") ─────
// Org admins (and super admins) can reveal the actual stored cleartext for one
// named secret. Used by the eye icon on Client Secret / ERP password / etc.
// Audit-logged on every call.
app.get('/api/settings/reveal-secret', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        let userId: number | null = null;
        if (token) {
            try {
                const jwt = await import('jsonwebtoken');
                const decoded: any = jwt.default.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
                userId = decoded.userId;
            } catch { /* invalid token */ }
        }
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const name = String(req.query.name || '');
        if (!name) return res.status(400).json({ success: false, message: 'name query param required' });

        // Allowlist — never reveal anything outside the known secret property names.
        const KNOWN_SECRETS = new Set([
            'signer_preProdClientSecret',
            'signer_prodClientSecret',
            'invoices_ServerPWD',
            'log_ServerPass',
            'signer_CurrentCertPIN',
        ]);
        if (!KNOWN_SECRETS.has(name)) {
            return res.status(400).json({ success: false, message: 'Unknown or non-revealable property' });
        }

        // Resolve org + verify caller is org_admin or super_admin
        let isPortalUser = false;
        let isSuperAdmin = false;
        try {
            const sa = await pool.query(`SELECT id FROM "otaxdb".super_admins WHERE id = $1 LIMIT 1`, [userId]);
            if (sa.rows.length > 0) isSuperAdmin = true;
        } catch { /* table may not exist */ }

        let orgId: number | null = req.query.orgId ? parseInt(req.query.orgId as string) : null;
        try {
            const pu = await pool.query(`SELECT organization_id FROM "otaxdb".portal_users WHERE id = $1 LIMIT 1`, [userId]);
            if (pu.rows.length > 0) {
                isPortalUser = true;
                if (!orgId) orgId = pu.rows[0].organization_id;
            }
        } catch { /* table may not exist */ }
        if (!isPortalUser && !isSuperAdmin) {
            const cr = await pool.query(`SELECT organization_id FROM "otaxdb".credentials WHERE id = $1 LIMIT 1`, [userId]);
            if (cr.rows.length > 0 && !orgId) orgId = cr.rows[0].organization_id;
        }

        // Org-admin gate: load roles, allow if super_admin OR org_admin OR admin
        let isOrgAdmin = false;
        if (!isSuperAdmin) {
            try {
                const roleRows = await pool.query(
                    `SELECT r.name FROM "otaxdb".portal_user_roles pur
                       JOIN "otaxdb".roles r ON r.id = pur.role_id
                      WHERE pur.user_id = $1
                     UNION
                     SELECT r.name FROM "otaxdb".user_roles ur
                       JOIN "otaxdb".roles r ON r.id = ur.role_id
                      WHERE ur.user_id = $1`,
                    [userId]
                );
                isOrgAdmin = roleRows.rows.some((r: any) => r.name === 'org_admin' || r.name === 'admin');
            } catch { /* fall through */ }
        }
        if (!isSuperAdmin && !isOrgAdmin) {
            return res.status(403).json({ success: false, message: 'Only organization admins can reveal stored secrets.' });
        }

        // Fetch the cleartext from the right table
        let cleartext: string | null = null;
        if (name === 'signer_preProdClientSecret' || name === 'signer_prodClientSecret') {
            if (!orgId) return res.status(400).json({ success: false, message: 'No organization scope resolved' });
            const col = name === 'signer_prodClientSecret' ? 'eta_prod_client_secret' : 'eta_preprod_client_secret';
            const r = await pool.query(`SELECT ${col} AS v FROM "otaxdb".organization_settings WHERE organization_id = $1`, [orgId]);
            cleartext = r.rows[0]?.v || null;
        } else if (name === 'invoices_ServerPWD' || name === 'log_ServerPass') {
            if (!orgId) return res.status(400).json({ success: false, message: 'No organization scope resolved' });
            const col = name === 'invoices_ServerPWD' ? 'erp_password_encrypted' : 'logdb_password_encrypted';
            const r = await pool.query(`SELECT ${col} AS v FROM "otaxdb".org_integration_settings WHERE organization_id = $1`, [orgId]);
            cleartext = decryptSecret(r.rows[0]?.v ?? null);
        } else if (name === 'signer_CurrentCertPIN') {
            // Per-user secret stored in clients_info_new (encrypted).
            const r = await pool.query(
                `SELECT property_value FROM "otaxdb".clients_info_new WHERE uid = $1 AND property_name = $2`,
                [userId, name]
            );
            cleartext = decryptSecret(r.rows[0]?.property_value ?? null);
        }

        // Audit log — record who revealed which secret
        try {
            await pool.query(
                `INSERT INTO "otaxdb".user_activity_logs (user_id, username, action, module, resource_type, resource_id, details, created_at)
                 VALUES ($1, $2, 'secret_revealed', 'settings', 'secret', $3, $4, NOW())`,
                [userId, String(userId), name, JSON.stringify({ orgId, hasValue: !!cleartext })]
            );
        } catch { /* audit log table may not exist on older deployments */ }

        if (!cleartext) {
            return res.json({ success: true, value: '', empty: true });
        }
        return res.json({ success: true, value: cleartext });
    } catch (err: any) {
        console.error('[Settings] Reveal error:', err);
        res.status(500).json({ success: false, message: 'Failed to reveal secret: ' + err.message });
    }
});

// ─── Settings save/load — field routing rules ─────────────────────────────
// Routing maps live in services/settingsRouting.ts so the standalone migration
// script in scripts/migrate-settings.ts can share them. Add a new setting?
// Edit the map there and both save/load and migration pick it up.

// Idempotent migrations — applied lazily on first save so existing
// deployments don't need a separate migration step. Cheap enough to run
// on every save (the IF NOT EXISTS clauses make them no-ops once applied).
async function ensureSettingsSchema(client: any): Promise<void> {
    // Phase A: company-level address columns on organizations
    await client.query(`
        ALTER TABLE "otaxdb".organizations
          ADD COLUMN IF NOT EXISTS street VARCHAR(500),
          ADD COLUMN IF NOT EXISTS building_number VARCHAR(50),
          ADD COLUMN IF NOT EXISTS postal_code VARCHAR(50),
          ADD COLUMN IF NOT EXISTS floor VARCHAR(50),
          ADD COLUMN IF NOT EXISTS room VARCHAR(50),
          ADD COLUMN IF NOT EXISTS landmark VARCHAR(500),
          ADD COLUMN IF NOT EXISTS additional_info TEXT,
          ADD COLUMN IF NOT EXISTS region_city VARCHAR(255),
          ADD COLUMN IF NOT EXISTS branch_id VARCHAR(50),
          ADD COLUMN IF NOT EXISTS logo_url TEXT
    `);
    // Phase D: export rules + language + activity code on organization_settings
    await client.query(`
        ALTER TABLE "otaxdb".organization_settings
          ADD COLUMN IF NOT EXISTS export_date_format VARCHAR(50),
          ADD COLUMN IF NOT EXISTS export_auto_convert_utf8 BOOLEAN,
          ADD COLUMN IF NOT EXISTS export_use_old_field_names BOOLEAN,
          ADD COLUMN IF NOT EXISTS export_no_of_days INTEGER,
          ADD COLUMN IF NOT EXISTS export_replace_date_with_current BOOLEAN,
          ADD COLUMN IF NOT EXISTS export_reduce_hours INTEGER,
          ADD COLUMN IF NOT EXISTS default_language VARCHAR(10),
          ADD COLUMN IF NOT EXISTS tax_activity_code VARCHAR(50)
    `);
    // Phase B: brand-new table for ERP + Log DB integration creds
    await client.query(`
        CREATE TABLE IF NOT EXISTS "otaxdb".org_integration_settings (
            organization_id        INTEGER PRIMARY KEY,
            erp_provider           VARCHAR(50),
            erp_host               VARCHAR(500),
            erp_db                 VARCHAR(255),
            erp_user               VARCHAR(255),
            erp_password_encrypted TEXT,
            erp_legal_entity       VARCHAR(100),
            erp_doc_type_version   VARCHAR(20),
            erp_header_view        VARCHAR(255),
            erp_lines_view         VARCHAR(255),
            logdb_mode             VARCHAR(20),
            logdb_provider         VARCHAR(50),
            logdb_host             VARCHAR(500),
            logdb_port             VARCHAR(20),
            logdb_db               VARCHAR(255),
            logdb_user             VARCHAR(255),
            logdb_password_encrypted TEXT,
            updated_at             TIMESTAMP DEFAULT NOW()
        )
    `);
}

// Update User Settings Endpoint
// Supports both portal_users (new) and credentials (legacy)
app.post('/api/settings/save', async (req, res) => {
    const { userId, settings } = req.body;

    if (!userId || !settings) {
        return res.status(400).json({ success: false, message: 'Missing userId or settings' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await ensureSettingsSchema(client);

        // ── Resolve user type + org id ──
        let isPortalUser = false;
        let orgId: number | null = null;

        try {
            const portalResult = await client.query(
                `SELECT id, organization_id FROM "otaxdb".portal_users WHERE id = $1 LIMIT 1`,
                [userId]
            );
            if (portalResult.rows.length > 0) {
                isPortalUser = true;
                orgId = portalResult.rows[0].organization_id;
            }
        } catch (e) { /* portal_users table may not exist */ }

        if (!isPortalUser) {
            const credResult = await client.query(
                `SELECT id, organization_id, hwid FROM "otaxdb".credentials WHERE id = $1 LIMIT 1`,
                [userId]
            );
            if (credResult.rows.length === 0) {
                throw new Error('User not found in portal_users or credentials');
            }
            orgId = credResult.rows[0].organization_id;
        }

        // Allow super admins to scope per-org via ?orgId=NN
        const scopedOrgId = req.query?.orgId ? parseInt(req.query.orgId as string) : null;
        const targetOrgId = scopedOrgId || orgId;

        // Bucketize incoming properties by destination table.
        const orgUpdates: Record<string, string> = {};
        const orgSettingsUpdates: Record<string, any> = {};
        const orgIntegrationUpdates: Record<string, any> = {};
        const userBucketUpdates: Record<string, any> = {};

        for (const [name, rawValue] of Object.entries(settings)) {
            // Secret fields: skip if user left it as the sentinel — preserves
            // the existing ciphertext / cleartext untouched.
            if (SECRET_PROPERTY_NAMES.has(name) && rawValue === SECRET_PLACEHOLDER) continue;

            const orgCol = ORG_TABLE_FIELDS[name];
            if (orgCol) { orgUpdates[orgCol] = rawValue == null ? '' : String(rawValue); continue; }

            const settingsCol = ORG_SETTINGS_FIELDS[name];
            if (settingsCol) { orgSettingsUpdates[settingsCol] = coerceForColumn(settingsCol, rawValue); continue; }

            const integrationCol = ORG_INTEGRATION_FIELDS[name];
            if (integrationCol) {
                if (ENCRYPTED_INTEGRATION_COLUMNS.has(integrationCol)) {
                    // The bullet sentinel means "user didn't touch this field" — preserve
                    // the existing ciphertext. (Already filtered out by the SECRET_PROPERTY_NAMES
                    // check above, but kept here as belt-and-suspenders.)
                    if (rawValue === SECRET_PLACEHOLDER) continue;
                    // Empty / null = user explicitly cleared the field → wipe the secret.
                    if (rawValue === null || rawValue === undefined || rawValue === '') {
                        orgIntegrationUpdates[integrationCol] = null;
                    } else {
                        orgIntegrationUpdates[integrationCol] = encryptSecret(String(rawValue));
                    }
                } else {
                    orgIntegrationUpdates[integrationCol] = rawValue == null ? null : String(rawValue);
                }
                continue;
            }

            // Unknown name → per-user fallback. Log a warning so we notice settings
            // that landed in clients_info_new instead of an org-scoped table — those
            // won't propagate to other users in the same organization.
            console.warn(`[Settings] Unmapped property "${name}" — saving per-user (clients_info_new). Add it to ORG_TABLE_FIELDS / ORG_SETTINGS_FIELDS / ORG_INTEGRATION_FIELDS to make it org-scoped.`);
            userBucketUpdates[name] = rawValue;
        }

        // ── Apply org-scoped updates (skip silently if no org) ──
        if (targetOrgId) {
            // organizations
            if (Object.keys(orgUpdates).length > 0) {
                const cols = Object.keys(orgUpdates);
                const setClauses = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
                await client.query(
                    `UPDATE "otaxdb".organizations SET ${setClauses} WHERE id = $1`,
                    [targetOrgId, ...cols.map(c => orgUpdates[c])]
                );
            }
            // organization_settings (upsert)
            if (Object.keys(orgSettingsUpdates).length > 0) {
                const cols = Object.keys(orgSettingsUpdates);
                const vals = cols.map(c => orgSettingsUpdates[c]);
                const exists = await client.query(
                    `SELECT 1 FROM "otaxdb".organization_settings WHERE organization_id = $1`, [targetOrgId]
                );
                if (exists.rowCount && exists.rowCount > 0) {
                    const setClauses = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
                    await client.query(
                        `UPDATE "otaxdb".organization_settings SET ${setClauses}, updated_at = NOW() WHERE organization_id = $1`,
                        [targetOrgId, ...vals]
                    );
                } else {
                    const colNames = ['organization_id', ...cols, 'updated_at'].join(', ');
                    const placeholders = cols.map((_, i) => `$${i + 2}`).join(', ');
                    await client.query(
                        `INSERT INTO "otaxdb".organization_settings (${colNames}) VALUES ($1, ${placeholders}, NOW())`,
                        [targetOrgId, ...vals]
                    );
                }
            }
            // org_integration_settings (upsert)
            if (Object.keys(orgIntegrationUpdates).length > 0) {
                const cols = Object.keys(orgIntegrationUpdates);
                const vals = cols.map(c => orgIntegrationUpdates[c]);
                const exists = await client.query(
                    `SELECT 1 FROM "otaxdb".org_integration_settings WHERE organization_id = $1`, [targetOrgId]
                );
                if (exists.rowCount && exists.rowCount > 0) {
                    const setClauses = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
                    await client.query(
                        `UPDATE "otaxdb".org_integration_settings SET ${setClauses}, updated_at = NOW() WHERE organization_id = $1`,
                        [targetOrgId, ...vals]
                    );
                } else {
                    const colNames = ['organization_id', ...cols, 'updated_at'].join(', ');
                    const placeholders = cols.map((_, i) => `$${i + 2}`).join(', ');
                    await client.query(
                        `INSERT INTO "otaxdb".org_integration_settings (${colNames}) VALUES ($1, ${placeholders}, NOW())`,
                        [targetOrgId, ...vals]
                    );
                }
            }
        } else if (Object.keys(orgUpdates).length + Object.keys(orgSettingsUpdates).length + Object.keys(orgIntegrationUpdates).length > 0) {
            console.warn(`[Settings] User ${userId} has no organization — org-scoped fields will fall through to clients_info_new`);
            // Fall back: route them through the per-user bucket so we don't lose them
            Object.assign(userBucketUpdates, settings);
        }

        // Scrub stale per-user shadows for any property that has an org-scoped destination.
        // Pre-routing-map deployments wrote everything to clients_info_new; if those legacy
        // rows linger they'd resurface on /settings/load and override what the admin saved
        // org-scoped (especially after explicit clears). Delete them — the org table is now
        // the single source of truth for these names.
        try {
            const allRoutedNames = [
                ...Object.keys(ORG_TABLE_FIELDS),
                ...Object.keys(ORG_SETTINGS_FIELDS),
                ...Object.keys(ORG_INTEGRATION_FIELDS),
            ];
            // Sweep across every user in the same org so a different user's stale row
            // can't shadow either. Per-user secrets like signer_CurrentCertPIN are NOT in
            // these maps so they survive the sweep.
            if (targetOrgId && allRoutedNames.length > 0) {
                await client.query(
                    `DELETE FROM "otaxdb".clients_info_new
                      WHERE property_name = ANY($1::text[])
                        AND uid IN (
                            SELECT id FROM "otaxdb".portal_users WHERE organization_id = $2
                            UNION
                            SELECT id FROM "otaxdb".credentials   WHERE organization_id = $2
                        )`,
                    [allRoutedNames, targetOrgId]
                );
            }
        } catch (e: any) {
            console.warn('[Settings] Stale per-user shadow cleanup failed:', e.message);
        }

        // ── Per-user fallback (clients_info_new) ──
        // Synthesise an hwid for portal users (legacy column we still write so
        // older code paths that read it don't choke on NULL).
        if (Object.keys(userBucketUpdates).length > 0) {
            let hwid: string = 'PORTAL-' + userId;
            if (!isPortalUser) {
                const hwidResult = await client.query(
                    `SELECT hwid FROM "otaxdb".credentials WHERE id = $1`, [userId]
                );
                hwid = hwidResult.rows[0]?.hwid || 'CLOUD-' + Math.random().toString(36).substr(2, 9).toUpperCase();
                if (!hwidResult.rows[0]?.hwid) {
                    await client.query(
                        `UPDATE "otaxdb".credentials SET hwid = $1 WHERE id = $2`,
                        [hwid, userId]
                    );
                }
            }

            // Per-user secrets in clients_info_new get the same at-rest
            // encryption as org-scoped secrets in org_integration_settings.
            // Right now this means signer_CurrentCertPIN — read paths that
            // need the cleartext PIN go through loadEffectiveSettings, which
            // decrypts transparently.
            const PER_USER_ENCRYPTED = new Set(['signer_CurrentCertPIN']);

            for (const [propertyName, propertyValue] of Object.entries(userBucketUpdates)) {
                let storedValue = propertyValue;
                if (PER_USER_ENCRYPTED.has(propertyName) && propertyValue !== null && propertyValue !== '') {
                    storedValue = encryptSecret(String(propertyValue));
                }
                const checkResult = await client.query(
                    `SELECT property_name FROM "otaxdb".clients_info_new WHERE uid = $1 AND property_name = $2`,
                    [userId, propertyName]
                );
                if (checkResult.rows.length > 0) {
                    await client.query(
                        `UPDATE "otaxdb".clients_info_new SET property_value = $1, modify_date = NOW() WHERE uid = $2 AND property_name = $3`,
                        [storedValue, userId, propertyName]
                    );
                } else {
                    await client.query(
                        `INSERT INTO "otaxdb".clients_info_new (uid, hwid, property_name, property_value, "nonAdminEdit", modify_date) VALUES ($1, $2, $3, $4, true, NOW())`,
                        [userId, hwid, propertyName, storedValue]
                    );
                }
            }
        }

        await client.query('COMMIT');

        const summary = {
            orgCols:         Object.keys(orgUpdates),
            settingsCols:    Object.keys(orgSettingsUpdates),
            integrationCols: Object.keys(orgIntegrationUpdates),
            perUserProps:    Object.keys(userBucketUpdates),
            orgScoped:       Boolean(targetOrgId),
        };
        console.log(`[Settings] Saved for user ${userId} (org=${targetOrgId}): ${summary.orgCols.length} org cols, ${summary.settingsCols.length} settings cols, ${summary.integrationCols.length} integration cols, ${summary.perUserProps.length} user props`);
        res.json({ success: true, message: 'Settings saved successfully', summary });

    } catch (err: any) {
        await client.query('ROLLBACK');
        console.error('[Settings] Save error:', err);
        res.status(500).json({ success: false, message: 'Failed to save settings: ' + err.message });
    } finally {
        client.release();
    }
});

// Download Invoice PDF Endpoint
app.get('/api/documents/:uuid/pdf', async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    const uuid = req.params.uuid;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    try {
        // Phase A-G aware: pulls ETA creds from organization_settings, falls
        // back to clients_info_new only when the org tables are empty.
        const props = await loadEffectiveSettings(pool, Number(userId));
        const getProp = (name: string) => makeGetProp(props)(name)?.trim();

        const env = getProp('signer_environment_type') || 'PreProd';
        const clientId = env === 'Prod' ? getProp('signer_prodClientId') : getProp('signer_preProdClientId');
        const clientSecret = env === 'Prod' ? getProp('signer_prodClientSecret') : getProp('signer_preProdClientSecret');

        if (!clientId || !clientSecret) return res.status(400).json({ success: false, message: 'Missing Credentials' });

        const token = await getETAToken(clientId, clientSecret, env);
        const hosts = getETAHosts(env);

        console.log(`[PDF] Fetching PDF for ${uuid}...`);

        const response = await axios.get(`${hosts.api}/api/v1.0/documents/${uuid}/pdf`, {
            headers: { 'Authorization': `Bearer ${token}` },
            responseType: 'arraybuffer',
            validateStatus: (status) => true
        });

        const contentType = response.headers['content-type'];
        if (response.status !== 200 || (contentType && contentType.includes('application/json'))) {
            const errText = Buffer.from(response.data).toString('utf8');
            console.error(`[PDF] ETA Error ${response.status}: ${errText}`);
            return res.status(response.status === 200 ? 500 : response.status).json({ success: false, message: 'ETA PDF API Error', details: errText });
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${uuid}.pdf"`);
        res.send(response.data);

    } catch (err: any) {
        console.error(`[PDF] Error:`, err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch PDF', details: err.message });
    }
});

// Download Invoice XML Endpoint
app.get('/api/documents/:uuid/xml', async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    const uuid = req.params.uuid;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    try {
        // Phase A-G aware: pulls ETA creds from organization_settings, falls
        // back to clients_info_new only when the org tables are empty.
        const props = await loadEffectiveSettings(pool, Number(userId));
        const getProp = (name: string) => makeGetProp(props)(name)?.trim();

        const env = getProp('signer_environment_type') || 'PreProd';
        const clientId = env === 'Prod' ? getProp('signer_prodClientId') : getProp('signer_preProdClientId');
        const clientSecret = env === 'Prod' ? getProp('signer_prodClientSecret') : getProp('signer_preProdClientSecret');

        if (!clientId || !clientSecret) return res.status(400).json({ success: false, message: 'Missing Credentials' });

        const token = await getETAToken(clientId, clientSecret, env);
        const hosts = getETAHosts(env);

        console.log(`[XML] Fetching Details for ${uuid}...`);

        let docData = null;

        // Try ETA
        try {
            const response = await axios.get(`${hosts.api}/api/v1.0/documents/${uuid}/details`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            docData = response.data;
        } catch (etaErr) {
            console.warn(`[XML] ETA fetch failed. Trying local DB...`);
            const localRes = await pool.query(`SELECT "documentBody" FROM public.documents WHERE uuid = $1`, [uuid]);
            if (localRes.rows.length > 0 && localRes.rows[0].documentBody) {
                // Handle both string and object cases for JSONB/JSON columns
                docData = typeof localRes.rows[0].documentBody === 'string'
                    ? JSON.parse(localRes.rows[0].documentBody)
                    : localRes.rows[0].documentBody;
            }
        }

        if (!docData) {
            return res.status(404).json({ success: false, message: 'Document data not found' });
        }

        // Convert to XML
        // Note: The root tag in user example is <document>
        const xml = jsonToXml(docData, 'document');
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Disposition', `attachment; filename="${uuid}.xml"`);
        res.send(xml);

    } catch (err: any) {
        console.error(`[XML] Error:`, err.message);
        res.status(500).json({ success: false, message: 'Failed to generate XML', details: err.message });
    }
});

// Helper: Simple JSON to XML Converter
function jsonToXml(obj: any, rootName: string = 'root'): string {
    const parse = (data: any): string => {
        let str = '';
        if (data === null || data === undefined) return '';
        if (typeof data !== 'object') return String(data).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        for (const key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                const value = data[key];
                if (Array.isArray(value)) {
                    value.forEach(item => {
                        let subKey = key.replace(/s$/, '');
                        // heuristic fixes
                        if (key === 'invoiceLines') subKey = 'invoiceLine';
                        if (key === 'taxableItems') subKey = 'taxableItem';
                        if (key === 'taxTotals') subKey = 'taxTotal';
                        if (key === 'signatures') subKey = 'signature';
                        if (key === 'validationSteps') subKey = 'validationSteps';

                        str += `<${subKey}>${parse(item)}</${subKey}>`;
                    });
                } else {
                    str += `<${key}>${parse(value)}</${key}>`;
                }
            }
        }
        return str;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n<${rootName}>${parse(obj)}</${rootName}>`;
}

// Clear Cache Endpoint - Used when environment changes
app.post('/api/cache/clear', async (req, res) => {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        // Clear the sync cache for this user
        if (syncCache[userId]) {
            delete syncCache[userId];
            console.log(`[Cache] Cleared cache for user ${userId}`);
        }

        res.json({ success: true, message: 'Cache cleared successfully' });
    } catch (err: any) {
        console.error('[Cache] Clear error:', err);
        res.status(500).json({ success: false, message: 'Failed to clear cache: ' + err.message });
    }
});

// Parse Excel Invoice Endpoint
app.post('/api/excel/parse', express.json({ limit: '50mb' }), async (req, res) => {
    try {
        const { excelData } = req.body; // Base64 encoded Excel file

        if (!excelData) {
            return res.status(400).json({ success: false, message: 'No Excel data provided' });
        }

        // Decode base64 and read Excel
        const buffer = Buffer.from(excelData, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer' });

        // Check for required sheets
        if (!workbook.SheetNames.includes('header') || !workbook.SheetNames.includes('detail')) {
            return res.status(400).json({
                success: false,
                message: 'Excel file must contain "header" and "detail" sheets'
            });
        }

        // Parse header sheet
        const headerSheet = workbook.Sheets['header'];
        const headerData = XLSX.utils.sheet_to_json(headerSheet);

        // Parse detail sheet
        const detailSheet = workbook.Sheets['detail'];
        const detailData = XLSX.utils.sheet_to_json(detailSheet);

        console.log(`[Excel] Parsed ${headerData.length} headers and ${detailData.length} detail lines`);

        res.json({
            success: true,
            data: {
                headers: headerData,
                details: detailData
            }
        });

    } catch (err: any) {
        console.error('[Excel] Parse error:', err);
        res.status(500).json({ success: false, message: 'Failed to parse Excel: ' + err.message });
    }
});

// Calculate Invoices from Excel Data
app.post('/api/excel/calculate', async (req, res) => {
    try {
        const { headers, details } = req.body;

        if (!headers || !details) {
            return res.status(400).json({ success: false, message: 'Missing headers or details' });
        }

        // Group details by INTERNAL_ID
        const detailsByInvoice = new Map();
        details.forEach((detail: any) => {
            const internalId = detail.INTERNAL_ID;
            if (!detailsByInvoice.has(internalId)) {
                detailsByInvoice.set(internalId, []);
            }
            detailsByInvoice.get(internalId).push(detail);
        });

        // Calculate each invoice
        const calculatedInvoices = headers.map((header: any) => {
            const internalId = header.INTERNAL_ID;
            const invoiceDetails = detailsByInvoice.get(internalId) || [];

            // Map to calculator format
            const headerMapped = {
                internalId: header.INTERNAL_ID,
                receiverType: header.RECEIVER_TYPE || 'B',
                receiverId: header.RECEIVER_ID,
                receiverName: header.RECEIVER_NAME,
                receiverCountry: header.RECEIVER_COUNTRY || 'EG',
                receiverGovernate: header.RECEIVER_GOVERNATE,
                receiverRegionCity: header.RECEIVER_REGIONCITY,
                receiverStreet: header.RECEIVER_STREET,
                receiverBuildingNumber: header.RECEIVER_BUILDINGNUMBER,
                receiverPostalCode: header.RECEIVER_POSTALCODE || '0',
                receiverFloor: header.RECEIVER_FLOOR || '',
                receiverRoom: header.RECEIVER_ROOM || '',
                receiverLandmark: header.RECEIVER_LANDMARK || '',
                receiverAdditionalInformation: header.RECEIVER_ADDITIONALINFORMATION || '',
                documentType: header.DOCUMENTTYPE || 'I',
                dateTimeIssued: header.DATETIMEISSUED,
                purchaseOrderReference: header.PURCHASEORDERREFERENCE,
                purchaseOrderDescription: header.PURCHASEORDERDESCRIPTION,
                salesOrderReference: header.SALESORDERREFERENCE,
                salesOrderDescription: header.SALESORDERDESCRIPTION,
                paymentBankName: header.PAYMENT_BANKNAME,
                paymentBankAddress: header.PAYMENT_BANKADDRESS,
                paymentBankAccountNo: header.PAYMENT_BANKACCOUNTNO,
                paymentBankAccountIban: header.PAYMENT_BANKACCOUNTIBAN,
                paymentSwiftCode: header.PAYMENT_SWIFTCODE,
                paymentTerms: header.PAYMENT_TERMS,
                deliveryApproach: header.DELIVERY_APPROACH,
                deliveryPackaging: header.DELIVERY_PACKAGING,
                deliveryGrossWeight: parseFloat(header.DELIVERY_GROSSWEIGHT || '1'),
                deliveryNetWeight: parseFloat(header.DELIVERY_NETWEIGHT || '1'),
                extraDiscountAmount: parseFloat(header.EXTRADISCOUNTAMOUNT || '0')
            };

            const linesMapped = invoiceDetails.map((detail: any) => ({
                description: detail.DESCRIPTION,
                itemType: detail.ITEMTYPE || 'GS1',
                itemCode: detail.ITEMCODE,
                itemInternalCode: detail.ITEM_INTERNAL_CODE,
                unitType: detail.UNITTYPE || 'EA',
                quantity: parseFloat(detail.QUANTITY),
                currencySold: detail.CURRENCYSOLD || 'EGP',
                amount: parseFloat(detail.AMOUNT),
                currencyExchangeRate: parseFloat(detail.CURRENCYEXCHANGERATE || '0'),
                disRate: parseFloat(detail.DIS_RATE || '0'),
                disAmount: parseFloat(detail.DIS_AMOUNT || '0'),
                tax_V001: parseFloat(detail.tax_V001 || '0'),
                tax_V003: parseFloat(detail.tax_V003 || '0'),
                tax_V009: parseFloat(detail.tax_V009 || '0'),
                tax_W007: parseFloat(detail.tax_W007 || '0')
            }));

            // Validate
            const validation = validateInvoice(headerMapped, linesMapped);
            if (!validation.isValid) {
                return {
                    internalId,
                    success: false,
                    errors: validation.errors
                };
            }

            // Calculate
            const calculated = calculateInvoice(headerMapped, linesMapped);
            return {
                internalId,
                success: true,
                ...calculated
            };
        });

        res.json({
            success: true,
            invoices: calculatedInvoices
        });

    } catch (err: any) {
        console.error('[Excel] Calculate error:', err);
        res.status(500).json({ success: false, message: 'Failed to calculate: ' + err.message });
    }
});

// Submit Invoice to ETA Endpoint (Sign & Send)
app.post('/api/invoices/send/:uuid', async (req, res) => {
    const { uuid } = req.params;
    const client = await pool.connect();

    try {
        // 1. Get Client Config — Phase A-G aware. Single-tenant fallback picks
        // the first user but routes through loadEffectiveSettings so the PIN
        // is decrypted and ETA creds come from organization_settings.
        let resolvedUserId: number | null = null;
        const firstCred = await client.query(`SELECT id FROM "otaxdb".credentials LIMIT 1`).catch(() => ({ rows: [] as any[] }));
        if (firstCred.rows[0]?.id) resolvedUserId = Number(firstCred.rows[0].id);
        const props = resolvedUserId
            ? await loadEffectiveSettings(client, resolvedUserId)
            : new Map<string, string>();
        const getProp = makeGetProp(props);

        const env = getProp('signer_environment_type') || 'PreProd';
        const clientId = env === 'Prod' ? getProp('signer_prodClientId') : getProp('signer_preProdClientId');
        const clientSecret = env === 'Prod' ? getProp('signer_prodClientSecret') : getProp('signer_preProdClientSecret');
        const certificateThumbprint = getProp('signer_CurrentCertName');
        const certificatePIN = getProp('signer_CurrentCertPIN');

        if (!clientId || !clientSecret || !certificateThumbprint) {
            throw new Error('Missing configuration: Client ID, Secret, or Certificate Thumbprint not found.');
        }

        // 2. Get Invoice Data
        const headerQuery = `SELECT * FROM "otaxdb".invoice_headers WHERE "UUID" = $1`;
        const detailsQuery = `SELECT * FROM "otaxdb".invoice_details WHERE "INTERNAL_ID" = (SELECT "INTERNAL_ID" FROM "otaxdb".invoice_headers WHERE "UUID" = $1)`;

        const headerRes = await client.query(headerQuery, [uuid]);
        const detailsRes = await client.query(detailsQuery, [uuid]);

        if (headerRes.rows.length === 0) {
            throw new Error('Invoice not found');
        }

        const header = headerRes.rows[0];
        const details = detailsRes.rows;

        // 3. Map to Calculator Format
        const headerMapped = {
            internalId: header.INTERNAL_ID,
            receiverType: header.RECEIVER_TYPE || 'B',
            receiverId: header.RECEIVER_ID,
            receiverName: header.RECEIVER_NAME,
            receiverCountry: header.RECEIVER_COUNTRY || 'EG',
            receiverGovernate: header.RECEIVER_GOVERNATE,
            receiverRegionCity: header.RECEIVER_REGIONCITY,
            receiverStreet: header.RECEIVER_STREET,
            receiverBuildingNumber: header.RECEIVER_BUILDINGNUMBER,
            receiverPostalCode: header.RECEIVER_POSTALCODE || '0',
            receiverFloor: header.RECEIVER_FLOOR || '',
            receiverRoom: header.RECEIVER_ROOM || '',
            receiverLandmark: header.RECEIVER_LANDMARK || '',
            receiverAdditionalInformation: header.RECEIVER_ADDITIONALINFORMATION || '',
            documentType: header.DOCUMENTTYPE || 'I',
            dateTimeIssued: header.DATETIMEISSUED,
            purchaseOrderReference: header.PURCHASEORDERREFERENCE,
            purchaseOrderDescription: header.PURCHASEORDERDESCRIPTION,
            salesOrderReference: header.SALESORDERREFERENCE,
            salesOrderDescription: header.SALESORDERDESCRIPTION,
            paymentBankName: header.PAYMENT_BANKNAME,
            paymentBankAddress: header.PAYMENT_BANKADDRESS,
            paymentBankAccountNo: header.PAYMENT_BANKACCOUNTNO,
            paymentBankAccountIban: header.PAYMENT_BANKACCOUNTIBAN,
            paymentSwiftCode: header.PAYMENT_SWIFTCODE,
            paymentTerms: header.PAYMENT_TERMS,
            deliveryApproach: header.DELIVERY_APPROACH,
            deliveryPackaging: header.DELIVERY_PACKAGING,
            deliveryGrossWeight: parseFloat(header.DELIVERY_GROSSWEIGHT || '1'),
            deliveryNetWeight: parseFloat(header.DELIVERY_NETWEIGHT || '1'),
            extraDiscountAmount: parseFloat(header.EXTRADISCOUNTAMOUNT || '0')
        };

        const linesMapped = details.map((detail: any) => ({
            description: detail.DESCRIPTION,
            itemType: detail.ITEMTYPE || 'GS1',
            itemCode: detail.ITEMCODE,
            itemInternalCode: detail.ITEM_INTERNAL_CODE,
            unitType: detail.UNITTYPE || 'EA',
            quantity: parseFloat(detail.QUANTITY),
            currencySold: detail.CURRENCYSOLD || 'EGP',
            amount: parseFloat(detail.AMOUNT),
            currencyExchangeRate: parseFloat(detail.CURRENCYEXCHANGERATE || '0'),
            disRate: parseFloat(detail.DIS_RATE || '0'),
            disAmount: parseFloat(detail.DIS_AMOUNT || '0'),
            tax_V001: parseFloat(detail.tax_V001 || '0'),
            tax_V003: parseFloat(detail.tax_V003 || '0'),
            tax_V009: parseFloat(detail.tax_V009 || '0'),
            tax_W007: parseFloat(detail.tax_W007 || '0')
        }));

        // 4. Calculate Final JSON
        const calculated = calculateInvoice(headerMapped, linesMapped);

        // 5. Get Issuer Data from Company Info Settings
        const issuerData = {
            type: getProp('user_type') || 'B',
            id: getProp('issuer_id') || '',
            name: getProp('issuer_name') || '',
            branchID: getProp('issuer_branchId') || '0',
            country: getProp('issuer_country') || 'EG',
            governate: getProp('issuer_governorate') || '',
            regionCity: '0', // Not stored in settings yet
            street: getProp('issuer_street') || '',
            buildingNumber: getProp('issuer_buildingNumber') || '0',
            postalCode: '0', // Not stored in settings yet
            floor: getProp('issuer_floor') || '0',
            room: '0', // Not stored in settings yet
            landmark: '0', // Not stored in settings yet
            additionalInformation: '0', // Not stored in settings yet
            activityCode: getProp('tax_payer_activity_code') || '0000'
        };

        // 6. Build Complete ETA Document
        // Fix: If issuance date is older than 3 days, ETA will reject it.
        // We ensure the date is current if needed.
        const issuedDate = new Date(calculated.header.dateTimeIssued);
        const now = new Date();
        const diffDays = (now.getTime() - issuedDate.getTime()) / (1000 * 3600 * 24);

        // Fix: If issuance date is older than 12 hours (especially in Pre-Prod), ETA may reject it.
        if (diffDays > 0.5 || diffDays < -0.05) {
            console.log(`[Submit] Adjusting dateTimeIssued from ${calculated.header.dateTimeIssued} to current time (${now.toISOString()}) to avoid ETA rejection.`);
            calculated.header.dateTimeIssued = now.toISOString();
        }

        console.log(`[Submit] Final document dateTimeIssued: ${calculated.header.dateTimeIssued}`);

        const document = buildETADocument(calculated, issuerData);

        // 7. Sign
        console.log(`[Submit] Signing invoice: ${uuid}`);

        let signedDocument;
        const companyId = issuerData.id || 'default';
        console.log(`[Submit] Requesting signature for Company: ${companyId}`);

        // ── SMART SIGNING: Check org settings for method ──
        let orgSignMethod = 'legacy';
        let oPfxBuf: Buffer | null = null;
        let oPfxPwd: string | null = null;
        let oCertIssuer: string = ''; // Empty = agent will auto-detect from cert store

        try {
            const orgSRes = await client.query(
                `SELECT signing_method, certificate_pfx, certificate_password, certificate_issuer
                 FROM "otaxdb".organization_settings WHERE eta_tax_id = $1 LIMIT 1`,
                [issuerData.id]
            );
            if (orgSRes.rows[0]) {
                orgSignMethod = orgSRes.rows[0].signing_method || 'agent';
                if (orgSRes.rows[0].certificate_pfx && orgSRes.rows[0].certificate_password) {
                    oPfxBuf = Buffer.from(orgSRes.rows[0].certificate_pfx);
                    oPfxPwd = orgSRes.rows[0].certificate_password;
                }
                if (orgSRes.rows[0].certificate_issuer) oCertIssuer = orgSRes.rows[0].certificate_issuer;
            }
        } catch (e: any) {
            console.warn(`[Submit] Could not load org signing settings: ${e.message}`);
        }

        if (orgSignMethod === 'pfx' && oPfxBuf && oPfxPwd) {
            const { signWithPFX } = await import('./services/pfxSigner.js');
            signedDocument = await signWithPFX(document, oPfxBuf, oPfxPwd, oCertIssuer);
        } else if (orgSignMethod === 'agent' || process.env.RENDER) {
            signedDocument = await bridgeService.signDocument(companyId, {
                document, pin: certificatePIN, certificateIssuer: oCertIssuer
            });
        } else {
            signedDocument = await signInvoiceWithCsharpSigner(document, certificatePIN, oCertIssuer);
        }

        // ── CRITICAL: Validate signature BEFORE sending to ETA ──
        if (!signedDocument || !signedDocument.signatures || signedDocument.signatures.length === 0) {
            throw new Error('Signing failed: No signature was generated. Ensure USB token PIN is correct and not skipped.');
        }
        const sVal = signedDocument.signatures[0]?.value || '';
        if (sVal.length < 500) {
            throw new Error(`Signing failed: Invalid signature (${sVal.length} chars). PIN may have been skipped or cancelled.`);
        }
        if (!sVal.startsWith('MI')) {
            throw new Error(`Signing failed: Malformed signature. Expected CAdES-BES format, got '${sVal.substring(0, 8)}...'.`);
        }
        console.log(`[Submit] ✓ Signature validated: ${sVal.length} chars`);

        // 6. Authenticate with ETA
        const accessToken = await getETAToken(clientId, clientSecret, env);

        // 7. Submit to ETA
        const hosts = getETAHosts(env);
        console.log(`[Submit] Sending to ETA: ${hosts.api}/api/v1/documentsubmissions`);

        // CRITICAL FIX for 4043 error: Send JSON as pre-stringified string
        // This ensures Arabic characters are sent as UTF-8, not escaped as \uXXXX
        // Matches mrkindy repository fix (commit 012e77f)
        const payloadString = JSON.stringify({ documents: [signedDocument] });
        const payload = Buffer.from(payloadString, 'utf8');

        // Debug logging
        console.log('[Submit] Payload is Buffer:', Buffer.isBuffer(payload));
        console.log('[Submit] Payload length:', payload.length);
        console.log('[Submit] First 200 chars:', payloadString.substring(0, 200));
        console.log('[Submit] Contains Arabic:', payloadString.includes('اوبراتفز'));
        console.log('[Submit] Contains \\u escapes:', payloadString.includes('\\u'));

        const etaResponse = await axios.post(
            `${hosts.api}/api/v1/documentsubmissions`,
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Length': payload.length.toString()
                },
                transformRequest: [],
                transformResponse: []
            }
        );

        console.log('[Submit] ETA Response:', etaResponse.data);

        // 8. Update DB (Submission ID and Status)
        // Assuming response structure: { submissionId: "...", acceptedDocuments: [...] }
        const submissionId = etaResponse.data.submissionId;
        const status = etaResponse.data.acceptedDocuments?.length > 0 ? 'Submitted' : 'Rejected';

        await client.query(`
            UPDATE "otaxdb".invoice_headers 
            SET status = $1, "submissionUUID" = $2
            WHERE "UUID" = $3
        `, [status, submissionId, uuid]);

        res.json({
            success: true,
            message: 'Invoice submitted successfully',
            submissionId,
            status
        });

    } catch (err: any) {
        console.error('[Submit Error]', err.response?.data || err.message);
        res.status(500).json({
            success: false,
            error: err.message,
            errorDetails: err.response?.data || err.stack || 'No additional details',
            fullError: String(err)
        });
    } finally {
        client.release();
    }
});

/**
 * Submit Receipt Batch to ETA Endpoint
 * Implements the full cycle for e-Receipts:
 * 1. UUID Generation based on receipt content and chain
 * 2. Batching multiple receipts
 * 3. Canonicalizing the entire batch for hashing
 * 4. Signing using CAdES-BES (detached)
 * 5. Sending to ETA e-Receipt API
 */
app.post('/api/receipts/submit', async (req, res) => {
    const { receipts } = req.body; // Array of receipt objects
    const client = await pool.connect();

    try {
        if (!Array.isArray(receipts) || receipts.length === 0) {
            throw new Error('No receipts provided for submission.');
        }

        // 1. Get Client Config — Phase A-G aware (decrypts PIN, reads ETA
        // creds from organization_settings).
        let resolvedUserId: number | null = null;
        const firstCred = await client.query(`SELECT id FROM "otaxdb".credentials LIMIT 1`).catch(() => ({ rows: [] as any[] }));
        if (firstCred.rows[0]?.id) resolvedUserId = Number(firstCred.rows[0].id);
        const props = resolvedUserId
            ? await loadEffectiveSettings(client, resolvedUserId)
            : new Map<string, string>();
        const getProp = makeGetProp(props);

        const env = getProp('signer_environment_type') || 'PreProd';
        const clientId = env === 'Prod' ? getProp('signer_prodClientId') : getProp('signer_preProdClientId');
        const clientSecret = env === 'Prod' ? getProp('signer_prodClientSecret') : getProp('signer_preProdClientSecret');
        const certificateThumbprint = getProp('signer_CurrentCertName');
        const certificatePIN = getProp('signer_CurrentCertPIN');

        // 2. Prepare Batch and Generate UUIDs (including chain)
        console.log(`[Receipts] Generating UUIDs and preparing batch for ${receipts.length} receipts...`);
        const batch = receiptService.prepareReceiptBatch(receipts);

        // 3. Sign the ENTIRE Batch
        console.log(`[Receipts] Signing batch...`);
        const signedBatch = await signReceiptBatch(batch, certificateThumbprint, certificatePIN);

        // 4. Authenticate with ETA
        const accessToken = await getETAToken(clientId, clientSecret, env);

        // 5. Submit to ETA e-Receipt API
        const hosts = getETAHosts(env);
        console.log(`[Receipts] Sending to ETA: ${hosts.api}/api/v1/receiptsubmissions`);

        const etaResponse = await axios.post(
            `${hosts.api}/api/v1/receiptsubmissions`,
            signedBatch,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('[Receipts] ETA Response:', etaResponse.data);

        // 6. Return Response
        res.json({
            success: true,
            message: 'Receipt batch submitted successfully',
            submissionId: etaResponse.data.submissionId,
            details: etaResponse.data
        });

    } catch (err: any) {
        console.error('[Receipts Submit Error]', err.response?.data || err.message);
        res.status(500).json({
            success: false,
            message: 'Receipt submission failed: ' + err.message,
            details: err.response?.data || err.message
        });
    } finally {
        client.release();
    }
});


// Helper to log key steps to a file for debugging
const logToFile = async (msg: string) => {
    try {
        await fsPromises.appendFile(path.join(__dirname, 'debug_steps.txt'), `[${new Date().toISOString()}] ${msg}\n`);
    } catch (e) { console.error('Log Error:', e); }
};

// Batch Submit from Excel (Save -> Sign -> Send)
// ════════════════════════════════════════════════
// ASYNC BATCH JOB SYSTEM
// ════════════════════════════════════════════════

interface BatchJob {
    id: string;
    status: 'queued' | 'processing' | 'completed' | 'failed';
    total: number;
    processed: number;
    success: number;
    failed: number;
    currentInvoice: string;
    results: any[];
    error?: string;
    createdAt: Date;
    completedAt?: Date;
}

const batchJobs = new Map<string, BatchJob>();

// Cleanup old jobs every 30 minutes (keep for 2 hours)
setInterval(() => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, job] of batchJobs) {
        if (job.createdAt.getTime() < twoHoursAgo) batchJobs.delete(id);
    }
}, 30 * 60 * 1000);

/**
 * POST /api/excel/batch-submit
 * Accepts { headers, details } — returns jobId immediately.
 * Processes invoices asynchronously in the background.
 */
app.post('/api/excel/batch-submit', async (req, res) => {
    const { headers, details } = req.body;

    if (!headers || !Array.isArray(headers) || headers.length === 0) {
        return res.status(400).json({ success: false, message: 'No invoice headers provided' });
    }

    const jobId = crypto.randomUUID();
    const job: BatchJob = {
        id: jobId,
        status: 'queued',
        total: headers.length,
        processed: 0,
        success: 0,
        failed: 0,
        currentInvoice: '',
        results: [],
        createdAt: new Date(),
    };
    batchJobs.set(jobId, job);

    // Return jobId immediately
    res.json({ success: true, jobId, total: headers.length });

    // ── Process in background (async, non-blocking) ──
    (async () => {
        const client = await pool.connect();
        try {
            job.status = 'processing';

            // 1. Load Config (same as sync endpoint)
            let userId = req.headers['x-user-id'] as string;
            if (!userId) {
                const authHeader = req.headers.authorization;
                if (authHeader?.startsWith('Bearer ')) {
                    try {
                        const jwt = await import('jsonwebtoken');
                        const decoded: any = jwt.default.verify(authHeader.replace('Bearer ', ''), process.env.JWT_SECRET || 'your-secret-key-change-in-production');
                        userId = String(decoded.userId);
                    } catch (e) { /* ignore */ }
                }
            }

            // Phase A-G aware: load merged settings from org_* tables first,
            // fall back to clients_info_new for legacy data.
            let resolvedUserId: number | null = userId ? Number(userId) : null;
            if (!resolvedUserId) {
                const r = await client.query(`SELECT id FROM "otaxdb".credentials LIMIT 1`).catch(() => ({ rows: [] as any[] }));
                if (r.rows[0]?.id) resolvedUserId = Number(r.rows[0].id);
            }
            const props = resolvedUserId
                ? await loadEffectiveSettings(client, resolvedUserId)
                : new Map<string, string>();
            const getProp = makeGetProp(props);

            let orgData: any = null;
            if (resolvedUserId) {
                try {
                    const orgRes = await client.query(`SELECT o.* FROM "otaxdb".organizations o JOIN "otaxdb".credentials c ON c.organization_id = o.id WHERE c.id = $1`, [resolvedUserId]);
                    if (orgRes.rows.length > 0) orgData = orgRes.rows[0];
                    if (!orgData) {
                        const r2 = await client.query(`SELECT o.* FROM "otaxdb".organizations o JOIN "otaxdb".portal_users p ON p.organization_id = o.id WHERE p.id = $1`, [resolvedUserId]);
                        if (r2.rows.length > 0) orgData = r2.rows[0];
                    }
                } catch (e) { /* ignore */ }
            }

            // ── Load ETA credentials from organization_settings (primary source) ──
            let clientId = '';
            let clientSecret = '';
            let env = 'PreProd';
            let certificatePIN = getProp('signer_CurrentCertPIN') || '';

            if (orgData?.id) {
                try {
                    const etaCredRes = await client.query(
                        `SELECT eta_environment, eta_prod_client_id, eta_prod_client_secret,
                                eta_preprod_client_id, eta_preprod_client_secret
                         FROM "otaxdb".organization_settings WHERE organization_id = $1 LIMIT 1`,
                        [orgData.id]
                    );
                    const etaCreds = etaCredRes.rows[0];
                    if (etaCreds) {
                        env = etaCreds.eta_environment || 'PreProd';
                        if (env === 'Prod') {
                            clientId = etaCreds.eta_prod_client_id || '';
                            clientSecret = etaCreds.eta_prod_client_secret || '';
                        } else {
                            clientId = etaCreds.eta_preprod_client_id || '';
                            clientSecret = etaCreds.eta_preprod_client_secret || '';
                        }
                    }
                } catch (e: any) {
                    console.warn('[Batch] Could not load ETA credentials from org settings:', e.message);
                }
            }

            // Fallback to legacy getProp if org settings creds are still empty
            if (!clientId) {
                const legacyEnv = getProp('signer_environment_type') || 'PreProd';
                env = legacyEnv;
                clientId = env === 'Prod' ? getProp('signer_prodClientId') : getProp('signer_preProdClientId');
                clientSecret = env === 'Prod' ? getProp('signer_prodClientSecret') : getProp('signer_preProdClientSecret');
            }

            // For agent signing, thumbprint is NOT required on backend (signing on user's PC)
            // Only require clientId + clientSecret
            if (!clientId || !clientSecret) {
                job.status = 'failed';
                job.error = `ETA API credentials missing (environment: ${env}). Please configure Client ID and Client Secret in Settings > ETA Connection.`;
                return;
            }
            console.log(`[Batch] ETA credentials loaded. Env: ${env}, ClientId: ${clientId.substring(0, 8)}...`);

            // 2. Authenticate ETA
            const accessToken = await getETAToken(clientId, clientSecret, env);
            const hosts = getETAHosts(env);

            // 3. Group Details
            const detailsByInvoice = new Map();
            details.forEach((detail: any) => {
                const internalId = detail.INTERNAL_ID;
                if (!detailsByInvoice.has(internalId)) detailsByInvoice.set(internalId, []);
                detailsByInvoice.get(internalId).push(detail);
            });

            // Load org signing settings once
            let orgSigningMethod = 'legacy';
            let orgPfxBuffer: Buffer | null = null;
            let orgPfxPassword: string | null = null;
            let orgCertIssuer: string = '';
            try {
                let orgSettingsRes;
                if (orgData?.id) {
                    orgSettingsRes = await client.query(
                        `SELECT signing_method, certificate_pfx, certificate_password, certificate_issuer FROM "otaxdb".organization_settings WHERE organization_id = $1 LIMIT 1`,
                        [orgData.id]
                    );
                }
                if ((!orgSettingsRes || orgSettingsRes.rows.length === 0) && getProp('issuer_id')) {
                    orgSettingsRes = await client.query(
                        `SELECT signing_method, certificate_pfx, certificate_password, certificate_issuer FROM "otaxdb".organization_settings WHERE eta_tax_id = $1 LIMIT 1`,
                        [getProp('issuer_id')]
                    );
                }
                const orgSettings = orgSettingsRes?.rows[0];
                if (orgSettings) {
                    orgSigningMethod = orgSettings.signing_method || 'agent';
                    if (orgSettings.certificate_pfx && orgSettings.certificate_password) {
                        orgPfxBuffer = Buffer.from(orgSettings.certificate_pfx);
                        orgPfxPassword = orgSettings.certificate_password;
                    }
                    if (orgSettings.certificate_issuer) orgCertIssuer = orgSettings.certificate_issuer;
                }
            } catch (e) { /* ignore */ }

            const issuerData = {
                type: getProp('user_type') || 'B',
                id: getProp('issuer_id') || orgData?.tax_id || '',
                name: getProp('issuer_name') || orgData?.name || '',
                branchID: getProp('issuer_branchId') || '0',
                country: getProp('issuer_country') || orgData?.country || 'EG',
                governate: getProp('issuer_governorate') || orgData?.governorate || '',
                regionCity: '0',
                street: getProp('issuer_street') || orgData?.street || '',
                buildingNumber: getProp('issuer_buildingNumber') || orgData?.building_number || '0',
                postalCode: getProp('issuer_postalCode') || orgData?.postal_code || '0',
                floor: getProp('issuer_floor') || '0',
                room: '0', landmark: '0', additionalInformation: '0',
                activityCode: getProp('tax_payer_activity_code') || '0000'
            };

            // 4. Process Each Invoice
            for (const header of headers) {
                const internalId = header.INTERNAL_ID;
                const invoiceUUID = crypto.randomUUID();
                job.currentInvoice = internalId;

                try {
                    const invoiceDetails = detailsByInvoice.get(internalId) || [];

                    const parseExcelDate = (input: any) => {
                        if (!input) return new Date().toISOString();
                        if (typeof input === 'number') {
                            const date = new Date(Math.round((input - 25569) * 86400 * 1000));
                            return date.toISOString();
                        }
                        if (typeof input === 'string') {
                            const parts = input.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
                            if (parts) {
                                const d = new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1]), 12, 0, 0);
                                if (!isNaN(d.getTime())) return d.toISOString();
                            }
                        }
                        const d = new Date(input);
                        return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
                    };

                    const headerMapped = {
                        internalId: header.INTERNAL_ID,
                        receiverType: header.RECEIVER_TYPE || 'B',
                        receiverId: header.RECEIVER_ID,
                        receiverName: header.RECEIVER_NAME,
                        receiverCountry: header.RECEIVER_COUNTRY || 'EG',
                        receiverGovernate: header.RECEIVER_GOVERNATE,
                        receiverRegionCity: header.RECEIVER_REGIONCITY,
                        receiverStreet: header.RECEIVER_STREET,
                        receiverBuildingNumber: header.RECEIVER_BUILDINGNUMBER,
                        receiverPostalCode: header.RECEIVER_POSTALCODE || '0',
                        receiverFloor: header.RECEIVER_FLOOR || '',
                        receiverRoom: header.RECEIVER_ROOM || '',
                        receiverLandmark: header.RECEIVER_LANDMARK || '',
                        receiverAdditionalInformation: header.RECEIVER_ADDITIONALINFORMATION || '',
                        documentType: header.DOCUMENTTYPE || 'I',
                        dateTimeIssued: parseExcelDate(header.DATETIMEISSUED),
                        purchaseOrderReference: header.PURCHASEORDERREFERENCE,
                        purchaseOrderDescription: header.PURCHASEORDERDESCRIPTION,
                        salesOrderReference: header.SALESORDERREFERENCE,
                        salesOrderDescription: header.SALESORDERDESCRIPTION,
                        paymentBankName: header.PAYMENT_BANKNAME,
                        paymentBankAddress: header.PAYMENT_BANKADDRESS,
                        paymentBankAccountNo: header.PAYMENT_BANKACCOUNTNO,
                        paymentBankAccountIban: header.PAYMENT_BANKACCOUNTIBAN,
                        paymentSwiftCode: header.PAYMENT_SWIFTCODE,
                        paymentTerms: header.PAYMENT_TERMS,
                        deliveryApproach: header.DELIVERY_APPROACH,
                        deliveryPackaging: header.DELIVERY_PACKAGING,
                        deliveryGrossWeight: parseFloat(header.DELIVERY_GROSSWEIGHT || '1'),
                        deliveryNetWeight: parseFloat(header.DELIVERY_NETWEIGHT || '1'),
                        extraDiscountAmount: parseFloat(header.EXTRADISCOUNTAMOUNT || '0')
                    };

                    const linesMapped = invoiceDetails.map((detail: any) => ({
                        description: detail.DESCRIPTION,
                        itemType: detail.ITEMTYPE || 'GS1',
                        itemCode: detail.ITEMCODE,
                        itemInternalCode: detail.ITEM_INTERNAL_CODE,
                        unitType: detail.UNITTYPE || 'EA',
                        quantity: parseFloat(detail.QUANTITY),
                        currencySold: detail.CURRENCYSOLD || 'EGP',
                        amount: parseFloat(detail.AMOUNT),
                        currencyExchangeRate: parseFloat(detail.CURRENCYEXCHANGERATE || '0'),
                        disRate: parseFloat(detail.DIS_RATE || '0'),
                        disAmount: parseFloat(detail.DIS_AMOUNT || '0'),
                        tax_V001: parseFloat(detail.tax_V001 || '0'),
                        tax_V003: parseFloat(detail.tax_V003 || '0'),
                        tax_V009: parseFloat(detail.tax_V009 || '0'),
                        tax_W007: parseFloat(detail.tax_W007 || '0')
                    }));

                    // Validate
                    const validation = validateInvoice(headerMapped, linesMapped);
                    if (!validation.isValid) throw new Error('Validation failed: ' + validation.errors.join(', '));

                    const calculated = calculateInvoice(headerMapped, linesMapped);

                    // Auto-fix date
                    const issuedDate = new Date(headerMapped.dateTimeIssued);
                    const now = new Date();
                    const diffDays = (now.getTime() - issuedDate.getTime()) / (1000 * 3600 * 24);
                    if (diffDays > 0.5 || diffDays < -0.05) headerMapped.dateTimeIssued = now.toISOString();
                    calculated.header.dateTimeIssued = headerMapped.dateTimeIssued;

                    const document = buildETADocument(calculated, issuerData);

                    // Sign
                    let signedDocument;
                    const companyId = issuerData.id || 'default';
                    if (orgSigningMethod === 'pfx' && orgPfxBuffer && orgPfxPassword) {
                        const { signWithPFX } = await import('./services/pfxSigner.js');
                        signedDocument = await signWithPFX(document, orgPfxBuffer, orgPfxPassword, orgCertIssuer);
                    } else if (orgSigningMethod === 'agent' || process.env.RENDER) {
                        signedDocument = await bridgeService.signDocument(companyId, { document, pin: certificatePIN, certificateIssuer: orgCertIssuer });
                    } else {
                        signedDocument = await signInvoiceWithCsharpSigner(document, certificatePIN, orgCertIssuer);
                    }

                    // Validate signature
                    if (!signedDocument?.signatures?.length) throw new Error(`Signing failed: No signature generated`);
                    const sigValue = signedDocument.signatures[0]?.value || '';
                    if (sigValue.length < 500) throw new Error(`Invalid signature (${sigValue.length} chars)`);

                    // Submit to ETA
                    const payloadObj = { documents: [signedDocument] };
                    const payloadString = JSON.stringify(payloadObj);
                    const payload = Buffer.from(payloadString, 'utf8');

                    const etaResponse = await axios.post(
                        `${hosts.api}/api/v1.0/documentsubmissions`,
                        payload,
                        {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json; charset=utf-8',
                                'Content-Length': payload.length.toString()
                            },
                            timeout: 30000,
                            transformRequest: [],
                            transformResponse: []
                        }
                    );

                    const responseData = typeof etaResponse.data === 'string' ? JSON.parse(etaResponse.data) : etaResponse.data;
                    const submissionId = responseData.submissionId;
                    const acceptedDocs = responseData.acceptedDocuments || [];
                    const rejectedDocs = responseData.rejectedDocuments || [];
                    const rejection = rejectedDocs.find((r: any) => r.internalId === internalId);
                    if (rejection) throw new Error(`ETA Rejected: ${rejection.error?.message || 'Unknown'}`);
                    const accepted = acceptedDocs.find((a: any) => a.internalId === internalId);
                    if (!accepted) throw new Error('Not found in accepted/rejected');

                    // Save to DB
                    await client.query(`INSERT INTO public.documents (uuid, "submissionId", "internalId", submitted, "typeName", "issuerId", "issuerName", "receiverId", "receiverName", "dateTimeIssued", "totalSales", "totalDiscount", "netAmount", total, status, environment, "documentBody") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [
                        accepted.uuid, submissionId, internalId, true, document.documentType,
                        document.issuer.id, document.issuer.name, document.receiver.id, document.receiver.name,
                        headerMapped.dateTimeIssued, document.totalSalesAmount, document.totalDiscountAmount,
                        document.netAmount, document.totalAmount, 'Valid', env, JSON.stringify(signedDocument)
                    ]);

                    if (orgData) {
                        try {
                            const orgTables = getOrgTableNames(orgData.id, orgData.name);
                            await createOrgTables(pool, orgData.id, orgData.name);
                            await client.query(`INSERT INTO "InvoicesDb"."${orgTables.documents}" (uuid, "submissionId", "internalId", submitted, "typeName", "issuerId", "issuerName", "receiverId", "receiverName", "dateTimeIssued", "totalSales", "totalDiscount", "netAmount", total, status, direction, environment, org_id, synced_at) VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Sent',$15,$16,NOW()) ON CONFLICT (uuid) DO UPDATE SET status = EXCLUDED.status, synced_at = NOW()`, [
                                accepted.uuid, submissionId, internalId, document.documentType || 'I',
                                document.issuer.id, document.issuer.name, document.receiver.id, document.receiver.name,
                                headerMapped.dateTimeIssued, document.totalSalesAmount || 0, document.totalDiscountAmount || 0,
                                document.netAmount || 0, document.totalAmount || 0, 'Valid', env, orgData.id,
                            ]);
                        } catch (e) { /* ignore org table errors */ }
                    }

                    job.success++;
                    job.results.push({ internalId, status: 'Submitted', uuid: accepted.uuid });

                } catch (invErr: any) {
                    job.failed++;
                    job.results.push({
                        internalId,
                        status: 'Failed',
                        error: invErr.message,
                        errorDetails: invErr.response?.data ? JSON.stringify(invErr.response.data) : undefined,
                        etaResponse: invErr.response?.data || null
                    });
                }
                job.processed++;
            }

            job.status = 'completed';
            job.completedAt = new Date();
            console.log(`[Batch Job ${jobId}] Completed: ${job.success} success, ${job.failed} failed out of ${job.total}`);

        } catch (err: any) {
            job.status = 'failed';
            job.error = err.message;
            console.error(`[Batch Job ${jobId}] Fatal error:`, err.message);
        } finally {
            client.release();
        }
    })();
});

/**
 * GET /api/excel/batch-status/:jobId
 * Returns real-time progress of a batch job.
 */
app.get('/api/excel/batch-status/:jobId', (req, res) => {
    const job = batchJobs.get(req.params.jobId);
    if (!job) {
        return res.status(404).json({ success: false, message: 'Job not found' });
    }
    res.json({
        success: true,
        job: {
            id: job.id,
            status: job.status,
            total: job.total,
            processed: job.processed,
            success: job.success,
            failed: job.failed,
            currentInvoice: job.currentInvoice,
            results: job.status === 'completed' || job.status === 'failed' ? job.results : undefined,
            error: job.error,
            progress: job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0,
            createdAt: job.createdAt,
            completedAt: job.completedAt,
        }
    });
});

// ════════════════════════════════════════════════
// LEGACY SYNC SUBMIT (kept for backward compatibility)
// ════════════════════════════════════════════════

app.post('/api/excel/submit', async (req, res) => {
    const { headers, details } = req.body;
    const client = await pool.connect();

    try {
        // 1. Load Config
        let userId = req.headers['x-user-id'] as string;

        // Also try to extract userId from JWT if X-User-ID not present
        if (!userId) {
            const authHeader = req.headers.authorization;
            if (authHeader?.startsWith('Bearer ')) {
                try {
                    const jwt = await import('jsonwebtoken');
                    const decoded: any = jwt.default.verify(authHeader.replace('Bearer ', ''), process.env.JWT_SECRET || 'your-secret-key-change-in-production');
                    userId = String(decoded.userId);
                } catch (e) { /* ignore JWT errors, fallback continues */ }
            }
        }

        // Resolve a numeric userId — if absent, fall back to "any user" (legacy
        // single-tenant deployments). The fallback path can't pull org-scoped
        // data so it relies entirely on clients_info_new.
        let resolvedUserId: number | null = userId ? Number(userId) : null;
        if (!resolvedUserId) {
            try {
                const r = await client.query(`SELECT id FROM "otaxdb".credentials LIMIT 1`);
                if (r.rows[0]?.id) resolvedUserId = Number(r.rows[0].id);
            } catch { /* ignore */ }
        }

        // Build the merged property bag from organization_settings +
        // org_integration_settings + organizations + clients_info_new. This is
        // what unblocks Phase A-G users — their ETA creds now live in
        // organization_settings; reading clients_info_new alone returned NULL
        // and crashed the submit with "Signer configuration missing".
        const props = resolvedUserId
            ? await loadEffectiveSettings(client, resolvedUserId)
            : new Map<string, string>();
        const getProp = makeGetProp(props);

        // Try to load organization data as fallback for issuer info
        let orgData: any = null;
        if (resolvedUserId) {
            try {
                const orgQuery = `
                    SELECT o.* FROM "otaxdb".organizations o
                    JOIN "otaxdb".credentials c ON c.organization_id = o.id
                    WHERE c.id = $1
                `;
                const orgRes = await client.query(orgQuery, [resolvedUserId]);
                if (orgRes.rows.length > 0) orgData = orgRes.rows[0];
                // Portal users (new SaaS) don't have a row in `credentials` so
                // the join above returns nothing — try portal_users instead.
                if (!orgData) {
                    const r2 = await client.query(`
                        SELECT o.* FROM "otaxdb".organizations o
                        JOIN "otaxdb".portal_users p ON p.organization_id = o.id
                        WHERE p.id = $1`, [resolvedUserId]);
                    if (r2.rows.length > 0) orgData = r2.rows[0];
                }
            } catch (e) { /* ignore */ }
        }

        // ── Load ETA credentials from organization_settings (primary source) ──
        let clientId = '';
        let clientSecret = '';
        let env = 'PreProd';
        const certificatePIN = getProp('signer_CurrentCertPIN') || '';

        if (orgData?.id) {
            try {
                const etaCredRes = await client.query(
                    `SELECT eta_environment, eta_prod_client_id, eta_prod_client_secret,
                            eta_preprod_client_id, eta_preprod_client_secret
                     FROM "otaxdb".organization_settings WHERE organization_id = $1 LIMIT 1`,
                    [orgData.id]
                );
                const etaCreds = etaCredRes.rows[0];
                if (etaCreds) {
                    env = etaCreds.eta_environment || 'PreProd';
                    if (env === 'Prod') {
                        clientId = etaCreds.eta_prod_client_id || '';
                        clientSecret = etaCreds.eta_prod_client_secret || '';
                    } else {
                        clientId = etaCreds.eta_preprod_client_id || '';
                        clientSecret = etaCreds.eta_preprod_client_secret || '';
                    }
                }
            } catch (e: any) {
                console.warn('[Submit] Could not load ETA credentials from org settings:', e.message);
            }
        }

        // Fallback to legacy getProp if org settings creds are still empty
        if (!clientId) {
            const legacyEnv = getProp('signer_environment_type') || 'PreProd';
            env = legacyEnv;
            clientId = env === 'Prod' ? getProp('signer_prodClientId') : getProp('signer_preProdClientId');
            clientSecret = env === 'Prod' ? getProp('signer_prodClientSecret') : getProp('signer_preProdClientSecret');
        }

        // For agent signing, thumbprint is NOT required on backend
        if (!clientId || !clientSecret) {
            throw new Error(`ETA API credentials missing (environment: ${env}). Please configure Client ID and Client Secret in Settings > ETA Connection.`);
        }
        console.log(`[Submit] ETA credentials loaded. Env: ${env}, ClientId: ${clientId.substring(0, 8)}...`);

        // 2. Authenticate ETA (Batch Session)
        console.log('[DEBUG STEP] 1. Authenticating with ETA...');
        const accessToken = await getETAToken(clientId, clientSecret, env);
        console.log('[DEBUG STEP] 2. Authentication Successful.');
        const hosts = getETAHosts(env);

        // 3. Group Details
        const detailsByInvoice = new Map();
        details.forEach((detail: any) => {
            const internalId = detail.INTERNAL_ID;
            if (!detailsByInvoice.has(internalId)) detailsByInvoice.set(internalId, []);
            detailsByInvoice.get(internalId).push(detail);
        });

        const summary: any = { success: 0, failed: 0, results: [] };

        // 4. Process Each Invoice
        for (const header of headers) {
            const internalId = header.INTERNAL_ID;
            const invoiceUUID = crypto.randomUUID();

            try {
                await logToFile(`3. Processing Invoice ${internalId}...`);
                console.log(`[DEBUG STEP] 3. Processing Invoice ${internalId}...`);

                // A. Map Data
                const invoiceDetails = detailsByInvoice.get(internalId) || [];

                // Helper to parse dates (handles Excel serial numbers like 46026 and DD/MM/YYYY strings)
                const parseExcelDate = (input: any) => {
                    if (!input) return new Date().toISOString();
                    if (typeof input === 'number') {
                        // Convert Excel serial date to JS Date
                        const date = new Date(Math.round((input - 25569) * 86400 * 1000));
                        return date.toISOString();
                    }
                    if (typeof input === 'string') {
                        const parts = input.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
                        if (parts) {
                            // Explicitly handle Day/Month/Year
                            const d = new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1]), 12, 0, 0);
                            if (!isNaN(d.getTime())) return d.toISOString();
                        }
                    }
                    const d = new Date(input);
                    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
                };

                // Accept both legacy Excel column names and the new ETA-aligned ones
                // that the Manual Invoice page (and updated Excel template) emit.
                const headerMapped: any = {
                    internalId: header.INTERNAL_ID,
                    receiverType: header.RECEIVER_TYPE || 'B',
                    receiverId: header.RECEIVER_ID,
                    receiverName: header.RECEIVER_NAME,
                    receiverCountry: header.RECEIVER_COUNTRY || 'EG',
                    receiverGovernate: header.RECEIVER_GOVERNATE,
                    receiverRegionCity: header.RECEIVER_REGIONCITY,
                    receiverStreet: header.RECEIVER_STREET,
                    receiverBuildingNumber: header.RECEIVER_BUILDINGNUMBER,
                    receiverPostalCode: header.RECEIVER_POSTALCODE || '0',
                    receiverFloor: header.RECEIVER_FLOOR || '',
                    receiverRoom: header.RECEIVER_ROOM || '',
                    receiverLandmark: header.RECEIVER_LANDMARK || '',
                    receiverAdditionalInformation: header.RECEIVER_ADDITIONALINFORMATION || '',
                    documentType: header.DOCUMENTTYPE || 'I',
                    // New ETA fields (manual-invoice form sends these; Excel may omit)
                    documentTypeVersion: header.DOCUMENTTYPEVERSION
                        || ((['EI', 'ED', 'EC'].includes(String(header.DOCUMENTTYPE || '').toUpperCase())) ? '1.0' : '0.9'),
                    taxpayerActivityCode: header.TAXPAYERACTIVITYCODE || header.TAX_PAYER_ACTIVITY_CODE || '',
                    serviceDeliveryDate: header.SERVICEDELIVERYDATE || '',
                    references: Array.isArray(header.REFERENCES)
                        ? header.REFERENCES.map((r: any) => String(r).trim()).filter(Boolean)
                        : (header.REFERENCES ? [String(header.REFERENCES).trim()] : []),
                    proformaInvoiceNumber: header.PROFORMAINVOICENUMBER || '',
                    dateTimeIssued: parseExcelDate(header.DATETIMEISSUED),
                    purchaseOrderReference: header.PURCHASEORDERREFERENCE,
                    purchaseOrderDescription: header.PURCHASEORDERDESCRIPTION,
                    salesOrderReference: header.SALESORDERREFERENCE,
                    salesOrderDescription: header.SALESORDERDESCRIPTION,
                    paymentBankName: header.PAYMENT_BANKNAME,
                    paymentBankAddress: header.PAYMENT_BANKADDRESS,
                    paymentBankAccountNo: header.PAYMENT_BANKACCOUNTNO,
                    paymentBankAccountIban: header.PAYMENT_BANKACCOUNTIBAN,
                    paymentSwiftCode: header.PAYMENT_SWIFTCODE,
                    paymentTerms: header.PAYMENT_TERMS,
                    deliveryApproach: header.DELIVERY_APPROACH,
                    deliveryPackaging: header.DELIVERY_PACKAGING,
                    deliveryDateValidity: header.DELIVERY_DATEVALIDITY,
                    deliveryExportPort: header.DELIVERY_EXPORTPORT,
                    deliveryCountryOfOrigin: header.DELIVERY_COUNTRYOFORIGIN,
                    deliveryGrossWeight: parseFloat(header.DELIVERY_GROSSWEIGHT || '0') || undefined,
                    deliveryNetWeight: parseFloat(header.DELIVERY_NETWEIGHT || '0') || undefined,
                    deliveryTerms: header.DELIVERY_TERMS,
                    extraDiscountAmount: parseFloat(header.EXTRADISCOUNTAMOUNT || '0')
                };

                const linesMapped = invoiceDetails.map((detail: any) => {
                    // Prefer the full ETA-shaped TAXABLE_ITEMS array when present; otherwise
                    // fall back to the legacy 4-tax fields (backward compat).
                    const rawTaxable = detail.TAXABLE_ITEMS;
                    const taxableItems = Array.isArray(rawTaxable)
                        ? rawTaxable
                            .map((t: any) => ({
                                taxType: String(t.taxType || '').toUpperCase(),
                                subType: String(t.subType || '').trim(),
                                rate: Number(t.rate) || 0,
                            }))
                            .filter((t: any) => t.taxType && t.subType)
                        : undefined;

                    return {
                        description: detail.DESCRIPTION,
                        itemType: detail.ITEMTYPE || 'GS1',
                        itemCode: detail.ITEMCODE,
                        itemInternalCode: detail.ITEM_INTERNAL_CODE,
                        unitType: detail.UNITTYPE || 'EA',
                        quantity: parseFloat(detail.QUANTITY),
                        currencySold: detail.CURRENCYSOLD || 'EGP',
                        amount: parseFloat(detail.AMOUNT),
                        currencyExchangeRate: parseFloat(detail.CURRENCYEXCHANGERATE || '0'),
                        disRate: parseFloat(detail.DIS_RATE || '0'),
                        disAmount: parseFloat(detail.DIS_AMOUNT || '0'),
                        ...(taxableItems && taxableItems.length > 0 ? { taxableItems } : {
                            // legacy fallback
                            tax_V001: parseFloat(detail.tax_V001 || '0'),
                            tax_V003: parseFloat(detail.tax_V003 || '0'),
                            tax_V009: parseFloat(detail.tax_V009 || '0'),
                            tax_W007: parseFloat(detail.tax_W007 || '0'),
                        }),
                    };
                });

                // B. Validate Header Data from Excel
                const headerErrors = [];
                if (!headerMapped.receiverId || String(headerMapped.receiverId).trim() === '') {
                    headerErrors.push('Receiver ID (Tax Registration Number) is missing in Excel header sheet');
                }
                if (!headerMapped.receiverName || String(headerMapped.receiverName).trim() === '') {
                    headerErrors.push('Receiver Name is missing in Excel header sheet');
                }
                if (!headerMapped.dateTimeIssued) {
                    headerErrors.push('Date Time Issued is missing in Excel header sheet');
                }
                if (linesMapped.length === 0) {
                    headerErrors.push('No invoice lines found in Excel detail sheet for this invoice');
                }

                if (headerErrors.length > 0) {
                    console.error(`[EXCEL DATA ERROR] ${internalId}:`, headerErrors);
                    throw new Error(`Excel data incomplete for invoice ${internalId}:\n${headerErrors.join('\n')}`);
                }

                // C. Validate & Calculate
                const validation = validateInvoice(headerMapped, linesMapped);
                if (!validation.isValid) throw new Error('Validation failed: ' + validation.errors.join(', '));

                const calculated = calculateInvoice(headerMapped, linesMapped);

                // Get Issuer Data from Company Info Settings (with org fallback)
                const issuerData: any = {
                    type: getProp('user_type') || 'B',
                    id: getProp('issuer_id') || orgData?.tax_id || '',
                    name: getProp('issuer_name') || orgData?.name || '',
                    branchID: getProp('issuer_branchId') || '0',
                    country: getProp('issuer_country') || orgData?.country || 'EG',
                    governate: getProp('issuer_governorate') || orgData?.governorate || '',
                    regionCity: '0',
                    street: getProp('issuer_street') || orgData?.street || '',
                    buildingNumber: getProp('issuer_buildingNumber') || orgData?.building_number || '0',
                    postalCode: getProp('issuer_postalCode') || orgData?.postal_code || '0',
                    floor: getProp('issuer_floor') || '0',
                    room: '0',
                    landmark: '0',
                    additionalInformation: '0',
                    activityCode: getProp('tax_payer_activity_code') || '0000'
                };

                // Multi-branch support: if the invoice specifies an ISSUER_BRANCH_ID,
                // look it up in otaxdb.org_branches and override the issuer address.
                // Otherwise fall back to the org's default branch (if any).
                try {
                    const targetBranchId = String(header.ISSUER_BRANCH_ID || '').trim();
                    // Resolve org id for the SQL lookup — already on orgData.
                    const orgIdForBranch = orgData?.id;
                    if (orgIdForBranch) {
                        const branchRes = await client.query(
                            targetBranchId
                                ? `SELECT * FROM "otaxdb".org_branches WHERE organization_id = $1 AND branch_id = $2 AND is_active = TRUE LIMIT 1`
                                : `SELECT * FROM "otaxdb".org_branches WHERE organization_id = $1 AND is_default = TRUE AND is_active = TRUE LIMIT 1`,
                            targetBranchId ? [orgIdForBranch, targetBranchId] : [orgIdForBranch]
                        );
                        const b = branchRes.rows[0];
                        if (b) {
                            issuerData.branchID = b.branch_id || issuerData.branchID;
                            issuerData.country = b.country || issuerData.country;
                            issuerData.governate = b.governate || issuerData.governate;
                            issuerData.regionCity = b.region_city || issuerData.regionCity;
                            issuerData.street = b.street || issuerData.street;
                            issuerData.buildingNumber = b.building_number || issuerData.buildingNumber;
                            issuerData.postalCode = b.postal_code || issuerData.postalCode;
                            issuerData.floor = b.floor || issuerData.floor;
                            issuerData.room = b.room || issuerData.room;
                            issuerData.landmark = b.landmark || issuerData.landmark;
                            issuerData.additionalInformation = b.additional_info || issuerData.additionalInformation;
                        }
                    }
                } catch (e: any) {
                    console.warn('[Excel Submit] Branch lookup (non-fatal):', e.message);
                }

                // Validate Issuer Data BEFORE building document
                const issuerErrors = [];
                if (!issuerData.id || issuerData.id.trim() === '') {
                    issuerErrors.push('Issuer ID (Tax Registration Number) is missing. Please configure it in Settings > Company Info.');
                }
                if (!issuerData.name || issuerData.name.trim() === '') {
                    issuerErrors.push('Issuer Name (Company Name) is missing. Please configure it in Settings > Company Info.');
                }
                if (!issuerData.governate || issuerData.governate.trim() === '') {
                    issuerErrors.push('Issuer Governate is missing. Please configure it in Settings > Company Info.');
                }
                if (!issuerData.street || issuerData.street.trim() === '') {
                    issuerErrors.push('Issuer Street is missing. Please configure it in Settings > Company Info.');
                }

                if (issuerErrors.length > 0) {
                    console.error(`[ISSUER CONFIG ERROR] ${internalId}:`, issuerErrors);
                    throw new Error(`Issuer configuration incomplete:\n${issuerErrors.join('\n')}`);
                }

                // Auto-fix issuance date - Pre-Prod is very strict (often 1-24 hours max)
                const issuedDate = new Date(headerMapped.dateTimeIssued);
                const now = new Date();
                const diffDays = (now.getTime() - issuedDate.getTime()) / (1000 * 3600 * 24);

                // If date is more than 12 hours old or in the future, force to NOW
                if (diffDays > 0.5 || diffDays < -0.05) {
                    console.log(`[Batch] Date ${headerMapped.dateTimeIssued} is out of safe range (${diffDays.toFixed(2)} days diff). Adjusting to ${now.toISOString()}`);
                    headerMapped.dateTimeIssued = now.toISOString();
                }

                // Ensure the calculated object used by the builder has the corrected date
                calculated.header.dateTimeIssued = headerMapped.dateTimeIssued;
                console.log(`[Batch] Final dateTimeIssued for ${internalId}: ${calculated.header.dateTimeIssued}`);

                // Build Complete ETA Document
                const document = buildETADocument(calculated, issuerData);

                // C. Validate Document Structure BEFORE Signing
                console.log(`[VALIDATION] Checking document structure for ${internalId}...`);

                // Debug: Log what we're about to validate
                console.log(`[DEBUG] Document Structure for ${internalId}:`);
                console.log(`  - issuer.id: "${document.issuer?.id}" (type: ${typeof document.issuer?.id})`);
                console.log(`  - issuer.name: "${document.issuer?.name}" (type: ${typeof document.issuer?.name})`);
                console.log(`  - receiver.id: "${document.receiver?.id}" (type: ${typeof document.receiver?.id})`);
                console.log(`  - receiver.name: "${document.receiver?.name}" (type: ${typeof document.receiver?.name})`);
                console.log(`  - dateTimeIssued: "${document.dateTimeIssued}" (type: ${typeof document.dateTimeIssued})`);
                console.log(`  - invoiceLines: ${document.invoiceLines?.length || 0} lines`);

                // Validate critical fields
                const validationErrors = [];
                if (!document.issuer?.id || document.issuer.id === '0') {
                    validationErrors.push('Missing issuer.id');
                }
                if (!document.issuer?.name || document.issuer.name === '0') {
                    validationErrors.push('Missing issuer.name');
                }
                if (!document.receiver?.id || document.receiver.id === '0') {
                    validationErrors.push('Missing receiver.id');
                }
                if (!document.receiver?.name || document.receiver.name === '0') {
                    validationErrors.push('Missing receiver.name');
                }
                if (!document.dateTimeIssued) {
                    validationErrors.push('Missing dateTimeIssued');
                }
                if (!document.invoiceLines || document.invoiceLines.length === 0) {
                    validationErrors.push('Missing or empty invoiceLines');
                }

                // Validate invoice lines
                if (document.invoiceLines) {
                    document.invoiceLines.forEach((line: any, idx: number) => {
                        if (!line.description) validationErrors.push(`Line ${idx}: Missing description`);
                        if (!line.itemCode) validationErrors.push(`Line ${idx}: Missing itemCode`);
                        if (!line.unitType) validationErrors.push(`Line ${idx}: Missing unitType`);
                        if (line.quantity === undefined || line.quantity === null) validationErrors.push(`Line ${idx}: Missing quantity`);
                        if (!line.unitValue) validationErrors.push(`Line ${idx}: Missing unitValue`);
                        if (!line.taxableItems || line.taxableItems.length === 0) {
                            validationErrors.push(`Line ${idx}: Missing or empty taxableItems`);
                        }
                    });
                }

                if (validationErrors.length > 0) {
                    console.error(`[VALIDATION FAILED] ${internalId}:`, validationErrors);
                    console.error(`[DEBUG] Full issuerData:`, JSON.stringify(issuerData, null, 2));
                    console.error(`[DEBUG] Full calculated.header:`, JSON.stringify(calculated.header, null, 2));
                    throw new Error(`Document validation failed: ${validationErrors.join(', ')}`);
                }

                console.log(`[VALIDATION] Document structure OK for ${internalId}`);

                // D. Sign
                await logToFile(`4. Signing invoice ${internalId}...`);
                console.log(`[DEBUG STEP] 4. Signing invoice ${internalId}...`);

                // --- DEBUG: Log the Document JSON before signing/sending ---
                // This helps identify "Invalid structured submission" causes (missing fields, wrong types)
                const docJson = JSON.stringify(document, null, 2);
                await logToFile(`[DOC JSON] \n${docJson}\n[END SEC]`);
                console.log(`[DOC PRE-SIGN] ${internalId} JSON preview:`, docJson.substring(0, 500) + '...');
                // -----------------------------------------------------------


                let signedDocument;
                const companyId = issuerData.id || 'default';
                console.log(`[Batch] Requesting signature for Company: ${companyId} (Invoice: ${internalId})`);

                // ── SMART SIGNING: Check org settings for method ──
                let orgSigningMethod = 'legacy'; // default fallback
                let orgPfxBuffer: Buffer | null = null;
                let orgPfxPassword: string | null = null;
                let orgCertIssuer: string = ''; // Empty = agent will auto-detect from cert store

                try {
                    // Try to find org settings by matching issuer tax ID or organization_id
                    let orgSettingsRes;
                    if (orgData?.id) {
                        orgSettingsRes = await client.query(
                            `SELECT signing_method, certificate_pfx, certificate_password, certificate_issuer, agent_company_id
                             FROM "otaxdb".organization_settings WHERE organization_id = $1 LIMIT 1`,
                            [orgData.id]
                        );
                    }
                    // Fallback: search by tax ID
                    if ((!orgSettingsRes || orgSettingsRes.rows.length === 0) && issuerData.id) {
                        orgSettingsRes = await client.query(
                            `SELECT signing_method, certificate_pfx, certificate_password, certificate_issuer, agent_company_id
                             FROM "otaxdb".organization_settings WHERE eta_tax_id = $1 LIMIT 1`,
                            [issuerData.id]
                        );
                    }
                    const orgSettings = orgSettingsRes?.rows[0];

                    if (orgSettings) {
                        orgSigningMethod = orgSettings.signing_method || 'agent';
                        if (orgSettings.certificate_pfx && orgSettings.certificate_password) {
                            orgPfxBuffer = Buffer.from(orgSettings.certificate_pfx);
                            orgPfxPassword = orgSettings.certificate_password;
                        }
                        if (orgSettings.certificate_issuer) {
                            orgCertIssuer = orgSettings.certificate_issuer;
                        }
                        console.log(`[Batch] Org signing method: ${orgSigningMethod}`);
                    }
                } catch (e: any) {
                    console.warn(`[Batch] Could not load org signing settings: ${e.message}`);
                }

                // ── Option 1: PFX Cloud Signing (any user, no USB needed) ──
                if (orgSigningMethod === 'pfx' && orgPfxBuffer && orgPfxPassword) {
                    console.log(`[Batch] Using PFX cloud signing for ${internalId}`);
                    const { signWithPFX } = await import('./services/pfxSigner.js');
                    signedDocument = await signWithPFX(document, orgPfxBuffer, orgPfxPassword, orgCertIssuer);
                }
                // ── Option 2: Agent Bridge (Master PC signs remotely) ──
                else if (orgSigningMethod === 'agent' || process.env.RENDER) {
                    console.log(`[Batch] Using Agent bridge signing for ${internalId}`);
                    signedDocument = await bridgeService.signDocument(companyId, {
                        document,
                        pin: certificatePIN,
                        certificateIssuer: orgCertIssuer
                    });
                }
                // ── Option 3: Local C# Signer (dev/legacy fallback) ──
                else {
                    console.log(`[Batch] Using local C# signer for ${internalId}`);
                    signedDocument = await signInvoiceWithCsharpSigner(document, certificatePIN, orgCertIssuer);
                }
                await logToFile(`5. Signing Successful.`);
                console.log(`[DEBUG STEP] 5. Signing Successful.`);

                // ── CRITICAL: Validate signature BEFORE sending to ETA ──
                // If PIN was skipped or signing failed silently, the signature may be malformed
                if (!signedDocument || !signedDocument.signatures || signedDocument.signatures.length === 0) {
                    throw new Error(`Signing failed for ${internalId}: No signature was generated. Make sure the USB token PIN was entered correctly.`);
                }
                const sigValue = signedDocument.signatures[0]?.value || '';
                const sigType = signedDocument.signatures[0]?.type || '';

                // A valid CAdES-BES signature is typically 2000+ chars (Base64-encoded DER)
                if (sigValue.length < 500) {
                    throw new Error(`Signing failed for ${internalId}: Invalid signature (only ${sigValue.length} chars). PIN may have been skipped or cancelled. Please ensure the token PIN is correct.`);
                }

                // Valid signatures start with 'MI' (Base64 ASN.1 DER)
                if (!sigValue.startsWith('MI')) {
                    throw new Error(`Signing failed for ${internalId}: Malformed signature format. Expected CAdES-BES signature starting with 'MI', got '${sigValue.substring(0, 8)}...'. Re-run signing with correct PIN.`);
                }

                // Verify signature type is CADES-BES (type 'I')
                if (sigType !== 'I') {
                    console.warn(`[Batch] Unexpected signature type '${sigType}' for ${internalId}, expected 'I'. Continuing anyway.`);
                }

                console.log(`[Batch] ✓ Signature validated: ${sigValue.length} chars, type='${sigType}', starts='${sigValue.substring(0, 4)}'`);

                // E. Send to ETA
                await logToFile(`6. Sending to ETA (${hosts.api})...`);
                console.log(`[DEBUG STEP] 6. Sending to ETA (${hosts.api})...`);

                // Log the exact payload being sent
                const payloadObj = { documents: [signedDocument] };
                console.log(`[ETA REQUEST] Endpoint: ${hosts.api}/api/v1.0/documentsubmissions`);
                console.log(`[ETA REQUEST] Payload structure:`, {
                    documentCount: payloadObj.documents.length,
                    firstDocumentKeys: Object.keys(payloadObj.documents[0]),
                    internalID: payloadObj.documents[0].internalID,
                    hasSignatures: !!payloadObj.documents[0].signatures
                });

                // CRITICAL FIX for 4043 error: Send JSON as pre-stringified string
                // This ensures Arabic characters are sent as UTF-8, not escaped as \uXXXX
                // Matches mrkindy repository fix (commit 012e77f)
                const payloadString = JSON.stringify(payloadObj);
                const payload = Buffer.from(payloadString, 'utf8');

                // Debug logging
                console.log('[Batch] Payload is Buffer:', Buffer.isBuffer(payload));
                console.log('[Batch] Payload length:', payload.length);
                console.log('[Batch] Contains Arabic:', payloadString.includes('اوبراتفز'));
                console.log('[Batch] Contains \\u escapes:', payloadString.includes('\\u'));

                const etaResponse = await axios.post(
                    `${hosts.api}/api/v1.0/documentsubmissions`,
                    payload,
                    {
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json; charset=utf-8',
                            'Content-Length': payload.length.toString()
                        },
                        timeout: 30000, // 30 second timeout
                        transformRequest: [],
                        transformResponse: []
                    }
                ).catch(async (axiosError: any) => {
                    // Enhanced error logging
                    console.error(`[ETA ERROR] Failed to submit ${internalId}`);
                    console.error(`[ETA ERROR] Status: ${axiosError.response?.status}`);
                    console.error(`[ETA ERROR] Status Text: ${axiosError.response?.statusText}`);
                    console.error(`[ETA ERROR] Response Data:`, JSON.stringify(axiosError.response?.data, null, 2));
                    console.error(`[ETA ERROR] Request URL: ${axiosError.config?.url}`);
                    console.error(`[ETA ERROR] Request Method: ${axiosError.config?.method}`);

                    if (axiosError.code === 'ECONNABORTED') {
                        console.error(`[ETA ERROR] Request timed out after 30 seconds`);
                    } else if (axiosError.code === 'ENOTFOUND' || axiosError.code === 'ECONNREFUSED') {
                        console.error(`[ETA ERROR] Cannot reach ETA server - network issue`);
                    }

                    await logToFile(`7. ETA ERROR: ${axiosError.message}`);
                    await logToFile(`   Status: ${axiosError.response?.status}, Data: ${JSON.stringify(axiosError.response?.data)}`);

                    throw axiosError; // Re-throw to be caught by outer try-catch
                });

                await logToFile(`7. ETA Response Received: ${JSON.stringify(etaResponse.data)}`);
                console.log(`[DEBUG STEP] 7. ETA Response Received.`);
                console.log(`[ETA RESPONSE] Full response:`, JSON.stringify(etaResponse.data, null, 2));

                // Parse response if it's a string (due to transformResponse: [])
                const responseData = typeof etaResponse.data === 'string' ? JSON.parse(etaResponse.data) : etaResponse.data;

                const submissionId = responseData.submissionId;
                const acceptedDocs = responseData.acceptedDocuments || [];
                const rejectedDocs = responseData.rejectedDocuments || [];

                console.log(`[ETA RESPONSE] Submission ID: ${submissionId}`);
                console.log(`[ETA RESPONSE] Accepted: ${acceptedDocs.length}, Rejected: ${rejectedDocs.length}`);

                // Check if this specific document was rejected
                const rejection = rejectedDocs.find((r: any) => r.internalId === internalId);
                if (rejection) {
                    console.error(`[ETA REJECTION] Invoice ${internalId} was REJECTED by ETA`);
                    console.error(`[ETA REJECTION] Error:`, JSON.stringify(rejection.error, null, 2));

                    await logToFile(`7. REJECTED by ETA: ${JSON.stringify(rejection.error)}`);

                    // Build detailed error message
                    let errorMsg = `ETA Validation Failed: ${rejection.error?.message || 'Unknown error'}`;
                    if (rejection.error?.details && Array.isArray(rejection.error.details)) {
                        errorMsg += '\nValidation Errors:\n';
                        rejection.error.details.forEach((detail: any) => {
                            errorMsg += `  - ${detail.propertyPath}: ${detail.message}\n`;
                        });
                    }

                    throw new Error(errorMsg);
                }

                // Check if document was accepted
                const accepted = acceptedDocs.find((a: any) => a.internalId === internalId);
                if (!accepted) {
                    console.error(`[ETA ERROR] Invoice ${internalId} was neither accepted nor rejected - unexpected response`);
                    throw new Error('Document not found in accepted or rejected lists');
                }

                console.log(`[ETA SUCCESS] Invoice ${internalId} ACCEPTED by ETA`);
                console.log(`[ETA SUCCESS] UUID: ${accepted.uuid}`);

                const status = 'Valid'; // ETA accepted it, status is Valid

                // Save to public.documents (New Schema)
                await client.query(`
                    INSERT INTO public.documents (
                        uuid, "submissionId", "internalId", submitted, "typeName", "issuerId", "issuerName", 
                        "receiverId", "receiverName", "dateTimeIssued", "totalSales", "totalDiscount", "netAmount", total, 
                        status, environment, "documentBody"
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                `, [
                    accepted.uuid, // Use ETA-assigned UUID, not our local one
                    submissionId,
                    internalId,
                    true,
                    document.documentType,
                    document.issuer.id,
                    document.issuer.name,
                    document.receiver.id,
                    document.receiver.name,
                    headerMapped.dateTimeIssued, // Use parsed date directly
                    document.totalSalesAmount,
                    document.totalDiscountAmount,
                    document.netAmount,
                    document.totalAmount,
                    status,
                    env,
                    JSON.stringify(signedDocument)
                ]);

                // Also save to org-specific table (InvoicesDb schema)
                if (orgData) {
                    try {
                        const orgTables = getOrgTableNames(orgData.id, orgData.name);
                        // Ensure org tables exist
                        await createOrgTables(pool, orgData.id, orgData.name);

                        await client.query(`
                            INSERT INTO "InvoicesDb"."${orgTables.documents}" (
                                uuid, "submissionId", "internalId", submitted, "typeName",
                                "issuerId", "issuerName", "receiverId", "receiverName",
                                "dateTimeIssued", "totalSales", "totalDiscount", "netAmount", total,
                                status, direction, environment, org_id, synced_at
                            ) VALUES (
                                $1, $2, $3, true, $4,
                                $5, $6, $7, $8,
                                $9, $10, $11, $12, $13,
                                $14, 'Sent', $15, $16, NOW()
                            )
                            ON CONFLICT (uuid) DO UPDATE SET
                                status = EXCLUDED.status,
                                synced_at = NOW()
                        `, [
                            accepted.uuid,
                            submissionId,
                            internalId,
                            document.documentType || 'I',
                            document.issuer.id,
                            document.issuer.name,
                            document.receiver.id,
                            document.receiver.name,
                            headerMapped.dateTimeIssued,
                            document.totalSalesAmount || 0,
                            document.totalDiscountAmount || 0,
                            document.netAmount || 0,
                            document.totalAmount || 0,
                            status,
                            env,
                            orgData.id,
                        ]);
                        console.log(`[Batch] ✅ Saved to org table ${orgTables.documents}`);

                        // Auto-populate the customer (receiver of a Sent invoice) into
                        // master_data_customers so the next ManualInvoice form picks
                        // them up immediately instead of waiting for the next sync.
                        // Failure is non-fatal — we never want a master-data hiccup
                        // to fail an otherwise-successful ETA submission.
                        upsertCustomerFromDoc(pool, orgData.id, orgData.name, {
                            direction: 'Sent',
                            issuerId: document.issuer.id,
                            issuerName: document.issuer.name,
                            receiverId: document.receiver.id,
                            receiverName: document.receiver.name,
                            receiverType: document.receiver.type,
                            receiverAddress: document.receiver.address,
                            total: document.totalAmount || 0,
                            dateTimeIssued: headerMapped.dateTimeIssued,
                        }).catch((mdErr: any) => console.warn(`[Submit] Customer auto-pop failed for ${internalId}:`, mdErr.message));

                        // Fan out the success event to any registered outbound webhooks.
                        // Best-effort — the queue + worker handle delivery, retries, and
                        // signing, so this call returns instantly with the count of subs
                        // we scheduled.
                        enqueueWebhookEvent(pool, orgData.id, 'invoice.submitted', {
                            uuid: accepted.uuid,
                            internalId,
                            submissionId,
                            issuerId: document.issuer.id,
                            issuerName: document.issuer.name,
                            receiverId: document.receiver.id,
                            receiverName: document.receiver.name,
                            total: document.totalAmount || 0,
                            currency: document.invoiceLines?.[0]?.currencySold || 'EGP',
                            dateTimeIssued: headerMapped.dateTimeIssued,
                            environment: env,
                        }).catch((whErr: any) => console.warn(`[Submit] Webhook enqueue failed for ${internalId}:`, whErr.message));
                    } catch (orgTableErr: any) {
                        console.warn(`[Batch] ⚠️ Could not save to org table: ${orgTableErr.message}`);
                    }
                }

                summary.success++;
                summary.results.push({
                    internalId,
                    status: 'Submitted',
                    uuid: invoiceUUID,
                    etaResponse: etaResponse.data
                });

            } catch (invErr: any) {
                console.error(`Failed to process invoice ${internalId}:`, invErr.message);

                // Extract ETA response if available
                const etaResponse = invErr.response?.data || null;
                const errorStr = etaResponse ? JSON.stringify(etaResponse, null, 2) : (invErr.message || 'Unknown Error');

                if (etaResponse) {
                    console.error(`[ETA Response for ${internalId}]:`, errorStr);
                }

                // Check if this is a duplicate submission error (422)
                const isDuplicate = invErr.response?.status === 422 &&
                    (errorStr.includes('identical to a previous payload') || errorStr.includes('Request payload is identical'));

                // Log Error to public.errors table
                try {
                    await client.query(`
                        INSERT INTO public.errors (
                            uuid, "submissionError", "internalId", "gettingError_1"
                        ) VALUES ($1, $2, $3, $4)
                     `, [invoiceUUID, String(invErr.message).substring(0, 9999), internalId, errorStr.substring(0, 9999)]);
                } catch (dbErr) { console.error('Failed to log error to DB:', dbErr); }

                if (isDuplicate) {
                    // Treat duplicate as a warning, not a failure
                    summary.results.push({
                        internalId,
                        status: 'Already Submitted',
                        error: 'This invoice was already successfully submitted to the ETA portal within the last 10 minutes. Check the ETA portal or wait before resubmitting.',
                        errorDetails: errorStr,
                        etaResponse: etaResponse
                    });
                } else {
                    summary.failed++;
                    summary.results.push({
                        internalId,
                        status: 'Failed',
                        error: invErr.message,
                        // Prioritize showing the API Error Response over the stack trace
                        errorDetails: etaResponse ? JSON.stringify(etaResponse, null, 2) : (invErr.stack || String(invErr)),
                        etaResponse: etaResponse
                    });
                }
            }
        }

        res.json({ success: true, summary });

    } catch (err: any) {
        console.error('Batch Submit Error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        client.release();
    }
});


// Duplicate health check removed - Kept original /api/health at top.

// SPA Fallback - Serve index.html for all non-API routes
// Note: This assumes the build output is in a folder called 'dist' next to the server folder
const frontendDist = path.join(__dirname, '..', '..', '..', 'OTax E-Invoice', 'smart-e-invoicing-middleware', 'dist');
app.use(express.static(frontendDist));


app.all('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }

    const indexPath = path.join(frontendDist, 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            // If dist not found (dev mode), just return a healthy message or the API info
            res.status(200).json({
                message: 'OTax Backend API',
                note: 'Frontend build not detected in dist folder. In development, use Vite dev server.'
            });
        }
    });
});



// ============================================
// Server Startup
// ============================================

const server = app.listen(port as number, '0.0.0.0', () => {
    console.log(`[Server] Backend listening at http://0.0.0.0:${port}`);
    console.log(`[Server] WebSocket Bridge active on /api/bridge`);
});

// Handle WebSocket Upgrade
server.on('upgrade', (request, socket, head) => {
    // Route to the WebSocket Server
    const url = request.url || '';
    if (url === '/api/logs' || url === '/' || url.includes('websocket') || url.startsWith('/api/bridge')) {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});







