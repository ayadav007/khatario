/**
 * Returns the normalised href when `url` is an absolute http(s) URL whose origin is one of this app's configured origins
 * (NEXT_PUBLIC_APP_URL, PUBLIC_PAYMENT_CALLBACK_URL), else null. Send the returned href, never the raw value.
 * The request-derived origin is trusted only when nodeEnv is exactly 'development' or 'test', because
 * Host / X-Forwarded-Host are client-controlled. Backslashes, whitespace, control characters, userinfo and
 * values over 2000 characters are refused to avoid parser differentials.
 */
export function normaliseOwnAppUrl(
  url: unknown,
  opts: { requestOrigin?: string; nodeEnv?: string; env?: NodeJS.ProcessEnv } = {},
): string | null {
  const env = opts.env ?? process.env;
  const nodeEnv = opts.nodeEnv ?? env.NODE_ENV;
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (raw.length === 0 || raw.length > 2000 || /[\\\s\u0000-\u001f\u007f]/.test(raw)) return null;
  if (!/^https?:\/\//i.test(raw)) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  const origin = parsed.origin;

  const allowed = new Set<string>();
  for (const configured of [env.NEXT_PUBLIC_APP_URL, env.PUBLIC_PAYMENT_CALLBACK_URL]) {
    if (!configured?.trim()) continue;
    try {
      allowed.add(new URL(configured.trim()).origin);
    } catch {
      /* ignore invalid value */
    }
  }
  if ((nodeEnv === 'development' || nodeEnv === 'test') && opts.requestOrigin) allowed.add(opts.requestOrigin);
  return allowed.has(origin) ? parsed.href : null;
}
