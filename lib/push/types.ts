/** Who a device belongs to. Decided by the server from the authenticated identity, never by the client. */
export type PushAudience = 'business' | 'customer';

/** Android application ids that may register a token. Anything else is rejected at registration. */
export const PUSH_APP_IDS = ['com.khatario.app', 'com.khatario.phone', 'com.khatario.staff'] as const;
export type PushAppId = (typeof PUSH_APP_IDS)[number];

/** Android notification channel ids. Created by each app at start; the server only names them. */
export const PUSH_CHANNEL_ALERTS = 'khatario_alerts';

export type PushJobRow = {
  id: string;
  kind: 'notification' | 'customer';
  audience: PushAudience;
  notification_id: string | null;
  notification_seq: string | null;
  business_id: string;
  user_id: string | null;
  customer_id: string | null;
  title: string;
  body: string;
  data: Record<string, unknown>;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  sent_count: number;
};

export type PushDeviceRow = {
  id: string;
  audience: PushAudience;
  user_id: string | null;
  customer_id: string | null;
  business_id: string | null;
  app_id: string;
  platform: string;
  token: string;
  token_hash: string;
  session_version: number | null;
};

/** What the FCM wrapper returns per token. Codes are Firebase's `messaging/...` strings. */
export type PushSendResult = {
  token: string;
  ok: boolean;
  messageId?: string;
  errorCode?: string;
  errorMessage?: string;
};

/** The message handed to FCM. Mirrors firebase-admin's MulticastMessage minus the tokens. */
export type PushMessage = {
  notification: { title: string; body: string };
  data: Record<string, string>;
  android: {
    priority: 'high' | 'normal';
    ttl: number;
    collapseKey?: string;
    notification: {
      channelId: string;
      icon: string;
      color: string;
      sound: string;
      tag?: string;
      visibility: 'private' | 'public' | 'secret';
      priority: 'high' | 'default';
      defaultVibrateTimings: boolean;
    };
  };
};

export interface PushSender {
  /** Sends one message to many tokens; never throws for per-token errors. */
  sendToTokens(tokens: string[], message: PushMessage): Promise<PushSendResult[]>;
}
