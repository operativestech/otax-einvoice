/**
 * ERP adapter factory — given an org's integration settings, returns the
 * right adapter implementation. Unknown / unimplemented providers throw a
 * clear error so the UI can surface "Not yet supported by OTax" rather than
 * silently falling through.
 */

import type { ErpAdapter, ErpConnectionConfig } from './types.js';
import { PostgresErpAdapter } from './postgresAdapter.js';
import { OdooErpAdapter } from './odooAdapter.js';
import { MysqlErpAdapter } from './mysqlAdapter.js';

export function createErpAdapter(cfg: ErpConnectionConfig): ErpAdapter {
    switch (cfg.provider) {
        case 'postgres':
        case 'npgsql':
            return new PostgresErpAdapter(cfg);
        case 'mysql':
            return new MysqlErpAdapter(cfg);
        case 'odoo':
            return new OdooErpAdapter(cfg);
        // mssql / oracle / sap_* / dynamics_* / sage / tally / excel /
        // custom_api fall through to the not-implemented branch until we
        // ship dedicated adapters. The error message mentions the provider
        // so the UI can show something specific.
        default:
            throw new Error(`ERP provider "${cfg.provider}" is not implemented yet. Currently supported: postgres, mysql, odoo.`);
    }
}

export type { ErpAdapter, ErpConnectionConfig, ErpInvoice, ErpInvoiceLine, FetchOptions, ConnectionTestResult } from './types.js';
