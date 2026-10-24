/**
 * One-time backfill after migration 347: encrypt ai_provider_config.api_key into
 * api_key_encrypted (same AES-256-GCM format as lib/secret-encryption.ts).
 *
 *   node scripts/encrypt-ai-provider-keys.mjs            # encrypt, keep plain column
 *   node scripts/encrypt-ai-provider-keys.mjs --clear    # also blank the plain api_key
 *   node scripts/encrypt-ai-provider-keys.mjs --dry-run
 */

import { createRequire } from 'module';
import { createCipheriv, randomBytes } from 'crypto';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const { loadEnvFiles, getMigrationDbConfig, describeMigrationDb } = require('./db-config.js');

loadEnvFiles();

const dryRun = process.argv.includes('--dry-run');
const clearPlain = process.argv.includes('--clear');

function getKey() {
  const k = (process.env.SECRETS_ENCRYPTION_KEY || process.env.PAYMENT_ENCRYPTION_KEY || '').trim();
  if (!k) throw new Error('SECRETS_ENCRYPTION_KEY (or PAYMENT_ENCRYPTION_KEY) is required');
  if (/^[0-9a-fA-F]{64}$/.test(k)) return Buffer.from(k, 'hex');
  const b64 = Buffer.from(k, 'base64');
  if (b64.length === 32) return b64;
  if (k.length === 32) return Buffer.from(k, 'utf8');
  throw new Error('SECRETS_ENCRYPTION_KEY must be 64 hex, base64 of 32 bytes, or 32 chars');
}

function encrypt(plaintext, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

async function main() {
  const key = getKey();
  const config = getMigrationDbConfig();
  console.log(`Database: ${describeMigrationDb(config)}${dryRun ? ' (dry run)' : ''}`);
  const pool = new Pool(config);
  try {
    const { rows } = await pool.query(
      `SELECT id, api_key FROM ai_provider_config
        WHERE api_key IS NOT NULL AND api_key <> '' AND api_key_encrypted IS NULL`,
    );
    console.log(`${rows.length} key(s) to encrypt`);
    for (const row of rows) {
      if (dryRun) continue;
      await pool.query(
        `UPDATE ai_provider_config
            SET api_key_encrypted = $2,
                api_key_last4 = RIGHT($3, 4),
                api_key = CASE WHEN $4 THEN NULL ELSE api_key END
          WHERE id = $1`,
        [row.id, encrypt(row.api_key, key), row.api_key, clearPlain],
      );
    }
    console.log(dryRun ? 'Dry run complete' : 'Done');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
