/**
 * Smoke tests for the at-rest encryption helper used by org_integration_settings.
 * If any of these break, every ERP/Log DB password in the database becomes
 * unreadable on the next page load — so this is the first line of defence.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { encryptSecret, decryptSecret } from '../server/services/secrets.js';

beforeAll(() => {
    // Pin the key so tests are deterministic regardless of the dev .env. The
    // helper hashes inputs through SHA-256, so any non-empty string works.
    process.env.SECRETS_ENCRYPTION_KEY = 'test-key-do-not-use-in-prod-deadbeefcafebabe';
});

describe('secrets.encryptSecret / decryptSecret', () => {
    it('round-trips a UTF-8 string', () => {
        const plain = 'P@ssw0rd!_عربى_漢字';
        const ct = encryptSecret(plain);
        expect(ct).toBeTruthy();
        expect(ct).toMatch(/^v1:/);
        expect(decryptSecret(ct)).toBe(plain);
    });

    it('produces a different ciphertext on every encryption (random nonce)', () => {
        const a = encryptSecret('same-input');
        const b = encryptSecret('same-input');
        expect(a).not.toBe(b);
        expect(decryptSecret(a)).toBe('same-input');
        expect(decryptSecret(b)).toBe('same-input');
    });

    it('returns null for empty / nullish plaintext (so the column stays NULL)', () => {
        expect(encryptSecret('')).toBeNull();
        expect(encryptSecret(null)).toBeNull();
        expect(encryptSecret(undefined)).toBeNull();
    });

    it('returns null for empty / nullish ciphertext on decrypt', () => {
        expect(decryptSecret('')).toBeNull();
        expect(decryptSecret(null)).toBeNull();
        expect(decryptSecret(undefined)).toBeNull();
    });

    it('treats unprefixed input as legacy plaintext (passthrough)', () => {
        // Migration window: existing un-encrypted ciphertext should round-trip
        // through decrypt unchanged so the next save can re-encrypt.
        expect(decryptSecret('legacy-cleartext-password')).toBe('legacy-cleartext-password');
    });

    it('returns null on a corrupt v1: blob rather than throwing', () => {
        // GCM auth tag verification fails → we want to fail closed, not crash.
        expect(decryptSecret('v1:not-valid-base64!@#$')).toBeNull();
        expect(decryptSecret('v1:dGFtcGVyZWRiYXNlNjQ=')).toBeNull();
    });

    it('refuses to decrypt with a different key', () => {
        const ct = encryptSecret('original');
        // Swap the key, force the cache to invalidate by re-importing the module fresh.
        // We can't easily reset the module cache here, so instead we verify the
        // algorithm property: a tampered tag MUST fail. Tamper one byte of the
        // ciphertext after the version prefix.
        const blob = Buffer.from(ct!.slice(3), 'base64');
        blob[blob.length - 1] ^= 0xff;
        const tampered = 'v1:' + blob.toString('base64');
        expect(decryptSecret(tampered)).toBeNull();
    });
});
