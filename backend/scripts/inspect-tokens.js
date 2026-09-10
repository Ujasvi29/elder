import { query, pool } from '../shared/db/pool.js';

async function main() {
  const { rows } = await query('SELECT * FROM device_tokens');
  console.log(JSON.stringify(rows, null, 2));
  await pool.end();
}

main().catch(console.error);
