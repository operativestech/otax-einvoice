
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Client } = pg;

async function exploreServer() {
    let dbConfig;
    try {
        const configPath = path.join(__dirname, 'db_config.json');
        dbConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) { console.error('No config'); return; }

    // Connect to 'postgres' DB first to list other DBs
    const client = new Client(dbConfig);

    try {
        await client.connect();
        console.log(`Connected to host: ${dbConfig.host} (DB: ${dbConfig.database})`);

        // 1. List all Databases
        const dbs = await client.query('SELECT datname FROM pg_database WHERE datistemplate = false;');
        console.log('\n--- DATABASES FOUND ---');
        console.table(dbs.rows.map(r => r.datname));

        const dbNames = dbs.rows.map(r => r.datname);
        client.end(); // Close initial connection

        // 2. Check each database for "LoginDb.credentials"
        for (const dbName of dbNames) {
            console.log(`\nChecking database: "${dbName}"...`);
            const dbClient = new Client({ ...dbConfig, database: dbName });
            try {
                await dbClient.connect();

                // Check for schema/table
                const res = await dbClient.query(`
                    SELECT table_schema, table_name 
                    FROM information_schema.tables 
                    WHERE table_schema = 'LoginDb' AND table_name = 'credentials';
                `);

                if (res.rows.length > 0) {
                    console.log(`✅ FOUND "LoginDb.credentials" in database: "${dbName}"`);

                    // Check for user 'essam'
                    const userRes = await dbClient.query(`SELECT id, username FROM "otaxdb".credentials WHERE username = 'essam'`);
                    if (userRes.rows.length > 0) {
                        console.log(`🎉 FOUND USER 'essam' in database: "${dbName}"!`);
                        console.log(`>>> YOU SHOULD CHANGE "database": "${dbName}" in db_config.json <<<`);
                    } else {
                        console.log(`⚠️ Table exists but user 'essam' NOT found in "${dbName}".`);
                    }
                } else {
                    console.log(`❌ Table not found in "${dbName}".`);
                }

                await dbClient.end();
            } catch (err: any) {
                console.log(`Failed to connect/query "${dbName}": ${err.message}`);
            }
        }

    } catch (err: any) {
        console.error('Main Error:', err.message);
    }
}

exploreServer();
