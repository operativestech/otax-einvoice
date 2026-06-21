/**
 * Two-Factor Authentication (TOTP).
 *
 * Adds an optional second factor on top of the existing username/password flow.
 * Users enable it from Settings → Security; the backend stores a base32 secret
 * on `portal_users.totp_secret` and enforces a 6-digit time-based one-time
 * password on login when `totp_enabled = TRUE`.
 *
 * Compatibility: Google Authenticator, Authy, 1Password, Microsoft
 * Authenticator — anything that scans an `otpauth://totp/...` URL.
 *
 * Three endpoints, all caller-authenticated (need a valid JWT first):
 *
 *   POST /api/auth/2fa/setup    — generates a secret + provisioning URL.
 *                                 The user scans the QR; nothing is enabled
 *                                 until they verify a code.
 *   POST /api/auth/2fa/verify   — checks the user's first 6-digit code, and
 *                                 if it matches, sets totp_enabled=TRUE.
 *   POST /api/auth/2fa/disable  — clears the secret + the enabled flag.
 *                                 Requires the current password to prevent a
 *                                 hijacked-session bypass.
 *
 * The actual enforcement during login lives in the login handler — we add a
 * helper here that the auth route can call.
 */

import { Router, Request, Response } from 'express';
import speakeasy from 'speakeasy';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pg from 'pg';
import { authenticate } from '../middleware/auth.js';

const router = Router();

function getPool(req: Request): pg.Pool { return (req as any).app.get('pool'); }

/** Schema bootstrap — auto-add columns on first 2FA call. Idempotent.
 *
 *  Two columns:
 *    - totp_secret  / totp_enabled  → the authenticator-app factor itself
 *    - totp_backup_codes (JSONB)    → SHA-256 hashes of single-use recovery
 *      codes. Stored as an array of `{ hash, used: boolean, used_at? }` so we
 *      can mark them spent without leaking the cleartext.
 */
let schemaReady = false;
async function ensureSchema(pool: pg.Pool): Promise<void> {
    if (schemaReady) return;
    try {
        await pool.query(`
            ALTER TABLE "otaxdb".portal_users
              ADD COLUMN IF NOT EXISTS totp_secret  VARCHAR(64),
              ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE,
              ADD COLUMN IF NOT EXISTS totp_backup_codes JSONB
        `);
        schemaReady = true;
    } catch (e: any) {
        console.warn('[2FA] ensureSchema failed (non-fatal):', e.message);
    }
}

// ─── Backup-code helpers ─────────────────────────────────────────────────
//
// Codes are 10 chars from a 32-letter ambiguity-free alphabet (no 0/O/1/I/L)
// so users can read them off paper. We hash with SHA-256 before storing —
// they're single-use one-shots, so a slow KDF would cost more than it helps.

const BACKUP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 chars (no 0/1/I/O/L)
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LEN = 10;

function generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
        const bytes = crypto.randomBytes(BACKUP_CODE_LEN);
        let s = '';
        for (const b of bytes) s += BACKUP_ALPHABET[b % BACKUP_ALPHABET.length];
        // Hyphenate at midpoint for readability: ABCDE-FGHJK
        codes.push(s.slice(0, 5) + '-' + s.slice(5));
    }
    return codes;
}

function hashBackupCode(code: string): string {
    // Normalise: strip whitespace + hyphens, uppercase. Users routinely paste
    // copies that look slightly different from what we issued.
    const norm = code.replace(/[\s\-]+/g, '').toUpperCase();
    return crypto.createHash('sha256').update(norm).digest('hex');
}

interface StoredBackupCode { hash: string; used: boolean; used_at?: string }

/**
 * Helper used by the login route — checks whether a portal user has 2FA
 * enabled, and if so verifies the given code. Accepts either:
 *   - a 6-digit TOTP from the authenticator app, OR
 *   - a 10-char (XXXXX-XXXXX) backup code, marked spent on first use.
 *
 * Returns:
 *   - { ok: true, usedBackupCode? }  if 2FA is off OR the code is correct
 *   - { ok: false, required: true }  if 2FA is on AND no code was provided
 *   - { ok: false, invalid: true }   if a code was provided but didn't verify
 */
