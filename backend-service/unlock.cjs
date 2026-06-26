require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function unlock() {
    try {
        const res = await pool.query("DELETE FROM otaxdb.signing_nodes WHERE company_id = '562067566'");
        console.log('Unlocked. Rows deleted:', res.rowCount);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
unlock();
