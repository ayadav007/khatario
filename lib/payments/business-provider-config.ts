/**
 * Load per-business PSP settings from DB (decrypted) with ENV fallback.
 * Never return encrypted blobs or raw secrets to API responses — use plain fields only in-memory.
 */

import { queryOne, queryRows } from '@/lib/db';
import { decryptPaymentSecret, encryptPaymentSecret } from './secret-encryption';
import type { PaymentProviderConfig } from './types';

export type BusinessPaymentProviderConfigRow = {
  id: string;
  business_id: string;
  provider: string;
  environment: 'sandbox' | 'production';
};

/**
 * Decrypted credentials for a single provider (server-side only).
 */
export type DecryptedBusinessPaymentConfig = PaymentProviderConfig & {
  environment: 'sandbox' | 'production';
};

/**
 * Read and decrypt config for one business + provider. Returns null if no row.
 */
export async function getBusinessPaymentProviderConfig(
  businessId: string,
  provider: string
): Promise<DecryptedBusinessPaymentConfig | null> {
  const row = await queryOne<{
    encrypted_client_id: string;
    encrypted_client_secret: string;
    environment: string;
  }>(
    `SELECT encrypted_client_id, encrypted_client_secret, environment
     FROM payment_provider_configs
     WHERE business_id = $1 AND LOWER(provider) = LOWER($2)
     LIMIT 1`,
    [businessId, provider]
  );

  if (!row) {
    return null;
  }

  const env =
    row.environment === 'production' ? 'production' : 'sandbox';

  const clientIdPlain = decryptPaymentSecret(row.encrypted_client_id);
  const clientSecretPlain = decryptPaymentSecret(row.encrypted_client_secret);

  return {
    clientId: clientIdPlain,
    appId: clientIdPlain,
    clientSecret: clientSecretPlain,
    secretKey: clientSecretPlain,
    environment: env,
  };
}

/**
 * Overlay explicit config with ENV defaults for missing keys (sync helper for createPaymentProvider).
 */
export function mergePaymentProviderConfigWithEnv(
  providerId: string,
  config: PaymentProviderConfig
): PaymentProviderConfig {
  const env = getEnvPaymentProviderFallback(providerId);
  return {
    ...env,
    ...config,
    clientId: config.clientId || env.clientId,
    clientSecret: config.clientSecret || env.clientSecret,
    appId: config.appId || env.appId || config.clientId || env.clientId,
    secretKey:
      config.secretKey ||
      env.secretKey ||
      config.clientSecret ||
      env.clientSecret,
    webhookSecret: config.webhookSecret || env.webhookSecret,
    environment: config.environment || env.environment,
    baseUrl: config.baseUrl || env.baseUrl,
  };
}

/** ENV-only defaults when no DB row (or to fill gaps). */
export function getEnvPaymentProviderFallback(providerId: string): PaymentProviderConfig {
  const id = providerId.toLowerCase();
  if (id === 'cashfree') {
    return {
      clientId: process.env.CASHFREE_CLIENT_ID || process.env.CASHFREE_APP_ID,
      appId: process.env.CASHFREE_CLIENT_ID || process.env.CASHFREE_APP_ID,
      clientSecret: process.env.CASHFREE_CLIENT_SECRET || process.env.CASHFREE_SECRET_KEY,
      secretKey: process.env.CASHFREE_CLIENT_SECRET || process.env.CASHFREE_SECRET_KEY,
      webhookSecret:
        process.env.CASHFREE_WEBHOOK_SECRET ||
        process.env.CASHFREE_CLIENT_SECRET ||
        process.env.CASHFREE_SECRET_KEY,
      environment:
        (process.env.CASHFREE_ENV as 'sandbox' | 'production') || 'sandbox',
    };
  }
  if (id === 'phonepe') {
    const mid =
      process.env.PHONEPE_MERCHANT_ID || process.env.PHONEPE_CLIENT_ID;
    return {
      clientId: mid,
      appId: mid,
      clientSecret:
        process.env.PHONEPE_SALT_KEY ||
        process.env.PHONEPE_CLIENT_SECRET ||
        process.env.PHONEPE_SALT,
      secretKey:
        process.env.PHONEPE_SALT_KEY ||
        process.env.PHONEPE_CLIENT_SECRET ||
        process.env.PHONEPE_SALT,
      environment:
        (process.env.PHONEPE_ENV as 'sandbox' | 'production') || 'sandbox',
    };
  }
  if (id === 'instamojo') {
    return {
      clientId:
        process.env.INSTAMOJO_API_KEY || process.env.INSTAMOJO_CLIENT_ID,
      appId:
        process.env.INSTAMOJO_API_KEY || process.env.INSTAMOJO_CLIENT_ID,
      clientSecret:
        process.env.INSTAMOJO_AUTH_TOKEN || process.env.INSTAMOJO_CLIENT_SECRET,
      secretKey:
        process.env.INSTAMOJO_AUTH_TOKEN || process.env.INSTAMOJO_CLIENT_SECRET,
      webhookSecret:
        process.env.INSTAMOJO_PRIVATE_SALT ||
        process.env.INSTAMOJO_WEBHOOK_SALT ||
        process.env.INSTAMOJO_AUTH_TOKEN,
      environment:
        (process.env.INSTAMOJO_ENV as 'sandbox' | 'production') || 'sandbox',
    };
  }
  return {};
}

