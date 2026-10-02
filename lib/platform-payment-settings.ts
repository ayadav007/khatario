/**
 * Khatario's own payment gateway (subscription + add-on billing), set in Admin > Settings > Payments.
 * Saved values in platform_settings win; empty columns fall back to PLATFORM_* env vars.
 * Secrets stay encrypted at rest and are never returned to the browser.
 */

import { query, queryOne } from '@/lib/db';
import { decryptSecret, encryptSecret } from '@/lib/secret-encryption';

export const PLATFORM_PAYMENT_PROVIDERS = ['razorpay', 'easebuzz'] as const;
export type PlatformPaymentProviderId = (typeof PLATFORM_PAYMENT_PROVIDERS)[number];
export type EasebuzzEnvironment = 'sandbox' | 'production';
export type SettingSource = 'saved' | 'env' | 'none';

export type PlatformPaymentSecrets = {
  activeProvider: PlatformPaymentProviderId;
  activeSource: 'saved' | 'env' | 'default';
  razorpay: { keyId: string; keySecret: string; webhookSecret: string; source: SettingSource };
  easebuzz: { key: string; salt: string; environment: EasebuzzEnvironment; source: SettingSource };
};

export type PlatformPaymentPublicSettings = {
  active_provider: PlatformPaymentProviderId;
  active_source: 'saved' | 'env' | 'default';
  active_ready: boolean;
  razorpay: {
    key_id: string;
    mode: 'test' | 'live' | null;
    has_key_secret: boolean;
    has_webhook_secret: boolean;
    source: SettingSource;
    ready: boolean;
    missing: string[];
  };
  easebuzz: {
    key_masked: string | null;
    has_salt: boolean;
    environment: EasebuzzEnvironment;
    source: SettingSource;
    ready: boolean;
    missing: string[];
  };
  webhook_urls: Record<PlatformPaymentProviderId, string>;
};

type Row = {
  platform_payment_provider: string | null;
  platform_razorpay_key_id: string | null;
  encrypted_platform_razorpay_key_secret: string | null;
  encrypted_platform_razorpay_webhook_secret: string | null;
  platform_easebuzz_key: string | null;
  encrypted_platform_easebuzz_salt: string | null;
  platform_easebuzz_environment: string | null;
};

function decryptOptional(blob: string | null | undefined): string {
  if (!blob?.trim()) return '';
  try {
    return decryptSecret(blob).trim();
  } catch {
    return '';
  }
}

function env(name: string): string {
  return process.env[name]?.trim() || '';
}

function isProvider(v: unknown): v is PlatformPaymentProviderId {
  return typeof v === 'string' && (PLATFORM_PAYMENT_PROVIDERS as readonly string[]).includes(v);
}

function easebuzzEnv(v: string | null | undefined): EasebuzzEnvironment {
  return v === 'production' ? 'production' : 'sandbox';
}

function razorpayMissing(r: PlatformPaymentSecrets['razorpay']): string[] {
  const missing: string[] = [];
  if (!r.keyId) missing.push('Key ID');
  if (!r.keySecret) missing.push('Key secret');
  if (!r.webhookSecret) missing.push('Webhook secret');
  return missing;
}

function easebuzzMissing(e: PlatformPaymentSecrets['easebuzz']): string[] {
  const missing: string[] = [];
  if (!e.key) missing.push('Merchant key');
  if (!e.salt) missing.push('Salt');
  return missing;
}

export function isRazorpayReady(s: PlatformPaymentSecrets): boolean {
  return razorpayMissing(s.razorpay).length === 0;
}

export function isEasebuzzReady(s: PlatformPaymentSecrets): boolean {
  return easebuzzMissing(s.easebuzz).length === 0;
}

