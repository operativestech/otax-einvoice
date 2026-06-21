import express from 'express';
import multer from 'multer';
import prisma from '../prisma';
import {
    authenticate,
    authorize,
    requireOrgAdmin,
    getScopedOrgId,
    logActivity,
    blockDemo,
} from '../middleware/auth';
import { signWithPFX, validatePFX } from '../services/pfxSigner';
import { bulkLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

// Helper: resolve org ID with fallback for legacy users
async function resolveOrgId(req: express.Request): Promise<number | null> {
    const orgId = getScopedOrgId(req) || (req as any).user?.organizationId || null;
    if (orgId) return orgId;
    try {
        const org = await prisma.organizations.findFirst({ where: { is_active: true }, orderBy: { id: 'asc' } });
        return org?.id || null;
    } catch { return null; }
}

// Multer for PFX file upload (max 50KB — PFX files are small)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.originalname.endsWith('.pfx') || file.originalname.endsWith('.p12')) {
            cb(null, true);
        } else {
            cb(new Error('Only .pfx and .p12 files are allowed'));
        }
    },
});

// ============================================
// GET /api/signing/method
// Get current signing method for organization
// ============================================
router.get('/method', authenticate, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const settings = await prisma.organization_settings.findUnique({
            where: { organization_id: orgId },
            select: {
                signing_method: true,
                certificate_subject: true,
                certificate_issuer: true,
                certificate_thumbprint: true,
                certificate_expires_at: true,
                certificate_uploaded_at: true,
                agent_company_id: true,
                agent_node_id: true,
                agent_last_seen: true,
            },
        });

        if (!settings) {
            return res.json({
                success: true,
                method: 'agent',
                pfx: { uploaded: false },
                agent: { configured: false, online: false },
            });
        }

        // Check agent online status via the activeAgents map (accessed via app)
        const activeAgents: Map<string, any> = req.app.get('activeAgents') || new Map();
        const agentCompanyId = settings.agent_company_id || String(orgId);
        const agentOnline = activeAgents.has(agentCompanyId);

        res.json({
            success: true,
            method: settings.signing_method || 'agent',
            pfx: {
                uploaded: !!settings.certificate_thumbprint,
                subject: settings.certificate_subject,
                issuer: settings.certificate_issuer,
                thumbprint: settings.certificate_thumbprint,
                expiresAt: settings.certificate_expires_at,
                uploadedAt: settings.certificate_uploaded_at,
            },
            agent: {
                configured: !!settings.agent_company_id,
                companyId: agentCompanyId,
                nodeId: settings.agent_node_id,
                lastSeen: settings.agent_last_seen,
                online: agentOnline,
            },
        });
    } catch (error: any) {
        console.error('[Signing] Get method error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// PUT /api/signing/method
// Set signing method ("pfx" or "agent")
// ============================================
router.put('/method', authenticate, blockDemo, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const { method } = req.body;
        if (!method || !['pfx', 'agent'].includes(method)) {
            return res.status(400).json({ success: false, message: 'Method must be "pfx" or "agent"' });
        }

        await prisma.organization_settings.update({
            where: { organization_id: orgId },
            data: { signing_method: method, updated_at: new Date() },
        });

        await logActivity(req.user!.id, req.user!.username, 'signing_method_changed', 'admin', 'organization_settings', orgId.toString(), { method }, req);

        console.log(`[Signing] Org ${orgId} switched to method: ${method}`);
        res.json({ success: true, message: `Signing method set to ${method}` });
    } catch (error: any) {
        console.error('[Signing] Set method error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// POST /api/signing/upload-pfx
// Upload PFX certificate file
// ============================================
router.post('/upload-pfx', authenticate, blockDemo, upload.single('pfxFile'), async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const file = req.file;
        const password = req.body.password;

        if (!file) return res.status(400).json({ success: false, message: 'No PFX file uploaded' });
        if (!password) return res.status(400).json({ success: false, message: 'Certificate password is required' });

        console.log(`[Signing] Org ${orgId}: Validating PFX upload (${file.size} bytes)...`);

        // Validate PFX
        const validation = await validatePFX(file.buffer, password);

        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: `Invalid certificate: ${validation.error}`,
            });
        }

        // Check expiry
        if (validation.expiresAt && validation.expiresAt < new Date()) {
            return res.status(400).json({
                success: false,
                message: `Certificate expired on ${validation.expiresAt.toLocaleDateString()}. Please upload a valid certificate.`,
            });
        }

        // Save to database
        await prisma.organization_settings.update({
            where: { organization_id: orgId },
            data: {
                signing_method: 'pfx',
                certificate_pfx: file.buffer,
                certificate_password: password,
                certificate_issuer: validation.issuer || null,
                certificate_subject: validation.subject || null,
                certificate_thumbprint: validation.thumbprint || null,
                certificate_expires_at: validation.expiresAt || null,
                certificate_uploaded_at: new Date(),
                updated_at: new Date(),
            },
        });

        await logActivity(req.user!.id, req.user!.username, 'pfx_certificate_uploaded', 'admin', 'organization_settings', orgId.toString(), {
            subject: validation.subject,
            issuer: validation.issuer,
            expiresAt: validation.expiresAt,
        }, req);

        console.log(`[Signing] Org ${orgId}: PFX uploaded successfully - ${validation.subject}`);

        res.json({
            success: true,
            message: 'Certificate uploaded successfully',
            certificate: {
                subject: validation.subject,
                issuer: validation.issuer,
                thumbprint: validation.thumbprint,
                expiresAt: validation.expiresAt,
            },
        });
    } catch (error: any) {
        console.error('[Signing] Upload PFX error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// DELETE /api/signing/pfx
// Remove uploaded PFX certificate
// ============================================
router.delete('/pfx', authenticate, blockDemo, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        await prisma.organization_settings.update({
            where: { organization_id: orgId },
            data: {
                certificate_pfx: null,
                certificate_password: null,
                certificate_issuer: null,
                certificate_subject: null,
                certificate_thumbprint: null,
                certificate_expires_at: null,
                certificate_uploaded_at: null,
                signing_method: 'agent',
                updated_at: new Date(),
            },
        });

        await logActivity(req.user!.id, req.user!.username, 'pfx_certificate_removed', 'admin', 'organization_settings', orgId.toString(), {}, req);

        res.json({ success: true, message: 'Certificate removed. Switched to Agent signing method.' });
    } catch (error: any) {
        console.error('[Signing] Delete PFX error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// POST /api/signing/test
// Test signing with current method
// ============================================
router.post('/test', authenticate, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const settings = await prisma.organization_settings.findUnique({
            where: { organization_id: orgId },
        });

        if (!settings) {
            return res.status(400).json({ success: false, message: 'No settings configured' });
        }

        const method = settings.signing_method || 'agent';

        if (method === 'pfx') {
            // Test PFX signing
            if (!settings.certificate_pfx || !settings.certificate_password) {
                return res.status(400).json({
                    success: false,
                    message: 'No PFX certificate uploaded. Please upload a certificate first.',
                });
            }

            const validation = await validatePFX(
                Buffer.from(settings.certificate_pfx),
                settings.certificate_password
            );

            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    message: `Certificate validation failed: ${validation.error}`,
                });
            }

            res.json({
                success: true,
                method: 'pfx',
                message: `✅ PFX certificate is valid. Subject: ${validation.subject}, Expires: ${validation.expiresAt?.toLocaleDateString()}`,
                certificate: {
                    subject: validation.subject,
                    issuer: validation.issuer,
                    thumbprint: validation.thumbprint,
                    expiresAt: validation.expiresAt,
                },
            });

        } else {
            // Test Agent connection
            const activeAgents: Map<string, any> = req.app.get('activeAgents') || new Map();
            const agentCompanyId = settings.agent_company_id || String(orgId);
            const agentOnline = activeAgents.has(agentCompanyId);

            if (agentOnline) {
                res.json({
                    success: true,
                    method: 'agent',
                    message: `✅ OTax Agent is online and connected for company: ${agentCompanyId}`,
                });
            } else {
                res.status(400).json({
                    success: false,
                    method: 'agent',
                    message: '❌ OTax Agent is NOT connected. Please make sure the agent is running on the Master PC.',
                    hint: 'Download and run the OTax Agent on the PC with the USB token.',
                });
            }
        }
    } catch (error: any) {
        console.error('[Signing] Test error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// PUT /api/signing/agent-config
// Configure agent settings
// ============================================
router.put('/agent-config', authenticate, blockDemo, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const { agent_company_id } = req.body;

        await prisma.organization_settings.update({
            where: { organization_id: orgId },
            data: {
                signing_method: 'agent',
                agent_company_id: agent_company_id || String(orgId),
                updated_at: new Date(),
            },
        });

        res.json({
            success: true,
            message: 'Agent configuration saved',
            agent_company_id: agent_company_id || String(orgId),
        });
    } catch (error: any) {
        console.error('[Signing] Agent config error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// PUT /api/signing/eta-credentials
// Save ETA API credentials to organization_settings
// ============================================
router.put('/eta-credentials', authenticate, blockDemo, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const {
            environment,         // 'PreProd' | 'Prod'
            preprod_client_id,
            preprod_client_secret,
            prod_client_id,
            prod_client_secret,
        } = req.body;

        if (!environment || !['PreProd', 'Prod'].includes(environment)) {
            return res.status(400).json({ success: false, message: 'environment must be "PreProd" or "Prod"' });
        }

        // Build update data — only update fields that were actually sent
        const updateData: any = {
            eta_environment: environment,
            updated_at: new Date(),
        };
        if (preprod_client_id !== undefined) updateData.eta_preprod_client_id = preprod_client_id || null;
        if (preprod_client_secret !== undefined) updateData.eta_preprod_client_secret = preprod_client_secret || null;
        if (prod_client_id !== undefined) updateData.eta_prod_client_id = prod_client_id || null;
        if (prod_client_secret !== undefined) updateData.eta_prod_client_secret = prod_client_secret || null;

        await prisma.organization_settings.update({
            where: { organization_id: orgId },
            data: updateData,
        });

        await logActivity(
            req.user!.id, req.user!.username,
            'eta_credentials_updated', 'admin', 'organization_settings',
            orgId.toString(), { environment }, req
        );

        console.log(`[Signing] Org ${orgId}: ETA credentials updated for environment: ${environment}`);
        res.json({ success: true, message: `ETA credentials saved for ${environment} environment` });
    } catch (error: any) {
        console.error('[Signing] ETA credentials error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});



// ============================================
// GET /api/signing/agent-status
// Check if agent is online (any user can check)
// ============================================
router.get('/agent-status', authenticate, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const settings = await prisma.organization_settings.findUnique({
            where: { organization_id: orgId },
            select: { agent_company_id: true, agent_node_id: true, agent_last_seen: true, signing_method: true },
        });

        const activeAgents: Map<string, any> = req.app.get('activeAgents') || new Map();
        const agentCompanyId = settings?.agent_company_id || String(orgId);
        const online = activeAgents.has(agentCompanyId);

        res.json({
            success: true,
            method: settings?.signing_method || 'agent',
            online,
            companyId: agentCompanyId,
            nodeId: settings?.agent_node_id,
            lastSeen: settings?.agent_last_seen,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════
// Signing Queue (Phase 3.1)
// ── A job log that records pending/failed sign attempts per org. Existing
//    direct-sign code paths (server.ts) remain unchanged; this queue is for
//    intentionally-deferred or retry-driven signing.
// ════════════════════════════════════════════════════════════════════

/**
 * POST /api/signing/queue
 * Body: { documents: [{ internalId?, document }] } OR { document, internalId? }
 * Enqueue one or many unsigned documents for later signing.
 */
router.post('/queue', authenticate, blockDemo, authorize('signing.manage'), bulkLimiter, async (req, res) => {
    try {
        const pool = req.app.get('pool');
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const user = (req as any).user;
        const items: Array<{ internalId?: string; document: any }> = [];
        if (Array.isArray(req.body?.documents)) {
            for (const d of req.body.documents) {
                if (d?.document) items.push({ internalId: d.internalId, document: d.document });
            }
        } else if (req.body?.document) {
            items.push({ internalId: req.body.internalId, document: req.body.document });
        }
        if (items.length === 0) return res.status(400).json({ success: false, message: 'Provide document or documents[]' });

        const ids: number[] = [];
        for (const it of items) {
            const r = await pool.query(
                `INSERT INTO "otaxdb".signing_queue (org_id, internal_id, document_body, method, status, enqueued_by)
                 VALUES ($1, $2, $3, $4, 'QUEUED', $5) RETURNING id`,
                [orgId, it.internalId || (it.document?.internalID ?? null), it.document, req.body?.method || 'auto', user?.id || null]
            );
            ids.push(r.rows[0].id);
        }
        logActivity(user.id, user.username || 'user', 'queue_enqueue', 'signing', 'signing_queue', ids.join(','), { count: ids.length }, req).catch(() => {});
        res.json({ success: true, enqueued: ids.length, ids });
    } catch (err: any) {
        console.error('[Signing Queue] Enqueue error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/signing/queue
 * Query: status (QUEUED|PROCESSING|SIGNED|FAILED), pageNo, pageSize
 */
router.get('/queue', authenticate, authorize('signing.view'), async (req, res) => {
    try {
        const pool = req.app.get('pool');
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const status = (req.query.status as string || '').toUpperCase();
        const pageNo = parseInt(req.query.pageNo as string) || 1;
        const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 500);
        const where: string[] = ['org_id = $1'];
        const params: any[] = [orgId];
        if (['QUEUED', 'PROCESSING', 'SIGNED', 'FAILED'].includes(status)) {
            params.push(status);
            where.push(`status = $${params.length}`);
        }

        const rows = await pool.query(
            `SELECT id, internal_id, method, status, attempts, last_error,
                    enqueued_at, started_at, finished_at, document_uuid, submission_id
             FROM "otaxdb".signing_queue
             WHERE ${where.join(' AND ')}
             ORDER BY enqueued_at DESC
             LIMIT ${pageSize} OFFSET ${(pageNo - 1) * pageSize}`,
            params
        );
        const count = await pool.query(
            `SELECT COUNT(*)::int AS total FROM "otaxdb".signing_queue WHERE ${where.join(' AND ')}`,
            params
        );
        res.json({ success: true, items: rows.rows, pageNo, pageSize, total: count.rows[0]?.total || 0 });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/signing/queue/stats
 * Returns per-org counts by status, used by the TopBar indicator widget.
 *
 * Soft-fails to zero counts (HTTP 200) on any error — the Dashboard polls this
 * every 30s and the widget is informational, so a missing schema row or a
 * transient DB hiccup shouldn't break the dashboard or spam 500s in the
 * console. Real error is logged server-side for debugging.
 */
router.get('/queue/stats', authenticate, authorize('signing.view'), async (req, res) => {
    const empty = { success: true, queued: 0, processing: 0, failed: 0, signed: 0 };
    try {
        const pool = req.app.get('pool');
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.json(empty);

        const r = await pool.query(
            `SELECT status, COUNT(*)::int AS c
             FROM "otaxdb".signing_queue
             WHERE org_id = $1
             GROUP BY status`,
            [orgId]
        );
        const counts = { queued: 0, processing: 0, failed: 0, signed: 0 } as Record<string, number>;
        for (const row of r.rows) {
            counts[String(row.status).toLowerCase()] = row.c;
        }
        res.json({ success: true, ...counts });
    } catch (err: any) {
        console.warn('[SigningQueue] stats query failed, returning zeros:', err.message);
        res.json(empty);
    }
});

/**
 * POST /api/signing/queue/:id/retry
 * Re-queue a FAILED job (resets status to QUEUED, keeps the document body).
 */
router.post('/queue/:id/retry', authenticate, blockDemo, authorize('signing.manage'), async (req, res) => {
    try {
        const pool = req.app.get('pool');
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const r = await pool.query(
            `UPDATE "otaxdb".signing_queue
             SET status = 'QUEUED', last_error = NULL, started_at = NULL, finished_at = NULL
             WHERE id = $1 AND org_id = $2 AND status = 'FAILED'
             RETURNING id`,
            [req.params.id, orgId]
        );
        if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'Job not found or not in FAILED state' });
        const user = (req as any).user;
        if (user?.id) logActivity(user.id, user.username || 'user', 'queue_retry', 'signing', 'signing_queue', req.params.id, null, req).catch(() => {});
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * DELETE /api/signing/queue/:id
 * Removes a job (any status) from the queue.
 */
router.delete('/queue/:id', authenticate, blockDemo, authorize('signing.manage'), async (req, res) => {
    try {
        const pool = req.app.get('pool');
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const r = await pool.query(
            `DELETE FROM "otaxdb".signing_queue WHERE id = $1 AND org_id = $2`,
            [req.params.id, orgId]
        );
        if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'Job not found' });
        const user = (req as any).user;
        if (user?.id) logActivity(user.id, user.username || 'user', 'queue_delete', 'signing', 'signing_queue', req.params.id, null, req).catch(() => {});
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
