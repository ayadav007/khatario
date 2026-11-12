// Server-only: the one module that reads and writes business_integrations.
// Nothing returned from here to a route carries a secret, a ciphertext or a token hash,
// except loadSecrets, whose plaintext is for server-side callers only.
import { getPool, queryOne, queryRows } from '@/lib/db';
import { getPluginEntry, type IntegrationCatalogEntry, type IntegrationPlugin, type PluginField } from '@/lib/integrations/catalog';
import { getProvider, type ProviderServer } from '@/lib/integrations/providers';
import { decryptPaymentSecret, encryptPaymentSecret } from '@/lib/payments/secret-encryption';
import { hashStoreWebhookToken, isValidShiprocketWebhookToken } from '@/lib/store/delivery/webhooks';

export type ConnectionView = {
  provider: string;
  connected: boolean; // row exists and every required field has a stored value
  config: Record<string, string>;
  secretsSet: string[];
  webhookConfigured: boolean;
  lastVerifiedAt: string | null;
};
export type SaveValues = Record<string, unknown>; // keyed by PluginField.key; webhook_token: string = set, null = clear, absent = keep
export type SaveResult =
  | { ok: true; connection: ConnectionView }
  | { ok: false; code: 'INVALID' | 'REJECTED' | 'UNREACHABLE' | 'TOKEN_TAKEN'; error: string };
export type DisconnectResult = { ok: true } | { ok: false; code: 'IN_FLIGHT'; count: number };

const MAX_VALUE_LENGTH = 255;
const TOKEN_INDEX = 'uq_business_integrations_webhook_token';
const TOKEN_TAKEN = 'Generate a new webhook token';

type Row = {
  provider: string;
  config: unknown;
  secrets_enc: unknown;
  webhook_token_hash: string | null;
  last_verified_at: Date | string | null;
};

const ROW_COLUMNS = 'provider, config, secrets_enc, webhook_token_hash, last_verified_at';

