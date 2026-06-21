import pg from 'pg';
import fs from 'fs';

const { Pool } = pg;

const pool = new Pool({
    host: 'postgresql-17417-0.cloudclusters.net',
    port: 17417,
    database: 'LoginDb',
    user: 'admin',
    password: 'admin123$456',
});

async function createRBACTables() {
    const client = await pool.connect();

    try {
        console.log('🔧 Creating RBAC tables in LoginDb schema...\n');

        // Read the SQL file
        const sql = fs.readFileSync('./create-rbac-tables.sql', 'utf8');

        // Execute the SQL
        await client.query(sql);

        console.log('✅ All RBAC tables created successfully!\n');

        // Verify tables
        const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'LoginDb'
      ORDER BY table_name
    `);

        console.log('📊 Tables in LoginDb schema:');
        result.rows.forEach(row => {
            console.log(`   ✓ ${row.table_name}`);
        });

        console.log('\n✨ Done! Now run:');
        console.log('   1. npx prisma generate');
        console.log('   2. npx tsx prisma/seed.ts');
        console.log('   3. npm run server');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error);
    } finally {
        client.release();
        await pool.end();
    }
}

createRBACTables();
