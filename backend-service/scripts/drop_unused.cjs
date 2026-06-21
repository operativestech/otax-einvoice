const { Client } = require('pg');

async function main() {
    const client = new Client({
        host: 'postgresql-17417-0.cloudclusters.net',
        port: 17417,
        database: 'LoginDb',
        user: 'admin',
        password: 'admin123$456',
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 30000,
    });

    try {
        console.log('Connecting to database...');
        await client.connect();
        console.log('✅ Connected!\n');

        const tablesToDrop = [
            '"otaxdb"."Clients_Info_empty"',
            '"otaxdb"."audit_logs"',
            '"otaxdb"."clients"',
            '"otaxdb"."clients_info"',
            '"otaxdb"."errors"',
            '"otaxdb"."user_preferences"',
            '"otaxdb"."user_sidebar_permissions"',
            '"otaxdb"."sidebar_items"',
            '"otaxdb"."route"',
            // Round 2: more unused tables
            '"otaxdb"."eta_sync_history"',
            '"otaxdb"."documents"',
            '"otaxdb"."org_document_lines"',
            '"otaxdb"."org_documents"',
        ];

        for (const table of tablesToDrop) {
            try {
                await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
                console.log(`  ✅ Dropped ${table}`);
            } catch (err) {
                console.log(`  ❌ Error dropping ${table}: ${err.message}`);
            }
        }

        // Verify remaining tables
        const result = await client.query(`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'otaxdb' 
      ORDER BY tablename
    `);

        console.log(`\n=== Remaining tables in otaxdb (${result.rows.length}) ===`);
        for (const row of result.rows) {
            console.log(`  📋 ${row.tablename}`);
        }

        await client.end();
        console.log('\n✅ Done!');
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

main();
