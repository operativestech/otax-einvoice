/**
 * ERP Importer — orchestrates fetch + submit cycles for one org.
 *
 * Adds beyond the MVP:
 *
 *   1. **Deduplication**: every (orgId, externalId) we've seen lands in
 *      `erp_invoice_index` with status (submitted | failed | skipped).
 *      Subsequent runs skip already-submitted ids automatically.
 *
 *   2. **Incremental sync**: if the caller doesn't pass `since`, we look up
 *      `erp_integration_settings.erp_last_synced_at` and pick from there.
 *      The pointer advances only when a run finishes with status ≠ failed,
 *      so a single bad run doesn't lose a window.
 *
 *   3. **Concurrent-run lock**: we acquire a Postgres advisory lock keyed on
 *      orgId before opening the run row. A second concurrent call returns
 *      immediately with status='busy' instead of stomping on the first.
 *
 *   4. **Per-invoice error log**: every fatura that the submit handler
 *      flagged as Failed is recorded in `erp_invoice_index` with the ETA
 *      error message, so the user can see *which* invoices broke instead of
 *      a "5 failed" aggregate.
 *
 *   5. **Public listRecentRuns()** still returns the same shape, plus a new
 *      `getRunDetail(runId)` for drilling into a specific run's failures.
 */

import pg from 'pg';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createErpAdapter } from './index.js';
import type { ErpConnectionConfig, ErpInvoice, FetchOptions } from './types.js';
import { decryptSecret } from '../secrets.js';

let schemaReady = false;
export async function ensureSchema(pool: pg.Pool): Promise<void> {
    if (schemaReady) return;
    try {
        // Run-level audit
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "otaxdb".erp_runs (
                id              BIGSERIAL PRIMARY KEY,
                organization_id INTEGER NOT NULL,
                started_by      INTEGER,
                started_at      TIMESTAMP NOT NULL DEFAULT NOW(),
                finished_at     TIMESTAMP,
                status          VARCHAR(16) NOT NULL DEFAULT 'running',  -- running | success | partial | failed | busy
                provider        VARCHAR(32),
                fetched_count   INTEGER NOT NULL DEFAULT 0,
                submitted_count INTEGER NOT NULL DEFAULT 0,
                failed_count    INTEGER NOT NULL DEFAULT 0,
                skipped_count   INTEGER NOT NULL DEFAULT 0,
                error_message   TEXT,
                summary         JSONB,
                triggered_by    VARCHAR(16) NOT NULL DEFAULT 'manual'    -- manual | scheduled
            );
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_erp_runs_org ON "otaxdb".erp_runs(organization_id, started_at DESC);`);
        // Backfill column for older deployments — idempotent
        await pool.query(`ALTER TABLE "otaxdb".erp_runs
                            ADD COLUMN IF NOT EXISTS skipped_count INTEGER NOT NULL DEFAULT 0,
                            ADD COLUMN IF NOT EXISTS triggered_by VARCHAR(16) NOT NULL DEFAULT 'manual'`);

        // Per-invoice index — what we've seen + final disposition. Keyed by
        // (org, externalId) so the same external id from a different org is
        // independent.
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "otaxdb".erp_invoice_index (
                organization_id INTEGER NOT NULL,
                external_id     VARCHAR(255) NOT NULL,
                internal_id     VARCHAR(255),
                status          VARCHAR(16) NOT NULL,               -- submitted | failed | skipped
                run_id          BIGINT,
                eta_uuid        VARCHAR(64),
                error_message   TEXT,
                first_seen_at   TIMESTAMP NOT NULL DEFAULT NOW(),
                last_seen_at    TIMESTAMP NOT NULL DEFAULT NOW(),
                PRIMARY KEY (organization_id, external_id)
            );
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_erp_index_run ON "otaxdb".erp_invoice_index(run_id);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_erp_index_status ON "otaxdb".erp_invoice_index(organization_id, status);`);

        // Schedule + last-sync pointer columns on org_integration_settings.
        // `mode` mirrors autoSyncScheduler's vocabulary so we can hand the
        // execution off to it later without renames.
        await pool.query(`ALTER TABLE "otaxdb".org_integration_settings
                            ADD COLUMN IF NOT EXISTS erp_auto_import_mode    VARCHAR(16) DEFAULT 'off',
                            ADD COLUMN IF NOT EXISTS erp_auto_import_minutes INTEGER     DEFAULT 60,
                            ADD COLUMN IF NOT EXISTS erp_last_synced_at      TIMESTAMP`);

        schemaReady = true;
    } catch (e: any) {
        console.warn('[ErpImporter] ensureSchema:', e.message);
    }
}

