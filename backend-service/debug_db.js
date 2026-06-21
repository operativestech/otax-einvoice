
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Pool } = pg;
const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '17417'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    ssl: { rejectUnauthorized: false }
});
async function test() {
    const res = await pool.query("SELECT property_name, property_value FROM \"LoginDb\".clients_info_new WHERE uid = '221'");
    console.log(JSON.stringify(res.rows, null, 2));
    process.exit(0);
}
test();
