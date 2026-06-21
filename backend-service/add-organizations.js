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

async function addOrganizationSupport() {
    const client = await pool.connect();

    try {
        console.log('🏢 Adding SaaS Multi-Tenant Organization Support...\n');

        // Read the SQL file
        const sql = fs.readFileSync('./add-organizations-saas.sql', 'utf8');

        // Execute the SQL
        await client.query(sql);

        console.log('✅ Organization tables created successfully!\n');

        // Verify organizations
        const orgs = await client.query(`
      SELECT 
        o.id,
        o.name,
        o.tax_id,
        o.subscription_plan,
        COUNT(c.id) as user_count
      FROM "otaxdb".organizations o
      LEFT JOIN "otaxdb".credentials c ON c.organization_id = o.id
      GROUP BY o.id, o.name, o.tax_id, o.subscription_plan
    `);

        console.log('📊 Organizations:');
        console.table(orgs.rows);

        console.log('\n✨ SaaS Multi-Tenant setup complete!');
        console.log('\n📝 What changed:');
        console.log('   ✓ Organizations table created');
        console.log('   ✓ Users linked to organizations');
        console.log('   ✓ Organization settings table added');
        console.log('   ✓ Organization subscriptions table added');
        console.log('   ✓ Organization invitations system added');
        console.log('   ✓ Organization-specific audit logs');
        console.log('   ✓ ETA credentials moved to organization level');
        console.log('   ✓ Default organization created for existing users');

        console.log('\n🎯 Next steps:');
        console.log('   1. Update Prisma schema with Organization models');
        console.log('   2. Run: npx prisma db pull (to sync schema)');
        console.log('   3. Run: npx prisma generate');
        console.log('   4. Update APIs to include organization context');
        console.log('   5. Update UI to show organization info');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error);
    } finally {
        client.release();
        await pool.end();
    }
}

addOrganizationSupport();
