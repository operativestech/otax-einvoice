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

        // ── Step 1: Check what tables already exist ──
        const existing = await client.query(`
      SELECT schemaname, tablename 
      FROM pg_tables 
      WHERE schemaname IN ('otaxdb', 'LoginDb', 'public', 'InvoicesDb') 
        AND tablename NOT LIKE 'pg_%'
      ORDER BY schemaname, tablename;
    `);
        console.log('=== EXISTING TABLES (BEFORE) ===');
        const existingSet = new Set();
        for (const row of existing.rows) {
            console.log(`  ${row.schemaname}.${row.tablename}`);
            existingSet.add(`${row.schemaname}.${row.tablename}`);
        }
        console.log(`Total: ${existing.rows.length}\n`);

        // ── Step 2: Read SQL and split into individual statements ──
        const sqlFile = path.join(__dirname, '..', 'prisma', 'recreate_tables.sql');
        const sql = fs.readFileSync(sqlFile, 'utf8');

        // Split on semicolons, strip comments from each chunk, filter empty
        const statements = sql
            .split(';')
            .map(s => {
                // Remove comment-only lines but keep the actual SQL
                return s.split('\n')
                    .filter(line => !line.trim().startsWith('--'))
                    .join('\n')
                    .trim();
            })
            .filter(s => s.length > 0);

        console.log(`Found ${statements.length} SQL statements to execute.\n`);

        let success = 0;
        let skipped = 0;
        let errors = 0;

        for (let i = 0; i < statements.length; i++) {
            const stmt = statements[i];
            const firstLine = stmt.split('\n').find(l => l.trim()) || '';
            const preview = firstLine.trim().substring(0, 80);

            try {
                await client.query(stmt);
                success++;
                console.log(`  ✅ [${i + 1}/${statements.length}] ${preview}...`);
            } catch (err) {
                if (err.message.includes('already exists') || err.message.includes('duplicate')) {
                    skipped++;
                    console.log(`  ⏭️  [${i + 1}/${statements.length}] SKIPPED: ${preview}...`);
                } else {
                    errors++;
                    console.log(`  ❌ [${i + 1}/${statements.length}] ERROR: ${err.message}`);
                    console.log(`      Statement: ${preview}...`);
                }
            }
        }

        console.log(`\n=== SUMMARY ===`);
        console.log(`  Success: ${success}`);
        console.log(`  Skipped: ${skipped}`);
        console.log(`  Errors:  ${errors}\n`);

        // ── Step 3: Final verification ──
        const result = await client.query(`
      SELECT schemaname, tablename 
      FROM pg_tables 
      WHERE schemaname = 'otaxdb'
        AND tablename NOT LIKE 'pg_%'
      ORDER BY tablename;
    `);

        console.log('=== TABLES IN otaxdb SCHEMA ===');
        for (const row of result.rows) {
            console.log(`  🆕 ${row.tablename}`);
        }
        console.log(`\nTotal: ${result.rows.length} tables in otaxdb`);

        await client.end();
        console.log('\n✅ Done!');
    } catch (err) {
        console.error('❌ Connection Error:', err.message);
        process.exit(1);
    }
}

main();
