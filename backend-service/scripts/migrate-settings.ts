/**
 * migrate-settings — one-time backfill of legacy per-user Settings rows into
 * the org-scoped tables introduced by Phase A/B/D.
 *
 * Why we need it:
 *   Before Phase A, every Settings field landed in `clients_info_new` keyed by
 *   `userId`. Even fields that should logically be per-organization (company
 *   address, ETA creds, ERP config) were stored once per user. Phase A/B/D
 *   moved them to `organizations`, `organization_settings`, and
 *   `org_integration_settings`. The save handler does the routing on every
 *   subsequent save, but until a user actually clicks Save the new tables
 *   stay empty.
 *
 *   This script walks the existing `clients_info_new` rows and copies the
 *   org-routed values into the right destination table — so every admin in
 *   an org sees the same settings on first login, even before anyone re-saves.
 *
 * Behaviour:
 *   - Idempotent. Running it twice is a no-op.
 *   - Non-destructive. The original `clients_info_new` rows are LEFT IN PLACE
 *     so a rollback is just "stop using the new tables and trust the load
 *     fallback." Once verified you can drop them with the SQL at the bottom
 *     of this file (kept as a comment, never executed).
 *   - Picks the most-recently-modified row per (orgId, property_name) when a
 *     property exists for multiple users in the same org. Newest wins.
 *   - Encrypts secrets (ERP/Log DB password) on the way in using the same
 *     `encryptSecret` helper the runtime save handler uses.
 *   - Skips secret values that look like placeholder bullets — that means a
 *     previous user already round-tripped the placeholder protocol and the
 *     real secret is gone.
 *
 * Usage:
 *   cd backend-service
 *   npx tsx scripts/migrate-settings.ts            # dry-run by default
 *   npx tsx scripts/migrate-settings.ts --apply    # actually write
 *
 * Safe to run on a live database; the destination tables are upserted by
 * `organization_id` so concurrent writes from the live save handler don't
 * collide.
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { encryptSecret } from '../server/services/secrets.js';
import {
    ORG_TABLE_FIELDS,
    ORG_SETTINGS_FIELDS,
    ORG_INTEGRATION_FIELDS,
    SECRET_PROPERTY_NAMES,
    SECRET_PLACEHOLDER,
    ENCRYPTED_INTEGRATION_COLUMNS,
    coerceForColumn,
} from '../server/services/settingsRouting.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');

const pool = new pg.Pool({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASS,
});

/** Apply the lazy ALTER TABLE statements upfront so we don't depend on the
 *  server having been started. Mirrors `ensureSettingsSchema` in server.ts —
 *  keep them in sync. */
async function ensureSchema(client: pg.PoolClient): Promise<void> {
    await client.query(`
        ALTER TABLE "otaxdb".organizations
          ADD COLUMN IF NOT EXISTS street VARCHAR(500),
          ADD COLUMN IF NOT EXISTS building_number VARCHAR(50),
          ADD COLUMN IF NOT EXISTS postal_code VARCHAR(50),
          ADD COLUMN IF NOT EXISTS floor VARCHAR(50),
          ADD COLUMN IF NOT EXISTS room VARCHAR(50),
          ADD COLUMN IF NOT EXISTS landmark VARCHAR(500),
          ADD COLUMN IF NOT EXISTS additional_info TEXT,
          ADD COLUMN IF NOT EXISTS region_city VARCHAR(255),
          ADD COLUMN IF NOT EXISTS branch_id VARCHAR(50),
          ADD COLUMN IF NOT EXISTS logo_url TEXT
    `);
    await client.query(`
        ALTER TABLE "otaxdb".organization_settings
          ADD COLUMN IF NOT EXISTS export_date_format VARCHAR(50),
          ADD COLUMN IF NOT EXISTS export_auto_convert_utf8 BOOLEAN,
          ADD COLUMN IF NOT EXISTS export_use_old_field_names BOOLEAN,
          ADD COLUMN IF NOT EXISTS export_no_of_days INTEGER,
          ADD COLUMN IF NOT EXISTS export_replace_date_with_current BOOLEAN,
          ADD COLUMN IF NOT EXISTS export_reduce_hours INTEGER,
          ADD COLUMN IF NOT EXISTS default_language VARCHAR(10),
          ADD COLUMN IF NOT EXISTS tax_activity_code VARCHAR(50)
    `);
    await client.query(`
        CREATE TABLE IF NOT EXISTS "otaxdb".org_integration_settings (
            organization_id        INTEGER PRIMARY KEY,
            erp_provider           VARCHAR(50),
            erp_host               VARCHAR(500),
            erp_db                 VARCHAR(255),
            erp_user               VARCHAR(255),
            erp_password_encrypted TEXT,
            erp_legal_entity       VARCHAR(100),
            erp_doc_type_version   VARCHAR(20),
            erp_header_view        VARCHAR(255),
            erp_lines_view         VARCHAR(255),
            logdb_mode             VARCHAR(20),
            logdb_provider         VARCHAR(50),
            logdb_host             VARCHAR(500),
            logdb_port             VARCHAR(20),
            logdb_db               VARCHAR(255),
            logdb_user             VARCHAR(255),
            logdb_password_encrypted TEXT,
            updated_at             TIMESTAMP DEFAULT NOW()
        )
    `);
}

