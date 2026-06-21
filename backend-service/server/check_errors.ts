
import { Pool } from 'pg';

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'documents',
    password: 'root', // Assuming default or user's password
    port: 5432,
});

async function checkErrors() {
    try {
        const res = await pool.query('SELECT * FROM public.errors ORDER BY id DESC LIMIT 5');
        console.log('--- LATEST ERRORS ---');
        console.log(JSON.stringify(res.rows, null, 2));

        const resDocs = await pool.query('SELECT * FROM public.documents ORDER BY id DESC LIMIT 5');
        console.log('--- LATEST DOCUMENTS ---');
        console.log(JSON.stringify(resDocs.rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkErrors();
