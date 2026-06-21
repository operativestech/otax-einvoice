/**
 * secrets — symmetric encryption helper for at-rest secret storage.
 *
 * Used by:
 *   - org_integration_settings.erp_password_encrypted
 *   - org_integration_settings.logdb_password_encrypted
 *   - any future per-org credential we need to round-trip without exposing
 *     the plaintext to the database log files
 *
 * Algorithm: AES-256-GCM
 *   - 32-byte key derived from `SECRETS_ENCRYPTION_KEY` (env), or a
 *     deterministic fallback derived from `JWT_SECRET` so dev environments
 *     don't crash on first boot. Production deployments MUST set the
 *     dedicated env var.
 *   - 12-byte random nonce per ciphertext, prepended to the output
 *   - 16-byte auth tag, prepended after the nonce
 *
 * Wire format (base64-encoded):
 *   v1:<base64(nonce || authTag || ciphertext)>
 *
 * The `v1:` prefix lets us swap algorithms later without ambiguity. Anything
 * without that prefix is assumed to be plaintext (legacy / migration window).
 *
 * SAFETY NOTE: This is at-rest protection only. A compromised process can
 * still read the key. The point is to make a stolen DB dump useless.
 */

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const NONCE_LEN = 12;
const TAG_LEN = 16;
const VERSION_PREFIX = 'v1:';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
    if (cachedKey) return cachedKey;
    const raw = process.env.SECRETS_ENCRYPTION_KEY || process.env.JWT_SECRET || 'dev-secret-do-not-use-in-prod';
    // Always derive 32 bytes via SHA-256 so the input length doesn't matter.
    cachedKey = crypto.createHash('sha256').update(raw, 'utf8').digest();
    return cachedKey;
}

/** Encrypt a UTF-8 string. Empty/nullish input returns null so the caller
 *  can NULL the column instead of storing an empty ciphertext. */
export function encryptSecret(plaintext: string | null | undefined): string | null {
    if (plaintext === null || plaintext === undefined || plaintext === '') return null;
    const nonce = crypto.randomBytes(NONCE_LEN);
    const cipher = crypto.createCipheriv(ALGO, getKey(), nonce);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return VERSION_PREFIX + Buffer.concat([nonce, tag, ct]).toString('base64');
}

/** Decrypt back to UTF-8 string, or null on any failure (corrupt, wrong key,
 *  or a value that was never encrypted in the first place). */
export function decryptSecret(stored: string | null | undefined): string | null {
    if (!stored) return null;
    if (!stored.startsWith(VERSION_PREFIX)) {
        // Legacy / migration: value is plaintext. Return it as-is so the
        // first save after this migration can re-encrypt.
        return stored;
    }
    try {
        const buf = Buffer.from(stored.slice(VERSION_PREFIX.length), 'base64');
        const nonce = buf.subarray(0, NONCE_LEN);
        const tag = buf.subarray(NONCE_LEN, NONCE_LEN + TAG_LEN);
        const ct = buf.subarray(NONCE_LEN + TAG_LEN);
        const decipher = crypto.createDecipheriv(ALGO, getKey(), nonce);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    } catch {
        // Corrupt blob, wrong key, etc. — fail closed.
        return null;
    }
}
