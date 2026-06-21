const { Client } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

// Load env from one level up or current
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Construct connection config
// If DATABASE_URL is present, pg Client uses it automatically if passed as connectionString
// or we can parse it. Using connectionString is easiest.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error('DATABASE_URL not found in .env');
    process.exit(1);
}

const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        await client.connect();
        console.log('Connected to DB');

        const query = `
        CREATE TABLE IF NOT EXISTS "otaxdb".leads (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            name VARCHAR(255) NOT NULL,
            phone VARCHAR(50),
            company_name VARCHAR(255),
            tax_id VARCHAR(50),
            plan VARCHAR(50),
            status VARCHAR(50) DEFAULT 'NEW',
            step INTEGER DEFAULT 1,
            details TEXT,
            created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
        );
        `;

        await client.query(query);
        console.log('Successfully created "otaxdb".leads table.');
    } catch (err) {
        console.error('Error creating table:', err);
    } finally {
        await client.end();
    }
}

run();
