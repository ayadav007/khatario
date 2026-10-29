import { createHash } from 'crypto';
import type { PushMessage, PushSender, PushSendResult } from './types';

/**
 * Firebase Admin wrapper. Credentials come only from the server environment:
 *   FIREBASE_SERVICE_ACCOUNT_JSON   the service-account JSON, raw or base64
 *   GOOGLE_APPLICATION_CREDENTIALS  path to the JSON file (Google's default)
 * Nothing here logs a token or a credential; callers log `tokenHash()` instead.
 */

type AdminApp = { messaging(): { sendEachForMulticast(m: unknown): Promise<MulticastResponse> } };
type MulticastResponse = {
  responses: { success: boolean; messageId?: string; error?: { code?: string; message?: string } }[];
};

let app: AdminApp | null | undefined;
let initError: string | null = null;

/** sha256 of a token: what logs, delivery rows and reports carry instead of the token. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Short safe form for a log line (first 8 hex chars of the hash). */
export function tokenRef(token: string): string {
  return tokenHash(token).slice(0, 8);
}

function readServiceAccount(): Record<string, unknown> | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (typeof parsed.project_id !== 'string' || typeof parsed.private_key !== 'string') {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not a service-account file');
  }
  return parsed;
}

export function isFcmConfigured(): boolean {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim());
}

/** Why FCM is unavailable, for health output; null when it is usable. */
export function fcmUnavailableReason(): string | null {
  if (!isFcmConfigured()) return 'fcm_not_configured';
  if (app === undefined) getAdminApp();
  return app ? null : initError || 'fcm_init_failed';
}

function getAdminApp(): AdminApp | null {
  if (app !== undefined) return app;
  if (!isFcmConfigured()) {
    app = null;
    return app;
  }
  try {
    // Loaded lazily so test and build environments without credentials never touch firebase-admin.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const admin = require('firebase-admin') as typeof import('firebase-admin');
    const serviceAccount = readServiceAccount();
    const existing = admin.apps.find((a) => a?.name === 'khatario-push');
    app =
      (existing as unknown as AdminApp) ??
      (admin.initializeApp(
        {
          credential: serviceAccount
            ? admin.credential.cert(serviceAccount as Parameters<typeof admin.credential.cert>[0])
            : admin.credential.applicationDefault(),
        },
        'khatario-push',
      ) as unknown as AdminApp);
    initError = null;
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    console.error('[push] Firebase Admin could not start:', initError);
    app = null;
  }
  return app;
}

/** FCM accepts at most 500 tokens per multicast call. */
const MULTICAST_LIMIT = 500;

class FirebaseSender implements PushSender {
  constructor(private readonly admin: AdminApp) {}

  async sendToTokens(tokens: string[], message: PushMessage): Promise<PushSendResult[]> {
    const out: PushSendResult[] = [];
    for (let i = 0; i < tokens.length; i += MULTICAST_LIMIT) {
      const batch = tokens.slice(i, i + MULTICAST_LIMIT);
      let res: MulticastResponse;
      try {
        res = await this.admin.messaging().sendEachForMulticast({ tokens: batch, ...message });
      } catch (err) {
        // A whole-batch failure (auth, network) is transient for every token in it.
        const code = (err as { code?: string })?.code || 'messaging/batch-failed';
        const errorMessage = err instanceof Error ? err.message : String(err);
        for (const token of batch) out.push({ token, ok: false, errorCode: code, errorMessage });
        continue;
      }
      res.responses.forEach((r, idx) => {
        out.push({
          token: batch[idx],
          ok: r.success,
          messageId: r.messageId,
          errorCode: r.error?.code,
          errorMessage: r.error?.message,
        });
      });
    }
    return out;
  }
}

/** The process-wide sender, or null when Firebase is not configured or failed to start. */
export function getPushSender(): PushSender | null {
  const a = getAdminApp();
  return a ? new FirebaseSender(a) : null;
}

/** Tests only. */
export function resetFcmForTests(): void {
  app = undefined;
  initError = null;
}
