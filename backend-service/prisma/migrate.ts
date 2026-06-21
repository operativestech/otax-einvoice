import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'postgresql-17417-0.cloudclusters.net',
  port: parseInt(process.env.DB_PORT || '17417'),
  database: process.env.DB_NAME || 'otaxdb',
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASS || 'admin123$456',
});

async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('🔄 Starting database migration...');

    // Read the SQL file
    const sqlPath = path.join(__dirname, 'migrations', 'create_credentials_table.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Execute the SQL
    await client.query(sql);

    console.log('✅ Migration completed successfully!');
    console.log('\n📋 Checking credentials table structure...');

    // Check the table structure
    const result = await client.query(`
      SELECT 
        column_name, 
        data_type, 
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_schema = 'otaxdb' 
      AND table_name = 'credentials'
      ORDER BY ordinal_position;
    `);

    console.log('\nCredentials table columns:');
    console.table(result.rows);

    // Check if admin and demo users exist
    const usersResult = await client.query(`
      SELECT id, username, "isDemo", "isValid" 
      FROM "LoginDb".credentials
    `);

    console.log('\n👥 Existing users:');
    console.table(usersResult.rows);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => {
    console.log('\n✨ All done! You can now run the seed script:');
    console.log('   npx tsx prisma/seed.ts');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