function resolve(row: Row | null): PlatformPaymentSecrets {
  const storedRzp = {
    keyId: row?.platform_razorpay_key_id?.trim() || '',
    keySecret: decryptOptional(row?.encrypted_platform_razorpay_key_secret),
    webhookSecret: decryptOptional(row?.encrypted_platform_razorpay_webhook_secret),
  };
  const envRzp = {
    keyId: env('PLATFORM_RAZORPAY_KEY_ID') || env('RAZORPAY_KEY_ID'),
    keySecret: env('PLATFORM_RAZORPAY_KEY_SECRET') || env('RAZORPAY_KEY_SECRET'),
    webhookSecret: env('PLATFORM_RAZORPAY_WEBHOOK_SECRET') || env('RAZORPAY_WEBHOOK_SECRET'),
  };
  const storedEb = {
    key: row?.platform_easebuzz_key?.trim() || '',
    salt: decryptOptional(row?.encrypted_platform_easebuzz_salt),
  };
  const envEb = { key: env('PLATFORM_EASEBUZZ_KEY'), salt: env('PLATFORM_EASEBUZZ_SALT') };

  const razorpay = {
    keyId: storedRzp.keyId || envRzp.keyId,
    keySecret: storedRzp.keySecret || envRzp.keySecret,
    webhookSecret: storedRzp.webhookSecret || envRzp.webhookSecret,
    source: (storedRzp.keySecret ? 'saved' : envRzp.keySecret ? 'env' : 'none') as SettingSource,
  };
  const easebuzz = {
    key: storedEb.key || envEb.key,
    salt: storedEb.salt || envEb.salt,
    environment: easebuzzEnv(row?.platform_easebuzz_environment || env('PLATFORM_EASEBUZZ_ENV')),
    source: (storedEb.salt ? 'saved' : envEb.salt ? 'env' : 'none') as SettingSource,
  };

  const secrets: PlatformPaymentSecrets = {
    activeProvider: 'razorpay',
    activeSource: 'default',
    razorpay,
    easebuzz,
  };
  const stored = row?.platform_payment_provider;
  if (isProvider(stored)) {
    secrets.activeProvider = stored;
    secrets.activeSource = 'saved';
  } else if (env('PLATFORM_PAYMENT_PROVIDER').toLowerCase() === 'easebuzz' && isEasebuzzReady(secrets)) {
    secrets.activeProvider = 'easebuzz';
    secrets.activeSource = 'env';
  }
  return secrets;
}

async function loadRow(): Promise<Row | null> {
  try {
    return await queryOne<Row>(
      `SELECT platform_payment_provider, platform_razorpay_key_id,
              encrypted_platform_razorpay_key_secret, encrypted_platform_razorpay_webhook_secret,
              platform_easebuzz_key, encrypted_platform_easebuzz_salt, platform_easebuzz_environment
       FROM platform_settings WHERE id = 'default'`,
    );
  } catch {
    // Columns missing until migration 347 runs; env vars keep billing working.
    return null;
  }
}

export async function loadPlatformPaymentSecrets(): Promise<PlatformPaymentSecrets> {
  return resolve(await loadRow());
}

function maskKey(v: string): string | null {
  if (!v) return null;
  if (v.length <= 6) return '••••';
  return `${v.slice(0, 3)}••••${v.slice(-3)}`;
}

