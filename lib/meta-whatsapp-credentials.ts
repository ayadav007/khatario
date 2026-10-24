/**
 * Load/save Meta Cloud API credentials from platform_settings or whatsapp_config.
 * Tokens stay encrypted at rest; APIs never return plaintext secrets.
 */

import { query, queryOne } from '@/lib/db';
import { decryptSecret, encryptSecret } from '@/lib/secret-encryption';

export type MetaWaConfig = {
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
};

export type MetaWaSecrets = MetaWaConfig & {
  appSecret: string;
  verifyToken: string;
};

export type MetaWaPublicCredentials = {
  waba_id: string;
  phone_number_id: string;
  has_access_token: boolean;
  has_app_secret: boolean;
  has_verify_token: boolean;
  ready: boolean;
  missing: string[];
};

function decryptOptional(blob: string | null | undefined): string {
  if (!blob?.trim()) return '';
  try {
    return decryptSecret(blob).trim();
  } catch {
    return '';
  }
}

function envFallback(): MetaWaSecrets {
  return {
    accessToken: process.env.META_WA_ACCESS_TOKEN?.trim() || '',
    wabaId: process.env.META_WA_WABA_ID?.trim() || '',
    phoneNumberId: process.env.META_WA_PHONE_NUMBER_ID?.trim() || '',
    appSecret: process.env.META_WA_APP_SECRET?.trim() || '',
    verifyToken: process.env.META_WA_VERIFY_TOKEN?.trim() || '',
  };
}

function mergePreferStored(stored: Partial<MetaWaSecrets>, fallback: MetaWaSecrets): MetaWaSecrets {
  return {
    accessToken: stored.accessToken || fallback.accessToken,
    wabaId: stored.wabaId || fallback.wabaId,
    phoneNumberId: stored.phoneNumberId || fallback.phoneNumberId,
    appSecret: stored.appSecret || fallback.appSecret,
    verifyToken: stored.verifyToken || fallback.verifyToken,
  };
}

export function toPublicMetaWaCredentials(secrets: MetaWaSecrets): MetaWaPublicCredentials {
  const missing: string[] = [];
  if (!secrets.accessToken) missing.push('Access token');
  if (!secrets.wabaId) missing.push('WhatsApp Business Account ID');
  if (!secrets.phoneNumberId) missing.push('Phone number ID');
  return {
    waba_id: secrets.wabaId,
    phone_number_id: secrets.phoneNumberId,
    has_access_token: Boolean(secrets.accessToken),
    has_app_secret: Boolean(secrets.appSecret),
    has_verify_token: Boolean(secrets.verifyToken),
    ready: missing.length === 0,
    missing,
  };
}

export function toGraphConfig(secrets: MetaWaSecrets): MetaWaConfig | null {
  if (!secrets.accessToken || !secrets.wabaId || !secrets.phoneNumberId) return null;
  return {
    accessToken: secrets.accessToken,
    wabaId: secrets.wabaId,
    phoneNumberId: secrets.phoneNumberId,
  };
}

export async function loadPlatformMetaWaSecrets(): Promise<MetaWaSecrets> {
  const fallback = envFallback();
  try {
    const row = await queryOne<{
      meta_wa_waba_id: string | null;
      meta_wa_phone_number_id: string | null;
      encrypted_meta_wa_access_token: string | null;
      encrypted_meta_wa_app_secret: string | null;
      encrypted_meta_wa_verify_token: string | null;
    }>(
      `SELECT meta_wa_waba_id, meta_wa_phone_number_id,
              encrypted_meta_wa_access_token, encrypted_meta_wa_app_secret,
              encrypted_meta_wa_verify_token
       FROM platform_settings WHERE id = 'default'`,
    );
    if (!row) return fallback;
    return mergePreferStored(
      {
        accessToken: decryptOptional(row.encrypted_meta_wa_access_token),
        wabaId: row.meta_wa_waba_id?.trim() || '',
        phoneNumberId: row.meta_wa_phone_number_id?.trim() || '',
        appSecret: decryptOptional(row.encrypted_meta_wa_app_secret),
        verifyToken: decryptOptional(row.encrypted_meta_wa_verify_token),
      },
      fallback,
    );
  } catch {
    return fallback;
  }
}

export async function loadBusinessMetaWaSecrets(businessId: string): Promise<MetaWaSecrets> {
  const empty: MetaWaSecrets = {
    accessToken: '',
    wabaId: '',
    phoneNumberId: '',
    appSecret: '',
    verifyToken: '',
  };
  try {
    const row = await queryOne<{
      meta_waba_id: string | null;
      phone_number_id: string | null;
      encrypted_meta_access_token: string | null;
      encrypted_meta_app_secret: string | null;
      encrypted_meta_verify_token: string | null;
    }>(
      `SELECT meta_waba_id, phone_number_id,
              encrypted_meta_access_token, encrypted_meta_app_secret,
              encrypted_meta_verify_token
       FROM whatsapp_config WHERE business_id = $1`,
      [businessId],
    );
    if (!row) return empty;
    return {
      accessToken: decryptOptional(row.encrypted_meta_access_token),
      wabaId: row.meta_waba_id?.trim() || '',
      phoneNumberId: row.phone_number_id?.trim() || '',
      appSecret: decryptOptional(row.encrypted_meta_app_secret),
      verifyToken: decryptOptional(row.encrypted_meta_verify_token),
    };
  } catch {
    return empty;
  }
}