export async function verifyTotpForLogin(
    pool: pg.Pool, userId: number, code?: string
): Promise<{ ok: boolean; required?: boolean; invalid?: boolean; usedBackupCode?: boolean }> {
    try {
        await ensureSchema(pool);
        const r = await pool.query(
            `SELECT totp_secret, totp_enabled, totp_backup_codes FROM "otaxdb".portal_users WHERE id = $1 LIMIT 1`,
            [userId]
        );
        const row = r.rows[0];
        if (!row || !row.totp_enabled || !row.totp_secret) return { ok: true };  // 2FA not configured → allow

        if (!code) return { ok: false, required: true };
        const trimmed = String(code).trim();

        // Backup code path — distinguishes by length / format. We accept the
        // canonical XXXXX-XXXXX form and the un-hyphenated XXXXXXXXXX form.
        const looksLikeBackup = /^[A-Za-z0-9\-]{10,12}$/.test(trimmed) && !/^\d{6}$/.test(trimmed);
        if (looksLikeBackup) {
            const stored: StoredBackupCode[] = Array.isArray(row.totp_backup_codes) ? row.totp_backup_codes : [];
            const incomingHash = hashBackupCode(trimmed);
            const idx = stored.findIndex(c => c && !c.used && c.hash === incomingHash);
            if (idx === -1) return { ok: false, invalid: true };
            // Mark spent — single-use semantics. Best-effort write; on failure
            // we still report success so a flaky DB doesn't lock the user out
            // mid-recovery, but the same code WILL work again on retry which
            // is a known soft trade-off.
            stored[idx].used = true;
            stored[idx].used_at = new Date().toISOString();
            await pool.query(
                `UPDATE "otaxdb".portal_users SET totp_backup_codes = $1::jsonb WHERE id = $2`,
                [JSON.stringify(stored), userId]
            ).catch(e => console.warn('[2FA] failed to mark backup code spent:', e.message));
            return { ok: true, usedBackupCode: true };
        }

        // TOTP path — strict 6 digits.
        if (!/^\d{6}$/.test(trimmed)) return { ok: false, required: true };
        const valid = speakeasy.totp.verify({
            secret: row.totp_secret,
            encoding: 'base32',
            token: trimmed,
            window: 1,   // accept codes from ±30s for clock-drift tolerance
        });
        return valid ? { ok: true } : { ok: false, invalid: true };
    } catch (e: any) {
        console.warn('[2FA] verifyTotpForLogin error:', e.message);
        return { ok: true };  // fail-open on infrastructure errors so users aren't locked out
    }
}

