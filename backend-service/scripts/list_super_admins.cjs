/* One-off: list super admin accounts (no passwords). */
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
});

(async () => {
    try {
        const r = await pool.query(
            `SELECT id, username, email, full_name, is_active, last_login_at, created_at
             FROM "otaxdb".super_admins ORDER BY id ASC`
        );
        if (r.rows.length === 0) {
            console.log('(no super_admins rows)');
        } else {
            console.log(`Found ${r.rows.length} super admin(s):`);
            for (const a of r.rows) {
                console.log(` - id=${a.id} username=${a.username} email=${a.email} active=${a.is_active} last_login=${a.last_login_at || 'never'}`);
            }
        }
    } catch (e) {
        console.error('ERROR:', e.message);
    } finally {
        await pool.end();
    }
})();
