const { Pool } = require('pg');

const pool = new Pool({
    host: 'postgresql-17417-0.cloudclusters.net',
    port: 17417,
    database: 'LoginDb',
    user: 'admin',
    password: 'admin123$456',
});

async function fixNullValues() {
    const client = await pool.connect();

    try {
        console.log('🔧 Fixing NULL values in credentials table...\n');

        // Update NULL isDemo values to false
        const result = await client.query(`
      UPDATE "otaxdb".credentials 
      SET "isDemo" = false 
      WHERE "isDemo" IS NULL
    `);

        console.log(`✅ Updated ${result.rowCount} rows\n`);

        // Verify
        const verify = await client.query(`
      SELECT id, username, "isDemo", "isValid" 
      FROM "otaxdb".credentials
    `);

        console.log('📊 Current users:');
        console.table(verify.rows);

        console.log('\n✨ Done! Now run: npx prisma db push');

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        client.release();
        await pool.end();
    }
}

fixNullValues();