// ─── Adapter helpers ─────────────────────────────────────────────────────

/** Map an integration_settings row into the adapter config + decrypt secrets. */
export function configFromSettings(row: any): ErpConnectionConfig {
    return {
        provider:        String(row.erp_provider || '') as any,
        host:            row.erp_host || null,
        port:            null,                                       // host can include :port; adapter splits it
        database:        row.erp_db || null,
        user:            row.erp_user || null,
        password:        decryptSecret(row.erp_password_encrypted) || null,
        legalEntity:     row.erp_legal_entity || null,
        docTypeVersion:  row.erp_doc_type_version || null,
        headerView:      row.erp_header_view || null,
        linesView:       row.erp_lines_view || null,
    };
}

async function loadIntegrationRow(pool: pg.Pool, orgId: number) {
    const r = await pool.query(
        `SELECT * FROM "otaxdb".org_integration_settings WHERE organization_id = $1`, [orgId]
    );
    return r.rows[0] || null;
}

export async function loadAdapterForOrg(pool: pg.Pool, orgId: number) {
    await ensureSchema(pool);
    const row = await loadIntegrationRow(pool, orgId);
    if (!row) return null;
    const cfg = configFromSettings(row);
    if (!cfg.provider) return null;
    return { adapter: createErpAdapter(cfg), cfg, settingsRow: row };
}

// ─── Concurrent-run lock ─────────────────────────────────────────────────
//
// We use Postgres advisory locks (`pg_try_advisory_lock`) keyed on a hash of
// the org id with a stable namespace. The lock auto-releases when the
// connection closes, so a crashed importer can't permanently wedge an org.

const LOCK_NAMESPACE = 0x4f7461; // "Ota" — arbitrary tag

function hashOrgId(orgId: number): number {
    // 31-bit unsigned integer derived from the org id — pg advisory locks
    // accept either a single int8 or two int4s; we use the (namespace, key)
    // form so different OTax features can't collide on the same id space.
    return Math.abs(crypto.createHash('sha1').update(`erp:${orgId}`).digest().readInt32BE(0));
}

async function withOrgLock<T>(
    pool: pg.Pool, orgId: number,
    onLocked: () => Promise<T>,
    onBusy: () => T,
): Promise<T> {
    const client = await pool.connect();
    try {
        const key = hashOrgId(orgId);
        const r = await client.query(`SELECT pg_try_advisory_lock($1, $2)::int AS got`, [LOCK_NAMESPACE, key]);
        const got = Number(r.rows[0]?.got || 0) === 1;
        if (!got) return onBusy();
        try {
            return await onLocked();
        } finally {
            await client.query(`SELECT pg_advisory_unlock($1, $2)`, [LOCK_NAMESPACE, key]).catch(() => {});
        }
    } finally {
        client.release();
    }
}

// ─── Preview ─────────────────────────────────────────────────────────────

export interface PreviewResult {
    invoices: ErpInvoice[];
    fetchedCount: number;
    provider: string;
    /** External ids that would be skipped on a real import because we've
     *  already submitted them. Not filtered out of `invoices` so the user
     *  can still inspect them. */
    alreadyImported: string[];
}

