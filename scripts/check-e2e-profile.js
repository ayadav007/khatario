const path = require('path');
const { Pool } = require('pg');
const { loadEnvFiles, getMigrationDbConfig } = require('./db-config');
loadEnvFiles();
const config = getMigrationDbConfig();
const pool = new Pool(
  config.connectionString
    ? { connectionString: config.connectionString }
    : config
);
(async () => {
  const user = await pool.query(
    `SELECT u.id, u.name, u.business_id, b.name AS business_name,
            b.address_line1, b.city, b.state, b.pincode, b.gstin, b.state_code
       FROM users u JOIN businesses b ON b.id = u.business_id
      WHERE u.phone = $1`,
    ['7777777777']
  );
  const row = user.rows[0];
  if (!row) {
    console.log(JSON.stringify({ found: false }));
  } else {
    console.log(JSON.stringify({
      found: true,
      business_name: row.business_name,
      state_code: row.state_code,
      state: row.state,
      gaps: {
        address: !row.address_line1,
        city: !row.city,
        state: !row.state,
        pincode: !row.pincode,
        gstin: !row.gstin,
        state_code: !row.state_code,
      },
    }));
  }
  await pool.end();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
