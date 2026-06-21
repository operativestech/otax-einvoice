
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '17417'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    ssl: { rejectUnauthorized: false }
});

async function dump() {
    try {
        const res = await pool.query('SELECT property_name, property_value FROM "otaxdb".clients_info_new WHERE uid = 221');
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
dump();