interface Row { uid: number; property_name: string; property_value: string; modify_date: Date }

/** Build a map: orgId -> propertyName -> value (newest wins). Walks every
 *  legacy row, joining on the user's organization_id from portal_users or
 *  credentials. Users with no org are skipped (their data stays per-user). */
async function collectByOrg(client: pg.PoolClient, allowedNames: Set<string>): Promise<Map<number, Map<string, Row>>> {
    const namesArr = Array.from(allowedNames);
    const result = new Map<number, Map<string, Row>>();

    // Pull every user's org id from both auth tables. Some rows may exist in
    // one and not the other (legacy upgrade), so we union the lookups.
    const userOrgRows = await client.query<{ uid: number; organization_id: number | null }>(`
        SELECT id::int AS uid, organization_id::int AS organization_id FROM "otaxdb".portal_users
        UNION
        SELECT id::int AS uid, organization_id::int AS organization_id FROM "otaxdb".credentials
    `);
    const userToOrg = new Map<number, number>();
    for (const r of userOrgRows.rows) {
        if (r.organization_id) userToOrg.set(r.uid, r.organization_id);
    }

    const ciRows = await client.query<Row>(
        `SELECT uid::int AS uid, property_name, property_value, modify_date
         FROM "otaxdb".clients_info_new
         WHERE property_name = ANY($1::text[])`,
        [namesArr]
    );

    for (const row of ciRows.rows) {
        const orgId = userToOrg.get(row.uid);
        if (!orgId) continue;
        if (!result.has(orgId)) result.set(orgId, new Map());
        const bag = result.get(orgId)!;
        const prev = bag.get(row.property_name);
        // Keep the newest non-empty value
        const nonEmpty = row.property_value !== null && row.property_value !== '';
        if (!nonEmpty) continue;
        if (!prev || (row.modify_date && (!prev.modify_date || row.modify_date > prev.modify_date))) {
            bag.set(row.property_name, row);
        }
    }
    return result;
}

/** Generic upsert helper: insert if missing, otherwise UPDATE only the columns
 *  whose destination value is currently NULL. We never overwrite a value the
 *  live save handler may have written since the cutover.
 *
 *  `keyCol` is the column we look the row up by — `id` for `organizations`
 *  (which is the canonical org row, never inserted by us) and
 *  `organization_id` for the satellite tables. */
