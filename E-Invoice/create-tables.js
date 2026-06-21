import pg from 'pg';
import fs from 'fs';

const { Pool } = pg;

// Database configuration
const pool = new Pool({
    host: 'postgresql-17417-0.cloudclusters.net',
    port: 17417,
    database: 'LoginDb',
    user: 'admin',
    password: 'admin123$456',
});

async function createTables() {
    const client = await pool.connect();

    try {
        console.log('🔄 Creating LoginDb.credentials table...\n');

        // Read and execute the SQL file
        const sql = fs.readFileSync('./prisma/migrations/create_credentials_table.sql', 'utf8');
        await client.query(sql);

        console.log('✅ Tables created successfully!\n');

        // Verify the table was created
        const result = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'LoginDb' 
      AND table_name = 'credentials'
      ORDER BY ordinal_position;
    `);

        console.log('📋 Credentials table structure:');
        console.table(result.rows);

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

createTables()
    .then(() => {
        console.log('\n✨ Done! Now run: npx tsx prisma/seed.ts');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