/** GET /api/auth/2fa/status — does this user have 2FA enabled? */
router.get('/status', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const userId = (req as any).user?.id;
        const r = await pool.query(
            `SELECT totp_enabled FROM "otaxdb".portal_users WHERE id = $1 LIMIT 1`,
            [userId]
        );
        res.json({ success: true, enabled: r.rows[0]?.totp_enabled === true });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/** POST /api/auth/2fa/setup — generate a fresh secret + provisioning URL. */
router.post('/setup', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const user = (req as any).user;

        // Generate a new secret. Issuer + label show up in the authenticator app.
        const secret = speakeasy.generateSecret({
            name: `OTax (${user.username || user.email || `User ${user.id}`})`,
            issuer: 'OTax Platform',
            length: 20,
        });

        // Persist the secret so the user's NEXT verify call can match it.
        // We don't enable yet — that flips on after a successful verify.
        await pool.query(
            `UPDATE "otaxdb".portal_users SET totp_secret = $1, totp_enabled = FALSE WHERE id = $2`,
            [secret.base32, user.id]
        );

        res.json({
            success: true,
            secret: secret.base32,           // shown to user as backup
            otpauthUrl: secret.otpauth_url,  // QR-encoded
        });
    } catch (err: any) {
        console.error('[2FA] setup error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/** POST /api/auth/2fa/verify — check user's first code, enable 2FA on success.
 *  Also issues an initial set of backup codes and returns them ONCE in the
 *  response body. The cleartext is never persisted; subsequent calls to
 *  /backup-codes (regenerate) will mint a fresh batch. */
router.post('/verify', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const user = (req as any).user;
        const code = String(req.body?.code || '').trim();
        if (!/^\d{6}$/.test(code)) return res.status(400).json({ success: false, message: '6-digit code required.' });

        const r = await pool.query(`SELECT totp_secret FROM "otaxdb".portal_users WHERE id = $1`, [user.id]);
        const secret = r.rows[0]?.totp_secret;
        if (!secret) return res.status(400).json({ success: false, message: 'Run /setup first to generate a secret.' });

        const valid = speakeasy.totp.verify({
            secret, encoding: 'base32', token: code, window: 1,
        });
        if (!valid) return res.status(401).json({ success: false, message: 'Invalid code. Check your authenticator app.' });

        // Generate the first batch of backup codes alongside enrolment.
        const cleartextCodes = generateBackupCodes();
        const stored: StoredBackupCode[] = cleartextCodes.map(c => ({ hash: hashBackupCode(c), used: false }));
        await pool.query(
            `UPDATE "otaxdb".portal_users SET totp_enabled = TRUE, totp_backup_codes = $1::jsonb WHERE id = $2`,
            [JSON.stringify(stored), user.id]
        );
        res.json({ success: true, backupCodes: cleartextCodes });
    } catch (err: any) {
        console.error('[2FA] verify error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/** POST /api/auth/2fa/backup-codes — regenerate. Invalidates the old set;
 *  the new batch is returned ONCE in the response body. Requires the current
 *  password (same defence-in-depth as /disable). */
router.post('/backup-codes', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const user = (req as any).user;
        const password = String(req.body?.password || '');
        if (!password) return res.status(400).json({ success: false, message: 'Current password required.' });

        const r = await pool.query(`SELECT password, totp_enabled FROM "otaxdb".portal_users WHERE id = $1`, [user.id]);
        const row = r.rows[0];
        if (!row?.totp_enabled) return res.status(400).json({ success: false, message: 'Enable 2FA first.' });
        if (!row.password || !(await bcrypt.compare(password, row.password))) {
            return res.status(401).json({ success: false, message: 'Wrong password.' });
        }

        const cleartextCodes = generateBackupCodes();
        const stored: StoredBackupCode[] = cleartextCodes.map(c => ({ hash: hashBackupCode(c), used: false }));
        await pool.query(
            `UPDATE "otaxdb".portal_users SET totp_backup_codes = $1::jsonb WHERE id = $2`,
            [JSON.stringify(stored), user.id]
        );
        res.json({ success: true, backupCodes: cleartextCodes });
    } catch (err: any) {
        console.error('[2FA] backup-codes error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/** GET /api/auth/2fa/backup-codes/status — count remaining unused codes.
 *  Doesn't reveal the codes themselves, just the count so the UI can warn
 *  the user when they're running low. */
router.get('/backup-codes/status', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const user = (req as any).user;
        const r = await pool.query(`SELECT totp_backup_codes FROM "otaxdb".portal_users WHERE id = $1`, [user.id]);
        const stored: StoredBackupCode[] = Array.isArray(r.rows[0]?.totp_backup_codes) ? r.rows[0].totp_backup_codes : [];
        const total = stored.length;
        const remaining = stored.filter(c => c && !c.used).length;
        res.json({ success: true, total, remaining });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/** POST /api/auth/2fa/disable — turn 2FA off. Requires the current password. */
router.post('/disable', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = getPool(req);
        await ensureSchema(pool);
        const user = (req as any).user;
        const password = String(req.body?.password || '');
        if (!password) return res.status(400).json({ success: false, message: 'Current password required.' });

        // Re-verify the password so a stolen JWT can't disable 2FA on its own.
        const r = await pool.query(`SELECT password FROM "otaxdb".portal_users WHERE id = $1`, [user.id]);
        const hash = r.rows[0]?.password;
        if (!hash || !(await bcrypt.compare(password, hash))) {
            return res.status(401).json({ success: false, message: 'Wrong password.' });
        }

        await pool.query(
            `UPDATE "otaxdb".portal_users SET totp_secret = NULL, totp_enabled = FALSE, totp_backup_codes = NULL WHERE id = $1`,
            [user.id]
        );
        res.json({ success: true });
    } catch (err: any) {
        console.error('[2FA] disable error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
