/**
 * Master Data Routes — per-org Customers master.
 *
 * Customers are auto-populated by `upsertCustomerFromDoc` whenever an invoice
 * is ingested (submit + sync paths). These endpoints let the user browse, search,
 * filter by tag, add manual entries, edit tags/notes, and backfill from existing
 * documents.
 *
 * Mounted at: /api/master-data
 */

import { Router, Request, Response } from 'express';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize, blockDemo, logActivity } from '../middleware/auth.js';
import { ensureMasterDataTables, getOrgTableNames, upsertCustomerFromDoc } from '../services/orgTables.js';

const router = Router();
const prisma = new PrismaClient();

function getPool(req: Request): pg.Pool { return (req as any).app.get('pool'); }

async function resolveOrg(req: Request): Promise<{ orgId: number; orgName: string }> {
    const user = (req as any).user;
    let orgId = user?.organizationId || null;
    if (!orgId) {
        const first = await prisma.organizations.findFirst({ where: { is_active: true }, orderBy: { id: 'asc' } });
        if (!first) throw new Error('No organization found');
        orgId = first.id;
    }
    const org = await prisma.organizations.findUnique({ where: { id: orgId } });
    if (!org) throw new Error('Organization not found');
    return { orgId, orgName: org.name };
}

function audit(req: Request, action: string, resourceId?: string, details?: any) {
    const u = (req as any).user;
    if (!u?.id) return;
    logActivity(u.id, u.username || 'user', action, 'master_data', 'customers', resourceId, details, req).catch(() => {});
}

// ──────────────────────────────────────────────────────────────────────
// GET /api/master-data/customers
//   Query: q (search on name/tax_id/phone), tag, direction (Sent|Received|both),
//          pageNo, pageSize, sortBy (name|last_seen|invoice_count|total_amount), sortDir
// ──────────────────────────────────────────────────────────────────────

