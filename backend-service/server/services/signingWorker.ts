/**
 * signingWorker — Phase 3.1.5 background processor for the signing queue.
 *
 * What it does each tick (every WORKER_INTERVAL_MS):
 *   1. Pick ONE job in status = 'QUEUED' (FOR UPDATE SKIP LOCKED so concurrent workers don't clash)
 *   2. Mark it PROCESSING
 *   3. Load org settings to pick signing method
 *   4. Sign + submit to ETA (PFX path only for now; Agent-Bridge jobs are left QUEUED
 *      until a future pass, because they need an active WebSocket in the current process)
 *   5. On success → SIGNED with document_uuid + submission_id
 *   6. On failure → FAILED if attempts >= MAX_ATTEMPTS, else back to QUEUED with last_error set
 *
 * Design notes:
 *   - One job per tick keeps the worker simple and predictable. Burst processing can be added
 *     later by looping internally, but Phase 3.1 prioritized observability over throughput.
 *   - The worker is best-effort: any thrown exception is logged and swallowed so the server
 *     keeps running.
 */

import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { signWithPFX } from './pfxSigner.js';
import { createETAServiceFromSettings } from './etaService.js';

const WORKER_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 3;

// One shared PrismaClient across ticks. Creating a new one every tick leaks
// connection-pool handles and quickly exhausts the DB's max_connections.
const prismaShared = new PrismaClient();

/** Minimum surface the worker needs from the running bridge service. */
export interface BridgeLike {
    signDocument(companyId: string, data: { document: any; pin?: string; certificateIssuer?: string }): Promise<any>;
}

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;
let bridge: BridgeLike | null = null;

export function startSigningWorker(pool: pg.Pool, deps?: { bridge?: BridgeLike | null }): void {
    if (timer) return;
    bridge = deps?.bridge || null;
    console.log(`[SigningWorker] starting (interval: ${WORKER_INTERVAL_MS}ms, bridge: ${bridge ? 'yes' : 'no'})`);
    timer = setInterval(() => {
        if (running) return; // previous tick still in flight — skip
        running = true;
        tick(pool).catch(e => console.error('[SigningWorker] tick error:', e.message)).finally(() => {
            running = false;
        });
    }, WORKER_INTERVAL_MS);
}

export function stopSigningWorker(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
        console.log('[SigningWorker] stopped');
    }
}

// ──────────────────────────────────────────────────────────────

async function tick(pool: pg.Pool): Promise<void> {
    const prisma = prismaShared;
    const client = await pool.connect();
    let jobId: number | null = null;

    try {
        // Claim one job atomically
        await client.query('BEGIN');
        const claim = await client.query(
            `SELECT id, org_id, internal_id, document_body, method, attempts
             FROM "otaxdb".signing_queue
             WHERE status = 'QUEUED'
             ORDER BY enqueued_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED`
        );
        if (claim.rowCount === 0) {
            await client.query('COMMIT');
            return;
        }

        const job = claim.rows[0];
        jobId = Number(job.id);
        await client.query(
            `UPDATE "otaxdb".signing_queue
             SET status = 'PROCESSING', started_at = NOW(), attempts = attempts + 1
             WHERE id = $1`,
            [jobId]
        );
        await client.query('COMMIT');

        // ── Run the actual sign + submit outside the transaction so nothing is held open ──
        try {
            await processJob(pool, prisma, job);
            await pool.query(
                `UPDATE "otaxdb".signing_queue
                 SET status = 'SIGNED', finished_at = NOW(), last_error = NULL
                 WHERE id = $1`,
                [jobId]
            );
            console.log(`[SigningWorker] job ${jobId} (${job.internal_id}) signed ✅`);
        } catch (err: any) {
            const nextAttempts = Number(job.attempts) + 1;
            const final = nextAttempts >= MAX_ATTEMPTS;
            const msg = (err?.message || 'unknown error').slice(0, 2000);

            await pool.query(
                `UPDATE "otaxdb".signing_queue
                 SET status = $1, last_error = $2, finished_at = ${final ? 'NOW()' : 'NULL'}
                 WHERE id = $3`,
                [final ? 'FAILED' : 'QUEUED', msg, jobId]
            );
            console.warn(`[SigningWorker] job ${jobId} attempt ${nextAttempts}/${MAX_ATTEMPTS} ${final ? 'FAILED' : 'requeued'}: ${msg}`);
        }
    } catch (outer: any) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        console.error('[SigningWorker] claim/outer error:', outer.message);
    } finally {
        client.release();
        // prismaShared is process-lived; do NOT disconnect here.
    }
}

// ──────────────────────────────────────────────────────────────

async function processJob(pool: pg.Pool, prisma: PrismaClient, job: any): Promise<void> {
    const orgId: number = Number(job.org_id);
    const method: string = String(job.method || 'auto').toLowerCase();
    const document: any = typeof job.document_body === 'string' ? JSON.parse(job.document_body) : job.document_body;
    if (!document) throw new Error('Empty document_body on job');

    const settings = await prisma.organization_settings.findUnique({ where: { organization_id: orgId } });
    if (!settings) throw new Error('No organization_settings configured for this org');

    const signingMethod = method === 'auto'
        ? (settings.signing_method || 'agent').toLowerCase()
        : method;

    let signedDoc: any;
    if (signingMethod === 'pfx') {
        const pfx = (settings as any).certificate_pfx;
        const pwd = (settings as any).certificate_password;
        const issuer = (settings as any).certificate_issuer || 'MCDR CA 2022';
        if (!pfx || !pwd) throw new Error('PFX certificate or password is missing on org_settings');
        signedDoc = await signWithPFX(document, Buffer.from(pfx), pwd, issuer);
    } else if (signingMethod === 'agent') {
        if (!bridge) throw new Error('Agent-Bridge not available in this process');
        const companyId = (settings as any).agent_company_id || String(orgId);
        const issuer = (settings as any).certificate_issuer || 'MCDR CA 2022';
        const result = await bridge.signDocument(companyId, { document, certificateIssuer: issuer });
        // Bridge returns the signed document directly OR an object with `.document` wrapping it.
        signedDoc = result?.document || result?.signedDocument || result;
        if (!signedDoc) throw new Error('Agent returned empty response');
    } else {
        throw new Error(`Unknown signing_method "${signingMethod}"`);
    }

    // Submit the signed doc to ETA
    const eta = createETAServiceFromSettings(orgId, settings);
    if (!eta) throw new Error('ETA credentials are not configured for this organization');

    const submission = await eta.submitDocuments([signedDoc]);
    const submissionId = (submission as any)?.submissionId || null;
    const accepted = (submission as any)?.acceptedDocuments || [];
    const rejected = (submission as any)?.rejectedDocuments || [];

    if (rejected.length > 0 && accepted.length === 0) {
        const detail = JSON.stringify(rejected[0]?.error || rejected[0]).slice(0, 1500);
        throw new Error(`ETA rejected the document: ${detail}`);
    }
    const uuid = accepted[0]?.uuid || null;

    await pool.query(
        `UPDATE "otaxdb".signing_queue
         SET document_uuid = $1, submission_id = $2
         WHERE id = $3`,
        [uuid, submissionId, job.id]
    );
}
