const pg = require('pg');

async function main() {
    const pool = new pg.Pool({
        host: 'postgresql-17417-0.cloudclusters.net',
        port: 17417,
        database: 'LoginDb',
        user: 'admin',
        password: 'admin123$456',
    });

    const client = await pool.connect();
    try {
        // Check credentials
        const creds = await client.query('SELECT COUNT(*) as count FROM "otaxdb"."credentials"');
        console.log('credentials: ' + creds.rows[0].count + ' rows (SAFE)');

        // Check clients_info_new
        const clients = await client.query('SELECT COUNT(*) as count FROM "otaxdb"."clients_info_new"');
        console.log('clients_info_new: ' + clients.rows[0].count + ' rows (SAFE)');

    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
