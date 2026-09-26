import webpush from 'web-push';
import { query, queryOne, queryRows } from '@/lib/db';
import { decryptSecret, encryptSecret } from '@/lib/secret-encryption';
import { getPlatformNotificationSettings } from '@/lib/platform-email';

export type PlatformPushEvent = 'signup' | 'incident';

type VapidPair = { publicKey: string; privateKey: string };

function vapidSubject(): string {
  const email = process.env.EMAIL_FROM || process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'help@khatario.com';
  return `mailto:${email.replace(/^mailto:/i, '')}`;
}

export async function getVapidPublicKey(): Promise<string | null> {
  const pair = await resolveVapidKeys();
  return pair?.publicKey ?? null;
}

async function resolveVapidKeys(): Promise<VapidPair | null> {
  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPub && envPriv) return { publicKey: envPub, privateKey: envPriv };

  try {
    const row = await queryOne<{ vapid_public_key: string | null; encrypted_vapid_private_key: string | null }>(
      `SELECT vapid_public_key, encrypted_vapid_private_key FROM platform_settings WHERE id = 'default'`,
    );
    if (row?.vapid_public_key && row.encrypted_vapid_private_key) {
      return {
        publicKey: row.vapid_public_key,
        privateKey: decryptSecret(row.encrypted_vapid_private_key),
      };
    }
  } catch (err) {
    console.warn('[platform-push] vapid lookup failed', err instanceof Error ? err.message : err);
  }
  return null;
}

export async function ensureVapidKeys(): Promise<VapidPair> {
  const existing = await resolveVapidKeys();
  if (existing) return existing;

  const generated = webpush.generateVAPIDKeys();
  try {
    await query(
      `INSERT INTO platform_settings (id, vapid_public_key, encrypted_vapid_private_key, updated_at)
       VALUES ('default', $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET
         vapid_public_key = EXCLUDED.vapid_public_key,
         encrypted_vapid_private_key = EXCLUDED.encrypted_vapid_private_key,
         updated_at = NOW()`,
      [generated.publicKey, encryptSecret(generated.privateKey)],
    );
  } catch (err) {
    console.error('[platform-push] could not persist VAPID keys', err);
    throw new Error('Could not save Web Push keys. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or SECRETS_ENCRYPTION_KEY.');
  }
  return generated;
}

export async function saveAdminPushSubscription(input: {
  adminId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO platform_admin_push_subscriptions (admin_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       admin_id = EXCLUDED.admin_id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent`,
    [input.adminId, input.endpoint, input.p256dh, input.auth, input.userAgent ?? null],
  );
}

export async function deleteAdminPushSubscription(endpoint: string): Promise<void> {
  await query(`DELETE FROM platform_admin_push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

export async function sendPlatformAdminPush(input: {
  event: PlatformPushEvent;
  title: string;
  body: string;
  url: string;
  force?: boolean;
}): Promise<number> {
  const settings = await getPlatformNotificationSettings();
  if (!input.force) {
    if (input.event === 'signup' && !settings.notify_push_signup) return 0;
    if (input.event === 'incident' && !settings.notify_push_incident) return 0;
  }

  const keys = await resolveVapidKeys();
  if (!keys) {
    console.warn('[platform-push] skipped: no VAPID keys (open Admin → Notifications on a phone once, or set VAPID_* env)');
    return 0;
  }

  const subs = await queryRows<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    `SELECT id, endpoint, p256dh, auth FROM platform_admin_push_subscriptions`,
  );
  if (subs.length === 0) return 0;

  const payload = JSON.stringify({
    title: input.title,
    body: input.body,
    url: input.url,
  });
  const options = {
    vapidDetails: {
      subject: vapidSubject(),
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
    },
    // Default urgency is "normal"; Android Doze holds those until the app/Chrome is opened.
    TTL: 24 * 60 * 60,
    urgency: 'high' as const,
  };

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
        options,
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await query(`DELETE FROM platform_admin_push_subscriptions WHERE id = $1`, [sub.id]);
      } else {
        console.warn('[platform-push] send failed', err instanceof Error ? err.message : err);
      }
    }
  }
  return sent;
}

export async function raisePlatformIncident(input: {
  kind: string;
  title: string;
  body: string;
  url: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO platform_incidents (kind, title, body, url, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.kind, input.title, input.body, input.url, JSON.stringify(input.metadata || {})],
    );
  } catch (err) {
    console.warn('[platform-incident] log failed', err instanceof Error ? err.message : err);
  }

  const { notifyAdminsIncidentEmail } = await import('@/lib/platform-email');
  void notifyAdminsIncidentEmail(input).catch((e) =>
    console.warn('[platform-incident] email failed', e instanceof Error ? e.message : e),
  );
  void sendPlatformAdminPush({
    event: 'incident',
    title: input.title,
    body: input.body,
    url: input.url,
  }).catch((e) => console.warn('[platform-incident] push failed', e instanceof Error ? e.message : e));
}
