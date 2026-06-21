/**
 * Seed Super Admin Script
 * Creates the first platform-level super admin user
 * 
 * Usage: node scripts/seed_super_admin.cjs
 */

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'postgresql-17417-0.cloudclusters.net',
    port: parseInt(process.env.DB_PORT || '17417'),
    database: process.env.DB_NAME || 'LoginDb',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASS || 'admin123$456',
});

async function seedSuperAdmin() {
    const client = await pool.connect();
    try {
        console.log('🔐 Seeding Super Admin...\n');

        // 1. Create the super_admins table if it doesn't exist
        await client.query(`
            CREATE TABLE IF NOT EXISTS "otaxdb"."super_admins" (
                "id"              SERIAL PRIMARY KEY,
                "username"        VARCHAR(255) NOT NULL UNIQUE,
                "email"           VARCHAR(255) NOT NULL UNIQUE,
                "password"        VARCHAR(255) NOT NULL,
                "full_name"       VARCHAR(255),
                "is_active"       BOOLEAN DEFAULT TRUE,
                "last_login_at"   TIMESTAMP(6),
                "created_at"      TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
                "updated_at"      TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ super_admins table ready');

        // 2. Check if super admin already exists
        const existing = await client.query(
            `SELECT id, username, email FROM "otaxdb"."super_admins" WHERE username = 'superadmin'`
        );

        if (existing.rows.length > 0) {
            console.log(`\n⚠️  Super admin already exists:`);
            console.log(`   ID: ${existing.rows[0].id}`);
            console.log(`   Username: ${existing.rows[0].username}`);
            console.log(`   Email: ${existing.rows[0].email}`);
            console.log('\n   To reset password, delete the row and re-run this script.');
            return;
        }

        // 3. Create the super admin
        const username = 'superadmin';
        const email = 'superadmin@otax.tech';
        const password = 'Admin@2026';
        const fullName = 'OTax Super Admin';

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await client.query(
            `INSERT INTO "otaxdb"."super_admins" (username, email, password, full_name, is_active)
             VALUES ($1, $2, $3, $4, TRUE)
             RETURNING id, username, email`,
            [username, email, hashedPassword, fullName]
        );

        const admin = result.rows[0];
        console.log(`\n✅ Super Admin created successfully!`);
        console.log(`   ┌──────────────────────────────────┐`);
        console.log(`   │  ID:       ${admin.id}`);
        console.log(`   │  Username: ${admin.username}`);
        console.log(`   │  Email:    ${admin.email}`);
        console.log(`   │  Password: ${password}`);
        console.log(`   └──────────────────────────────────┘`);
        console.log(`\n⚠️  IMPORTANT: Change the password after first login!`);

    } catch (err) {
        console.error('❌ Error seeding super admin:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

seedSuperAdmin();