/** Ruling R1: only string values survive, so a copied NULL email reads as absent. */
function stringsOnly(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/** Ciphertexts stored per secret field; empty strings count as not set. */
function storedSecrets(row: Row): Record<string, string> {
  return Object.fromEntries(Object.entries(stringsOnly(row.secrets_enc)).filter(([, v]) => v !== ''));
}

function pluginForProvider(provider: string): IntegrationPlugin | null {
  const entry = getPluginEntry(provider);
  return entry && entry.plugin.provider === provider ? entry.plugin : null;
}

function isConfigField(f: PluginField): boolean {
  return f.kind === 'text' || f.kind === 'email';
}

function toView(row: Row): ConnectionView {
  const config = stringsOnly(row.config);
  const secrets = storedSecrets(row);
  const plugin = pluginForProvider(row.provider);
  const connected = plugin
    ? plugin.fields.every((f) => {
        if (!f.required) return true;
        if (f.kind === 'password') return Boolean(secrets[f.key]);
        if (isConfigField(f)) return Boolean(config[f.key]);
        return true;
      })
    : Object.keys(secrets).length > 0;
  const at = row.last_verified_at;
  return {
    provider: row.provider,
    connected,
    config,
    secretsSet: Object.keys(secrets).sort(),
    webhookConfigured: Boolean(row.webhook_token_hash),
    lastVerifiedAt: at == null ? null : at instanceof Date ? at.toISOString() : String(at),
  };
}

async function readRow(businessId: string, provider: string): Promise<Row | null> {
  return queryOne<Row>(
    `SELECT ${ROW_COLUMNS} FROM business_integrations WHERE business_id = $1 AND provider = $2`,
    [businessId, provider],
  );
}

/**
 * Writes that can hit the webhook-token index go straight to the pool: lib/db.ts `query` logs the whole
 * pg error, and a 23505 error's `detail` contains the token hash.
 */
async function writeOne<T extends Row | { provider: string }>(text: string, params: unknown[]): Promise<T | null> {
  const res = await getPool().query(text, params);
  return (res.rows[0] as T | undefined) ?? null;
}

function isTokenCollision(error: unknown): boolean {
  const e = error as { code?: string; constraint?: string } | null;
  return Boolean(e && e.code === '23505' && e.constraint === TOKEN_INDEX);
}

export async function listConnections(businessId: string): Promise<ConnectionView[]> {
  const rows = await queryRows<Row>(
    `SELECT ${ROW_COLUMNS} FROM business_integrations WHERE business_id = $1 ORDER BY provider`,
    [businessId],
  );
  return rows.map(toView);
}

export async function getConnection(businessId: string, provider: string): Promise<ConnectionView | null> {
  const row = await readRow(businessId, provider);
  return row ? toView(row) : null;
}

export async function loadSecrets(
  businessId: string,
  provider: string,
): Promise<{ config: Record<string, string>; secrets: Record<string, string> } | null> {
  const row = await readRow(businessId, provider);
  if (!row) return null;
  const secrets: Record<string, string> = {};
  for (const [k, enc] of Object.entries(storedSecrets(row))) secrets[k] = decryptPaymentSecret(enc);
  return { config: stringsOnly(row.config), secrets };
}

function invalid(error: string): SaveResult {
  return { ok: false, code: 'INVALID', error };
}

export async function saveConnection(
  businessId: string,
  pluginId: string,
  values: SaveValues,
  actorUserId: string | null,
  opts?: { verify?: ProviderServer['verify'] },
): Promise<SaveResult> {
  const entry: (IntegrationCatalogEntry & { plugin: IntegrationPlugin }) | null = getPluginEntry(pluginId);
  if (!entry) return invalid('Unknown integration');
  const { plugin } = entry;
  const provider = plugin.provider;
  const server = getProvider(provider);
  const verify = opts?.verify ?? server?.verify;
  if (!verify) return invalid('Unknown integration');

  if (!values || typeof values !== 'object' || Array.isArray(values)) return invalid('Invalid values');
  const fields = new Map(plugin.fields.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(values)) {
    const field = fields.get(key);
    if (!field) return invalid(`Unknown field: ${key}`);
    if (value === undefined) continue;
    if (value === null && field.kind === 'webhook_token') continue;
    if (typeof value !== 'string') return invalid(`${field.label} must be text`);
    if (value.length > MAX_VALUE_LENGTH) return invalid(`${field.label} must be at most ${MAX_VALUE_LENGTH} characters`);
  }

  const row = await readRow(businessId, provider);
  const storedConfig = row ? stringsOnly(row.config) : {};
  const storedEnc = row ? storedSecrets(row) : {};

  const config: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  const secretsEnc: Record<string, string> = {};
  let tokenSent = false;
  let tokenHash: string | null = null;

  for (const field of plugin.fields) {
    const sent = values[field.key];
    if (isConfigField(field)) {
      const value = typeof sent === 'string' ? sent.trim() : storedConfig[field.key] ?? '';
      if (value === '') {
        if (field.required) return invalid(`${field.label} is required`);
        continue;
      }
      if (field.kind === 'email' && !value.includes('@')) return invalid(`${field.label} must be an email address`);
      config[field.key] = value;
    } else if (field.kind === 'password') {
      if (typeof sent === 'string' && sent !== '') {
        secrets[field.key] = sent; // stored exactly as typed
        secretsEnc[field.key] = encryptPaymentSecret(sent);
      } else if (storedEnc[field.key]) {
        secrets[field.key] = decryptPaymentSecret(storedEnc[field.key]);
        secretsEnc[field.key] = storedEnc[field.key];
      } else if (field.required) {
        return invalid(`${field.label} is required`);
      }
    } else if (field.kind === 'webhook_token') {
      if (sent === null) {
        tokenSent = true;
        tokenHash = null;
      } else if (sent !== undefined) {
        if (!isValidShiprocketWebhookToken(sent)) return invalid('Webhook token must be 24–128 letters or digits');
        tokenSent = true;
        tokenHash = hashStoreWebhookToken(sent);
      }
    }
  }

  const check = await verify({ config, secrets });
  if (!check.ok) {
    return { ok: false, code: check.reason === 'rejected' ? 'REJECTED' : 'UNREACHABLE', error: check.message };
  }

  let saved: Row | null;
  try {
    saved = await writeOne<Row>(
      `INSERT INTO business_integrations
         (business_id, provider, config, secrets_enc, webhook_token_hash, last_verified_at, connected_by, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, now(), $6, now())
       ON CONFLICT (business_id, provider) DO UPDATE SET
         config = EXCLUDED.config,
         secrets_enc = EXCLUDED.secrets_enc,
         webhook_token_hash = CASE WHEN $7::boolean THEN EXCLUDED.webhook_token_hash
                                   ELSE business_integrations.webhook_token_hash END,
         last_verified_at = now(),
         connected_by = EXCLUDED.connected_by,
         updated_at = now()
       RETURNING ${ROW_COLUMNS}`,
      [businessId, provider, JSON.stringify(config), JSON.stringify(secretsEnc), tokenHash, actorUserId, tokenSent],
    );
  } catch (error) {
    if (isTokenCollision(error)) return { ok: false, code: 'TOKEN_TAKEN', error: TOKEN_TAKEN };
    throw error;
  }
  if (!saved) throw new Error('Saving the integration returned no row');

  server?.onChanged?.(businessId);
  return { ok: true, connection: toView(saved) };
}

export async function setWebhookToken(
  businessId: string,
  provider: string,
  token: string | null,
): Promise<{ ok: true } | { ok: false; code: 'NOT_CONNECTED' | 'INVALID' | 'TOKEN_TAKEN'; error: string }> {
  if (token !== null && !isValidShiprocketWebhookToken(token)) {
    return { ok: false, code: 'INVALID', error: 'Webhook token must be 24–128 letters or digits' };
  }
  const hash = token === null ? null : hashStoreWebhookToken(token);
  let updated: { provider: string } | null;
  try {
    updated = await writeOne<{ provider: string }>(
      `UPDATE business_integrations SET webhook_token_hash = $3, updated_at = now()
        WHERE business_id = $1 AND provider = $2
        RETURNING provider`,
      [businessId, provider, hash],
    );
  } catch (error) {
    if (isTokenCollision(error)) return { ok: false, code: 'TOKEN_TAKEN', error: TOKEN_TAKEN };
    throw error;
  }
  if (!updated) {
    const title = getPluginEntry(provider)?.title ?? provider;
    return { ok: false, code: 'NOT_CONNECTED', error: `Connect ${title} first` };
  }
  return { ok: true };
}

export async function disconnect(businessId: string, provider: string): Promise<DisconnectResult> {
  const server = getProvider(provider);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT id FROM business_integrations WHERE business_id = $1 AND provider = $2 FOR UPDATE`,
      [businessId, provider],
    );
    if (found.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: true };
    }
    const count = server ? await server.countInFlight(businessId) : 0;
    if (count > 0) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'IN_FLIGHT', count };
    }
    await client.query(`DELETE FROM business_integrations WHERE business_id = $1 AND provider = $2`, [businessId, provider]);
    await server?.onDisconnect?.(client, businessId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  server?.onChanged?.(businessId);
  return { ok: true };
}

export async function resolveBusinessForWebhookToken(provider: string, token: string): Promise<string | null> {
  if (!isValidShiprocketWebhookToken(token)) return null;
  const row = await queryOne<{ business_id: string }>(
    `SELECT business_id FROM business_integrations WHERE provider = $1 AND webhook_token_hash = $2`,
    [provider, hashStoreWebhookToken(token)],
  );
  return row?.business_id ?? null;
}
