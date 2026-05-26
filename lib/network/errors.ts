import { isAppOffline } from '@/lib/network/offline-state';

const OFFLINE_MESSAGE_PATTERN =
  /\b(offline|network error|failed to fetch|load failed|internet connection|err_internet|err_network|net::err)\b/i;

/**
 * True when a fetch/TypeError likely indicates connectivity loss (not a 4xx/5xx body).
 */
export function isLikelyNetworkFetchError(error: unknown): boolean {
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('load failed')) return true;
  }
  if (error instanceof Error && OFFLINE_MESSAGE_PATTERN.test(error.message)) {
    return true;
  }
  return false;
}

/** Suppress user-facing error toasts when offline or the failure is clearly network-related. */
export function shouldSuppressOfflineToast(message?: string, error?: unknown): boolean {
  if (isAppOffline()) return true;
  if (message && OFFLINE_MESSAGE_PATTERN.test(message)) return true;
  if (isLikelyNetworkFetchError(error)) return true;
  return false;
}
