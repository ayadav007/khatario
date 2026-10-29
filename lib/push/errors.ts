export type PushErrorClass = 'invalid_token' | 'retry' | 'failed';

/** Firebase `messaging/...` codes that mean the token is dead and must be revoked. */
const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-recipient',
  // The token was minted for another Firebase project (wrong google-services.json on the device).
  'messaging/mismatched-credential',
  'messaging/sender-id-mismatch',
]);

/** Transient provider or network conditions: try the same token again later. */
const RETRY_CODES = new Set([
  'messaging/internal-error',
  'messaging/server-unavailable',
  'messaging/message-rate-exceeded',
  'messaging/device-message-rate-exceeded',
  'messaging/topics-message-rate-exceeded',
  'messaging/unknown-error',
  'messaging/batch-failed',
  'messaging/quota-exceeded',
  'app/network-error',
  'app/network-timeout',
]);

export function classifyPushError(code: string | undefined, message?: string): PushErrorClass {
  if (!code) return 'retry';
  if (INVALID_TOKEN_CODES.has(code)) return 'invalid_token';
  if (RETRY_CODES.has(code)) return 'retry';
  if (code === 'messaging/invalid-argument' && /token/i.test(message || '')) return 'invalid_token';
  // Authentication, invalid payload and anything unknown: the same send will fail again.
  return 'failed';
}

/** Minutes to wait before attempt n+1 (attempt 1 just happened). Exhausted after the last entry. */
export const PUSH_RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000];
export const PUSH_MAX_ATTEMPTS = PUSH_RETRY_DELAYS_MS.length + 1;

export function nextRetryDelayMs(attemptsMade: number): number | null {
  const delay = PUSH_RETRY_DELAYS_MS[attemptsMade - 1];
  return delay == null ? null : delay;
}
