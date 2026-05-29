/**
 * Best-effort check that the remote app origin responds (WebView has real connectivity).
 * Any HTTP response (including 401) counts as reachable; network errors do not.
 */
export async function probeServerReachable(timeoutMs = 8000): Promise<boolean> {
  if (typeof fetch === 'undefined') return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    await fetch('/api/auth/session', {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}
