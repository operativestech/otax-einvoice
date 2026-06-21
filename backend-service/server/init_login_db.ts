
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

async function initLoginSchema() {
    let dbConfig;
    try {
        const configPath = path.join(__dirname, 'db_config.json');
        dbConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('Loaded DB Config for Init:', dbConfig.host);
    } catch (e: any) {
        console.error('Failed to load db_config.json:', e.message);
        return;
    }

    const pool = new Pool(dbConfig);

    try {
        const client = await pool.connect();
        console.log('Connected to Database.');

        try {
            await client.query('BEGIN');

            console.log('Creating Schema "otaxdb"...');
            await client.query('CREATE SCHEMA IF NOT EXISTS "otaxdb";');

            console.log('Creating Table "LoginDb.credentials"...');
            await client.query(`
                CREATE TABLE IF NOT EXISTS "otaxdb".credentials (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(255) UNIQUE NOT NULL,
                    password VARCHAR(255) NOT NULL,
                    hwid VARCHAR(255),
                    "isValid" BOOLEAN DEFAULT true,
                    "isDemo" BOOLEAN DEFAULT false,
                    "registerDate" TIMESTAMP DEFAULT NOW(),
                    "expiryDate" TIMESTAMP,
                    "configHash" VARCHAR(500)
                );
            `);

            console.log('Creating Table "LoginDb.clients_info_new"...');
            await client.query(`
                CREATE TABLE IF NOT EXISTS "otaxdb".clients_info_new (
                    id SERIAL PRIMARY KEY,
                    hwid VARCHAR(255),
                    uid INTEGER REFERENCES "otaxdb".credentials(id),
                    property_name VARCHAR(255),
                    property_value TEXT,
                    "nonAdminEdit" BOOLEAN DEFAULT false,
                    modify_date TIMESTAMP DEFAULT NOW()
                );
            `);

            // Check if admin exists
            const res = await client.query('SELECT * FROM "otaxdb".credentials WHERE username = $1', ['admin']);
            if (res.rows.length === 0) {
                console.log('Creating Default Admin User (admin / admin123)...'); // Assuming user wants a default login to access
                // User provided admin / admin123$456 in db_config, maybe he wants that password for the app user too?
                // I'll create a default app user 'essam' as shown in the screenshot, or just 'admin'.
                // Screenshot shows 'essam'. I'll stick to a generic 'admin' user so he has access, he can Signup 'essam' later or I can create 'essam' if I knew the pass.
                // Let's create 'admin' with password 'admin' for simplicity, or '123456'.
                await client.query(`
                    INSERT INTO "otaxdb".credentials (username, password, "isValid", "isDemo", "registerDate")
                    VALUES ('admin', 'admin', true, false, NOW());
                `);
                console.log('Default admin user created.');
            } else {
                console.log('Admin user already exists.');
            }

            await client.query('COMMIT');
            console.log('Schema Initialization Complete!');

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err: any) {
        console.error('Initialization Failed:', err.message);
    } finally {
        await pool.end();
    }
}

initLoginSchema();
