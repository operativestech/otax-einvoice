const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

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

        // Read and execute the SQL file
        const sqlFile = path.join(__dirname, '..', 'prisma', 'recreate_tables.sql');
        const sql = fs.readFileSync(sqlFile, 'utf8');

        console.log('Executing schema creation script...');
        await client.query(sql);
        console.log('✅ Schema creation completed!\n');

        // Verify: list all tables
        const result = await client.query(`
      SELECT schemaname, tablename 
      FROM pg_tables 
      WHERE schemaname IN ('LoginDb', 'public', 'InvoicesDb') 
        AND tablename NOT LIKE 'pg_%'
      ORDER BY schemaname, tablename;
    `);

        console.log('=== ALL TABLES ===');
        for (const row of result.rows) {
            console.log(`  ${row.schemaname}.${row.tablename}`);
        }
        console.log(`\nTotal: ${result.rows.length} tables`);

        await client.end();
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

main();
