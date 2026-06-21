/**
 * settingsRouting — single source of truth for "where does each Settings
 * property name belong in the database?"
 *
 * Both `POST /api/settings/save` and the standalone migration script in
 * `scripts/migrate-settings.ts` import from here. Adding a new setting?
 * Add it to exactly ONE map below and the save / load / migration paths
 * pick it up automatically.
 */

// property_name → organizations.<column>  (org-scoped identity + address)
export const ORG_TABLE_FIELDS: Record<string, string> = {
    'issuer_name':           'name',
    'issuer_id':             'tax_id',
    'user_type':             'company_type',
    'issuer_country':        'country',
    'issuer_governorate':    'city',
    'issuer_regionCity':     'region_city',
    'issuer_street':         'street',
    'issuer_buildingNumber': 'building_number',
    'issuer_postalCode':     'postal_code',
    'issuer_floor':          'floor',
    'issuer_room':           'room',
    'issuer_landmark':       'landmark',
    'issuer_additionalInfo': 'additional_info',
    'issuer_branchId':       'branch_id',
};

// property_name → organization_settings.<column>  (org-scoped behavior toggles)
export const ORG_SETTINGS_FIELDS: Record<string, string> = {
    'signer_environment_type':       'eta_environment',
    'signer_preProdClientId':        'eta_preprod_client_id',
    'signer_preProdClientSecret':    'eta_preprod_client_secret',
    'signer_prodClientId':           'eta_prod_client_id',
    'signer_prodClientSecret':       'eta_prod_client_secret',
    'eta_submit_format':             'eta_submit_format',
    'tax_payer_activity_code':       'tax_activity_code',
    'user_language':                 'default_language',
    'dateTimeIssued_Format':         'export_date_format',
    'export_autoConvertUtf8':        'export_auto_convert_utf8',
    'export_useOldFieldNames':       'export_use_old_field_names',
    'export_noOfDays':               'export_no_of_days',
    'export_replaceDateWithCurrent': 'export_replace_date_with_current',
    'export_reduceHours':            'export_reduce_hours',
};

// property_name → org_integration_settings.<column>  (encrypted column for *_password_encrypted)
export const ORG_INTEGRATION_FIELDS: Record<string, string> = {
    'selected_erp':                          'erp_provider',
    'invoices_Server':                       'erp_host',
    'invoices_ServerDB':                     'erp_db',
    'invoices_ServerUID':                    'erp_user',
    'invoices_ServerPWD':                    'erp_password_encrypted',
    'legal_Entity':                          'erp_legal_entity',
    'xml_Auto_Export_documentTypeVersion':   'erp_doc_type_version',
    'erp_headerView':                        'erp_header_view',
    'erp_linesView':                         'erp_lines_view',
    'logdb_mode':                            'logdb_mode',
    'log_ServerProvider':                    'logdb_provider',
    'log_ServerHost':                        'logdb_host',
    'log_ServerPort':                        'logdb_port',
    'log_ServerDB':                          'logdb_db',
    'log_ServerUser':                        'logdb_user',
    'log_ServerPass':                        'logdb_password_encrypted',
};

// Property names whose value is a secret. On LOAD we hide the cleartext from
// the client by returning a sentinel; on SAVE the same sentinel tells us "the
// user didn't touch this field — preserve the existing value." Includes both
// org-scoped secrets (in ORG_SETTINGS_FIELDS / ORG_INTEGRATION_FIELDS) and the
// per-user `signer_CurrentCertPIN` stored in clients_info_new.
export const SECRET_PROPERTY_NAMES = new Set([
    'signer_preProdClientSecret',
    'signer_prodClientSecret',
    'invoices_ServerPWD',
    'log_ServerPass',
    'signer_CurrentCertPIN',
]);

export const SECRET_PLACEHOLDER = '••••••••';

// Columns inside the routing maps that must be encrypted at rest.
export const ENCRYPTED_INTEGRATION_COLUMNS = new Set([
    'erp_password_encrypted',
    'logdb_password_encrypted',
]);

/** Coerce a (typically stringified) form value into the right runtime type
 *  for the typed columns in `organization_settings`. */
export function coerceForColumn(col: string, raw: any): any {
    if (raw === null || raw === undefined || raw === '') return null;
    if (col.startsWith('export_auto_') || col.startsWith('export_use_') || col.startsWith('export_replace_')) {
        if (typeof raw === 'boolean') return raw;
        const s = String(raw).toLowerCase();
        return s === 'true' || s === '1' || s === 'yes' || s === 'on';
    }
    if (col === 'export_no_of_days' || col === 'export_reduce_hours') {
        const n = parseInt(String(raw), 10);
        return isNaN(n) ? null : n;
    }
    return String(raw);
}