export async function previewInvoices(pool: pg.Pool, orgId: number, opts: FetchOptions = {}): Promise<PreviewResult> {
    const handle = await loadAdapterForOrg(pool, orgId);
    if (!handle) throw new Error('No ERP integration configured for this organization.');
    try {
        const invoices = await handle.adapter.fetchInvoices({ limit: opts.limit ?? 5, ...opts });
        // Cross-reference against the dedup index so the UI can highlight
        // which rows are repeats.
        let alreadyImported: string[] = [];
        if (invoices.length) {
            const ids = invoices.map(i => i.externalId);
            const seen = await pool.query(
                `SELECT external_id FROM "otaxdb".erp_invoice_index
                 WHERE organization_id = $1 AND external_id = ANY($2::text[]) AND status = 'submitted'`,
                [orgId, ids]
            );
            alreadyImported = seen.rows.map((r: any) => String(r.external_id));
        }
        return { invoices, fetchedCount: invoices.length, provider: handle.adapter.provider, alreadyImported };
    } finally {
        await handle.adapter.close?.();
    }
}

// ─── Run ─────────────────────────────────────────────────────────────────

export interface RunResult {
    runId: number;
    status: 'success' | 'partial' | 'failed' | 'busy';
    fetchedCount: number;
    submittedCount: number;
    failedCount: number;
    skippedCount: number;
    errorMessage?: string;
}

export interface RunOptions extends FetchOptions {
    /** 'manual' = user clicked Import Now; 'scheduled' = cron tick. */
    triggeredBy?: 'manual' | 'scheduled';
    /** Force reprocessing of already-submitted external ids. Default false. */
    reimport?: boolean;
}

/** Full fetch + submit pass with dedup, incremental since-pointer, and
 *  per-invoice error tracking. Acquires a per-org advisory lock so two
 *  concurrent calls don't both fire. */
export async function runImport(
    pool: pg.Pool, orgId: number, userId: number, opts: RunOptions = {}
): Promise<RunResult> {
    await ensureSchema(pool);

    return withOrgLock(pool, orgId,
        () => runImportLocked(pool, orgId, userId, opts),
        () => ({
            runId: 0,
            status: 'busy' as const,
            fetchedCount: 0, submittedCount: 0, failedCount: 0, skippedCount: 0,
            errorMessage: 'Another import is already running for this organization. Wait for it to finish.',
        }),
    );
}