async function upsertOrgScopedRow(
    client: pg.PoolClient,
    table: string,
    keyCol: string,
    orgId: number,
    cols: Record<string, any>,
    extraInsertCols: Record<string, any> = {}
): Promise<{ inserted: boolean; updatedCols: string[] }> {
    if (Object.keys(cols).length === 0) return { inserted: false, updatedCols: [] };

    const exists = await client.query(`SELECT * FROM "otaxdb".${table} WHERE ${keyCol} = $1`, [orgId]);
    if (exists.rowCount === 0) {
        // For `organizations` we never insert — the row is created at signup.
        // If we somehow get here, skip rather than synthesise a half-built org.
        if (table === 'organizations') return { inserted: false, updatedCols: [] };

        const allCols = [keyCol, ...Object.keys(cols), ...Object.keys(extraInsertCols)];
        const allVals = [orgId, ...Object.values(cols), ...Object.values(extraInsertCols)];
        const placeholders = allVals.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(
            `INSERT INTO "otaxdb".${table} (${allCols.join(', ')}) VALUES (${placeholders})`,
            allVals
        );
        return { inserted: true, updatedCols: Object.keys(cols) };
    }

    // Only fill columns that are currently NULL — preserve anything the live
    // save handler may have written since cutover.
    const current = exists.rows[0];
    const toUpdate: Record<string, any> = {};
    for (const [c, v] of Object.entries(cols)) {
        if (current[c] === null || current[c] === undefined) toUpdate[c] = v;
    }
    if (Object.keys(toUpdate).length === 0) return { inserted: false, updatedCols: [] };

    const setClauses = Object.keys(toUpdate).map((c, i) => `${c} = $${i + 2}`).join(', ');
    await client.query(
        `UPDATE "otaxdb".${table} SET ${setClauses} WHERE ${keyCol} = $1`,
        [orgId, ...Object.values(toUpdate)]
    );
    return { inserted: false, updatedCols: Object.keys(toUpdate) };
}

