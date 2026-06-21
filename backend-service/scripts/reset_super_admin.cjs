/* One-off: wipe all super_admins rows and create a fresh one. */
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const EMAIL    = 'otax.tech@gmail.com';
const PASSWORD = 'Mm123@135';
const USERNAME = 'superadmin';
const FULLNAME = 'OTax Super Admin';

const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
});

(async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const del = await client.query(`DELETE FROM "otaxdb".super_admins`);
        console.log(`Deleted ${del.rowCount} existing super admin row(s).`);

        const hash = await bcrypt.hash(PASSWORD, 10);
        const ins = await client.query(
            `INSERT INTO "otaxdb".super_admins (username, email, password, full_name, is_active)
             VALUES ($1, $2, $3, $4, TRUE)
             RETURNING id, username, email`,
            [USERNAME, EMAIL, hash, FULLNAME]
        );
        await client.query('COMMIT');

        const a = ins.rows[0];
        console.log('\nCreated super admin:');
        console.log(`  id=${a.id} username=${a.username} email=${a.email}`);
        console.log(`  password=${PASSWORD}  (stored bcrypt-hashed)`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('ERROR:', e.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
})();