function appBaseUrl(): string {
  return (
    env('PUBLIC_PAYMENT_CALLBACK_URL') ||
    env('NEXT_PUBLIC_APP_URL') ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

export function toPublicPlatformPaymentSettings(s: PlatformPaymentSecrets): PlatformPaymentPublicSettings {
  const rzpMissing = razorpayMissing(s.razorpay);
  const ebMissing = easebuzzMissing(s.easebuzz);
  const base = appBaseUrl();
  return {
    active_provider: s.activeProvider,
    active_source: s.activeSource,
    active_ready: s.activeProvider === 'easebuzz' ? ebMissing.length === 0 : rzpMissing.length === 0,
    razorpay: {
      key_id: s.razorpay.keyId,
      mode: s.razorpay.keyId.startsWith('rzp_live_')
        ? 'live'
        : s.razorpay.keyId.startsWith('rzp_test_')
          ? 'test'
          : null,
      has_key_secret: Boolean(s.razorpay.keySecret),
      has_webhook_secret: Boolean(s.razorpay.webhookSecret),
      source: s.razorpay.source,
      ready: rzpMissing.length === 0,
      missing: rzpMissing,
    },
    easebuzz: {
      key_masked: maskKey(s.easebuzz.key),
      has_salt: Boolean(s.easebuzz.salt),
      environment: s.easebuzz.environment,
      source: s.easebuzz.source,
      ready: ebMissing.length === 0,
      missing: ebMissing,
    },
    webhook_urls: {
      razorpay: `${base}/api/webhooks/platform-billing/razorpay`,
      easebuzz: `${base}/api/webhooks/platform-billing/easebuzz`,
    },
  };
}

export class PlatformPaymentSettingsError extends Error {}

export type SavePlatformPaymentInput = {
  active_provider?: unknown;
  razorpay?: { key_id?: unknown; key_secret?: unknown; webhook_secret?: unknown };
  easebuzz?: { key?: unknown; salt?: unknown; environment?: unknown };
};

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Blank secret fields keep what is already saved. The active provider must be fully
 * configured (saved or env) so checkout never switches to a gateway that cannot charge.
 */
export async function savePlatformPaymentSettings(
  input: SavePlatformPaymentInput,
): Promise<PlatformPaymentPublicSettings> {
  const row = await loadRow();
  if (row === null) {
    const exists = await queryOne<{ ok: number }>(
      `SELECT 1 AS ok FROM information_schema.columns
       WHERE table_name = 'platform_settings' AND column_name = 'platform_payment_provider'`,
    );
    if (!exists) {
      throw new PlatformPaymentSettingsError('Run migration 347_platform_payment_settings.sql first.');
    }
  }

  const activeProvider = input.active_provider;
  if (!isProvider(activeProvider)) {
    throw new PlatformPaymentSettingsError('Choose Razorpay or Easebuzz.');
  }

  const rzpKeyId = text(input.razorpay?.key_id);
  const rzpKeySecret = text(input.razorpay?.key_secret);
  const rzpWebhookSecret = text(input.razorpay?.webhook_secret);
  const ebKey = text(input.easebuzz?.key);
  const ebSalt = text(input.easebuzz?.salt);
  const ebEnvRaw = text(input.easebuzz?.environment);
  if (ebEnvRaw && ebEnvRaw !== 'sandbox' && ebEnvRaw !== 'production') {
    throw new PlatformPaymentSettingsError('Easebuzz environment must be sandbox or production.');
  }
  if (rzpKeyId && !/^rzp_(test|live)_[A-Za-z0-9]+$/.test(rzpKeyId)) {
    throw new PlatformPaymentSettingsError('Razorpay Key ID should look like rzp_test_… or rzp_live_….');
  }

  const next: Row = {
    platform_payment_provider: activeProvider,
    platform_razorpay_key_id: rzpKeyId || row?.platform_razorpay_key_id || null,
    encrypted_platform_razorpay_key_secret: rzpKeySecret
      ? encryptSecret(rzpKeySecret)
      : row?.encrypted_platform_razorpay_key_secret || null,
    encrypted_platform_razorpay_webhook_secret: rzpWebhookSecret
      ? encryptSecret(rzpWebhookSecret)
      : row?.encrypted_platform_razorpay_webhook_secret || null,
    platform_easebuzz_key: ebKey || row?.platform_easebuzz_key || null,
    encrypted_platform_easebuzz_salt: ebSalt
      ? encryptSecret(ebSalt)
      : row?.encrypted_platform_easebuzz_salt || null,
    platform_easebuzz_environment: ebEnvRaw || row?.platform_easebuzz_environment || null,
  };

  const resolved = resolve(next);
  if (activeProvider === 'razorpay' && !isRazorpayReady(resolved)) {
    throw new PlatformPaymentSettingsError(
      `Razorpay is missing: ${razorpayMissing(resolved.razorpay).join(', ')}.`,
    );
  }
  if (activeProvider === 'easebuzz' && !isEasebuzzReady(resolved)) {
    throw new PlatformPaymentSettingsError(
      `Easebuzz is missing: ${easebuzzMissing(resolved.easebuzz).join(', ')}.`,
    );
  }

  await query(
    `INSERT INTO platform_settings (
       id, platform_payment_provider, platform_razorpay_key_id,
       encrypted_platform_razorpay_key_secret, encrypted_platform_razorpay_webhook_secret,
       platform_easebuzz_key, encrypted_platform_easebuzz_salt, platform_easebuzz_environment, updated_at
     ) VALUES ('default', $1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (id) DO UPDATE SET
       platform_payment_provider = EXCLUDED.platform_payment_provider,
       platform_razorpay_key_id = EXCLUDED.platform_razorpay_key_id,
       encrypted_platform_razorpay_key_secret = EXCLUDED.encrypted_platform_razorpay_key_secret,
       encrypted_platform_razorpay_webhook_secret = EXCLUDED.encrypted_platform_razorpay_webhook_secret,
       platform_easebuzz_key = EXCLUDED.platform_easebuzz_key,
       encrypted_platform_easebuzz_salt = EXCLUDED.encrypted_platform_easebuzz_salt,
       platform_easebuzz_environment = EXCLUDED.platform_easebuzz_environment,
       updated_at = NOW()`,
    [
      next.platform_payment_provider,
      next.platform_razorpay_key_id,
      next.encrypted_platform_razorpay_key_secret,
      next.encrypted_platform_razorpay_webhook_secret,
      next.platform_easebuzz_key,
      next.encrypted_platform_easebuzz_salt,
      next.platform_easebuzz_environment,
    ],
  );

  return toPublicPlatformPaymentSettings(resolved);
}