async function main(): Promise<void> {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Settings migration — clients_info_new → org-scoped tables');
    console.log(`  Mode: ${APPLY ? 'APPLY (writes will be committed)' : 'DRY-RUN (no writes)'}`);
    console.log('═══════════════════════════════════════════════════════\n');

    const client = await pool.connect();
    try {
        // Schema bootstrap runs outside any transaction — these statements are
        // idempotent (IF NOT EXISTS) and we want them applied regardless of
        // whether this is a dry-run, otherwise the dry-run can't read from
        // org_integration_settings to compare against existing values.
        await ensureSchema(client);

        // The dry-run still opens a normal transaction (not READ ONLY) so the
        // UPDATE/INSERT statements actually execute and we see what they would
        // do — we just ROLLBACK at the end. READ ONLY would refuse the writes
        // outright and we'd never reach the summary.
        await client.query('BEGIN');

        const allRoutedNames = new Set([
            ...Object.keys(ORG_TABLE_FIELDS),
            ...Object.keys(ORG_SETTINGS_FIELDS),
            ...Object.keys(ORG_INTEGRATION_FIELDS),
        ]);
        const byOrg = await collectByOrg(client, allRoutedNames);

        if (byOrg.size === 0) {
            console.log('Nothing to migrate — clients_info_new has no rows for routed property names.');
            await client.query('ROLLBACK');
            return;
        }

        let totalRows = 0;
        let totalInserts = 0;
        let totalUpdates = 0;
        let totalSkipped = 0;
        let totalSecretsEncrypted = 0;
        let totalSecretsSkipped = 0;

        for (const [orgId, bag] of byOrg) {
            const orgUpdates: Record<string, any> = {};
            const settingsUpdates: Record<string, any> = {};
            const integrationUpdates: Record<string, any> = {};

            for (const [propName, row] of bag) {
                totalRows++;
                const value = row.property_value;

                // Secrets: skip if the user already round-tripped the placeholder
                // (the real value is gone) so we don't write the literal bullets.
                if (SECRET_PROPERTY_NAMES.has(propName) && value === SECRET_PLACEHOLDER) {
                    totalSecretsSkipped++;
                    continue;
                }

                const orgCol = ORG_TABLE_FIELDS[propName];
                if (orgCol) { orgUpdates[orgCol] = value; continue; }

                const settingsCol = ORG_SETTINGS_FIELDS[propName];
                if (settingsCol) { settingsUpdates[settingsCol] = coerceForColumn(settingsCol, value); continue; }

                const integrationCol = ORG_INTEGRATION_FIELDS[propName];
                if (integrationCol) {
                    if (ENCRYPTED_INTEGRATION_COLUMNS.has(integrationCol)) {
                        if (value === '' || value === null) continue;
                        integrationUpdates[integrationCol] = encryptSecret(value);
                        totalSecretsEncrypted++;
                    } else {
                        integrationUpdates[integrationCol] = value;
                    }
                    continue;
                }
                totalSkipped++;
            }

            const orgRes      = await upsertOrgScopedRow(client, 'organizations',             'id',              orgId, orgUpdates);
            const settingsRes = await upsertOrgScopedRow(client, 'organization_settings',    'organization_id', orgId, settingsUpdates,    { updated_at: new Date() });
            const integrRes   = await upsertOrgScopedRow(client, 'org_integration_settings', 'organization_id', orgId, integrationUpdates, { updated_at: new Date() });

            const before = totalInserts + totalUpdates;
            if (orgRes.inserted) totalInserts++;
            else if (orgRes.updatedCols.length) totalUpdates++;
            if (settingsRes.inserted) totalInserts++;
            else if (settingsRes.updatedCols.length) totalUpdates++;
            if (integrRes.inserted) totalInserts++;
            else if (integrRes.updatedCols.length) totalUpdates++;

            const touched = totalInserts + totalUpdates - before;
            if (touched > 0 || orgRes.updatedCols.length || settingsRes.updatedCols.length || integrRes.updatedCols.length) {
                console.log(`  org ${orgId}: organizations[${orgRes.updatedCols.join(',') || '-'}]  settings[${settingsRes.updatedCols.join(',') || '-'}]  integration[${integrRes.updatedCols.join(',') || '-'}]`);
            }
        }

        console.log('\n─── Summary ───');
        console.log(`  Orgs processed:        ${byOrg.size}`);
        console.log(`  Source rows examined:  ${totalRows}`);
        console.log(`  New rows inserted:     ${totalInserts}`);
        console.log(`  Existing rows updated: ${totalUpdates}`);
        console.log(`  Secrets encrypted:     ${totalSecretsEncrypted}`);
        console.log(`  Placeholder skipped:   ${totalSecretsSkipped}`);
        console.log(`  Unrouted skipped:      ${totalSkipped}`);

        if (APPLY) {
            await client.query('COMMIT');
            console.log('\n✅ Committed.');
        } else {
            await client.query('ROLLBACK');
            console.log('\n👀 Dry-run only — no changes written. Re-run with --apply to commit.');
        }
    } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('❌ Migration failed:', err.message);
        if (err.stack) console.error(err.stack);
        if (err.detail) console.error('detail:', err.detail);
        if (err.position) console.error('position:', err.position);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

main();

// ─── Optional cleanup, do NOT run until you've verified at least one full
//     login cycle on the new tables. Once you're sure the new save/load is
//     working end-to-end, drop the legacy rows so the load merge stops
//     paying the per-user lookup cost:
//
//   DELETE FROM "otaxdb".clients_info_new
//   WHERE property_name = ANY (ARRAY[
//     'issuer_name','issuer_id','user_type','issuer_country','issuer_governorate',
//     'issuer_regionCity','issuer_street','issuer_buildingNumber','issuer_postalCode',
//     'issuer_floor','issuer_room','issuer_landmark','issuer_additionalInfo',
//     'issuer_branchId','signer_environment_type','signer_preProdClientId',
//     'signer_preProdClientSecret','signer_prodClientId','signer_prodClientSecret',
//     'eta_submit_format','tax_payer_activity_code','user_language',
//     'dateTimeIssued_Format','export_autoConvertUtf8','export_useOldFieldNames',
//     'export_noOfDays','export_replaceDateWithCurrent','export_reduceHours',
//     'selected_erp','invoices_Server','invoices_ServerDB','invoices_ServerUID',
//     'invoices_ServerPWD','legal_Entity','xml_Auto_Export_documentTypeVersion',
//     'erp_headerView','erp_linesView','logdb_mode','log_ServerProvider',
//     'log_ServerHost','log_ServerPort','log_ServerDB','log_ServerUser','log_ServerPass'
//   ]);
