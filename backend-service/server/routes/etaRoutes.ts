/**
 * ETA Routes — All 19 ETA API endpoints + Sync management
 *
 * Mounted at: /api/eta
 *
 * All routes are org-scoped: they read ETA credentials from organization_settings
 * and operate on the org's dedicated tables.
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { authenticate, authorize, blockDemo, logActivity } from '../middleware/auth.js';
import { etaLimiter, bulkLimiter } from '../middleware/rateLimit.js';
import { ETAService, createETAServiceFromSettings, InvoiceLine } from '../services/etaService.js';
import { getOrgTableNames, createOrgTables, migrateOrgTables, findOrgTablePrefix, upsertCustomerFromDoc } from '../services/orgTables.js';

const router = Router();
const prisma = new PrismaClient();

// ──────────────────────────────────────────────
// Helper: Get pool from app (passed via middleware)
// ──────────────────────────────────────────────

function getPool(req: Request): pg.Pool {
    return (req as any).app.get('pool');
}

// ──────────────────────────────────────────────
// Helper: Build an ETAService for the current user's org
// ──────────────────────────────────────────────

async function getETAServiceForUser(req: Request): Promise<{ service: ETAService; orgId: number; orgName: string }> {
    const user = (req as any).user;
    let userOrgId = user?.organizationId || null;

    // Auto-resolve org if not set
    if (!userOrgId) {
        const fallbackOrg = await prisma.organizations.findFirst({ where: { is_active: true }, orderBy: { id: 'asc' } });
        if (fallbackOrg) {
            userOrgId = fallbackOrg.id;
            console.log(`[ETA] Auto-resolved org ${userOrgId} for user ${user?.id}`);
        }
    }

    if (!userOrgId) {
        throw new Error('No organization found. Please create an organization first.');
    }

    const orgId = userOrgId;

    // Get org info
    const org = await prisma.organizations.findUnique({ where: { id: orgId } });
    if (!org) throw new Error('Organization not found');

    // Get org settings for ETA credentials
    let settings = await prisma.organization_settings.findUnique({
        where: { organization_id: orgId },
    });

    // ── Legacy fallback: build settings from clients_info_new ──
    if (!settings) {
        const pool = getPool(req);
        try {
            const propsResult = await pool.query(
                `SELECT property_name, property_value FROM "otaxdb".clients_info_new WHERE uid = $1`,
                [user.id]
            );
            const props: Record<string, string> = {};
            propsResult.rows.forEach((r: any) => { props[r.property_name] = r.property_value; });

            // Map legacy property names to org_settings fields
            const legacyData: any = {
                organization_id: orgId,
                eta_environment: props['signer_etaEnvironment'] || 'PreProd',
                eta_preprod_client_id: props['signer_preProdClientId'] || null,
                eta_preprod_client_secret: props['signer_preProdClientSecret'] || null,
                eta_prod_client_id: props['signer_prodClientId'] || null,
                eta_prod_client_secret: props['signer_prodClientSecret'] || null,
                eta_client_id: props['signer_clientId'] || props['signer_preProdClientId'] || null,
                eta_client_secret: props['signer_clientSecret'] || props['signer_preProdClientSecret'] || null,
                eta_tax_id: props['issuer_id'] || org.tax_id || null,
            };

            // Only create if we have at least some ETA credentials
            if (legacyData.eta_preprod_client_id || legacyData.eta_prod_client_id || legacyData.eta_client_id) {
                settings = await prisma.organization_settings.upsert({
                    where: { organization_id: orgId },
                    create: legacyData,
                    update: legacyData,
                });
                console.log(`[ETA] Migrated legacy ETA credentials to org_settings for org ${orgId}`);
            }
        } catch (legacyErr: any) {
            console.warn(`[ETA] Legacy credential fallback failed:`, legacyErr.message);
        }
    }

    if (!settings) {
        throw new Error('Organization settings not configured. Go to Settings → OTAX Connection to set up your ETA credentials.');
    }

    const service = createETAServiceFromSettings(orgId, settings);
    if (!service) {
        throw new Error('ETA credentials are not configured. Go to Settings → OTAX Connection.');
    }

    return { service, orgId, orgName: org.name };
}

// ──────────────────────────────────────────────
// Helper: Get org table names for current user
// ──────────────────────────────────────────────

async function getOrgTablesForUser(req: Request): Promise<{ documents: string; lines: string; item_codes: string; orgId: number }> {
    const user = (req as any).user;
    let userOrgId = user?.organizationId || null;

    // Auto-resolve org if not set
    if (!userOrgId) {
        const fallbackOrg = await prisma.organizations.findFirst({ where: { is_active: true }, orderBy: { id: 'asc' } });
        if (fallbackOrg) userOrgId = fallbackOrg.id;
    }

    if (!userOrgId) throw new Error('No organization found. Please create an organization first.');

    const org = await prisma.organizations.findUnique({ where: { id: userOrgId } });
    if (!org) throw new Error('Organization not found');

    const tables = getOrgTableNames(org.id, org.name);
    return { ...tables, orgId: org.id };
}

// ════════════════════════════════════════════════
// 0. LOCAL DB QUERIES (synced data)
// ════════════════════════════════════════════════

/**
 * GET /api/eta/local/documents
 * Query locally-synced documents from org_X__documents table
 * Query params: pageSize, pageNo
 */
router.get('/local/documents', authenticate, async (req: Request, res: Response) => {
    try {
        const { documents: docTable, orgId } = await getOrgTablesForUser(req);
        const pool = getPool(req);
        const pageSize = parseInt(req.query.pageSize as string) || 100;
        const pageNo = parseInt(req.query.pageNo as string) || 1;
        const offset = (pageNo - 1) * pageSize;

        // Check if table exists
        try {
            const tableCheck = await pool.query(
                `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'InvoicesDb' AND table_name = $1) as exists`,
                [docTable]
            );
            if (!tableCheck.rows[0]?.exists) {
                return res.json({ success: true, result: [], metadata: { totalCount: 0, totalPages: 0, currentPage: 1 } });
            }
        } catch (checkErr: any) {
            console.warn('[ETA Route] Table check failed:', checkErr.message);
            return res.json({ success: true, result: [], metadata: { totalCount: 0, totalPages: 0, currentPage: 1 } });
        }

        const countResult = await pool.query(`SELECT COUNT(*) as total FROM "InvoicesDb"."${docTable}"`);
        const totalCount = parseInt(countResult.rows[0]?.total || '0');

        const result = await pool.query(
            `SELECT * FROM "InvoicesDb"."${docTable}" ORDER BY "dateTimeReceived" DESC NULLS LAST LIMIT $1 OFFSET $2`,
            [pageSize, offset]
        );

        res.json({
            success: true,
            result: result.rows,
            metadata: {
                totalCount,
                totalPages: Math.ceil(totalCount / pageSize),
                currentPage: pageNo,
            },
        });
    } catch (err: any) {
        console.error('[ETA Route] Local documents query error:', err.message);
        // Return empty result gracefully instead of 500
        res.json({ success: true, result: [], metadata: { totalCount: 0, totalPages: 0, currentPage: 1 }, error: err.message });
    }
});

// ════════════════════════════════════════════════
// 1. DOCUMENT SEARCH & FETCH
// ════════════════════════════════════════════════

/**
 * GET /api/eta/documents/search
 * Search ETA documents (delegates to ETA API)
 * Query params: dateFrom, dateTo, direction, status, pageNo, pageSize
 */
