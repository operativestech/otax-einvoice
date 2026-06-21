import pg from 'pg';

const { Pool } = pg;

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

        // Check if credentials table exists in public schema
        const checkPublic = await client.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_name = 'credentials'
    `);

        console.log('📋 Current credentials table location:');
        console.table(checkPublic.rows);

        if (checkPublic.rows.some(r => r.table_schema === 'public')) {
            console.log('\n2️⃣ Moving credentials table to LoginDb schema...');
            await client.query('ALTER TABLE public.credentials SET SCHEMA "otaxdb"');
            console.log('✅ credentials table moved\n');
        }

        // Check if clients_info_new exists in public
        const checkClientsInfo = await client.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_name = 'clients_info_new'
    `);

        if (checkClientsInfo.rows.some(r => r.table_schema === 'public')) {
            console.log('3️⃣ Moving clients_info_new table to LoginDb schema...');
            await client.query('ALTER TABLE public.clients_info_new SET SCHEMA "otaxdb"');
            console.log('✅ clients_info_new table moved\n');
        }

        // Verify final location
        console.log('4️⃣ Verifying tables in LoginDb schema...');
        const verify = await client.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'LoginDb' 
      AND table_name IN ('credentials', 'clients_info_new')
      ORDER BY table_name
    `);

        console.log('📊 Tables in LoginDb schema:');
        console.table(verify.rows);

        // Check existing users
        console.log('\n5️⃣ Checking existing users...');
        const users = await client.query('SELECT id, username, "isDemo", "isValid" FROM "otaxdb".credentials');
        console.log('👥 Current users:');
        console.table(users.rows);

        console.log('\n✨ Schema fix complete!');

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

fixSchema()
    .then(() => {
        console.log('\n🎉 Success! Now restart your server and try logging in.');
        console.log('\nIf you don\'t see admin/demo users, run: npx tsx prisma/seed.ts');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Fatal error:', error);
        process.exit(1);
    });
