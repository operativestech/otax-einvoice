
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

async function checkUsers() {
    let dbConfig;
    try {
        const configPath = path.join(__dirname, 'db_config.json');
        dbConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('Checking DB Host:', dbConfig.host);
    } catch (e: any) {
        console.error('Failed to load db_config.json');
        return;
    }

    const pool = new Pool(dbConfig);

    try {
        const client = await pool.connect();
        console.log('Connected.');

        console.log('--- USERS IN "otaxdb".credentials ---');
        try {
            const res = await client.query('SELECT id, username, password FROM "otaxdb".credentials');
            if (res.rows.length === 0) {
                console.log('No users found.');
            } else {
                console.table(res.rows);
            }
        } catch (err: any) {
            console.log('Error querying table:', err.message);
        }

        client.release();
    } catch (err: any) {
        console.error('Connection Failed:', err.message);
    } finally {
        await pool.end();
    }
}

checkUsers();
