import { query, queryOne } from '@/lib/db';
import { tokenHash } from './fcm';
import { PUSH_APP_IDS, type PushAppId, type PushAudience } from './types';

export type RegisterInput = {
  audience: PushAudience;
  /** business audience */
  userId?: string;
  /** customer audience: the store customer and the shop that signed them in */
  customerId?: string;
  businessId?: string;
  appId: string;
  platform?: string;
  token: string;
  environment?: string;
  deviceLabel?: string | null;
  appVersion?: string | null;
};

export type RegisterResult = { ok: true; deviceId: string } | { ok: false; error: string };

/** FCM tokens are opaque; this only rejects obviously broken input before it reaches the table. */
export function isPlausiblePushToken(token: unknown): token is string {
  return typeof token === 'string' && token.length >= 20 && token.length <= 4096 && !/\s/.test(token);
}

export function isPushAppId(value: unknown): value is PushAppId {
  return typeof value === 'string' && (PUSH_APP_IDS as readonly string[]).includes(value);
}

function clean(value: string | null | undefined, max: number): string | null {
  const v = (value ?? '').trim();
  return v ? v.slice(0, max) : null;
}

/**
 * Upserts a device by token. A token identifies one app install, so when another account signs
 * in on the same phone the row moves to that account and loses its old owner; the previous
 * account can no longer receive anything on that device. Business devices remember the user's
 * session version so a device whose session was revoked stops receiving pushes.
 */
export async function registerPushDevice(input: RegisterInput): Promise<RegisterResult> {
  if (!isPlausiblePushToken(input.token)) return { ok: false, error: 'Invalid token' };
  if (!isPushAppId(input.appId)) return { ok: false, error: 'Unknown app id' };
  const platform = clean(input.platform, 16) ?? 'android';
  const environment = clean(input.environment, 16) ?? 'production';

  if (input.audience === 'business') {
    if (!input.userId) return { ok: false, error: 'User required' };
    const user = await queryOne<{ auth_session_version: string | null }>(
      `SELECT auth_session_version::text AS auth_session_version FROM users WHERE id = $1 AND is_active = true`,
      [input.userId],
    );
    if (!user) return { ok: false, error: 'User not found' };
    const row = await queryOne<{ id: string }>(
      `INSERT INTO push_devices (
         audience, user_id, customer_id, business_id, app_id, platform, token, token_hash, environment,
         session_version, device_label, app_version, last_seen_at, revoked_at, revoked_reason
       ) VALUES ('business', $1, NULL, NULL, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, NULL, NULL)
       ON CONFLICT (token) DO UPDATE SET
         audience = 'business', user_id = EXCLUDED.user_id, customer_id = NULL, business_id = NULL,
         app_id = EXCLUDED.app_id, platform = EXCLUDED.platform, environment = EXCLUDED.environment,
         session_version = EXCLUDED.session_version, device_label = EXCLUDED.device_label,
         app_version = EXCLUDED.app_version, last_seen_at = CURRENT_TIMESTAMP,
         revoked_at = NULL, revoked_reason = NULL
       RETURNING id`,
      [
        input.userId,
        input.appId,
        platform,
        input.token,
        tokenHash(input.token),
        environment,
        user.auth_session_version == null ? null : Number(user.auth_session_version),
        clean(input.deviceLabel, 120),
        clean(input.appVersion, 40),
      ],
    );
    return row ? { ok: true, deviceId: row.id } : { ok: false, error: 'Could not save device' };
  }

  if (!input.customerId || !input.businessId) return { ok: false, error: 'Customer required' };
  const customer = await queryOne<{ id: string }>(
    `SELECT id FROM store_customers WHERE id = $1 AND business_id = $2`,
    [input.customerId, input.businessId],
  );
  if (!customer) return { ok: false, error: 'Customer not found' };
  const row = await queryOne<{ id: string }>(
    `INSERT INTO push_devices (
       audience, user_id, customer_id, business_id, app_id, platform, token, token_hash, environment,
       session_version, device_label, app_version, last_seen_at, revoked_at, revoked_reason
     ) VALUES ('customer', NULL, $1, $2, $3, $4, $5, $6, $7, NULL, $8, $9, CURRENT_TIMESTAMP, NULL, NULL)
     ON CONFLICT (token) DO UPDATE SET
       audience = 'customer', user_id = NULL, customer_id = EXCLUDED.customer_id, business_id = EXCLUDED.business_id,
       app_id = EXCLUDED.app_id, platform = EXCLUDED.platform, environment = EXCLUDED.environment,
       session_version = NULL, device_label = EXCLUDED.device_label, app_version = EXCLUDED.app_version,
       last_seen_at = CURRENT_TIMESTAMP, revoked_at = NULL, revoked_reason = NULL
     RETURNING id`,
    [
      input.customerId,
      input.businessId,
      input.appId,
      platform,
      input.token,
      tokenHash(input.token),
      environment,
      clean(input.deviceLabel, 120),
      clean(input.appVersion, 40),
    ],
  );
  return row ? { ok: true, deviceId: row.id } : { ok: false, error: 'Could not save device' };
}

/**
 * Revokes a token on logout. Only the owner recorded on the row can revoke it, so one account
 * cannot silence another account's device by guessing a token.
 */
export async function revokePushDevice(
  token: string,
  owner: { audience: 'business'; userId: string } | { audience: 'customer'; customerId: string; businessId: string },
  reason = 'logout',
): Promise<boolean> {
  if (!isPlausiblePushToken(token)) return false;
  const result =
    owner.audience === 'business'
      ? await query(
          `UPDATE push_devices SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = $3
            WHERE token = $1 AND audience = 'business' AND user_id = $2 AND revoked_at IS NULL`,
          [token, owner.userId, reason],
        )
      : await query(
          `UPDATE push_devices SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = $4
            WHERE token = $1 AND audience = 'customer' AND customer_id = $2 AND business_id = $3 AND revoked_at IS NULL`,
          [token, owner.customerId, owner.businessId, reason],
        );
  return (result.rowCount ?? 0) > 0;
}

/** The dispatcher marks a token dead after FCM says it is not registered any more. */
export async function revokeDeviceById(deviceId: string, reason: string): Promise<void> {
  await query(
    `UPDATE push_devices SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL`,
    [deviceId, reason.slice(0, 40)],
  );
}
