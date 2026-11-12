/**
 * business_integrations: migration 476 copies the old Shiprocket columns once, and running it again changes nothing.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
if (!process.env.PAYMENT_ENCRYPTION_KEY) process.env.PAYMENT_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { hashStoreWebhookToken } from '@/lib/store/delivery/webhooks';
import { loadShiprocketCreds } from '@/lib/store/delivery';
import { encryptPaymentSecret } from '@/lib/payments/secret-encryption';
import {
  disconnect,
  getConnection,
  listConnections,
  loadSecrets,
  resolveBusinessForWebhookToken,
  saveConnection,
  setWebhookToken,
} from '@/lib/integrations/service';

/** The copy statement from the migration, so the test runs exactly what ships. */
const COPY_SQL = (() => {
  const sql = readFileSync(path.join(process.cwd(), 'database/migrations/476_business_integrations.sql'), 'utf8');
  const m = sql.match(/INSERT INTO business_integrations[\s\S]*?;/);
  if (!m) throw new Error('INSERT statement not found in migration 476');
  return m[0];
})();

d('business_integrations (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const A = randomUUID();
  const B = randomUUID();
  const C = randomUUID();
  const D = randomUUID();
  const ALL = [A, B, C, D];
  const tag = A.slice(0, 8);
  const HASH_A = hashStoreWebhookToken(`bint${tag}${'a'.repeat(24)}`);

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string }>('SELECT current_database() AS db');
    if (!/test/i.test(db.rows[0].db)) throw new Error(`Refusing to run against ${db.rows[0].db}`);
    for (const [biz, name] of [
      [A, 'A'],
      [B, 'B'],
      [C, 'C'],
      [D, 'D'],
    ] as const) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
         VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
        [biz, `Integ ${name} ${tag}`],
      );
      await pool.query(`INSERT INTO business_settings (business_id) VALUES ($1) ON CONFLICT (business_id) DO NOTHING`, [biz]);
    }
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM business_integrations WHERE business_id = ANY($1::uuid[])`, [ALL]);
      await pool.query(`DELETE FROM order_fulfilments WHERE business_id = ANY($1::uuid[])`, [ALL]);
      await pool.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [ALL]);
    } finally {
      await closePool();
    }
  });

  test('copy: old Shiprocket columns become one connection, and running it twice changes nothing', async () => {
    await pool.query(
      `INSERT INTO business_settings (business_id, store_shiprocket_email, store_shiprocket_password_enc, store_shiprocket_webhook_token_hash)
       VALUES ($1, 'api@shop.test', 'CIPHERTEXT', $2)
       ON CONFLICT (business_id) DO UPDATE SET store_shiprocket_email = EXCLUDED.store_shiprocket_email,
         store_shiprocket_password_enc = EXCLUDED.store_shiprocket_password_enc,
         store_shiprocket_webhook_token_hash = EXCLUDED.store_shiprocket_webhook_token_hash`,
      [A, HASH_A],
    );
    await pool.query(COPY_SQL);
    await pool.query(COPY_SQL);
    const { rows } = await pool.query(
      `SELECT config, secrets_enc, webhook_token_hash FROM business_integrations WHERE business_id = $1 AND provider = 'shiprocket'`,
      [A],
    );
    expect(rows).toEqual([{ config: { email: 'api@shop.test' }, secrets_enc: { password: 'CIPHERTEXT' }, webhook_token_hash: HASH_A }]);
  });

  test('copy: a business with no Shiprocket columns gets no row', async () => {
    // B has a business_settings row with all three columns NULL
    expect((await pool.query(`SELECT 1 FROM business_integrations WHERE business_id = $1`, [B])).rowCount).toBe(0);
  });

  describe('service', () => {
    const USER = randomUUID();
    const TOKEN = `tokA${tag}${'t'.repeat(24)}`;
    const TOKEN_C = `tokC${tag}${'c'.repeat(24)}`;
    const HASH_C = hashStoreWebhookToken(TOKEN_C);
    const accept = async () => ({ ok: true as const });
    const reject = async () => ({ ok: false as const, reason: 'rejected' as const, message: 'nope' });
    let fulfilmentId: string;

    beforeAll(async () => {
      // The copy tests above leave a row for A; start the service tests from nothing connected.
      await pool.query(`DELETE FROM business_integrations WHERE business_id = ANY($1::uuid[])`, [ALL]);
      await pool.query(
        `UPDATE business_settings SET store_shiprocket_email = NULL, store_shiprocket_password_enc = NULL,
           store_shiprocket_webhook_token_hash = NULL WHERE business_id = ANY($1::uuid[])`,
        [ALL],
      );
    });

    test('rejected credentials save nothing', async () => {
      const r = await saveConnection(A, 'shiprocket', { email: 'a@shop.test', password: 'pw' }, null, { verify: reject });
      expect(r).toEqual({ ok: false, code: 'REJECTED', error: 'nope' });
      expect(await getConnection(A, 'shiprocket')).toBeNull();
    });

    test('an unreachable courier saves nothing', async () => {
      const unreachable = async () => ({ ok: false as const, reason: 'unreachable' as const, message: 'down' });
      const r = await saveConnection(A, 'shiprocket', { email: 'a@shop.test', password: 'pw' }, null, { verify: unreachable });
      expect(r).toEqual({ ok: false, code: 'UNREACHABLE', error: 'down' });
      expect(await getConnection(A, 'shiprocket')).toBeNull();
    });

    test('accepted credentials are stored encrypted and read back', async () => {
      const r = await saveConnection(A, 'shiprocket', { email: '  A@Shop.test ', password: ' pw with spaces ' }, USER, { verify: accept });
      expect(r.ok && r.connection).toMatchObject({
        connected: true,
        config: { email: 'A@Shop.test' },
        secretsSet: ['password'],
        webhookConfigured: false,
      });
      const raw = await pool.query(`SELECT secrets_enc, connected_by, last_verified_at FROM business_integrations WHERE business_id = $1`, [A]);
      expect(raw.rows[0].secrets_enc.password).not.toContain('pw with spaces');
      expect(raw.rows[0].connected_by).toBe(USER);
      expect(raw.rows[0].last_verified_at).not.toBeNull();
      expect(await loadSecrets(A, 'shiprocket')).toEqual({ config: { email: 'A@Shop.test' }, secrets: { password: ' pw with spaces ' } });
    });

    test('views never carry a secret, ciphertext or hash', async () => {
      const raw = (await pool.query(`SELECT secrets_enc FROM business_integrations WHERE business_id = $1`, [A])).rows[0];
      const json = JSON.stringify([await getConnection(A, 'shiprocket'), await listConnections(A)]);
      expect(json).not.toMatch(/pw with spaces|secrets_enc|webhook_token_hash/);
      expect(json).not.toContain(raw.secrets_enc.password);
      expect(await listConnections(A)).toHaveLength(1);
    });

    test('a blank password keeps the stored one, and the check sees the stored one', async () => {
      const verify = jest.fn(accept);
      await saveConnection(A, 'shiprocket', { email: 'new@shop.test', password: '' }, null, { verify });
      expect(verify).toHaveBeenCalledWith({ config: { email: 'new@shop.test' }, secrets: { password: ' pw with spaces ' } });
      expect(await loadSecrets(A, 'shiprocket')).toEqual({ config: { email: 'new@shop.test' }, secrets: { password: ' pw with spaces ' } });
    });

    test('two saves at once leave one row', async () => {
      await Promise.all(
        [1, 2].map(() => saveConnection(A, 'shiprocket', { email: 'x@shop.test', password: 'p' }, null, { verify: accept })),
      );
      expect((await pool.query(`SELECT 1 FROM business_integrations WHERE business_id = $1`, [A])).rowCount).toBe(1);
    });

    test.each([
      [{ email: 'a@shop.test', password: 'p', extra: 'x' }],
      [{ email: { a: 1 }, password: 'p' }],
      [{ email: 'a@shop.test', password: 'p'.repeat(256) }],
      [{ email: 'no-at-sign', password: 'p' }],
      [{ email: 'a@shop.test', password: 'p', webhook_token: 'short' }],
      [{ email: null, password: 'p' }],
    ])('invalid input %# is refused before the check runs', async (values) => {
      const verify = jest.fn(accept);
      expect(await saveConnection(B, 'shiprocket', values as Record<string, unknown>, null, { verify })).toMatchObject({
        ok: false,
        code: 'INVALID',
      });
      expect(verify).not.toHaveBeenCalled();
      expect(await getConnection(B, 'shiprocket')).toBeNull();
    });

    test('required password missing on first connect is INVALID', async () => {
      const verify = jest.fn(accept);
      expect(await saveConnection(B, 'shiprocket', { email: 'b@shop.test', password: '' }, null, { verify })).toEqual({
        ok: false,
        code: 'INVALID',
        error: 'API user password is required',
      });
      expect(await saveConnection(B, 'shiprocket', { email: 'b@shop.test' }, null, { verify })).toMatchObject({ ok: false, code: 'INVALID' });
      expect(await saveConnection(B, 'shiprocket', { password: 'p' }, null, { verify })).toMatchObject({ ok: false, code: 'INVALID' });
      expect(verify).not.toHaveBeenCalled();
      expect(await getConnection(B, 'shiprocket')).toBeNull();
    });

    test('unknown plugin id and a coming-soon id are INVALID', async () => {
      for (const id of ['nope', 'delhivery']) {
        expect(await saveConnection(B, id, { email: 'b@shop.test', password: 'p' }, null, { verify: accept })).toEqual({
          ok: false,
          code: 'INVALID',
          error: 'Unknown integration',
        });
      }
      expect(await listConnections(B)).toEqual([]);
    });

    test('webhook token: resolves to its business only; a second business cannot take it', async () => {
      const r = await saveConnection(A, 'shiprocket', { email: 'a@shop.test', webhook_token: TOKEN }, null, { verify: accept });
      expect(r.ok && r.connection).toMatchObject({ connected: true, webhookConfigured: true });
      expect(await resolveBusinessForWebhookToken('shiprocket', TOKEN)).toBe(A);
      expect(await resolveBusinessForWebhookToken('shiprocket', 'x'.repeat(32))).toBeNull();
      expect(await resolveBusinessForWebhookToken('shiprocket', '')).toBeNull();
      expect(await resolveBusinessForWebhookToken('delhivery', TOKEN)).toBeNull();
      expect(
        await saveConnection(B, 'shiprocket', { email: 'b@shop.test', password: 'p', webhook_token: TOKEN }, null, { verify: accept }),
      ).toEqual({ ok: false, code: 'TOKEN_TAKEN', error: 'Generate a new webhook token' });
      expect(await getConnection(B, 'shiprocket')).toBeNull();
    });

    test('a row with a token but no password is not connected, keeps its token when credentials arrive', async () => {
      await pool.query(`INSERT INTO business_integrations (business_id, provider, webhook_token_hash) VALUES ($1, 'shiprocket', $2)`, [C, HASH_C]);
      expect(await getConnection(C, 'shiprocket')).toMatchObject({ connected: false, webhookConfigured: true });
      expect(await loadSecrets(C, 'shiprocket')).toEqual({ config: {}, secrets: {} });
      await saveConnection(C, 'shiprocket', { email: 'c@shop.test', password: 'p' }, null, { verify: accept });
      expect(await resolveBusinessForWebhookToken('shiprocket', TOKEN_C)).toBe(C);
      expect(await getConnection(C, 'shiprocket')).toMatchObject({ connected: true, webhookConfigured: true });
    });

    test('a copied row with a NULL email reads as empty config and not connected', async () => {
      await pool.query(
        `INSERT INTO business_integrations (business_id, provider, config, secrets_enc) VALUES ($1, 'shiprocket', '{"email": null}', '{}')`,
        [D],
      );
      expect(await getConnection(D, 'shiprocket')).toMatchObject({ connected: false, config: {}, secretsSet: [] });
      expect(await loadSecrets(D, 'shiprocket')).toEqual({ config: {}, secrets: {} });
      await pool.query(`DELETE FROM business_integrations WHERE business_id = $1`, [D]);
    });

    test('setWebhookToken: needs a row; null clears', async () => {
      expect(await setWebhookToken(D, 'shiprocket', TOKEN_C)).toEqual({
        ok: false,
        code: 'NOT_CONNECTED',
        error: 'Connect Shiprocket first',
      });
      expect(await setWebhookToken(C, 'shiprocket', 'short')).toMatchObject({ ok: false, code: 'INVALID' });
      expect(await setWebhookToken(C, 'shiprocket', TOKEN)).toEqual({ ok: false, code: 'TOKEN_TAKEN', error: 'Generate a new webhook token' });
      expect(await setWebhookToken(C, 'shiprocket', null)).toEqual({ ok: true });
      expect(await getConnection(C, 'shiprocket')).toMatchObject({ connected: true, webhookConfigured: false });
      expect(await resolveBusinessForWebhookToken('shiprocket', TOKEN_C)).toBeNull();
      expect(await setWebhookToken(C, 'shiprocket', TOKEN_C)).toEqual({ ok: true });
      expect(await resolveBusinessForWebhookToken('shiprocket', TOKEN_C)).toBe(C);
    });

    test('business B never sees or changes business A', async () => {
      expect(await getConnection(B, 'shiprocket')).toBeNull();
      expect(await loadSecrets(B, 'shiprocket')).toBeNull();
      expect(await disconnect(B, 'shiprocket')).toEqual({ ok: true });
      expect(await getConnection(A, 'shiprocket')).not.toBeNull();
    });

    test('disconnect is refused with a parcel in flight', async () => {
      fulfilmentId = randomUUID();
      await pool.query(
        `INSERT INTO order_fulfilments (id, business_id, channel, method, status, public_token)
         VALUES ($1, $2, 'manual', 'shiprocket', 'shipped', $3)`,
        [fulfilmentId, A, `pt${randomUUID().replace(/-/g, '')}`],
      );
      expect(await disconnect(A, 'shiprocket')).toEqual({ ok: false, code: 'IN_FLIGHT', count: 1 });
      expect(await getConnection(A, 'shiprocket')).not.toBeNull();
    });

    test('disconnect deletes the row, clears the old columns and resets the checkout provider', async () => {
      await pool.query(`UPDATE order_fulfilments SET status = 'delivered' WHERE id = $1`, [fulfilmentId]);
      await pool.query(
        `UPDATE business_settings SET store_shiprocket_email = 'old@shop.test', store_shiprocket_password_enc = 'OLDCIPHER',
           store_shiprocket_webhook_token_hash = $2, store_delivery_provider = 'shiprocket' WHERE business_id = $1`,
        [A, HASH_A],
      );
      expect(await disconnect(A, 'shiprocket')).toEqual({ ok: true });
      expect(await getConnection(A, 'shiprocket')).toBeNull();
      const s = (
        await pool.query(
          `SELECT store_shiprocket_email, store_shiprocket_password_enc, store_shiprocket_webhook_token_hash, store_delivery_provider
             FROM business_settings WHERE business_id = $1`,
          [A],
        )
      ).rows[0];
      expect(s).toEqual({
        store_shiprocket_email: null,
        store_shiprocket_password_enc: null,
        store_shiprocket_webhook_token_hash: null,
        store_delivery_provider: 'self',
      });
      await pool.query(COPY_SQL);
      expect(await getConnection(A, 'shiprocket')).toBeNull();
      expect(await resolveBusinessForWebhookToken('shiprocket', TOKEN)).toBeNull();
      expect(await getConnection(C, 'shiprocket')).not.toBeNull();
    });

    test('disconnect twice, or with nothing connected, is ok', async () => {
      expect(await disconnect(A, 'shiprocket')).toEqual({ ok: true });
      expect(await disconnect(D, 'shiprocket')).toEqual({ ok: true });
    });

    test('loadShiprocketCreds reads the connection, not the old columns', async () => {
      await pool.query(
        `UPDATE business_settings SET store_shiprocket_email = 'old@shop.test', store_shiprocket_password_enc = $2 WHERE business_id = $1`,
        [D, encryptPaymentSecret('old')],
      );
      expect(await loadShiprocketCreds(D)).toBeNull();
      await saveConnection(D, 'shiprocket', { email: 'new@shop.test', password: 'new' }, null, { verify: accept });
      expect(await loadShiprocketCreds(D)).toEqual({ email: 'new@shop.test', password: 'new' });
    });
  });
});