async function runImportLocked(
    pool: pg.Pool, orgId: number, userId: number, opts: RunOptions = {}
): Promise<RunResult> {
    const triggeredBy = opts.triggeredBy === 'scheduled' ? 'scheduled' : 'manual';

    // Open the run row first so even an early crash leaves an audit trail.
    const insertRes = await pool.query(
        `INSERT INTO "otaxdb".erp_runs (organization_id, started_by, status, triggered_by)
         VALUES ($1, $2, 'running', $3) RETURNING id`,
        [orgId, userId, triggeredBy]
    );
    const runId = Number(insertRes.rows[0].id);

    let provider = '';
    let fetchedCount = 0;
    let submittedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let summary: any = {};
    let errorMessage: string | null = null;
    let advanceSyncPointerTo: Date | null = null;

    try {
        const handle = await loadAdapterForOrg(pool, orgId);
        if (!handle) throw new Error('No ERP integration configured.');
        provider = handle.adapter.provider;

        // Fail fast on bad creds.
        const test = await handle.adapter.testConnection();
        if (!test.ok) throw new Error(`Connection test failed: ${test.message}`);

        // Incremental: if caller didn't pass `since`, pick up where the last
        // successful run left off. The pointer is per-org on
        // org_integration_settings.erp_last_synced_at.
        let effectiveSince = opts.since;
        if (!effectiveSince) {
            const last = handle.settingsRow?.erp_last_synced_at;
            if (last) effectiveSince = new Date(last);
        }
        const effectiveUntil = opts.until ?? new Date();

        const invoices = await handle.adapter.fetchInvoices({
            limit: opts.limit ?? 200,
            since: effectiveSince,
            until: effectiveUntil,
        });
        fetchedCount = invoices.length;
        await handle.adapter.close?.();

        // Dedup pass — load every external id we've already submitted.
        const allIds = invoices.map(i => i.externalId).filter(Boolean);
        let alreadySubmitted = new Set<string>();
        if (allIds.length && !opts.reimport) {
            const r = await pool.query(
                `SELECT external_id FROM "otaxdb".erp_invoice_index
                 WHERE organization_id = $1 AND external_id = ANY($2::text[]) AND status = 'submitted'`,
                [orgId, allIds]
            );
            alreadySubmitted = new Set(r.rows.map((x: any) => String(x.external_id)));
        }
        const toSubmit = invoices.filter(i => !alreadySubmitted.has(i.externalId));
        skippedCount = invoices.length - toSubmit.length;

        // Mark the skipped ones with a fresh last_seen_at so the index isn't
        // misleading about when we last saw them.
        if (skippedCount > 0) {
            await pool.query(
                `UPDATE "otaxdb".erp_invoice_index
                    SET last_seen_at = NOW()
                  WHERE organization_id = $1 AND external_id = ANY($2::text[])`,
                [orgId, Array.from(alreadySubmitted)]
            ).catch(() => {});
        }

        if (toSubmit.length === 0) {
            // Pointer still advances on a successful "nothing new" run so we
            // don't keep re-fetching the same window.
            advanceSyncPointerTo = effectiveUntil;
            await markRun(pool, runId, 'success',
                { provider, fetchedCount, submittedCount: 0, failedCount: 0, skippedCount });
            await advancePointer(pool, orgId, advanceSyncPointerTo);
            return { runId, status: 'success', fetchedCount, submittedCount: 0, failedCount: 0, skippedCount };
        }

        // Build the submit payload.
        const headers = toSubmit.map(({ lines, externalId, ...h }) => h);
        const details = toSubmit.flatMap(inv => inv.lines.map(ln => ({
            INTERNAL_ID: inv.INTERNAL_ID, ...ln,
        })));

        // Internal POST to /api/excel/submit — same code path as the UI.
        const port = process.env.PORT || 3001;
        const secret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
        const token = jwt.sign({ userId }, secret, { expiresIn: '5m' });
        const submitRes = await fetch(`http://localhost:${port}/api/excel/submit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-User-ID': String(userId),
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ headers, details }),
        });
        const submitJson: any = await submitRes.json().catch(() => ({}));
        if (!submitRes.ok) throw new Error(`Submission failed: HTTP ${submitRes.status} ${submitJson?.message || ''}`);

        submittedCount = submitJson?.summary?.success || 0;
        failedCount    = submitJson?.summary?.failed || 0;
        const perInvoiceResults: any[] = Array.isArray(submitJson?.summary?.results) ? submitJson.summary.results : [];

        // Update the dedup index per-invoice. We zip the submit results with
        // our `toSubmit` array using internalId as the join key (excel/submit
        // doesn't echo externalId).
        const byInternalId = new Map<string, ErpInvoice>();
        for (const i of toSubmit) byInternalId.set(i.INTERNAL_ID, i);

        const indexedFailures: Array<{ externalId: string; internalId: string; error: string }> = [];
        for (const r of perInvoiceResults) {
            const inv = byInternalId.get(String(r.internalId));
            if (!inv) continue;
            const status = r.status === 'Success' ? 'submitted' : 'failed';
            const errMsg = r.status === 'Success' ? null : (r.error || 'Unknown error');
            const etaUuid = r.uuid || null;
            await pool.query(
                `INSERT INTO "otaxdb".erp_invoice_index
                    (organization_id, external_id, internal_id, status, run_id, eta_uuid, error_message, first_seen_at, last_seen_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                  ON CONFLICT (organization_id, external_id) DO UPDATE
                  SET status = EXCLUDED.status,
                      run_id = EXCLUDED.run_id,
                      eta_uuid = COALESCE(EXCLUDED.eta_uuid, "otaxdb".erp_invoice_index.eta_uuid),
                      error_message = EXCLUDED.error_message,
                      last_seen_at = NOW(),
                      internal_id = COALESCE(EXCLUDED.internal_id, "otaxdb".erp_invoice_index.internal_id)`,
                [orgId, inv.externalId, inv.INTERNAL_ID, status, runId, etaUuid, errMsg]
            ).catch(e => console.warn('[ErpImporter] index upsert failed:', e.message));
            if (status === 'failed') indexedFailures.push({ externalId: inv.externalId, internalId: inv.INTERNAL_ID, error: errMsg || '' });
        }

        const status: 'success' | 'partial' | 'failed' =
            failedCount === 0 ? 'success' :
            submittedCount > 0 ? 'partial' : 'failed';

        // Only advance the since-pointer when we got an end-to-end clean
        // run (success). Partial / failed → don't move forward, so the next
        // run sees the same window and retries.
        if (status === 'success') {
            advanceSyncPointerTo = effectiveUntil;
        }

        summary = {
            provider, fetchedCount, submittedCount, failedCount, skippedCount,
            triggeredBy,
            sinceUsed: effectiveSince?.toISOString() || null,
            untilUsed: effectiveUntil.toISOString(),
            failureSamples: indexedFailures.slice(0, 10),
        };

        await markRun(pool, runId, status, summary);
        if (advanceSyncPointerTo) await advancePointer(pool, orgId, advanceSyncPointerTo);
        return { runId, status, fetchedCount, submittedCount, failedCount, skippedCount };
    } catch (e: any) {
        errorMessage = e.message || String(e);
        await markRun(pool, runId, 'failed',
            { provider, fetchedCount, submittedCount, failedCount, skippedCount, error: errorMessage });
        return { runId, status: 'failed', fetchedCount, submittedCount, failedCount, skippedCount, errorMessage };
    }
}

async function markRun(
    pool: pg.Pool, runId: number,
    status: 'success' | 'partial' | 'failed' | 'busy',
    summary: any
): Promise<void> {
    await pool.query(
        `UPDATE "otaxdb".erp_runs
            SET finished_at = NOW(),
                status = $1,
                provider = COALESCE($2, provider),
                fetched_count = $3,
                submitted_count = $4,
                failed_count = $5,
                skipped_count = $6,
                error_message = $7,
                summary = $8::jsonb
          WHERE id = $9`,
        [
            status,
            summary.provider || null,
            Number(summary.fetchedCount || 0),
            Number(summary.submittedCount || 0),
            Number(summary.failedCount || 0),
            Number(summary.skippedCount || 0),
            summary.error || null,
            JSON.stringify(summary),
            runId,
        ]
    ).catch(e => console.warn('[ErpImporter] markRun:', e.message));
}

async function advancePointer(pool: pg.Pool, orgId: number, until: Date): Promise<void> {
    await pool.query(
        `UPDATE "otaxdb".org_integration_settings
            SET erp_last_synced_at = $1, updated_at = NOW()
          WHERE organization_id = $2`,
        [until, orgId]
    ).catch(e => console.warn('[ErpImporter] advancePointer:', e.message));
}

// ─── Listings ────────────────────────────────────────────────────────────

export async function listRecentRuns(pool: pg.Pool, orgId: number, limit = 50) {
    await ensureSchema(pool);
    const r = await pool.query(
        `SELECT id, started_at, finished_at, status, provider, fetched_count, submitted_count,
                failed_count, skipped_count, triggered_by, error_message
           FROM "otaxdb".erp_runs
          WHERE organization_id = $1
          ORDER BY started_at DESC
          LIMIT ${Math.max(1, Math.min(limit, 200))}`,
        [orgId]
    );
    return r.rows;
}

/** All invoices touched by one run, with their final status + error. */
export async function getRunDetail(pool: pg.Pool, orgId: number, runId: number) {
    await ensureSchema(pool);
    const r = await pool.query(
        `SELECT external_id, internal_id, status, eta_uuid, error_message, first_seen_at, last_seen_at
           FROM "otaxdb".erp_invoice_index
          WHERE organization_id = $1 AND run_id = $2
          ORDER BY status DESC, internal_id ASC`,
        [orgId, runId]
    );
    return r.rows;
}
