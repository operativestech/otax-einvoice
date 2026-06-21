const { Pool } = require('pg');

const pool = new Pool({
    host: 'postgresql-17417-0.cloudclusters.net',
    port: 17417,
    database: 'LoginDb',
    user: 'admin',
    password: 'admin123$456',
});

async function fixSchema() {
    const client = await pool.connect();

    try {
        console.log('🔧 Fixing database schema...\n');

        // Create LoginDb schema
        console.log('1️⃣ Creating LoginDb schema...');
        await client.query('CREATE SCHEMA IF NOT EXISTS "otaxdb"');
        console.log('✅ LoginDb schema ready\n');

        // Move credentials table
        console.log('2️⃣ Moving credentials table to LoginDb schema...');
        try {
            await client.query('ALTER TABLE public.credentials SET SCHEMA "otaxdb"');
            console.log('✅ credentials table moved\n');
        } catch (e) {
            console.log('ℹ️  credentials table already in LoginDb or doesn\'t exist in public\n');
        }

        // Move clients_info_new table
        console.log('3️⃣ Moving clients_info_new table to LoginDb schema...');
        try {
            await client.query('ALTER TABLE public.clients_info_new SET SCHEMA "otaxdb"');
            console.log('✅ clients_info_new table moved\n');
        } catch (e) {
            console.log('ℹ️  clients_info_new table already in LoginDb or doesn\'t exist in public\n');
        }

        // Verify
        console.log('4️⃣ Verifying tables...');
        const verify = await client.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_name IN ('credentials', 'clients_info_new')
      ORDER BY table_schema, table_name
    `);

        console.log('📊 Tables found:');
        verify.rows.forEach(row => {
            console.log(`   ${row.table_schema}.${row.table_name}`);
        });

        // Check users
        console.log('\n5️⃣ Checking users in LoginDb.credentials...');
        try {
            const users = await client.query('SELECT id, username, "isDemo", "isValid" FROM "otaxdb".credentials LIMIT 5');
            console.log(`👥 Found ${users.rows.length} users:`);
            users.rows.forEach(u => {
                console.log(`   - ${u.username} (ID: ${u.id}, Demo: ${u.isDemo}, Valid: ${u.isValid})`);
            });
        } catch (e) {
            console.log('⚠️  Could not read users:', e.message);
        }

        console.log('\n✨ Done!');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error);
    } finally {
        client.release();
        await pool.end();
    }
}

fixSchema()
    .then(() => {
        console.log('\n🎉 Schema fix complete!');
        console.log('Now restart your server: npm run server');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
