/**
 * Notifications feed routes — power the bell dropdown in the TopBar.
 *
 * Mounted at `/api/notifications`:
 *
 *   GET  /            → recent rows for the caller + unread count
 *   POST /:id/read    → mark one as read
 *   POST /read-all    → mark every unread as read
 *
 * Auth: every endpoint requires `authenticate`. The bell only ever shows
 * what was recorded for the caller's user_id — `recordOrgNotification`
 * already fans out one row per user, so per-user reads are sufficient.
 */

import { Router, Request, Response } from 'express';
import pg from 'pg';
import { authenticate } from '../middleware/auth.js';
import {
    listNotifications,
    markRead,
    markAllRead,
} from '../services/notificationsFeed.js';

const router = Router();
function getPool(req: Request): pg.Pool { return (req as any).app.get('pool'); }

router.get('/', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = Number((req as any).user?.id);
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const limit = Math.max(1, Math.min(parseInt(String(req.query.limit || 30)) || 30, 100));
        const before = req.query.before ? String(req.query.before) : undefined;
        const data = await listNotifications(getPool(req), userId, { limit, before });
        res.json({ success: true, ...data });
    } catch (err: any) {
        // Soft-fail: the bell is informational, never break the page
        // because the notifications table had a hiccup.
        console.warn('[NotifFeed] GET / failed:', err.message);
        res.json({ success: true, rows: [], unread: 0 });
    }
});

router.post('/:id/read', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = Number((req as any).user?.id);
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const id = parseInt(String(req.params.id), 10);
        if (!id) return res.status(400).json({ success: false, message: 'Bad id' });
        await markRead(getPool(req), userId, id);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/read-all', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = Number((req as any).user?.id);
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const updated = await markAllRead(getPool(req), userId);
        res.json({ success: true, updated });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