export async function savePlatformMetaWaCredentials(input: {
  waba_id: string;
  phone_number_id: string;
  access_token?: string;
  app_secret?: string;
  verify_token?: string;
}): Promise<MetaWaPublicCredentials> {
  const existing = await loadPlatformMetaWaSecrets();
  const accessToken = input.access_token?.trim() || existing.accessToken;
  const appSecret = input.app_secret?.trim() || existing.appSecret;
  const verifyToken = input.verify_token?.trim() || existing.verifyToken;
  const wabaId = input.waba_id.trim();
  const phoneNumberId = input.phone_number_id.trim();

  await query(
    `INSERT INTO platform_settings (
       id, meta_wa_waba_id, meta_wa_phone_number_id,
       encrypted_meta_wa_access_token, encrypted_meta_wa_app_secret, encrypted_meta_wa_verify_token, updated_at
     ) VALUES ('default', $1, $2, $3, $4, $5, NOW())
     ON CONFLICT (id) DO UPDATE SET
       meta_wa_waba_id = EXCLUDED.meta_wa_waba_id,
       meta_wa_phone_number_id = EXCLUDED.meta_wa_phone_number_id,
       encrypted_meta_wa_access_token = COALESCE(EXCLUDED.encrypted_meta_wa_access_token, platform_settings.encrypted_meta_wa_access_token),
       encrypted_meta_wa_app_secret = COALESCE(EXCLUDED.encrypted_meta_wa_app_secret, platform_settings.encrypted_meta_wa_app_secret),
       encrypted_meta_wa_verify_token = COALESCE(EXCLUDED.encrypted_meta_wa_verify_token, platform_settings.encrypted_meta_wa_verify_token),
       updated_at = NOW()`,
    [
      wabaId || null,
      phoneNumberId || null,
      accessToken ? encryptSecret(accessToken) : null,
      appSecret ? encryptSecret(appSecret) : null,
      verifyToken ? encryptSecret(verifyToken) : null,
    ],
  );

  return toPublicMetaWaCredentials({
    accessToken,
    wabaId,
    phoneNumberId,
    appSecret,
    verifyToken,
  });
}

export async function saveBusinessMetaWaCredentials(
  businessId: string,
  input: {
    waba_id: string;
    phone_number_id: string;
    access_token?: string;
    app_secret?: string;
    verify_token?: string;
  },
): Promise<MetaWaPublicCredentials> {
  const existing = await loadBusinessMetaWaSecrets(businessId);
  const accessToken = input.access_token?.trim() || existing.accessToken;
  const appSecret = input.app_secret?.trim() || existing.appSecret;
  const verifyToken = input.verify_token?.trim() || existing.verifyToken;
  const wabaId = input.waba_id.trim();
  const phoneNumberId = input.phone_number_id.trim();

  await query(
    `INSERT INTO whatsapp_config (
       business_id, connection_type, phone_number_id, meta_waba_id,
       encrypted_meta_access_token, encrypted_meta_app_secret, encrypted_meta_verify_token
     ) VALUES ($1, 'cloud_api', $2, $3, $4, $5, $6)
     ON CONFLICT (business_id) DO UPDATE SET
       phone_number_id = EXCLUDED.phone_number_id,
       meta_waba_id = EXCLUDED.meta_waba_id,
       encrypted_meta_access_token = COALESCE(EXCLUDED.encrypted_meta_access_token, whatsapp_config.encrypted_meta_access_token),
       encrypted_meta_app_secret = COALESCE(EXCLUDED.encrypted_meta_app_secret, whatsapp_config.encrypted_meta_app_secret),
       encrypted_meta_verify_token = COALESCE(EXCLUDED.encrypted_meta_verify_token, whatsapp_config.encrypted_meta_verify_token),
       updated_at = CURRENT_TIMESTAMP`,
    [
      businessId,
      phoneNumberId || null,
      wabaId || null,
      accessToken ? encryptSecret(accessToken) : null,
      appSecret ? encryptSecret(appSecret) : null,
      verifyToken ? encryptSecret(verifyToken) : null,
    ],
  );

  return toPublicMetaWaCredentials({
    accessToken,
    wabaId,
    phoneNumberId,
    appSecret,
    verifyToken,
  });
}

export async function getMetaWaConfig(businessId?: string | null): Promise<MetaWaConfig | null> {
  const secrets = businessId
    ? await loadBusinessMetaWaSecrets(businessId)
    : await loadPlatformMetaWaSecrets();
  return toGraphConfig(secrets);
}

export async function isMetaWaConfigured(businessId?: string | null): Promise<boolean> {
  return (await getMetaWaConfig(businessId)) != null;
}
