/**
 * Dashboard layout — per-user customisation of which widgets show on the
 * Dashboard page, in what order, and at what size.
 *
 * The layout is a JSON array of `{ id, visible, cols, rows }` entries, keyed
 * by widget id. The frontend ships a fixed catalogue of widget ids; the user
 * can hide widgets, reorder them, and resize them (cols 1-12, rows 1-4) but
 * never invent new ones (we don't run user-supplied SQL).
 *
 * Storage: `portal_users.dashboard_layout JSONB` — auto-added on first call.
 * Per-user (not per-org): two admins on the same org can want different
 * layouts. Falls through to the catalogue's default size + order on first
 * login. `cols` / `rows` are optional in the wire format — missing values
 * snap back to the per-widget natural default.
 */

import { Router, Request, Response } from 'express';
import pg from 'pg';
import { authenticate } from '../middleware/auth.js';

const router = Router();
function getPool(req: Request): pg.Pool { return (req as any).app.get('pool'); }

let schemaReady = false;
async function ensureSchema(pool: pg.Pool): Promise<void> {
    if (schemaReady) return;
    try {
        await pool.query(`
            ALTER TABLE "otaxdb".portal_users
              ADD COLUMN IF NOT EXISTS dashboard_layout JSONB
        `);
        schemaReady = true;
    } catch (e: any) {
        console.warn('[DashboardLayout] ensureSchema:', e.message);
    }
}

// Catalogue of widgets recognised by the frontend. Keeping this list here so
// the backend can validate that no junk slips into the saved layout (and so
// the API can return the catalogue along with the user's layout).
//
// `cols` / `rows` are the natural defaults applied when the user hasn't
// resized a widget — we still store explicit values once they've fiddled.
//   cols: 1..12  (CSS-grid columns at lg+; everything stacks full-width on mobile)
//   rows: 1..4   (multiplier on the widget's intrinsic height; 1 = auto)
const WIDGET_CATALOGUE = [
    { id: 'kpis',          name: 'KPI cards',           desc: 'Top-of-page metric cards driven by /api/dashboard/summary',     cols: 12, rows: 1 },
    { id: 'invoiceVolume', name: 'Invoice volume',      desc: 'Area chart of invoice counts over the selected period',         cols: 8,  rows: 1 },
    { id: 'statusDist',    name: 'Status distribution', desc: 'Donut chart of Valid / Rejected / Submitted percentages',       cols: 4,  rows: 1 },
    { id: 'vatPayable',    name: 'VAT — this month',    desc: 'Output / Input / Net Payable summary card',                     cols: 4,  rows: 1 },
    { id: 'alerts',        name: 'Compliance alerts',   desc: 'Last-24h rejected + late-submission glance',                    cols: 4,  rows: 1 },
    { id: 'topCustomers',  name: 'Top customers',       desc: 'Top 5 customers by total revenue',                              cols: 4,  rows: 1 },
    { id: 'reconciliation',name: 'Reconciliation',      desc: 'Suggested / Accepted matches + ERP / Bank coverage',            cols: 6,  rows: 1 },
    { id: 'signingQueue',  name: 'Signing queue',       desc: 'Queued / Processing / Signed / Failed signing job counts',      cols: 6,  rows: 1 },
] as const;
type WidgetId = typeof WIDGET_CATALOGUE[number]['id'];
const WIDGET_IDS = new Set<WidgetId>(WIDGET_CATALOGUE.map(w => w.id));
const WIDGET_DEFAULTS: Record<WidgetId, { cols: number; rows: number }> = WIDGET_CATALOGUE.reduce(
    (acc, w) => { acc[w.id] = { cols: w.cols, rows: w.rows }; return acc; },
    {} as Record<WidgetId, { cols: number; rows: number }>
);

interface LayoutEntry { id: WidgetId; visible: boolean; cols: number; rows: number }

/** Snap an arbitrary number to an integer in [min, max]. NaN → fallback. */
function clampInt(v: any, min: number, max: number, fallback: number): number {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

/** Coerce arbitrary user input back into the canonical shape. Drops unknown
 *  ids, fills missing widgets with `visible: true` + their default cols/rows,
 *  clamps cols ∈ [1,12] and rows ∈ [1,4], preserves order. */
function normaliseLayout(raw: any): LayoutEntry[] {
    const out: LayoutEntry[] = [];
    const seen = new Set<string>();
    if (Array.isArray(raw)) {
        for (const item of raw) {
            const id = String(item?.id || '');
            if (!WIDGET_IDS.has(id as WidgetId) || seen.has(id)) continue;
            seen.add(id);
            const def = WIDGET_DEFAULTS[id as WidgetId];
            out.push({
                id:      id as WidgetId,
                visible: item?.visible !== false,
                cols:    clampInt(item?.cols, 1, 12, def.cols),
                rows:    clampInt(item?.rows, 1, 4,  def.rows),
            });
        }
    }
    // Append any catalogue widgets the user hasn't ordered yet (visible by default)
    for (const w of WIDGET_CATALOGUE) {
        if (!seen.has(w.id)) out.push({ id: w.id, visible: true, cols: w.cols, rows: w.rows });
    }
    return out;
}

/** GET /api/dashboard/layout — returns the user's saved layout + catalogue.
 *  First-time callers get the default order (everything visible). */
router.get('/', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const r = await pool.query(
            `SELECT dashboard_layout FROM "otaxdb".portal_users WHERE id = $1`, [userId]
        );
        const layout = normaliseLayout(r.rows[0]?.dashboard_layout);
        res.json({ success: true, layout, catalogue: WIDGET_CATALOGUE });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/** PUT /api/dashboard/layout — replace the user's saved layout.
 *  body: { layout: [{ id, visible }, …] } */
router.put('/', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const layout = normaliseLayout(req.body?.layout);
        await pool.query(
            `UPDATE "otaxdb".portal_users SET dashboard_layout = $1::jsonb WHERE id = $2`,
            [JSON.stringify(layout), userId]
        );
        res.json({ success: true, layout });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/** POST /api/dashboard/layout/reset — wipe the user's customisation, fall back
 *  to default order. Convenient when a layout drifts off-screen. */
router.post('/reset', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        await pool.query(
            `UPDATE "otaxdb".portal_users SET dashboard_layout = NULL WHERE id = $1`, [userId]
        );
        const layout = normaliseLayout(null);
        res.json({ success: true, layout });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
