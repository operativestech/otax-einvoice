import pg from 'pg';
const { Client } = pg;

const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'InvoicingDb',
    password: 'root',
    port: 5432,
});

async function check() {
    try {
        await client.connect();
        console.log('Connected to DB');

        const res = await client.query(`
            SELECT "internalId", "submissionId", environment, status, "dateTimeIssued" 
            FROM public.documents 
            ORDER BY "id" DESC 
            LIMIT 5
        `);

        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
}

check();
