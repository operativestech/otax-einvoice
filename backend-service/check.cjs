require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query('SELECT * FROM otaxdb.signing_nodes').then(r => console.log(r.rows)).finally(() => pool.end());
