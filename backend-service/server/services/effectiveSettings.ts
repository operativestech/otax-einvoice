/**
 * effectiveSettings — read-side counterpart to settingsRouting.ts.
 *
 * The submit / sign / sync handlers all need to look up properties like
 * "signer_preProdClientSecret" or "issuer_street" without caring which table
 * they live in. Before Phase A-G everything was in `clients_info_new`. After
 * the refactor those values live in `organizations`, `organization_settings`,
 * and `org_integration_settings`, so a naïve `SELECT … FROM clients_info_new`
 * silently misses them and the handler crashes with "Signer configuration
 * missing".
 *
 * This helper returns a single property → value map merged from all four
 * tables, with the new org-scoped tables winning when both contain a value.
 * Callers replace their old `getProp()` factory with one line:
 *
 *   const props = await loadEffectiveSettings(client, userId);
 *   const env   = props.get('signer_environment_type') || 'PreProd';
 *
 * Encrypted columns (erp_password_encrypted, logdb_password_encrypted) are
 * decrypted on the way out so the caller works with cleartext.
 */

import type pg from 'pg';
import { decryptSecret } from './secrets.js';
import {
    ORG_TABLE_FIELDS,
    ORG_SETTINGS_FIELDS,
    ORG_INTEGRATION_FIELDS,
    ENCRYPTED_INTEGRATION_COLUMNS,
} from './settingsRouting.js';

// Reverse maps: column name → property name.
const ORG_COL_TO_PROP = invert(ORG_TABLE_FIELDS);
const ORG_SETTINGS_COL_TO_PROP = invert(ORG_SETTINGS_FIELDS);
const ORG_INTEGRATION_COL_TO_PROP = invert(ORG_INTEGRATION_FIELDS);

function invert(m: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(m)) out[v] = k;
    return out;
}

type Client = pg.Pool | pg.PoolClient;

/**
 * Resolve the user's organization id. Checks portal_users first (new SaaS
 * users) then falls back to the legacy credentials table. Returns null if
 * the user has no org — callers should treat that as "use per-user values
 * only" rather than crashing.
 */
async function resolveOrgId(client: Client, userId: number | string): Promise<number | null> {
    const uid = Number(userId);
    if (isNaN(uid)) return null;
    try {
        const r1 = await client.query<{ organization_id: number | null }>(
            `SELECT organization_id FROM "otaxdb".portal_users WHERE id = $1 LIMIT 1`, [uid]
        );
        if (r1.rows[0]?.organization_id) return r1.rows[0].organization_id;
    } catch { /* table may not exist on older deployments */ }
    try {
        const r2 = await client.query<{ organization_id: number | null }>(
            `SELECT organization_id FROM "otaxdb".credentials WHERE id = $1 LIMIT 1`, [uid]
        );
        return r2.rows[0]?.organization_id || null;
    } catch { return null; }
}

/**
 * Build the effective property bag for a given user. Returns a Map (rather
 * than a plain object) so callers can use `.get(name)` without worrying about
 * prototype pollution from a malicious property_name.
 *
 * Lookup priority (winner):
 *   1. organization_settings        (org-scoped behavior)
 *   2. org_integration_settings     (org-scoped ERP/Log DB, decrypted)
 *   3. organizations                (org-scoped identity / address)
 *   4. clients_info_new             (per-user fallback)
 *
 * The org-scoped tables win because Phase A-G migrated the canonical values
 * out of clients_info_new — leftover rows there are now historical noise.
 */
export async function loadEffectiveSettings(
    client: Client, userId: number | string, scopedOrgId?: number | null
): Promise<Map<string, string>> {
    const out = new Map<string, string>();

    const setIfMissing = (name: string, value: any) => {
        if (value === null || value === undefined || value === '') return;
        if (!out.has(name)) out.set(name, String(value));
    };
    const setOverride = (name: string, value: any) => {
        if (value === null || value === undefined || value === '') return;
        out.set(name, String(value));
    };

    const orgId = scopedOrgId || await resolveOrgId(client, userId);

    // 1. organization_settings — highest priority because it's where Settings.tsx writes.
    if (orgId) {
        try {
            const r = await client.query(
                `SELECT * FROM "otaxdb".organization_settings WHERE organization_id = $1`, [orgId]
            );
            if (r.rows[0]) {
                for (const [col, val] of Object.entries(r.rows[0])) {
                    const propName = ORG_SETTINGS_COL_TO_PROP[col];
                    if (propName) setOverride(propName, val);
                }
            }
        } catch (e: any) { console.warn('[effectiveSettings] organization_settings:', e.message); }

        // 2. org_integration_settings (decrypt secrets on the way out)
        try {
            const r = await client.query(
                `SELECT * FROM "otaxdb".org_integration_settings WHERE organization_id = $1`, [orgId]
            );
            if (r.rows[0]) {
                for (const [col, val] of Object.entries(r.rows[0])) {
                    const propName = ORG_INTEGRATION_COL_TO_PROP[col];
                    if (!propName) continue;
                    if (ENCRYPTED_INTEGRATION_COLUMNS.has(col)) {
                        const plain = decryptSecret(val as string | null);
                        if (plain) setOverride(propName, plain);
                    } else {
                        setOverride(propName, val);
                    }
                }
            }
        } catch (e: any) { console.warn('[effectiveSettings] org_integration_settings:', e.message); }

        // 3. organizations (identity + address)
        try {
            const r = await client.query(
                `SELECT * FROM "otaxdb".organizations WHERE id = $1`, [orgId]
            );
            if (r.rows[0]) {
                for (const [col, val] of Object.entries(r.rows[0])) {
                    const propName = ORG_COL_TO_PROP[col];
                    if (propName) setOverride(propName, val);
                }
            }
        } catch (e: any) { console.warn('[effectiveSettings] organizations:', e.message); }
    }

    // 4. clients_info_new — fallback for unrouted properties (cert thumbprint,
    //    cert PIN, file paths, anything legacy that didn't migrate).
    //
    // Per-user secrets stored encrypted are listed here so the read path
    // decrypts them before handing them to callers (signing flows expect
    // cleartext). Values that don't carry the v1: prefix passthrough as
    // cleartext, which preserves backward compat for installs that haven't
    // yet re-saved their PIN since the encryption rollout.
    const PER_USER_ENCRYPTED = new Set(['signer_CurrentCertPIN']);
    try {
        const r = await client.query(
            `SELECT property_name, property_value FROM "otaxdb".clients_info_new WHERE uid = $1`,
            [Number(userId)]
        );
        for (const row of r.rows) {
            let value = row.property_value;
            if (PER_USER_ENCRYPTED.has(row.property_name) && value) {
                const plain = decryptSecret(value);
                if (plain) value = plain;
            }
            setIfMissing(row.property_name, value);
        }
    } catch (e: any) { console.warn('[effectiveSettings] clients_info_new:', e.message); }

    return out;
}

/** Convenience: return a `getProp(name)` function that reads from the merged
 *  bag with case-insensitive matching, mirroring the legacy helper signature
 *  used throughout server.ts. */
export function makeGetProp(props: Map<string, string>): (name: string) => string | undefined {
    // Pre-build a lowercase index so each lookup stays O(1).
    const lc = new Map<string, string>();
    for (const [k, v] of props) lc.set(k.toLowerCase(), v);
    return (name: string) => lc.get(name.toLowerCase());
}
