/**
 * Smoke tests for the Settings routing maps and coercion helper.
 *
 * These maps are the single source of truth for "where does each Settings
 * property name belong in the database?" — they're imported by the live save
 * handler in server.ts AND the migration script in scripts/migrate-settings.ts.
 * A drift bug (same key in two maps, missing key, wrong column type) would
 * silently corrupt user settings, so we lock the contracts down here.
 */

import { describe, it, expect } from 'vitest';
import {
    ORG_TABLE_FIELDS,
    ORG_SETTINGS_FIELDS,
    ORG_INTEGRATION_FIELDS,
    SECRET_PROPERTY_NAMES,
    SECRET_PLACEHOLDER,
    ENCRYPTED_INTEGRATION_COLUMNS,
    coerceForColumn,
} from '../server/services/settingsRouting.js';

describe('routing maps disjoint', () => {
    it('no property name appears in more than one routing map', () => {
        const all = [
            ...Object.keys(ORG_TABLE_FIELDS),
            ...Object.keys(ORG_SETTINGS_FIELDS),
            ...Object.keys(ORG_INTEGRATION_FIELDS),
        ];
        const seen = new Set<string>();
        const dupes: string[] = [];
        for (const name of all) {
            if (seen.has(name)) dupes.push(name);
            seen.add(name);
        }
        expect(dupes).toEqual([]);
    });

    it('every secret property maps to a real destination column', () => {
        // The placeholder protocol only fires when the save handler recognises
        // the field. A secret name that isn't routed anywhere would silently
        // leak through to clients_info_new.
        for (const secret of SECRET_PROPERTY_NAMES) {
            // signer_CurrentCertPIN is intentionally per-user (clients_info_new),
            // so we exempt it from the routed-destination assertion.
            if (secret === 'signer_CurrentCertPIN') continue;
            const routed = ORG_SETTINGS_FIELDS[secret] || ORG_INTEGRATION_FIELDS[secret];
            expect(routed, `secret "${secret}" has no routing destination`).toBeTruthy();
        }
    });

    it('every encrypted integration column is referenced by exactly one secret name', () => {
        for (const col of ENCRYPTED_INTEGRATION_COLUMNS) {
            const secrets = Object.entries(ORG_INTEGRATION_FIELDS)
                .filter(([, c]) => c === col)
                .map(([name]) => name);
            expect(secrets.length, `encrypted column "${col}" must be reachable from exactly one property name`).toBe(1);
            expect(SECRET_PROPERTY_NAMES.has(secrets[0])).toBe(true);
        }
    });

    it('placeholder is the same canonical bullet string across the codebase', () => {
        // If this ever changes, update the frontend display + the migration
        // script's "skip if placeholder" branch in lockstep.
        expect(SECRET_PLACEHOLDER).toBe('••••••••');
        expect([...SECRET_PLACEHOLDER].length).toBe(8);
    });
});

describe('coerceForColumn', () => {
    it('returns null for empty / nullish input regardless of column', () => {
        expect(coerceForColumn('export_no_of_days', '')).toBeNull();
        expect(coerceForColumn('export_no_of_days', null)).toBeNull();
        expect(coerceForColumn('export_no_of_days', undefined)).toBeNull();
        expect(coerceForColumn('eta_environment', '')).toBeNull();
    });

    it('coerces stringified booleans for export_auto_/use_/replace_ columns', () => {
        // The HTML form serializer always sends strings, never raw booleans.
        for (const col of ['export_auto_convert_utf8', 'export_use_old_field_names', 'export_replace_date_with_current']) {
            expect(coerceForColumn(col, 'true')).toBe(true);
            expect(coerceForColumn(col, '1')).toBe(true);
            expect(coerceForColumn(col, 'on')).toBe(true);
            expect(coerceForColumn(col, 'yes')).toBe(true);
            expect(coerceForColumn(col, 'false')).toBe(false);
            expect(coerceForColumn(col, '0')).toBe(false);
            // Real booleans pass through too — for tests / direct API callers.
            expect(coerceForColumn(col, true)).toBe(true);
            expect(coerceForColumn(col, false)).toBe(false);
        }
    });

    it('coerces integer columns', () => {
        expect(coerceForColumn('export_no_of_days', '7')).toBe(7);
        expect(coerceForColumn('export_no_of_days', '  30  ')).toBe(30);
        expect(coerceForColumn('export_reduce_hours', '2')).toBe(2);
        // Garbage input → null so the DB never sees NaN
        expect(coerceForColumn('export_no_of_days', 'abc')).toBeNull();
    });

    it('falls through to String() for everything else', () => {
        expect(coerceForColumn('eta_environment', 'PreProd')).toBe('PreProd');
        expect(coerceForColumn('default_language', 'ar')).toBe('ar');
        expect(coerceForColumn('tax_activity_code', 4620)).toBe('4620');
    });
});

describe('routing destinations sanity', () => {
    it('ORG_TABLE_FIELDS only references columns that exist on organizations (manual lock)', () => {
        // We can't query Postgres from a unit test without a fixture DB. Lock
        // the destination column names here so accidental typos surface as a
        // diff in code review, not as a 500 in production.
        const expected = new Set([
            'name', 'tax_id', 'company_type', 'country', 'city', 'region_city',
            'street', 'building_number', 'postal_code', 'floor', 'room',
            'landmark', 'additional_info', 'branch_id',
        ]);
        for (const col of Object.values(ORG_TABLE_FIELDS)) {
            expect(expected.has(col), `${col} not in expected organizations columns`).toBe(true);
        }
    });

    it('ORG_INTEGRATION_FIELDS only references columns that exist on org_integration_settings (manual lock)', () => {
        const expected = new Set([
            'erp_provider', 'erp_host', 'erp_db', 'erp_user', 'erp_password_encrypted',
            'erp_legal_entity', 'erp_doc_type_version', 'erp_header_view', 'erp_lines_view',
            'logdb_mode', 'logdb_provider', 'logdb_host', 'logdb_port', 'logdb_db',
            'logdb_user', 'logdb_password_encrypted',
        ]);
        for (const col of Object.values(ORG_INTEGRATION_FIELDS)) {
            expect(expected.has(col), `${col} not in expected org_integration_settings columns`).toBe(true);
        }
    });
});