router.get('/customers', authenticate, async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        await ensureMasterDataTables(pool, orgId, orgName);
        const { customers } = getOrgTableNames(orgId, orgName);

        const q = String(req.query.q || '').trim();
        const tag = String(req.query.tag || '').trim();
        const direction = String(req.query.direction || '').trim();
        const pageNo = Math.max(parseInt(req.query.pageNo as string) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(req.query.pageSize as string) || 25, 1), 200);
        const offset = (pageNo - 1) * pageSize;

        const sortBy = ({
            name: 'name',
            last_seen: 'last_seen_at',
            invoice_count: 'invoice_count',
            total_amount: 'total_amount',
        } as Record<string, string>)[String(req.query.sortBy || 'last_seen')] || 'last_seen_at';
        const sortDir = String(req.query.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

        const where: string[] = [];
        const params: any[] = [];
        if (q) {
            params.push(`%${q}%`);
            where.push(`(name ILIKE $${params.length} OR tax_id ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length})`);
        }
        if (tag) {
            params.push(tag);
            where.push(`$${params.length} = ANY(tags)`);
        }
        if (direction === 'Sent' || direction === 'Received') {
            params.push(direction);
            where.push(`$${params.length} = ANY(directions)`);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const [rows, count] = await Promise.all([
            pool.query(
                `SELECT id, tax_id, name, party_type, country, governate, region_city, street,
                        building_number, postal_code, phone, email, tags, notes, directions,
                        invoice_count, total_amount, first_seen_at, last_seen_at, manually_added,
                        created_at, updated_at
                 FROM "InvoicesDb"."${customers}"
                 ${whereSql}
                 ORDER BY ${sortBy} ${sortDir} NULLS LAST, name ASC
                 LIMIT ${pageSize} OFFSET ${offset}`,
                params
            ),
            pool.query(
                `SELECT COUNT(*)::int AS total FROM "InvoicesDb"."${customers}" ${whereSql}`,
                params
            ),
        ]);

        res.json({ success: true, items: rows.rows, pageNo, pageSize, total: count.rows[0]?.total || 0 });
    } catch (err: any) {
        console.error('[MasterData] list customers error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// GET /api/master-data/customers/stats — counts + tag distribution
// ──────────────────────────────────────────────────────────────────────

router.get('/customers/stats', authenticate, async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        await ensureMasterDataTables(pool, orgId, orgName);
        const { customers } = getOrgTableNames(orgId, orgName);

        const [total, manualTotal, tagRows] = await Promise.all([
            pool.query(`SELECT COUNT(*)::int AS n FROM "InvoicesDb"."${customers}"`),
            pool.query(`SELECT COUNT(*)::int AS n FROM "InvoicesDb"."${customers}" WHERE manually_added = TRUE`),
            pool.query(
                `SELECT unnest(tags) AS tag, COUNT(*)::int AS n
                 FROM "InvoicesDb"."${customers}"
                 WHERE tags IS NOT NULL AND array_length(tags, 1) > 0
                 GROUP BY tag
                 ORDER BY n DESC
                 LIMIT 50`
            ),
        ]);

        res.json({
            success: true,
            totalCustomers: total.rows[0]?.n || 0,
            manuallyAdded: manualTotal.rows[0]?.n || 0,
            autoFromInvoices: (total.rows[0]?.n || 0) - (manualTotal.rows[0]?.n || 0),
            topTags: tagRows.rows,
        });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// POST /api/master-data/customers — manually add one
// ──────────────────────────────────────────────────────────────────────

router.post('/customers', authenticate, blockDemo, authorize('masterdata.edit'), async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        await ensureMasterDataTables(pool, orgId, orgName);
        const { customers } = getOrgTableNames(orgId, orgName);

        const b = req.body || {};
        const taxId = String(b.tax_id || '').trim();
        if (!taxId) return res.status(400).json({ success: false, message: 'tax_id is required' });

        const r = await pool.query(
            `INSERT INTO "InvoicesDb"."${customers}"
             (tax_id, name, party_type, country, governate, region_city, street,
              building_number, postal_code, phone, email, tags, notes,
              directions, first_seen_at, last_seen_at, manually_added)
             VALUES ($1,$2,$3, $4,$5,$6,$7, $8,$9, $10,$11, $12, $13,
                     ARRAY[]::TEXT[], NOW(), NOW(), TRUE)
             ON CONFLICT (tax_id) DO NOTHING
             RETURNING id`,
            [
                taxId, b.name || null, b.party_type || null,
                b.country || null, b.governate || null, b.region_city || null, b.street || null,
                b.building_number || null, b.postal_code || null,
                b.phone || null, b.email || null,
                Array.isArray(b.tags) ? b.tags.map((t: any) => String(t).slice(0, 60)) : [],
                b.notes || null,
            ]
        );
        if (r.rowCount === 0) {
            return res.status(409).json({ success: false, message: `A customer with tax_id "${taxId}" already exists.` });
        }
        audit(req, 'customer_create', String(r.rows[0].id), { taxId });
        res.json({ success: true, id: r.rows[0].id });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// PATCH /api/master-data/customers/:id — update tags, notes, contact info
// ──────────────────────────────────────────────────────────────────────

router.patch('/customers/:id', authenticate, blockDemo, authorize('masterdata.edit'), async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        const { customers } = getOrgTableNames(orgId, orgName);
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

        const allowed = ['name', 'phone', 'email', 'notes', 'tags', 'country', 'governate', 'region_city', 'street', 'building_number', 'postal_code'];
        const sets: string[] = [];
        const params: any[] = [];
        for (const k of allowed) {
            if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) {
                let v = (req.body as any)[k];
                if (k === 'tags') v = Array.isArray(v) ? v.map((t: any) => String(t).slice(0, 60)) : [];
                params.push(v);
                sets.push(`${k} = $${params.length}`);
            }
        }
        if (sets.length === 0) return res.status(400).json({ success: false, message: 'Nothing to update' });
        sets.push(`updated_at = NOW()`);
        params.push(id);

        const r = await pool.query(
            `UPDATE "InvoicesDb"."${customers}" SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
            params
        );
        if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'Customer not found' });
        audit(req, 'customer_update', String(id), { fields: Object.keys(req.body || {}) });
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// DELETE /api/master-data/customers/:id
// ──────────────────────────────────────────────────────────────────────

router.delete('/customers/:id', authenticate, blockDemo, authorize('masterdata.edit'), async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        const { customers } = getOrgTableNames(orgId, orgName);
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
        const r = await pool.query(
            `DELETE FROM "InvoicesDb"."${customers}" WHERE id = $1`,
            [id]
        );
        if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'Customer not found' });
        audit(req, 'customer_delete', String(id));
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// POST /api/master-data/customers/backfill
//   Scans all documents in the org's table and upserts missing customers.
//   Idempotent — re-running just increments counters correctly.
// ──────────────────────────────────────────────────────────────────────

router.post('/customers/backfill', authenticate, blockDemo, authorize('masterdata.edit'), async (req: Request, res: Response) => {
    const pool = getPool(req);
    try {
        const { orgId, orgName } = await resolveOrg(req);
        await ensureMasterDataTables(pool, orgId, orgName);
        const tables = getOrgTableNames(orgId, orgName);

        // Wipe auto-populated rows so counters don't drift; keep manual ones.
        await pool.query(`DELETE FROM "InvoicesDb"."${tables.customers}" WHERE manually_added = FALSE`);

        const docs = await pool.query(
            `SELECT direction, "issuerId", "issuerName", "issuerType",
                    "receiverId", "receiverName", "receiverType",
                    total, "dateTimeIssued",
                    "issuer_address_country", "issuer_address_governate", "issuer_address_regionCity",
                    "issuer_address_street", "issuer_address_buildingNumber", "issuer_address_postalCode",
                    "issuer_address_floor", "issuer_address_room", "issuer_address_landmark",
                    "issuer_address_additionalInformation", "issuer_address_branchID",
                    "receiver_address_country", "receiver_address_governate", "receiver_address_regionCity",
                    "receiver_address_street", "receiver_address_buildingNumber", "receiver_address_postalCode",
                    "receiver_address_floor", "receiver_address_room", "receiver_address_landmark",
                    "receiver_address_additionalInformation", "receiver_address_branchID"
             FROM "InvoicesDb"."${tables.documents}"`
        ).catch(() => ({ rows: [] as any[] }));

        let processed = 0;
        for (const d of docs.rows) {
            await upsertCustomerFromDoc(pool, orgId, orgName, {
                direction: d.direction,
                issuerId: d.issuerId, issuerName: d.issuerName, issuerType: d.issuerType,
                issuerAddress: {
                    country: d.issuer_address_country, governate: d.issuer_address_governate,
                    regionCity: d.issuer_address_regionCity, street: d.issuer_address_street,
                    buildingNumber: d.issuer_address_buildingNumber, postalCode: d.issuer_address_postalCode,
                    floor: d.issuer_address_floor, room: d.issuer_address_room, landmark: d.issuer_address_landmark,
                    additionalInformation: d.issuer_address_additionalInformation, branchID: d.issuer_address_branchID,
                },
                receiverId: d.receiverId, receiverName: d.receiverName, receiverType: d.receiverType,
                receiverAddress: {
                    country: d.receiver_address_country, governate: d.receiver_address_governate,
                    regionCity: d.receiver_address_regionCity, street: d.receiver_address_street,
                    buildingNumber: d.receiver_address_buildingNumber, postalCode: d.receiver_address_postalCode,
                    floor: d.receiver_address_floor, room: d.receiver_address_room, landmark: d.receiver_address_landmark,
                    additionalInformation: d.receiver_address_additionalInformation, branchID: d.receiver_address_branchID,
                },
                total: Number(d.total || 0),
                dateTimeIssued: d.dateTimeIssued,
            });
            processed++;
        }

        const uniq = await pool.query(`SELECT COUNT(*)::int AS n FROM "InvoicesDb"."${tables.customers}"`);
        audit(req, 'customers_backfill', undefined, { processed, unique: uniq.rows[0]?.n || 0 });
        res.json({ success: true, processed, uniqueCustomers: uniq.rows[0]?.n || 0 });
    } catch (err: any) {
        console.error('[MasterData] backfill error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