/**
 * Merge: DB row if present, then overlay ENV for any missing field.
 */
export async function resolvePaymentProviderConfigForBusiness(
  businessId: string,
  providerId: string
): Promise<PaymentProviderConfig> {
  const fromDb = await getBusinessPaymentProviderConfig(businessId, providerId);
  const fromEnv = getEnvPaymentProviderFallback(providerId);

  if (!fromDb) {
    return mergePaymentProviderConfigWithEnv(providerId, fromEnv);
  }

  return mergePaymentProviderConfigWithEnv(providerId, {
    ...fromEnv,
    ...fromDb,
    clientId: fromDb.clientId || fromEnv.clientId,
    clientSecret: fromDb.clientSecret || fromEnv.clientSecret,
    webhookSecret: fromDb.webhookSecret || fromEnv.webhookSecret,
    environment: fromDb.environment || fromEnv.environment,
    baseUrl: fromDb.baseUrl || fromEnv.baseUrl,
  });
}

/**
 * List configured providers for a business (metadata only — no secrets).
 */
export async function listBusinessPaymentProviderIds(
  businessId: string
): Promise<Array<{ provider: string; environment: string }>> {
  return queryRows<{ provider: string; environment: string }>(
    `SELECT provider, environment FROM payment_provider_configs WHERE business_id = $1 ORDER BY provider ASC`,
    [businessId]
  );
}

export type UpsertBusinessPaymentProviderInput = {
  businessId: string;
  provider: string;
  clientId: string;
  clientSecret: string;
  environment: 'sandbox' | 'production';
};

/**
 * Insert or update encrypted credentials (call only from trusted server routes / scripts).
 */
export async function upsertBusinessPaymentProviderConfig(
  input: UpsertBusinessPaymentProviderInput
): Promise<BusinessPaymentProviderConfigRow> {
  const encId = encryptPaymentSecret(input.clientId);
  const encSec = encryptPaymentSecret(input.clientSecret);

  const row = await queryOne<BusinessPaymentProviderConfigRow & { business_id: string }>(
    `INSERT INTO payment_provider_configs (
       business_id, provider, encrypted_client_id, encrypted_client_secret, environment
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (business_id, provider) DO UPDATE SET
       encrypted_client_id = EXCLUDED.encrypted_client_id,
       encrypted_client_secret = EXCLUDED.encrypted_client_secret,
       environment = EXCLUDED.environment,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, business_id, provider, environment`,
    [
      input.businessId,
      input.provider.toLowerCase(),
      encId,
      encSec,
      input.environment,
    ]
  );

  if (!row) {
    throw new Error('upsertBusinessPaymentProviderConfig: no row returned');
  }

  return {
    id: row.id,
    business_id: row.business_id,
    provider: row.provider,
    environment: row.environment,
  };
}
