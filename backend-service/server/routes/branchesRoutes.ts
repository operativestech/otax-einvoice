/**
 * Multi-branch support.
 *
 * Egyptian ETA lets a taxpayer issue invoices from multiple branches, each
 * with its own branchID and registered address. Before this module every org
 * used an implicit "branch 0" baked into the issuer address saved in
 * organization settings.
 *
 * Schema (per org, stored in otaxdb so SQL stays consistent with other org
 * settings):
 *
 *   otaxdb.org_branches
 *     id, organization_id, branch_id (ETA's numeric branch code),
 *     name, country, governate, region_city, street, building_number,
 *     postal_code, floor, room, landmark, additional_info,
 *     is_default, is_active, created_at, updated_at
 *
 * When a branch is marked `is_default = TRUE`, the Manual Invoice page and
 * ERP imports use it as the issuer address unless overridden per-invoice.
 *
 * Endpoints (mounted at /api/admin/branches):
 *   GET          → list all active branches for the caller's org
 *   POST         → create a new branch (optionally set as default)
 *   PATCH /:id   → edit one field or toggle default/active
 *   DELETE /:id  → soft-delete (sets is_active = FALSE)
 */

import { Router, Request, Response } from 'express';
import pg from 'pg';
import { authenticate, blockDemo, logActivity } from '../middleware/auth.js';

const router = Router();

function getPool(req: Request): pg.Pool { return (req as any).app.get('pool'); }

// ── Schema bootstrap ────────────────────────────────────────────────
let schemaReady = false;
async function ensureSchema(pool: pg.Pool): Promise<void> {
    if (schemaReady) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "otaxdb".org_branches (
                id               SERIAL PRIMARY KEY,
                organization_id  INTEGER NOT NULL,
                branch_id        VARCHAR(20) NOT NULL,   -- ETA's branch code, typically numeric
                name             VARCHAR(200),
                country          VARCHAR(10)  DEFAULT 'EG',
                governate        VARCHAR(200),
                region_city      VARCHAR(200),
                street           VARCHAR(500),
                building_number  VARCHAR(50),
                postal_code      VARCHAR(20),
                floor            VARCHAR(50),
                room             VARCHAR(50),
                landmark         VARCHAR(500),
                additional_info  VARCHAR(500),
                is_default       BOOLEAN NOT NULL DEFAULT FALSE,
                is_active        BOOLEAN NOT NULL DEFAULT TRUE,
                created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
            );
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_org_branches_org ON "otaxdb".org_branches(organization_id, is_active);`);
        // One default per org — partial unique index so multiple orgs don't clash.
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_org_branches_default ON "otaxdb".org_branches(organization_id) WHERE is_default = TRUE;`);
        schemaReady = true;
    } catch (e: any) {
        console.warn('[Branches] ensureSchema failed (non-fatal):', e.message);
    }
}

// ── Endpoints ───────────────────────────────────────────────────────

/** GET /api/admin/branches — list. */
router.get('/', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const orgId = (req as any).user?.organizationId;
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const r = await pool.query(
            `SELECT * FROM "otaxdb".org_branches
             WHERE organization_id = $1 AND is_active = TRUE
             ORDER BY is_default DESC, branch_id ASC`,
            [orgId]
        );
        res.json({ success: true, rows: r.rows });
    } catch (err: any) {
        console.error('[Branches] list error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/** POST /api/admin/branches — create. If isDefault=true, clears the previous default in the same tx. */
router.post('/', authenticate, blockDemo, async (req: Request, res: Response) => {
    const pool = getPool(req);
    const client = await pool.connect();
    try {
        await ensureSchema(pool);
        const user = (req as any).user;
        const orgId = user?.organizationId;
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const b = req.body || {};
        const branchId = String(b.branch_id || '').trim();
        if (!branchId) return res.status(400).json({ success: false, message: 'branch_id is required.' });

        await client.query('BEGIN');

        // Unseat any previous default if this row is supposed to be it.
        if (b.is_default) {
            await client.query(
                `UPDATE "otaxdb".org_branches SET is_default = FALSE WHERE organization_id = $1 AND is_default = TRUE`,
                [orgId]
            );
        }

        const r = await client.query(
            `INSERT INTO "otaxdb".org_branches
              (organization_id, branch_id, name, country, governate, region_city, street, building_number,
               postal_code, floor, room, landmark, additional_info, is_default)
             VALUES ($1,$2,$3, $4,$5,$6,$7,$8, $9,$10,$11,$12,$13, $14)
             RETURNING *`,
            [
                orgId, branchId, b.name || null,
                b.country || 'EG', b.governate || null, b.region_city || null, b.street || null, b.building_number || null,
                b.postal_code || null, b.floor || null, b.room || null, b.landmark || null, b.additional_info || null,
                Boolean(b.is_default),
            ]
        );

        await client.query('COMMIT');
        logActivity(user.id, user.username, 'branch_created', 'admin', 'org_branches', String(r.rows[0].id), { branch_id: branchId }, req).catch(() => {});
        res.json({ success: true, branch: r.rows[0] });
    } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[Branches] create error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        client.release();
    }
});

/** PATCH /api/admin/branches/:id — update any subset of fields. */
router.patch('/:id', authenticate, blockDemo, async (req: Request, res: Response) => {
    const pool = getPool(req);
    const client = await pool.connect();
    try {
        await ensureSchema(pool);
        const user = (req as any).user;
        const orgId = user?.organizationId;
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const allowed = ['branch_id','name','country','governate','region_city','street','building_number','postal_code','floor','room','landmark','additional_info','is_default','is_active'];
        const sets: string[] = [];
        const params: any[] = [];
        for (const k of allowed) {
            if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) {
                params.push((req.body as any)[k]);
                sets.push(`${k} = $${params.length}`);
            }
        }
        if (sets.length === 0) return res.status(400).json({ success: false, message: 'Nothing to update' });
        sets.push('updated_at = NOW()');

        await client.query('BEGIN');
        // If we're setting this row to default, unseat the old default first so
        // the unique partial index doesn't complain.
        if (req.body?.is_default === true) {
            await client.query(
                `UPDATE "otaxdb".org_branches SET is_default = FALSE WHERE organization_id = $1 AND id <> $2 AND is_default = TRUE`,
                [orgId, id]
            );
        }
        params.push(id, orgId);
        const r = await client.query(
            `UPDATE "otaxdb".org_branches SET ${sets.join(', ')}
             WHERE id = $${params.length - 1} AND organization_id = $${params.length}
             RETURNING *`,
            params
        );
        await client.query('COMMIT');

        if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'Branch not found.' });
        logActivity(user.id, user.username, 'branch_updated', 'admin', 'org_branches', String(id), { fields: Object.keys(req.body || {}) }, req).catch(() => {});
        res.json({ success: true, branch: r.rows[0] });
    } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[Branches] update error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        client.release();
    }
});

/** DELETE /api/admin/branches/:id — soft delete. */
router.delete('/:id', authenticate, blockDemo, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const user = (req as any).user;
        const orgId = user?.organizationId;
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization context' });

        const r = await pool.query(
            `UPDATE "otaxdb".org_branches
             SET is_active = FALSE, is_default = FALSE, updated_at = NOW()
             WHERE id = $1 AND organization_id = $2 RETURNING id`,
            [id, orgId]
        );
        if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'Branch not found.' });
        logActivity(user.id, user.username, 'branch_deleted', 'admin', 'org_branches', String(id), undefined, req).catch(() => {});
        res.json({ success: true });
    } catch (err: any) {
        console.error('[Branches] delete error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
