/* eslint-disable */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    const r = await pool.query(
      `SELECT id, email,
              CASE WHEN fcm_token IS NULL THEN NULL
                   ELSE substr(fcm_token, 1, 24) || '...' END AS token_prefix,
              length(fcm_token) AS token_len,
              updated_at
         FROM users
        ORDER BY updated_at DESC
        LIMIT 15`,
    );
    console.log('rows =', r.rowCount);
    for (const row of r.rows) {
      console.log(JSON.stringify(row));
    }
  } catch (e) {
    console.error('ERR:', e.message);
  } finally {
    await pool.end();
  }
})();
