/**
 * Smoke tests for the ERP adapter contract — factory routing + identifier
 * sanitisation. We don't try to spin up a real Postgres / Odoo here (those
 * are integration tests); instead we lock down the parts of the framework
 * that don't need a network: factory dispatch, error messages, and the
 * SQL-injection guard on user-supplied table names.
 */

import { describe, it, expect } from 'vitest';
import { createErpAdapter, type ErpConnectionConfig } from '../server/services/erp/index.js';
import { PostgresErpAdapter } from '../server/services/erp/postgresAdapter.js';
import { OdooErpAdapter } from '../server/services/erp/odooAdapter.js';
import { MysqlErpAdapter } from '../server/services/erp/mysqlAdapter.js';

function cfg(overrides: Partial<ErpConnectionConfig> = {}): ErpConnectionConfig {
    return {
        provider: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'test',
        user: 'u',
        password: 'p',
        legalEntity: null,
        docTypeVersion: '0.9',
        headerView: 'invoices',
        linesView: 'invoice_lines',
        ...overrides,
    };
}

describe('createErpAdapter — factory routing', () => {
    it('routes provider=postgres to PostgresErpAdapter', () => {
        const a = createErpAdapter(cfg({ provider: 'postgres' }));
        expect(a).toBeInstanceOf(PostgresErpAdapter);
        expect(a.provider).toBe('postgres');
    });

    it('routes provider=npgsql to PostgresErpAdapter (same engine)', () => {
        const a = createErpAdapter(cfg({ provider: 'npgsql' }));
        expect(a).toBeInstanceOf(PostgresErpAdapter);
    });

    it('routes provider=odoo to OdooErpAdapter', () => {
        const a = createErpAdapter(cfg({ provider: 'odoo', host: 'https://erp.example.com' }));
        expect(a).toBeInstanceOf(OdooErpAdapter);
        expect(a.provider).toBe('odoo');
    });

    it('routes provider=mysql to MysqlErpAdapter', () => {
        const a = createErpAdapter(cfg({ provider: 'mysql' }));
        expect(a).toBeInstanceOf(MysqlErpAdapter);
        expect(a.provider).toBe('mysql');
    });

    it('throws a descriptive error for unsupported providers', () => {
        for (const p of ['mssql', 'oracle', 'sap_b1', 'dynamics_bc', 'sage', 'tally', 'excel', 'custom_api'] as const) {
            expect(() => createErpAdapter(cfg({ provider: p })))
                .toThrowError(/not implemented yet/);
        }
    });
});

describe('PostgresErpAdapter — SQL-injection guard', () => {
    it('rejects table names with semicolons', async () => {
        const a = new PostgresErpAdapter(cfg({ headerView: 'invoices; DROP TABLE customers;' }));
        await expect(a.fetchInvoices({ limit: 1 })).rejects.toThrow(/Invalid identifier/);
    });

    it('rejects table names with quotes / spaces / SQL keywords', async () => {
        for (const bad of ['inv oices', `"invoices"`, 'invoices--', 'invoices/*x*/', 'invoices)'])  {
            const a = new PostgresErpAdapter(cfg({ headerView: bad }));
            await expect(a.fetchInvoices({ limit: 1 })).rejects.toThrow(/Invalid identifier/);
        }
    });

    it('accepts a plain identifier', async () => {
        // We can't actually fetch (no DB) but the identifier validation runs
        // before the network call. So this should NOT throw "Invalid
        // identifier" — it'll throw a connection error instead, which we
        // don't assert on here.
        const a = new PostgresErpAdapter(cfg({ headerView: 'erp_invoices' }));
        await expect(a.fetchInvoices({ limit: 1 })).rejects.toThrow();
        await expect(a.fetchInvoices({ limit: 1 })).rejects.not.toThrow(/Invalid identifier/);
        await a.close();
    });

    it('accepts a schema-qualified identifier', async () => {
        const a = new PostgresErpAdapter(cfg({ headerView: 'public.erp_invoices' }));
        // Same as above — validation passes, network fails.
        await expect(a.fetchInvoices({ limit: 1 })).rejects.not.toThrow(/Invalid identifier/);
        await a.close();
    });

    it('refuses unconfigured headerView', async () => {
        const a = new PostgresErpAdapter(cfg({ headerView: '' }));
        await expect(a.fetchInvoices({ limit: 1 })).rejects.toThrow(/headerView not configured/);
    });
});

describe('OdooErpAdapter — URL validation', () => {
    it('throws when host does not start with http(s)', async () => {
        const a = new OdooErpAdapter(cfg({ provider: 'odoo', host: 'erp.example.com' }));
        const r = await a.testConnection();
        expect(r.ok).toBe(false);
        expect(r.message).toMatch(/http/i);
    });

    it('rejects testConnection when database is missing', async () => {
        const a = new OdooErpAdapter(cfg({
            provider: 'odoo',
            host: 'http://localhost:8069',
            database: null,
        }));
        const r = await a.testConnection();
        expect(r.ok).toBe(false);
        // Could fail at the version probe (network) before we get to db check;
        // either way we want a non-200 outcome with a non-empty message.
        expect(r.message.length).toBeGreaterThan(0);
    });
});