router.get('/documents/search', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const result = await service.searchDocuments({
            dateFrom: req.query.dateFrom as string,
            dateTo: req.query.dateTo as string,
            direction: req.query.direction as any,
            status: req.query.status as string,
            documentType: req.query.documentType as string,
            receiverId: req.query.receiverId as string,
            issuerId: req.query.issuerId as string,
            internalId: req.query.internalId as string,
            pageNo: parseInt(req.query.pageNo as string) || 1,
            pageSize: parseInt(req.query.pageSize as string) || 100,
        });
        res.json({ success: true, ...result });
    } catch (err: any) {
        console.error('[ETA Route] Search documents error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/eta/documents/:uuid
 * Get raw document from ETA
 */
router.get('/documents/:uuid', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const result = await service.getDocument(req.params.uuid);
        res.json({ success: true, document: result });
    } catch (err: any) {
        console.error('[ETA Route] Get document error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/eta/documents/:uuid/details
 * Get document details with validation results + invoice lines
 */
router.get('/documents/:uuid/details', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const result = await service.getDocumentDetails(req.params.uuid);
        res.json({ success: true, document: result });
    } catch (err: any) {
        console.error('[ETA Route] Get document details error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/eta/documents/:uuid/pdf
 * Download document PDF printout
 */
router.get('/documents/:uuid/pdf', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const pdfBuffer = await service.getDocumentPrintout(req.params.uuid);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=invoice_${req.params.uuid}.pdf`);
        res.send(pdfBuffer);
    } catch (err: any) {
        console.error('[ETA Route] Get PDF error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ════════════════════════════════════════════════
// 2. DOCUMENT ACTIONS
// ════════════════════════════════════════════════

/**
 * PUT /api/eta/documents/:uuid/cancel
 * Cancel an issued document on ETA portal
 */
router.put('/documents/:uuid/cancel', authenticate, async (req: Request, res: Response) => {
    try {
        const { uuid } = req.params;
        const { reason } = req.body;
        const { service, orgId } = await getETAServiceForUser(req);

        console.log(`[ETA Route] Cancel document ${uuid} for org ${orgId}, reason: ${reason || 'N/A'}`);

        const result = await service.cancelDocument(uuid, reason || 'Cancelled by user');

        // Update local DB status
        try {
            const pool = getPool(req);
            const { documents: docTable } = await getOrgTablesForUser(req);
            await pool.query(
                `UPDATE "${docTable}" SET status = 'Cancelled' WHERE uuid = $1`,
                [uuid]
            );
        } catch (dbErr: any) {
            console.warn(`[ETA Route] Failed to update local status for ${uuid}:`, dbErr.message);
        }

        res.json({ success: true, message: 'Document cancelled successfully', data: result });
    } catch (err: any) {
        console.error('[ETA Route] Cancel document error:', err.response?.data || err.message);
        const details = err.response?.data || null;
        res.status(err.response?.status || 500).json({
            success: false,
            message: err.message,
            details,
        });
    }
});

/**
 * PUT /api/eta/documents/:uuid/reject
 * Reject a received document on ETA portal
 */
router.put('/documents/:uuid/reject', authenticate, async (req: Request, res: Response) => {
    try {
        const { uuid } = req.params;
        const { reason } = req.body;
        const { service, orgId } = await getETAServiceForUser(req);

        console.log(`[ETA Route] Reject document ${uuid} for org ${orgId}, reason: ${reason || 'N/A'}`);

        const result = await service.rejectDocument(uuid, reason || 'Rejected by receiver');

        // Update local DB status
        try {
            const pool = getPool(req);
            const { documents: docTable } = await getOrgTablesForUser(req);
            await pool.query(
                `UPDATE "${docTable}" SET status = 'Rejected' WHERE uuid = $1`,
                [uuid]
            );
        } catch (dbErr: any) {
            console.warn(`[ETA Route] Failed to update local status for ${uuid}:`, dbErr.message);
        }

        res.json({ success: true, message: 'Document rejected successfully', data: result });
    } catch (err: any) {
        console.error('[ETA Route] Reject document error:', err.response?.data || err.message);
        const details = err.response?.data || null;
        res.status(err.response?.status || 500).json({
            success: false,
            message: err.message,
            details,
        });
    }
});

/**
 * PUT /api/eta/documents/:uuid/decline-rejection
 * Decline a rejection request (issuer declines receiver's rejection)
 */
router.put('/documents/:uuid/decline-rejection', authenticate, async (req: Request, res: Response) => {
    try {
        const { uuid } = req.params;
        const { service, orgId } = await getETAServiceForUser(req);

        console.log(`[ETA Route] Decline rejection for document ${uuid}, org ${orgId}`);

        const result = await service.declineRejection(uuid);

        // Update local DB status
        try {
            const pool = getPool(req);
            const { documents: docTable } = await getOrgTablesForUser(req);
            await pool.query(
                `UPDATE "${docTable}" SET status = 'DeclinedReject' WHERE uuid = $1`,
                [uuid]
            );
        } catch (dbErr: any) {
            console.warn(`[ETA Route] Failed to update local status for ${uuid}:`, dbErr.message);
        }

        res.json({ success: true, message: 'Rejection declined successfully', data: result });
    } catch (err: any) {
        console.error('[ETA Route] Decline rejection error:', err.response?.data || err.message);
        const details = err.response?.data || null;
        res.status(err.response?.status || 500).json({
            success: false,
            message: err.message,
            details,
        });
    }
});

/**
 * PUT /api/eta/documents/:uuid/decline-cancellation
 * Decline a cancellation request (receiver declines issuer's cancellation)
 */
router.put('/documents/:uuid/decline-cancellation', authenticate, async (req: Request, res: Response) => {
    try {
        const { uuid } = req.params;
        const { service, orgId } = await getETAServiceForUser(req);

        console.log(`[ETA Route] Decline cancellation for document ${uuid}, org ${orgId}`);

        const result = await service.declineCancellation(uuid);

        // Update local DB status
        try {
            const pool = getPool(req);
            const { documents: docTable } = await getOrgTablesForUser(req);
            await pool.query(
                `UPDATE "${docTable}" SET status = 'DeclinedCancel' WHERE uuid = $1`,
                [uuid]
            );
        } catch (dbErr: any) {
            console.warn(`[ETA Route] Failed to update local status for ${uuid}:`, dbErr.message);
        }

        res.json({ success: true, message: 'Cancellation declined successfully', data: result });
    } catch (err: any) {
        console.error('[ETA Route] Decline cancellation error:', err.response?.data || err.message);
        const details = err.response?.data || null;
        res.status(err.response?.status || 500).json({
            success: false,
            message: err.message,
            details,
        });
    }
});

/**
 * POST /api/eta/documents/submit
 * Submit signed documents to ETA.
 * Format precedence:
 *   1. body.format if provided ('JSON' | 'XML')
 *   2. organization_settings.eta_submit_format
 *   3. default 'JSON'
 */
router.post('/documents/submit', authenticate, etaLimiter, async (req: Request, res: Response) => {
    try {
        const { service, orgId } = await getETAServiceForUser(req);
        const { documents, format: bodyFormat } = req.body;
        if (!documents || !Array.isArray(documents)) {
            return res.status(400).json({ success: false, message: 'documents array is required' });
        }

        let format: 'JSON' | 'XML' = 'JSON';
        if (bodyFormat === 'JSON' || bodyFormat === 'XML') {
            format = bodyFormat;
        } else {
            try {
                const settings = await prisma.organization_settings.findUnique({ where: { organization_id: orgId } });
                const s = (settings as any)?.eta_submit_format;
                if (s === 'XML') format = 'XML';
            } catch { /* fall back to JSON */ }
        }

        const result = format === 'XML'
            ? await service.submitDocumentsXml(documents)
            : await service.submitDocuments(documents);

        res.json({ success: true, format, ...result });
    } catch (err: any) {
        console.error('[ETA Route] Submit documents error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PUT /api/eta/documents/:uuid/cancel
 * Cancel an issued document
 */
router.put('/documents/:uuid/cancel', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ success: false, message: 'Cancellation reason is required' });

        const result = await service.cancelDocument(req.params.uuid, reason);

        // Update status in org table
        try {
            const pool = getPool(req);
            const { documents: tableName } = await getOrgTablesForUser(req);
            await pool.query(`UPDATE "InvoicesDb"."${tableName}" SET status = 'cancelled', "dateTimeCancelled" = NOW() WHERE uuid = $1`, [req.params.uuid]);
        } catch (dbErr: any) {
            console.warn('[ETA Route] Could not update local DB:', dbErr.message);
        }

        res.json({ success: true, ...result });
    } catch (err: any) {
        console.error('[ETA Route] Cancel document error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PUT /api/eta/documents/:uuid/reject
 * Reject a received document
 */
router.put('/documents/:uuid/reject', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ success: false, message: 'Rejection reason is required' });

        const result = await service.rejectDocument(req.params.uuid, reason);

        // Update status in org table
        try {
            const pool = getPool(req);
            const { documents: tableName } = await getOrgTablesForUser(req);
            await pool.query(`UPDATE "InvoicesDb"."${tableName}" SET status = 'rejected', "rejectionReasons" = $2 WHERE uuid = $1`, [req.params.uuid, reason]);
        } catch (dbErr: any) {
            console.warn('[ETA Route] Could not update local DB:', dbErr.message);
        }

        res.json({ success: true, ...result });
    } catch (err: any) {
        console.error('[ETA Route] Reject document error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PUT /api/eta/documents/:uuid/decline-rejection
 * Decline a receiver's rejection (issuer action)
 */
router.put('/documents/:uuid/decline-rejection', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const result = await service.declineRejection(req.params.uuid);
        res.json({ success: true, ...result });
    } catch (err: any) {
        console.error('[ETA Route] Decline rejection error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PUT /api/eta/documents/:uuid/decline-cancellation
 * Decline issuer's cancellation (receiver action)
 */
router.put('/documents/:uuid/decline-cancellation', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const result = await service.declineCancellation(req.params.uuid);

        // Update status back to valid in org table
        try {
            const pool = getPool(req);
            const { documents: tableName } = await getOrgTablesForUser(req);
            await pool.query(`UPDATE "InvoicesDb"."${tableName}" SET status = 'valid', "dateTimeCancelled" = NULL WHERE uuid = $1`, [req.params.uuid]);
        } catch (dbErr: any) {
            console.warn('[ETA Route] Could not update local DB:', dbErr.message);
        }

        res.json({ success: true, ...result });
    } catch (err: any) {
        console.error('[ETA Route] Decline cancellation error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ════════════════════════════════════════════════
// 3. SUBMISSIONS
// ════════════════════════════════════════════════

/**
 * GET /api/eta/submissions/:uuid
 * Get submission batch status
 */
router.get('/submissions/:uuid', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const pageNo = parseInt(req.query.pageNo as string) || 1;
        const pageSize = parseInt(req.query.pageSize as string) || 100;
        const result = await service.getSubmission(req.params.uuid, pageNo, pageSize);
        res.json({ success: true, ...result });
    } catch (err: any) {
        console.error('[ETA Route] Get submission error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ════════════════════════════════════════════════
// 4. NOTIFICATIONS
// ════════════════════════════════════════════════

/**
 * GET /api/eta/notifications
 * Get ETA notifications (paginated, filterable)
 */
router.get('/notifications', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const result = await service.getNotifications({
            dateFrom: req.query.dateFrom as string,
            dateTo: req.query.dateTo as string,
            type: req.query.type as string,
            language: (req.query.language as 'ar' | 'en') || 'en',
            status: req.query.status as string,
            channel: req.query.channel as string,
            pageNo: parseInt(req.query.pageNo as string) || 1,
            pageSize: parseInt(req.query.pageSize as string) || 50,
        });
        res.json({ success: true, ...result });
    } catch (err: any) {
        console.error('[ETA Route] Get notifications error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ════════════════════════════════════════════════
// 5. BULK PACKAGES
// ════════════════════════════════════════════════

/**
 * POST /api/eta/packages/request
 * Request a document package (Summary|Full, JSON|XML) for bulk export.
 * Persists the request in otaxdb.package_requests and returns the ETA rid.
 */
router.post('/packages/request', authenticate, blockDemo, authorize('packages.manage'), etaLimiter, async (req: Request, res: Response) => {
    const pool = getPool(req);
    const user = (req as any).user;
    const {
        dateFrom,
        dateTo,
        type = 'Summary',
        format = 'JSON',
        truncateIfExceeded = false,
        statuses,
        documentTypeNames,
        receiverSenderId,
        receiverSenderType,
        branchNumber,
        productsInternalCodes,
        itemCodes,
    } = req.body;

    if (!dateFrom || !dateTo) {
        return res.status(400).json({ success: false, message: 'dateFrom and dateTo are required' });
    }

    let dbId: number | null = null;
    try {
        const { service, orgId } = await getETAServiceForUser(req);

        // Persist pending row first so we can track even if ETA call fails
        const insertRes = await pool.query(
            `INSERT INTO "otaxdb".package_requests
             (org_id, type, format, date_from, date_to, statuses, document_types, is_intermediary, created_by, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Pending')
             RETURNING id`,
            [
                orgId,
                type,
                format,
                dateFrom,
                dateTo,
                statuses || null,
                documentTypeNames || null,
                false,
                user?.id || null,
            ]
        );
        dbId = insertRes.rows[0].id;

        const etaResponse = await service.requestPackage({
            dateFrom, dateTo, type, format, truncateIfExceeded,
            statuses, documentTypeNames, receiverSenderId, receiverSenderType,
            branchNumber, productsInternalCodes, itemCodes,
        });
        const rid = etaResponse?.requestId || etaResponse?.rid || etaResponse;

        await pool.query(
            `UPDATE "otaxdb".package_requests SET rid = $1, status = 'Submitted' WHERE id = $2`,
            [rid, dbId]
        );

        if (user?.id) logActivity(user.id, user.username || 'user', 'package_request', 'packages', 'package_request', String(dbId), { rid, type, format, dateFrom, dateTo }, req).catch(() => {});
        res.json({ success: true, id: dbId, rid, etaResponse });
    } catch (err: any) {
        console.error('[ETA Route] Request package error:', err.message);
        // Rewrite ETA's 504 gateway timeout into a user-actionable message.
        const rawMsg: string = err.message || '';
        const isGatewayTimeout = /HTTP 504/.test(rawMsg) || /Gateway Time-?out/i.test(rawMsg) || /ETIMEDOUT|ECONNABORTED/i.test(rawMsg);
        const friendly = isGatewayTimeout
            ? 'ETA took too long to respond (504 Gateway Timeout). The date range is likely too wide for a single request — try splitting it into shorter periods (e.g. month-by-month) and retry.'
            : rawMsg;
        if (dbId) {
            await pool.query(
                `UPDATE "otaxdb".package_requests SET status = 'Failed', error_message = $1 WHERE id = $2`,
                [friendly.slice(0, 2000), dbId]
            ).catch(() => {});
        }
        res.status(isGatewayTimeout ? 504 : 500).json({ success: false, message: friendly, gatewayTimeout: isGatewayTimeout || undefined });
    }
});

/**
 * POST /api/eta/packages/intermediary
 * Same as /packages/request but on behalf of a represented taxpayer
 * (for accountants / tax intermediaries acting for clients).
 */
router.post('/packages/intermediary', authenticate, blockDemo, authorize('packages.manage'), etaLimiter, async (req: Request, res: Response) => {
    const pool = getPool(req);
    const user = (req as any).user;
    const {
        dateFrom, dateTo,
        type = 'Summary', format = 'JSON', truncateIfExceeded = false,
        statuses, documentTypeNames, receiverSenderId, receiverSenderType,
        branchNumber, productsInternalCodes, itemCodes,
        representedTaxpayerFilterType = '1',
        representeeRin,
    } = req.body;

    if (!dateFrom || !dateTo) {
        return res.status(400).json({ success: false, message: 'dateFrom and dateTo are required' });
    }

    let dbId: number | null = null;
    try {
        const { service, orgId } = await getETAServiceForUser(req);

        const insertRes = await pool.query(
            `INSERT INTO "otaxdb".package_requests
             (org_id, type, format, date_from, date_to, statuses, document_types, is_intermediary, representee_rin, created_by, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Pending')
             RETURNING id`,
            [
                orgId, type, format, dateFrom, dateTo,
                statuses || null, documentTypeNames || null,
                true, representeeRin || null, user?.id || null,
            ]
        );
        dbId = insertRes.rows[0].id;

        const etaResponse = await service.requestIntermediaryPackage({
            dateFrom, dateTo, type, format, truncateIfExceeded,
            statuses, documentTypeNames, receiverSenderId, receiverSenderType,
            branchNumber, productsInternalCodes, itemCodes,
            representedTaxpayerFilterType, representeeRin,
        });
        const rid = etaResponse?.requestId || etaResponse?.rid || etaResponse;

        await pool.query(
            `UPDATE "otaxdb".package_requests SET rid = $1, status = 'Submitted' WHERE id = $2`,
            [rid, dbId]
        );

        if (user?.id) logActivity(user.id, user.username || 'user', 'package_request_intermediary', 'packages', 'package_request', String(dbId), { rid, type, format, representeeRin }, req).catch(() => {});
        res.json({ success: true, id: dbId, rid, etaResponse });
    } catch (err: any) {
        console.error('[ETA Route] Intermediary package error:', err.message);
        const rawMsg: string = err.message || '';
        const isGatewayTimeout = /HTTP 504/.test(rawMsg) || /Gateway Time-?out/i.test(rawMsg) || /ETIMEDOUT|ECONNABORTED/i.test(rawMsg);
        const friendly = isGatewayTimeout
            ? 'ETA took too long to respond (504 Gateway Timeout). The date range is likely too wide for a single request — try splitting it into shorter periods (e.g. month-by-month) and retry.'
            : rawMsg;
        if (dbId) {
            await pool.query(
                `UPDATE "otaxdb".package_requests SET status = 'Failed', error_message = $1 WHERE id = $2`,
                [friendly.slice(0, 2000), dbId]
            ).catch(() => {});
        }
        res.status(isGatewayTimeout ? 504 : 500).json({ success: false, message: friendly, gatewayTimeout: isGatewayTimeout || undefined });
    }
});

/**
 * GET /api/eta/packages/history
 * Paginated list of this org's package requests (local DB, not ETA).
 */
router.get('/packages/history', authenticate, authorize('packages.view'), async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId } = await getETAServiceForUser(req);
        const pageNo = parseInt(req.query.pageNo as string) || 1;
        const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 100);
        const offset = (pageNo - 1) * pageSize;

        const [rows, count] = await Promise.all([
            pool.query(
                `SELECT id, rid, type, format, date_from, date_to, statuses, document_types,
                        is_intermediary, representee_rin, status, error_message, created_at, downloaded_at
                 FROM "otaxdb".package_requests
                 WHERE org_id = $1
                 ORDER BY created_at DESC
                 LIMIT $2 OFFSET $3`,
                [orgId, pageSize, offset]
            ),
            pool.query(
                `SELECT COUNT(*)::int AS total FROM "otaxdb".package_requests WHERE org_id = $1`,
                [orgId]
            ),
        ]);

        res.json({
            success: true,
            items: rows.rows,
            pageNo,
            pageSize,
            total: count.rows[0].total,
        });
    } catch (err: any) {
        console.error('[ETA Route] Package history error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/eta/packages/eta-list
 * Query ETA directly for this taxpayer's package-request list (paged).
 * Use /packages/history for the local-DB view.
 */
router.get('/packages/eta-list', authenticate, authorize('packages.view'), async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const result = await service.getPackageRequests({
            pageNo: parseInt(req.query.pageNo as string) || 1,
            pageSize: parseInt(req.query.pageSize as string) || 50,
        });
        res.json({ success: true, ...result });
    } catch (err: any) {
        console.error('[ETA Route] ETA package list error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/eta/packages/:id
 * Download a prepared document package by ETA rid.
 * Marks the local DB row as Downloaded on success.
 * If ETA hasn't finished building the ZIP yet, returns 202 Accepted
 * so the UI can show "still processing" instead of a hard failure.
 */
router.get('/packages/:id', authenticate, authorize('packages.view'), async (req: Request, res: Response) => {
    const pool = getPool(req);
    const rid = req.params.id;
    try {
        const { service, orgId } = await getETAServiceForUser(req);
        const packageBuffer = await service.getPackage(rid);

        // Best-effort mark downloaded (don't fail the download if UPDATE fails)
        await pool.query(
            `UPDATE "otaxdb".package_requests SET status = 'Downloaded', downloaded_at = NOW()
             WHERE org_id = $1 AND rid = $2`,
            [orgId, rid]
        ).catch(() => {});

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=package_${rid}.zip`);
        res.send(packageBuffer);
    } catch (err: any) {
        // ETA returns 400 + ValidationError body while the package is still being built.
        const msg = err?.message || '';
        const notReady = /HTTP 400/.test(msg) && /ValidationError|not.*(ready|available|completed)|still.*(processing|building)/i.test(msg);
        if (notReady) {
            return res.status(202).json({ success: false, status: 'Building', message: 'Package is still being prepared by ETA. Try again in a few minutes.' });
        }
        console.error('[ETA Route] Get package error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ════════════════════════════════════════════════
// 6. ITEM CODES (EGS / GS1)
// ════════════════════════════════════════════════

/**
 * POST /api/eta/codes
 * Create EGS code usage request
 */
router.post('/codes', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const { items } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'items array is required' });
        }
        const result = await service.createEGSCode(items);
        res.json({ success: true, ...result });
    } catch (err: any) {
        console.error('[ETA Route] Create EGS code error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/eta/codes/search
 * Search published codes (GS1 + EGS)
 * Query: codeType (EGS/GS1), codeLookupValue, pageNo, pageSize
 */
router.get('/codes/search', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const codeType = (req.query.codeType as string) || 'EGS';
        const result = await service.searchPublishedCodes(codeType, {
            codeLookupValue: req.query.codeLookupValue as string,
            pageNo: parseInt(req.query.pageNo as string) || 1,
            pageSize: parseInt(req.query.pageSize as string) || 50,
        });
        res.json({ success: true, ...result });
    } catch (err: any) {
        console.error('[ETA Route] Search codes error:', err.message);
        // Graceful: return empty result on ETA errors (429 rate limit, etc)
        res.json({ success: false, result: [], message: err.message });
    }
});

/**
 * GET /api/eta/codes/my-requests
 * List my EGS code usage requests
 */
router.get('/codes/my-requests', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const result = await service.searchMyCodeRequests({
            active: req.query.active === 'true' ? true : req.query.active === 'false' ? false : undefined,
            status: req.query.status as string,
            pageNo: parseInt(req.query.pageNo as string) || 1,
            pageSize: parseInt(req.query.pageSize as string) || 50,
        });
        res.json({ success: true, ...result });
    } catch (err: any) {
        console.error('[ETA Route] Search my code requests error:', err.message);
        // Graceful: return empty result on ETA errors (429 rate limit, etc)
        res.json({ success: true, result: [], message: err.message });
    }
});

/**
 * GET /api/eta/codes/:codeType/:itemCode
 * Get published code details
 */
router.get('/codes/:codeType/:itemCode', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const result = await service.getCodeDetails(req.params.codeType, req.params.itemCode);
        res.json({ success: true, ...result });
    } catch (err: any) {
        console.error('[ETA Route] Get code details error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PUT /api/eta/codes/:id
 * Update an EGS code request (only if status = Submitted)
 */
router.put('/codes/:id', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const result = await service.updateEGSCode(req.params.id, req.body);
        res.json({ success: true, ...result });
    } catch (err: any) {
        console.error('[ETA Route] Update EGS code error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ════════════════════════════════════════════════
// 7. SYNC MANAGEMENT
// ════════════════════════════════════════════════

// In-memory sync progress tracker (per org)
const syncProgress = new Map<number, {
    status: 'idle' | 'syncing' | 'completed' | 'error';
    progress: number; // 0-100
    totalDocuments: number;
    syncedDocuments: number;
    message: string;
    startedAt?: Date;
    completedAt?: Date;
}>();

// ── Sync History (in-memory, per org) ──
const syncHistory = new Map<number, Array<{
    id: string;
    startedAt: Date;
    completedAt?: Date;
    status: 'completed' | 'error' | 'syncing';
    documentsCount: number;
    message: string;
    durationMs?: number;
}>>();

// Cleanup old history entries every hour
setInterval(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    syncHistory.forEach((entries, orgId) => {
        const filtered = entries.filter(e => e.startedAt.getTime() > sevenDaysAgo);
        if (filtered.length === 0) syncHistory.delete(orgId);
        else syncHistory.set(orgId, filtered);
    });
}, 60 * 60 * 1000);

/**
 * POST /api/eta/sync/start
 * Start full org sync from ETA (background)
 */
router.post('/sync/start', authenticate, bulkLimiter, async (req: Request, res: Response) => {
    try {
        const { service, orgId, orgName } = await getETAServiceForUser(req);
        const pool = getPool(req);

        // Check if sync is already running
        const current = syncProgress.get(orgId);
        if (current?.status === 'syncing') {
            return res.json({
                success: true,
                message: 'Sync is already in progress',
                progress: current,
            });
        }

        // Initialize progress
        syncProgress.set(orgId, {
            status: 'syncing',
            progress: 0,
            totalDocuments: 0,
            syncedDocuments: 0,
            message: 'Starting sync...',
            startedAt: new Date(),
        });

        // Ensure tables exist and migrate existing ones
        const tables = getOrgTableNames(orgId, orgName);
        await createOrgTables(pool, orgId, orgName);
        await migrateOrgTables(pool, orgId, orgName);

        // Respond immediately — sync runs in background
        res.json({ success: true, message: 'Sync started in background', orgId });

        // Record sync start in history
        const historyId = `sync_${Date.now()}_${orgId}`;
        const historyEntries = syncHistory.get(orgId) || [];
        historyEntries.unshift({
            id: historyId,
            startedAt: new Date(),
            status: 'syncing',
            documentsCount: 0,
            message: 'Sync in progress...',
        });
        // Keep only last 50
        if (historyEntries.length > 50) historyEntries.length = 50;
        syncHistory.set(orgId, historyEntries);

        // ── Background sync ──
        (async () => {
            try {
                const settings = await prisma.organization_settings.findUnique({
                    where: { organization_id: orgId },
                });
                const env = settings?.eta_environment || 'PreProd';

                console.log(`[Sync] ═══ Starting sync for org ${orgId} (${orgName}) ═══`);
                console.log(`[Sync] Environment: ${env}`);
                console.log(`[Sync] Settings found: ${!!settings}`);
                if (settings) {
                    console.log(`[Sync] ETA client_id: ${settings.eta_client_id ? settings.eta_client_id.substring(0, 8) + '...' : 'NULL'}`);
                    console.log(`[Sync] ETA preprod_client_id: ${settings.eta_preprod_client_id ? settings.eta_preprod_client_id.substring(0, 8) + '...' : 'NULL'}`);
                    console.log(`[Sync] ETA prod_client_id: ${settings.eta_prod_client_id ? settings.eta_prod_client_id.substring(0, 8) + '...' : 'NULL'}`);
                }

                // Fetch documents in 30-day chunks going back to 2020
                const endDate = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
                let currentEnd = new Date(endDate);
                const limitDate = new Date('2020-01-01T00:00:00Z');
                let totalSynced = 0;
                let chunkIndex = 0;

                while (currentEnd > limitDate) {
                    const currentStart = new Date(currentEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
                    if (currentStart < limitDate) currentStart.setTime(limitDate.getTime());

                    const dateFrom = currentStart.toISOString().split('.')[0] + 'Z';
                    const dateTo = currentEnd.toISOString().split('.')[0] + 'Z';

                    syncProgress.set(orgId, {
                        ...syncProgress.get(orgId)!,
                        message: `Fetching: ${dateFrom.split('T')[0]} → ${dateTo.split('T')[0]}`,
                    });

                    try {
                        // Refresh token periodically
                        let page = 1;
                        let hasMore = true;

                        while (hasMore) {
                            const result = await service.searchDocuments({
                                dateFrom,
                                dateTo,
                                pageNo: page,
                                pageSize: 100,
                            });

                            // Debug: log first chunk response
                            if (chunkIndex === 0 && page === 1) {
                                console.log(`[Sync] First API response keys: ${JSON.stringify(Object.keys(result))}`);
                                console.log(`[Sync] First API result count: ${result.result?.length ?? 'NO result array'}`);
                                console.log(`[Sync] metadata: ${JSON.stringify(result.metadata || 'none')}`);
                            }

                            const docs = result.result || [];
                            if (docs.length === 0) {
                                hasMore = false;
                                break;
                            }

                            // UPSERT each document into org table
                            let linesInserted = 0;
                            let detailErrors = 0;
                            let lineErrors = 0;

                            for (const doc of docs) {
                                // Task 2: Default direction = 'sent' for searchDocuments
                                await upsertDocument(pool, tables.documents, doc, orgId, env, 'sent', orgName);

                                // Fetch full document details for invoice lines
                                try {
                                    // Small delay to avoid ETA rate limiting
                                    if (totalSynced > 0 && totalSynced % 5 === 0) {
                                        await new Promise(r => setTimeout(r, 200));
                                    }

                                    // Use getDocumentDetails (/details endpoint)
                                    const details = await service.getDocumentDetails(doc.uuid);

                                    // Re-upsert document with full details (includes address, signedBy, etc.)
                                    await upsertDocument(pool, tables.documents, details, orgId, env, 'sent', orgName);

                                    // Extract invoice lines
                                    const invoiceLines = details.invoiceLines || [];

                                    // Debug first doc
                                    if (totalSynced === 0) {
                                        console.log(`[Sync] ═══ First Document Details ═══`);
                                        console.log(`[Sync] UUID: ${doc.uuid}`);
                                        console.log(`[Sync] Details top-keys: ${JSON.stringify(Object.keys(details))}`);
                                        console.log(`[Sync] invoiceLines count: ${invoiceLines.length}`);
                                        if (details.documentBody) {
                                            console.log(`[Sync] documentBody keys: ${JSON.stringify(Object.keys(details.documentBody).slice(0, 10))}`);
                                        }
                                        if (invoiceLines.length > 0) {
                                            console.log(`[Sync] First line keys: ${JSON.stringify(Object.keys(invoiceLines[0]))}`);
                                        } else {
                                            console.log(`[Sync] ⚠ No invoiceLines found in document details!`);
                                            console.log(`[Sync] Full response (first 500 chars): ${JSON.stringify(details).substring(0, 500)}`);
                                        }
                                    }

                                    // Task 5: Extract validation errors for lines
                                    const validationErrors = details.validationResults?.validationSteps || [];

                                    if (invoiceLines.length > 0) {
                                        try {
                                            await upsertInvoiceLines(pool, tables, doc.uuid, invoiceLines, orgId, validationErrors);
                                            linesInserted += invoiceLines.length;
                                        } catch (lineErr: any) {
                                            lineErrors++;
                                            if (lineErrors <= 2) {
                                                console.error(`[Sync] ❌ SQL error inserting lines for ${doc.uuid}: ${lineErr.message}`);
                                            }
                                        }
                                    }
                                } catch (detailErr: any) {
                                    detailErrors++;
                                    if (detailErrors <= 3) {
                                        console.warn(`[Sync] ❌ getDocumentDetails failed for ${doc.uuid}: ${detailErr.message}`);
                                        if (detailErr.response?.status) {
                                            console.warn(`[Sync]    HTTP ${detailErr.response.status}: ${JSON.stringify(detailErr.response.data || '').substring(0, 300)}`);
                                        }
                                    }
                                }

                                totalSynced++;
                            }

                            if (detailErrors > 0 || lineErrors > 0 || linesInserted > 0) {
                                console.log(`[Sync] Chunk results: ${docs.length} docs, ${linesInserted} lines inserted, ${detailErrors} detail errors, ${lineErrors} line SQL errors`);
                            }

                            syncProgress.set(orgId, {
                                ...syncProgress.get(orgId)!,
                                syncedDocuments: totalSynced,
                                totalDocuments: totalSynced,
                                progress: Math.min(99, Math.round(
                                    ((endDate.getTime() - currentEnd.getTime()) / (endDate.getTime() - limitDate.getTime())) * 100
                                )),
                            });

                            if (docs.length < 100) hasMore = false;
                            else page++;
                        }
                    } catch (chunkErr: any) {
                        console.warn(`[Sync] Chunk error for ${dateFrom} → ${dateTo}:`, chunkErr.message);
                    }

                    chunkIndex++;
                    currentEnd = new Date(currentEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
                }

                // Update sync status in DB
                await prisma.organization_settings.update({
                    where: { organization_id: orgId },
                    data: {
                        eta_last_sync_at: new Date(),
                        eta_sync_status: 'completed',
                    },
                });

                syncProgress.set(orgId, {
                    status: 'completed',
                    progress: 100,
                    totalDocuments: totalSynced,
                    syncedDocuments: totalSynced,
                    message: `Sync completed: ${totalSynced} documents`,
                    startedAt: syncProgress.get(orgId)?.startedAt,
                    completedAt: new Date(),
                });

                // Update sync history
                const entries = syncHistory.get(orgId) || [];
                const entry = entries.find(e => e.id === historyId);
                if (entry) {
                    entry.status = 'completed';
                    entry.completedAt = new Date();
                    entry.documentsCount = totalSynced;
                    entry.message = `${totalSynced} documents synced`;
                    entry.durationMs = new Date().getTime() - entry.startedAt.getTime();
                }

                console.log(`[Sync] ✅ Org ${orgId}: Full sync completed — ${totalSynced} documents`);
            } catch (err: any) {
                console.error(`[Sync] ❌ Org ${orgId}: Sync failed —`, err.message);
                syncProgress.set(orgId, {
                    status: 'error',
                    progress: 0,
                    totalDocuments: 0,
                    syncedDocuments: 0,
                    message: `Sync failed: ${err.message}`,
                    startedAt: syncProgress.get(orgId)?.startedAt,
                });

                // Update sync history with error
                const entries = syncHistory.get(orgId) || [];
                const entry = entries.find(e => e.id === historyId);
                if (entry) {
                    entry.status = 'error';
                    entry.completedAt = new Date();
                    entry.message = `Error: ${err.message}`;
                    entry.durationMs = new Date().getTime() - entry.startedAt.getTime();
                }

                await prisma.organization_settings.update({
                    where: { organization_id: orgId },
                    data: { eta_sync_status: 'error' },
                }).catch(() => { });
            }
        })();
    } catch (err: any) {
        console.error('[ETA Route] Sync start error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/eta/sync/status
 * Get current sync progress for user's org
 */
router.get('/sync/status', authenticate, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        let orgId = user?.organizationId || null;
        if (!orgId) {
            const fallbackOrg = await prisma.organizations.findFirst({ where: { is_active: true }, orderBy: { id: 'asc' } });
            if (fallbackOrg) orgId = fallbackOrg.id;
        }
        if (!orgId) {
            return res.status(400).json({ success: false, message: 'No organization found' });
        }
        const progress = syncProgress.get(orgId) || {
            status: 'idle',
            progress: 0,
            totalDocuments: 0,
            syncedDocuments: 0,
            message: 'No sync has been started',
        };
        res.json({ success: true, ...progress });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/eta/sync/history
 * Get past sync records for user's org
 */
router.get('/sync/history', authenticate, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        let orgId = user?.organizationId || null;
        if (!orgId) {
            const fallbackOrg = await prisma.organizations.findFirst({ where: { is_active: true }, orderBy: { id: 'asc' } });
            if (fallbackOrg) orgId = fallbackOrg.id;
        }
        if (!orgId) {
            return res.status(400).json({ success: false, message: 'No organization found' });
        }

        const history = syncHistory.get(orgId) || [];

        // Also get last sync from DB
        let lastSyncAt: Date | null = null;
        try {
            const settings = await prisma.organization_settings.findUnique({
                where: { organization_id: orgId },
                select: { eta_last_sync_at: true, eta_sync_status: true },
            });
            lastSyncAt = settings?.eta_last_sync_at || null;
        } catch (e) { /* */ }

        res.json({
            success: true,
            history,
            lastSyncAt,
            count: history.length,
        });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/eta/sync/delta
 * Quick delta sync — fetch only last 30 minutes
 */
router.post('/sync/delta', authenticate, bulkLimiter, async (req: Request, res: Response) => {
    try {
        const { service, orgId, orgName } = await getETAServiceForUser(req);
        const pool = getPool(req);
        const tables = getOrgTableNames(orgId, orgName);

        const settings = await prisma.organization_settings.findUnique({
            where: { organization_id: orgId },
        });
        const env = settings?.eta_environment || 'PreProd';

        const dateTo = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 min ago
        const dateFrom = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago

        const result = await service.searchDocuments({ dateFrom, dateTo, pageSize: 100 });
        const docs = result.result || [];
        let synced = 0;

        for (const doc of docs) {
            await upsertDocument(pool, tables.documents, doc, orgId, env, 'sent', orgName);

            try {
                const details = await service.getDocumentDetails(doc.uuid);
                // Re-upsert with full details (address, signedBy, etc.)
                await upsertDocument(pool, tables.documents, details, orgId, env, 'sent', orgName);
                const validationErrors = details.validationResults?.validationSteps || [];
                if (details.invoiceLines && details.invoiceLines.length > 0) {
                    await upsertInvoiceLines(pool, tables, doc.uuid, details.invoiceLines, orgId, validationErrors);
                }
            } catch (detailErr: any) {
                console.warn(`[Delta Sync] Details error for ${doc.uuid}: ${detailErr.message}`);
            }
            synced++;
        }

        // Update last sync time
        await prisma.organization_settings.update({
            where: { organization_id: orgId },
            data: { eta_last_sync_at: new Date() },
        });

        res.json({ success: true, message: `Delta sync: ${synced} documents updated`, count: synced });
    } catch (err: any) {
        console.error('[ETA Route] Delta sync error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/eta/test-connection
 * Test ETA credentials without starting sync
 * Accepts optional body: { clientId, clientSecret, env }
 */
router.post('/test-connection', authenticate, async (req: Request, res: Response) => {
    try {
        let service: ETAService;

        try {
            const result = await getETAServiceForUser(req);
            service = result.service;
        } catch (orgErr: any) {
            // If org settings don't have credentials, try from request body
            const { clientId, clientSecret, env } = req.body || {};
            if (clientId && clientSecret) {
                const environment = env === 'Prod' ? 'Prod' : 'PreProd';
                service = new ETAService(0, { clientId, clientSecret, environment });
            } else {
                throw orgErr;
            }
        }

        const result = await service.testConnection();
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────
// DB Helpers: Upsert document + lines
// ──────────────────────────────────────────────

async function upsertDocument(
    pool: pg.Pool,
    tableName: string,
    doc: any,
    orgId: number,
    env: string,
    direction?: string,
    orgName?: string,
): Promise<void> {
    const client = await pool.connect();
    try {
        // Extract nested objects safely
        const taxTotalsJson = doc.taxTotals ? JSON.stringify(doc.taxTotals) : null;
        const issuerAddress = doc.issuer?.address ? JSON.stringify(doc.issuer.address) : null;
        const receiverAddress = doc.receiver?.address ? JSON.stringify(doc.receiver.address) : null;

        // Task 1: Extract individual address fields
        const iAddr = doc.issuer?.address || {};
        const rAddr = doc.receiver?.address || {};

        // Task 4: Extract signedBy from signatures array
        const signedBy = doc.signatures?.[0]?.signedBy || null;

        // Audit: Serialize delivery, payment, freezeStatus objects
        const deliveryJson = doc.delivery ? JSON.stringify(doc.delivery) : null;
        const paymentJson = doc.payment ? JSON.stringify(doc.payment) : null;
        const freezeStatusJson = doc.freezeStatus ? JSON.stringify(doc.freezeStatus) : null;

        // Audit 2: Serialize validationResults, invoiceLineItemCodes, additionalMetadata
        const validationResultsJson = doc.validationResults ? JSON.stringify(doc.validationResults) : null;
        const invoiceLineItemCodesJson = doc.invoiceLineItemCodes ? JSON.stringify(doc.invoiceLineItemCodes) : null;
        const additionalMetadataJson = doc.additionalMetadata && doc.additionalMetadata.length > 0 ? JSON.stringify(doc.additionalMetadata) : null;

        // Audit 4: Serialize references, currencySegments, alertDetails
        const referencesJson = doc.references && doc.references.length > 0 ? JSON.stringify(doc.references) : null;
        const currencySegmentsJson = doc.currencySegments ? JSON.stringify(doc.currencySegments) : null;
        const alertDetailsJson = doc.alertDetails ? JSON.stringify(doc.alertDetails) : null;

        await client.query(`
            INSERT INTO "InvoicesDb"."${tableName}" (
                uuid, "submissionId", "internalId", "longId", submitted,
                "typeName", "typeVersionName", "issuerId", "issuerName",
                "receiverId", "receiverName", "dateTimeIssued", "dateTimeReceived",
                "totalSales", "totalDiscount", "netAmount", total, status,
                direction, "dateTimeCancelled", environment, org_id, synced_at,
                "publicUrl", "totalItemsDiscountAmount", "extraDiscountAmount",
                "salesOrderReference", "salesOrderDescription",
                "purchaseOrderReference", "purchaseOrderDescription",
                "taxpayerActivityCode", "proformaInvoiceNumber", "currenciesSold",
                "statusId", "documentStatusReason",
                "cancelRequestDate", "rejectRequestDate",
                "canbeCancelledUntil", "canbeRejectedUntil",
                "taxTotalsJson", "issuerAddress", "receiverAddress",
                "issuerType", "receiverType",
                "documentTypeNamePrimaryLang", "documentTypeNameSecondaryLang",
                "issuer_address_country", "issuer_address_governate", "issuer_address_regionCity",
                "issuer_address_street", "issuer_address_buildingNumber", "issuer_address_postalCode",
                "issuer_address_room", "issuer_address_floor", "issuer_address_landmark",
                "issuer_address_additionalInformation", "issuer_address_branchID",
                "receiver_address_country", "receiver_address_governate", "receiver_address_regionCity",
                "receiver_address_street", "receiver_address_buildingNumber", "receiver_address_postalCode",
                "receiver_address_room", "receiver_address_floor", "receiver_address_landmark",
                "receiver_address_additionalInformation", "receiver_address_branchID",
                "cancelRequestDelayedDate", "rejectRequestDelayedDate",
                "declineCancelRequestDate", "declineRejectRequestDate",
                "submissionChannel", "transformationStatus", "signedBy",
                "maxPercision", "documentLinesTotalCount", "lateSubmissionRequestNumber",
                "serviceDeliveryDate", "customsClearanceDate", "customsDeclarationNumber",
                "ePaymentNumber", "deliveryJson", "paymentJson", "freezeStatusJson",
                "documentBody", "validationResultsJson", "invoiceLineItemCodesJson", "additionalMetadataJson",
                "referencesJson", "currencySegmentsJson", "alertDetailsJson"
            ) VALUES (
                $1, $2, $3, $4, true,
                $5, $6, $7, $8,
                $9, $10, $11, $12,
                $13, $14, $15, $16, $17,
                $18, $19, $20, $21, NOW(),
                $22, $23, $24,
                $25, $26,
                $27, $28,
                $29, $30, $31,
                $32, $33,
                $34, $35,
                $36, $37,
                $38, $39, $40,
                $41, $42,
                $43, $44,
                $45, $46, $47, $48, $49, $50, $51, $52, $53, $54, $55,
                $56, $57, $58, $59, $60, $61, $62, $63, $64, $65, $66,
                $67, $68, $69, $70, $71, $72, $73,
                $74, $75, $76, $77, $78, $79, $80, $81, $82, $83,
                $84, $85, $86, $87,
                $88, $89, $90
            )
            ON CONFLICT (uuid) DO UPDATE SET
                status = EXCLUDED.status,
                "dateTimeCancelled" = EXCLUDED."dateTimeCancelled",
                "publicUrl" = COALESCE(EXCLUDED."publicUrl", "InvoicesDb"."${tableName}"."publicUrl"),
                "statusId" = COALESCE(EXCLUDED."statusId", "InvoicesDb"."${tableName}"."statusId"),
                "documentStatusReason" = COALESCE(EXCLUDED."documentStatusReason", "InvoicesDb"."${tableName}"."documentStatusReason"),
                "cancelRequestDate" = COALESCE(EXCLUDED."cancelRequestDate", "InvoicesDb"."${tableName}"."cancelRequestDate"),
                "rejectRequestDate" = COALESCE(EXCLUDED."rejectRequestDate", "InvoicesDb"."${tableName}"."rejectRequestDate"),
                "canbeCancelledUntil" = COALESCE(EXCLUDED."canbeCancelledUntil", "InvoicesDb"."${tableName}"."canbeCancelledUntil"),
                "canbeRejectedUntil" = COALESCE(EXCLUDED."canbeRejectedUntil", "InvoicesDb"."${tableName}"."canbeRejectedUntil"),
                "taxTotalsJson" = COALESCE(EXCLUDED."taxTotalsJson", "InvoicesDb"."${tableName}"."taxTotalsJson"),
                direction = COALESCE(EXCLUDED.direction, "InvoicesDb"."${tableName}".direction),
                "cancelRequestDelayedDate" = COALESCE(EXCLUDED."cancelRequestDelayedDate", "InvoicesDb"."${tableName}"."cancelRequestDelayedDate"),
                "rejectRequestDelayedDate" = COALESCE(EXCLUDED."rejectRequestDelayedDate", "InvoicesDb"."${tableName}"."rejectRequestDelayedDate"),
                "declineCancelRequestDate" = COALESCE(EXCLUDED."declineCancelRequestDate", "InvoicesDb"."${tableName}"."declineCancelRequestDate"),
                "declineRejectRequestDate" = COALESCE(EXCLUDED."declineRejectRequestDate", "InvoicesDb"."${tableName}"."declineRejectRequestDate"),
                "submissionChannel" = COALESCE(EXCLUDED."submissionChannel", "InvoicesDb"."${tableName}"."submissionChannel"),
                "transformationStatus" = COALESCE(EXCLUDED."transformationStatus", "InvoicesDb"."${tableName}"."transformationStatus"),
                "signedBy" = COALESCE(EXCLUDED."signedBy", "InvoicesDb"."${tableName}"."signedBy"),
                "issuer_address_country" = COALESCE(EXCLUDED."issuer_address_country", "InvoicesDb"."${tableName}"."issuer_address_country"),
                "receiver_address_country" = COALESCE(EXCLUDED."receiver_address_country", "InvoicesDb"."${tableName}"."receiver_address_country"),
                "deliveryJson" = COALESCE(EXCLUDED."deliveryJson", "InvoicesDb"."${tableName}"."deliveryJson"),
                "paymentJson" = COALESCE(EXCLUDED."paymentJson", "InvoicesDb"."${tableName}"."paymentJson"),
                "freezeStatusJson" = COALESCE(EXCLUDED."freezeStatusJson", "InvoicesDb"."${tableName}"."freezeStatusJson"),
                "maxPercision" = COALESCE(EXCLUDED."maxPercision", "InvoicesDb"."${tableName}"."maxPercision"),
                "documentLinesTotalCount" = COALESCE(EXCLUDED."documentLinesTotalCount", "InvoicesDb"."${tableName}"."documentLinesTotalCount"),
                "documentBody" = COALESCE(EXCLUDED."documentBody", "InvoicesDb"."${tableName}"."documentBody"),
                "validationResultsJson" = COALESCE(EXCLUDED."validationResultsJson", "InvoicesDb"."${tableName}"."validationResultsJson"),
                "invoiceLineItemCodesJson" = COALESCE(EXCLUDED."invoiceLineItemCodesJson", "InvoicesDb"."${tableName}"."invoiceLineItemCodesJson"),
                synced_at = NOW()
        `, [
            doc.uuid,
            doc.submissionId || doc.submissionUUID || null,
            doc.internalId || doc.internalID || null,
            doc.longId || null,
            doc.typeName || doc.documentType || null,
            doc.typeVersionName || doc.documentTypeVersion || null,
            doc.issuerId || doc.issuer?.id || null,
            doc.issuerName || doc.issuer?.name || null,
            doc.receiverId || doc.receiver?.id || null,
            doc.receiverName || doc.receiver?.name || null,
            doc.dateTimeIssued || null,
            doc.dateTimeReceived || doc.dateTimeRecevied || null,
            doc.totalSales || doc.totalSalesAmount || 0,
            doc.totalDiscount || doc.totalDiscountAmount || 0,
            doc.netAmount || 0,
            doc.total || doc.totalAmount || 0,
            doc.status || null,
            // Task 2: direction — use passed direction or doc.direction
            direction || doc.direction || null,
            doc.cancelRequestDate || doc.dateTimeCancelled || null,
            env,
            orgId,
            // Extended fields
            doc.publicUrl || null,
            doc.totalItemsDiscountAmount || 0,
            doc.extraDiscountAmount || 0,
            doc.salesOrderReference || null,
            doc.salesOrderDescription || null,
            doc.purchaseOrderReference || null,
            doc.purchaseOrderDescription || null,
            doc.taxpayerActivityCode || null,
            doc.proformaInvoiceNumber || null,
            doc.currenciesSold || 'EGP',
            doc.statusId ?? null,
            doc.documentStatusReason || null,
            doc.cancelRequestDate || null,
            doc.rejectRequestDate || null,
            doc.canbeCancelledUntil || null,
            doc.canbeRejectedUntil || null,
            taxTotalsJson,
            issuerAddress,
            receiverAddress,
            doc.issuer?.type != null ? String(doc.issuer.type) : (doc.issuerType || null),
            doc.receiver?.type != null ? String(doc.receiver.type) : (doc.receiverType || null),
            doc.documentTypeNamePrimaryLang || null,
            doc.documentTypeNameSecondaryLang || null,
            // Task 1: Issuer address individual fields
            iAddr.country || null,
            iAddr.governate || null,
            iAddr.regionCity || null,
            iAddr.street || null,
            iAddr.buildingNumber || null,
            iAddr.postalCode || null,
            iAddr.room || null,
            iAddr.floor || null,
            iAddr.landmark || null,
            iAddr.additionalInformation || null,
            iAddr.branchID || null,
            // Task 1: Receiver address individual fields
            rAddr.country || null,
            rAddr.governate || null,
            rAddr.regionCity || null,
            rAddr.street || null,
            rAddr.buildingNumber || null,
            rAddr.postalCode || null,
            rAddr.room || null,
            rAddr.floor || null,
            rAddr.landmark || null,
            rAddr.additionalInformation || null,
            rAddr.branchID || null,
            // Task 4: Missing fields
            doc.cancelRequestDelayedDate || null,
            doc.rejectRequestDelayedDate || null,
            doc.declineCancelRequestDate || null,
            doc.declineRejectRequestDate || null,
            doc.submissionChannel ?? null,
            doc.transformationStatus || null,
            signedBy,
            // Audit: new fields
            doc.maxPercision ?? null,
            doc.documentLinesTotalCount ?? null,
            doc.lateSubmissionRequestNumber || null,
            doc.serviceDeliveryDate || null,
            doc.customsClearanceDate || null,
            doc.customsDeclarationNumber || null,
            doc.ePaymentNumber || null,
            deliveryJson,
            paymentJson,
            freezeStatusJson,
            // Audit 2: Final missing fields
            doc.document || null,  // raw XML/JSON body → documentBody
            validationResultsJson,
            invoiceLineItemCodesJson,
            additionalMetadataJson,
            // Audit 4: references, currencySegments, alertDetails
            referencesJson,
            currencySegmentsJson,
            alertDetailsJson,
        ]);
    } finally {
        client.release();
    }

    // Master-data: auto-populate the Customers table from this invoice.
    // Silent on failure — never let a master-data upsert break the main sync.
    if (orgName) {
        upsertCustomerFromDoc(pool, orgId, orgName, {
            direction: direction || doc.direction,
            issuerId: doc.issuer?.id, issuerName: doc.issuer?.name, issuerType: doc.issuer?.type,
            issuerAddress: doc.issuer?.address,
            receiverId: doc.receiver?.id, receiverName: doc.receiver?.name, receiverType: doc.receiver?.type,
            receiverAddress: doc.receiver?.address,
            total: doc.total != null ? Number(doc.total) : doc.totalAmount != null ? Number(doc.totalAmount) : 0,
            dateTimeIssued: doc.dateTimeIssued || null,
        }).catch(e => console.warn('[Customers] upsert from doc failed:', e.message));
    }
}

async function upsertInvoiceLines(
    pool: pg.Pool,
    tables: { documents: string; lines: string },
    documentUuid: string,
    lines: InvoiceLine[],
    orgId: number,
    validationErrors?: Array<{ stepName: string; status: string; error: any }>,
): Promise<void> {
    const client = await pool.connect();
    try {
        // Delete existing lines for this document (re-sync replaces them)
        await client.query(`DELETE FROM "InvoicesDb"."${tables.lines}" WHERE document_uuid = $1`, [documentUuid]);

        // Task 5: Build error strings from validationResults (shared across all lines of this document)
        const errors: (string | null)[] = new Array(8).fill(null);
        if (validationErrors && validationErrors.length > 0) {
            const failedSteps = validationErrors.filter(s => s.status !== 'Valid' && s.error);
            for (let e = 0; e < Math.min(failedSteps.length, 8); e++) {
                const step = failedSteps[e];
                errors[e] = `${step.stepName}: ${typeof step.error === 'string' ? step.error : JSON.stringify(step.error)}`;
            }
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Extract taxable items as JSON string
            const taxItems = line.taxableItems || (line as any).lineTaxableItems || (line as any).taxTotals || (line as any).taxes || [];
            const taxableItemsJson = taxItems.length > 0 ? JSON.stringify(taxItems) : null;

            // Task 3: Flatten tax items into individual columns (up to 8, 5 fields each)
            const flatTax: (string | number | null)[] = [];
            for (let t = 0; t < 8; t++) {
                if (t < taxItems.length) {
                    const ti = taxItems[t];
                    flatTax.push(ti.taxType || null);
                    flatTax.push(ti.amount ?? null);
                    flatTax.push(ti.subType || null);
                    flatTax.push(ti.rate ?? null);
                    flatTax.push(ti.amountForeign ?? null);
                } else {
                    flatTax.push(null, null, null, null, null);
                }
            }

            // Debug: log the first line's keys to understand response structure
            if (i === 0) {
                console.log(`[Sync Debug] First invoice line keys: ${JSON.stringify(Object.keys(line))}`);
                console.log(`[Sync Debug] taxableItems count: ${taxItems.length}`);
            }

            await client.query(`
                INSERT INTO "InvoicesDb"."${tables.lines}" (
                    document_uuid, line_number, description, "itemType", "itemCode", "internalCode",
                    "unitType", quantity, "unitPrice", currency, "exchangeRate",
                    "salesTotal", "discountRate", "discountAmount", "netTotal",
                    "totalTaxableFees", "itemsDiscount", "valueDifference", total, org_id,
                    "itemPrimaryName", "itemSecondaryName",
                    "amountSold", "amountEGP", "currencySold", "currencyExchangeRate",
                    "weightUnitType", "weightQuantity",
                    "salesTotalForeign", "netTotalForeign", "totalForeign",
                    "totalTaxableFeesForeign", "itemsDiscountForeign",
                    "valueDifferenceForeign", "discountAmountForeign",
                    "taxableItemsJson",
                    "tax1_type", "tax1_amount", "tax1_subtype", "tax1_rate", "tax1_amountForeign",
                    "tax2_type", "tax2_amount", "tax2_subtype", "tax2_rate", "tax2_amountForeign",
                    "tax3_type", "tax3_amount", "tax3_subtype", "tax3_rate", "tax3_amountForeign",
                    "tax4_type", "tax4_amount", "tax4_subtype", "tax4_rate", "tax4_amountForeign",
                    "tax5_type", "tax5_amount", "tax5_subtype", "tax5_rate", "tax5_amountForeign",
                    "tax6_type", "tax6_amount", "tax6_subtype", "tax6_rate", "tax6_amountForeign",
                    "tax7_type", "tax7_amount", "tax7_subtype", "tax7_rate", "tax7_amountForeign",
                    "tax8_type", "tax8_amount", "tax8_subtype", "tax8_rate", "tax8_amountForeign",
                    "gettingError_1", "gettingError_2", "gettingError_3", "gettingError_4",
                    "gettingError_5", "gettingError_6", "gettingError_7", "gettingError_8",
                    "itemPrimaryDescription", "itemSecondaryDescription", "factoryUnitValueJson",
                    "unitTypePrimaryName", "unitTypePrimaryDescription",
                    "unitTypeSecondaryName", "unitTypeSecondaryDescription",
                    "weightUnitTypePrimaryName", "weightUnitTypePrimaryDescription",
                    "weightUnitTypeSecondaryName", "weightUnitTypeSecondaryDescription",
                    "discountRateForeign"
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    $7, $8, $9, $10, $11,
                    $12, $13, $14, $15,
                    $16, $17, $18, $19, $20,
                    $21, $22,
                    $23, $24, $25, $26,
                    $27, $28,
                    $29, $30, $31,
                    $32, $33,
                    $34, $35,
                    $36,
                    $37, $38, $39, $40, $41,
                    $42, $43, $44, $45, $46,
                    $47, $48, $49, $50, $51,
                    $52, $53, $54, $55, $56,
                    $57, $58, $59, $60, $61,
                    $62, $63, $64, $65, $66,
                    $67, $68, $69, $70, $71,
                    $72, $73, $74, $75, $76,
                    $77, $78, $79, $80, $81, $82, $83, $84,
                    $85, $86, $87,
                    $88, $89, $90, $91, $92, $93, $94, $95,
                    $96
                )
            `, [
                documentUuid,
                i + 1,
                line.description || null,
                line.itemType || null,
                line.itemCode || null,
                line.internalCode || null,
                line.unitType || 'EA',
                line.quantity || 0,
                line.unitValue?.amountEGP || 0,
                line.unitValue?.currencySold || 'EGP',
                line.unitValue?.currencyExchangeRate || 0,
                line.salesTotal || 0,
                line.discount?.rate || 0,
                line.discount?.amount || 0,
                line.netTotal || 0,
                line.totalTaxableFees || 0,
                line.itemsDiscount || 0,
                line.valueDifference || 0,
                line.total || 0,
                orgId,
                // Extended fields
                (line as any).itemPrimaryName || null,
                (line as any).itemSecondaryName || null,
                line.unitValue?.amountSold || 0,
                line.unitValue?.amountEGP || 0,
                line.unitValue?.currencySold || 'EGP',
                line.unitValue?.currencyExchangeRate || 0,
                (line as any).weightUnitType || null,
                (line as any).weightQuantity || 0,
                (line as any).salesTotalForeign || 0,
                (line as any).netTotalForeign || 0,
                (line as any).totalForeign || 0,
                (line as any).totalTaxableFeesForeign || 0,
                (line as any).itemsDiscountForeign || 0,
                (line as any).valueDifferenceForeign || 0,
                (line as any).discount?.amountForeign || (line as any).discountForeign?.amountForeign || 0,
                taxableItemsJson,
                // Task 3: Flat tax values (32 values for 8 taxes × 4 fields each)
                ...flatTax,
                // Task 5: Error columns
                ...errors,
                // Audit: new line fields
                (line as any).itemPrimaryDescription || null,
                (line as any).itemSecondaryDescription || null,
                (line as any).factoryUnitValue ? JSON.stringify((line as any).factoryUnitValue) : null,
                // Audit 3: Unit type names/descriptions
                (line as any).unitTypePrimaryName || null,
                (line as any).unitTypePrimaryDescription || null,
                (line as any).unitTypeSecondaryName || null,
                (line as any).unitTypeSecondaryDescription || null,
                (line as any).weightUnitTypePrimaryName || null,
                (line as any).weightUnitTypePrimaryDescription || null,
                (line as any).weightUnitTypeSecondaryName || null,
                (line as any).weightUnitTypeSecondaryDescription || null,
                // Audit 4: discount rate foreign
                (line as any).discountForeign?.rate ?? (line as any).discount?.rateForeign ?? 0,
            ]);
        }
    } finally {
        client.release();
    }
}

// ════════════════════════════════════════════════
// 7b. ITEM CODE SYNC & LOCAL MANAGEMENT
// ════════════════════════════════════════════════

/** POST /api/eta/codes/sync — Sync item codes from ETA portal to local DB */
router.post('/codes/sync', authenticate, async (req: Request, res: Response) => {
    try {
        const { service, orgId } = await getETAServiceForUser(req);
        const orgTables = await getOrgTablesForUser(req);
        const pool = getPool(req);

        // Fetch ALL published codes from ETA (both EGS + GS1)
        let allCodes: any[] = [];

        for (const codeType of ['EGS', 'GS1']) {
            let page = 1;
            let hasMore = true;

            while (hasMore) {
                try {
                    const result = await service.searchPublishedCodes(codeType, { pageNo: page, pageSize: 100 });
                    const codes = result.result || result.data || [];

                    // Tag each code with its type
                    for (const code of codes) {
                        code._syncedCodeType = codeType;
                    }

                    allCodes = allCodes.concat(codes);
                    console.log(`[Code Sync] Org ${orgId}: ${codeType} page ${page} → ${codes.length} codes`);

                    if (codes.length < 100) hasMore = false;
                    else page++;

                    // Delay to avoid 429 rate limiting
                    await new Promise(r => setTimeout(r, 1000));
                } catch (pageErr: any) {
                    console.warn(`[Code Sync] ${codeType} page ${page} failed: ${pageErr.message}`);
                    hasMore = false; // Stop on error, keep what we have
                }
            }
        }

        console.log(`[Code Sync] Org ${orgId}: Found ${allCodes.length} total codes from ETA portal`);

        if (allCodes.length === 0) {
            return res.json({ success: true, message: 'No published codes found on ETA portal', synced: 0 });
        }

        // Ensure item_codes table exists
        const client = await pool.connect();
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS "InvoicesDb"."${orgTables.item_codes}" (
                    id BIGSERIAL PRIMARY KEY,
                    item_code VARCHAR(100) UNIQUE,
                    code_type VARCHAR(20) DEFAULT 'EGS',
                    code_name VARCHAR(500),
                    code_name_ar VARCHAR(500),
                    parent_code VARCHAR(100),
                    description TEXT,
                    description_ar TEXT,
                    active_from TIMESTAMP,
                    active_to TIMESTAMP,
                    status VARCHAR(50) DEFAULT 'Submitted',
                    request_id VARCHAR(100),
                    org_id INTEGER DEFAULT ${orgId},
                    synced_at TIMESTAMP DEFAULT NOW(),
                    created_at TIMESTAMP DEFAULT NOW()
                );
            `);

            // Upsert each code
            let synced = 0;
            for (const code of allCodes) {
                try {
                    await client.query(`
                        INSERT INTO "InvoicesDb"."${orgTables.item_codes}" (
                            item_code, code_type, code_name, code_name_ar, parent_code,
                            description, description_ar, active_from, active_to,
                            status, request_id, org_id, synced_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
                        ON CONFLICT (item_code) DO UPDATE SET
                            code_name = EXCLUDED.code_name,
                            code_name_ar = EXCLUDED.code_name_ar,
                            status = EXCLUDED.status,
                            active_from = EXCLUDED.active_from,
                            active_to = EXCLUDED.active_to,
                            description = EXCLUDED.description,
                            description_ar = EXCLUDED.description_ar,
                            synced_at = NOW()
                    `, [
                        code.codeLookupValue || code.itemCode || code.codeID,
                        code._syncedCodeType || code.codeTypeName || code.codeType || 'EGS',
                        code.codeNamePrimaryLang || code.codeName || null,
                        code.codeNameSecondaryLang || code.codeNameAr || null,
                        code.parentCodeLookupValue || code.parentCode || null,
                        code.codeDescriptionPrimaryLang || code.description || null,
                        code.codeDescriptionSecondaryLang || code.descriptionAr || null,
                        code.activeFrom || null,
                        code.activeTo || null,
                        code.status || code.activeStatus || 'Active',
                        code.codeUsageRequestId || code.requestId || code.codeID || null,
                        orgId,
                    ]);
                    synced++;
                } catch (upsertErr: any) {
                    console.warn(`[Code Sync] Failed to upsert code ${code.itemCode}: ${upsertErr.message}`);
                }
            }

            console.log(`[Code Sync] ✅ Org ${orgId}: Synced ${synced}/${allCodes.length} codes`);
            res.json({ success: true, message: `Synced ${synced} item codes from ETA portal`, synced, total: allCodes.length });
        } finally {
            client.release();
        }
    } catch (err: any) {
        console.error('[Code Sync] Error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/** GET /api/eta/codes/local — Get locally synced item codes */
router.get('/codes/local', authenticate, async (req: Request, res: Response) => {
    try {
        const orgTables = await getOrgTablesForUser(req);
        const pool = getPool(req);
        const search = req.query.search as string || '';
        const codeType = req.query.codeType as string || '';

        let query = `SELECT * FROM "InvoicesDb"."${orgTables.item_codes}" WHERE 1=1`;
        const params: any[] = [];
        let paramIdx = 1;

        if (search) {
            query += ` AND (item_code ILIKE $${paramIdx} OR code_name ILIKE $${paramIdx} OR code_name_ar ILIKE $${paramIdx})`;
            params.push(`%${search}%`);
            paramIdx++;
        }

        if (codeType) {
            query += ` AND code_type = $${paramIdx}`;
            params.push(codeType);
            paramIdx++;
        }

        query += ` ORDER BY created_at DESC LIMIT 500`;

        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows, total: result.rows.length });
    } catch (err: any) {
        // Table might not exist yet
        if (err.message?.includes('does not exist')) {
            return res.json({ success: true, data: [], total: 0, message: 'No item codes synced yet. Click "Sync from Portal" to start.' });
        }
        res.status(500).json({ success: false, message: err.message });
    }
});

/** DELETE /api/eta/codes/local/:itemCode — Remove a local item code */
router.delete('/codes/local/:itemCode', authenticate, async (req: Request, res: Response) => {
    try {
        const orgTables = await getOrgTablesForUser(req);
        const pool = getPool(req);
        const itemCode = req.params.itemCode;

        await pool.query(`DELETE FROM "InvoicesDb"."${orgTables.item_codes}" WHERE item_code = $1`, [itemCode]);
        res.json({ success: true, message: `Item code ${itemCode} removed` });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ════════════════════════════════════════════════
// 8. DOCUMENT TYPES (#2, #3, #4)
// ════════════════════════════════════════════════

/** GET /api/eta/document-types — Get all document types */
router.get('/document-types', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const result = await service.getDocumentTypes();
        res.json({ success: true, ...result });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/** GET /api/eta/document-types/:id — Get specific document type */
router.get('/document-types/:id', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const result = await service.getDocumentType(req.params.id);
        res.json({ success: true, ...result });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/** GET /api/eta/document-types/:id/versions/:vid — Get document type version */
router.get('/document-types/:id/versions/:vid', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const result = await service.getDocumentTypeVersion(req.params.id, req.params.vid);
        res.json({ success: true, ...result });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ════════════════════════════════════════════════
// 9. RECENT DOCUMENTS (#17)
// ════════════════════════════════════════════════

/** GET /api/eta/documents/recent — Get recent documents (faster than search) */
router.get('/documents/recent', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const result = await service.getRecentDocuments({
            pageNo: parseInt(req.query.pageNo as string) || 1,
            pageSize: parseInt(req.query.pageSize as string) || 50,
            direction: req.query.direction as 'Sent' | 'Received' | undefined,
        });
        res.json({ success: true, ...result });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ════════════════════════════════════════════════
// 10. CODE REUSE & UPDATE (#9, #13)
// ════════════════════════════════════════════════

/** PUT /api/eta/codes/reuse — Request code reuse */
router.put('/codes/reuse', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const { items } = req.body;
        if (!items || !Array.isArray(items)) {
            return res.status(400).json({ success: false, message: 'items array is required' });
        }
        const result = await service.requestCodeReuse(items);
        res.json({ success: true, ...result });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/** PUT /api/eta/codes/:codeType/:itemCode — Update a published code */
router.put('/codes/:codeType/:itemCode', authenticate, async (req: Request, res: Response) => {
    try {
        const { service } = await getETAServiceForUser(req);
        const result = await service.updatePublishedCode(req.params.codeType, req.params.itemCode, req.body);
        res.json({ success: true, ...result });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ════════════════════════════════════════════════
// 11. TAXPAYER INFO LOOKUP
// ════════════════════════════════════════════════

/**
 * GET /api/eta/taxpayer/:rin
 * Look up an Egyptian taxpayer's registration details by RIN/Tax ID.
 * Returns 404 (with a helpful body) if ETA says the taxpayer isn't registered.
 */
router.get('/taxpayer/:rin', authenticate, async (req: Request, res: Response) => {
    try {
        const rin = String(req.params.rin || '').trim();
        if (!rin) return res.status(400).json({ success: false, message: 'rin is required' });
        if (!/^[A-Za-z0-9-]{4,32}$/.test(rin)) {
            return res.status(400).json({ success: false, message: 'rin format looks invalid' });
        }

        const { service } = await getETAServiceForUser(req);
        const info = await service.getTaxpayerInfo(rin);
        res.json({ success: true, taxpayer: info });
    } catch (err: any) {
        // ETA returns 404 for unregistered OR when the lookup endpoint is disabled for
        // this taxpayer profile (ETA gates it to tax-authority / intermediary accounts).
        const msg = err?.message || 'lookup failed';
        const notFound = /HTTP 404/.test(msg) || /not.*found/i.test(msg);
        if (notFound) {
            return res.status(404).json({
                success: false,
                message: 'Not registered, or ETA taxpayer lookup is not available for your account profile.',
                detail: msg,
            });
        }
        console.error('[ETA Route] Taxpayer lookup error:', msg);
        res.status(500).json({ success: false, message: msg });
    }
});

// ════════════════════════════════════════════════
// 12. WEBHOOKS — ETA sends notifications TO us (#28, #29)
// ════════════════════════════════════════════════

/**
 * PUT /api/eta/webhooks/documents (#28)
 * ETA calls this endpoint to notify us when document status changes
 * (e.g. Valid → Cancelled, Submitted → Rejected)
 */
router.put('/webhooks/documents', async (req: Request, res: Response) => {
    try {
        const notifications = req.body;
        console.log(`[ETA Webhook] Document notification received:`, JSON.stringify(notifications).substring(0, 500));

        // Process each notification — update local document status
        if (Array.isArray(notifications)) {
            for (const notif of notifications) {
                if (notif.uuid && notif.status) {
                    // Find which org has this document and update it
                    try {
                        const pool = (req as any).pool;
                        if (pool) {
                            // Find the document across all org tables
                            const orgs = await prisma.organizations.findMany({ where: { is_active: true } });
                            for (const org of orgs) {
                                const tableName = `org_${org.id}__documents`;
                                try {
                                    await pool.query(
                                        `UPDATE "InvoicesDb"."${tableName}" SET status = $1, synced_at = NOW() WHERE uuid = $2`,
                                        [notif.status, notif.uuid]
                                    );
                                } catch { }
                            }
                        }
                    } catch (dbErr: any) {
                        console.warn(`[ETA Webhook] DB update failed:`, dbErr.message);
                    }
                }
            }
        }

        // ETA expects 200 OK response
        res.json({ success: true, message: 'Notification received' });
    } catch (err: any) {
        console.error('[ETA Webhook] Document notification error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PUT /api/eta/webhooks/packages (#29)
 * ETA calls this endpoint to notify us when a document package is ready
 */
router.put('/webhooks/packages', async (req: Request, res: Response) => {
    try {
        const notification = req.body;
        console.log(`[ETA Webhook] Package notification received:`, JSON.stringify(notification).substring(0, 500));

        // TODO: Auto-download the package when ready
        // const { packageId } = notification;
        // const service = getETAServiceForOrg(orgId);
        // const packageData = await service.getPackage(packageId);

        res.json({ success: true, message: 'Package notification received' });
    } catch (err: any) {
        console.error('[ETA Webhook] Package notification error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ════════════════════════════════════════════════
// 13. ERP PING (#6) — ETA checks if our system is alive
// ════════════════════════════════════════════════

/** PUT /ping — ETA pings this to verify ERP connectivity */
router.put('/ping', (req: Request, res: Response) => {
    res.json({
        success: true,
        message: 'OTax ERP system is online',
        timestamp: new Date().toISOString(),
    });
});

export default router;
export { syncProgress };
