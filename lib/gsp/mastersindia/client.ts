// Dependency-free Masters India (GSP) HTTP client. Never log credentials, JWTs or bodies.

export type GspCredentials = { username: string; password: string };
export type GspErrorKind = 'auth' | 'rejected' | 'timeout' | 'unreachable' | 'not_configured';

export class GspError extends Error {
  constructor(readonly kind: GspErrorKind, message: string, readonly nicCode: string | null = null) {
    super(message);
    this.name = 'GspError';
  }
}

export type GspDeps = { fetch?: typeof fetch; now?: () => number };
export type GspResult<T> = { data: T; info: string | null; requestId: string | null };

const DEFAULT_BASE = 'https://sandb-api.mastersindia.co/api/v1';
const TIMEOUT_MS = 30_000;
const EXPIRY_MARGIN_S = 60;

const tokenCache = new Map<string, { token: string; exp: number }>();

export function clearGspTokenCache(): void {
  tokenCache.clear();
}

export function gspBaseUrl(): string {
  const raw = (process.env.MASTERSINDIA_BASE_URL || '').trim();
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new GspError('not_configured', 'MASTERSINDIA_BASE_URL is not set');
    }
    return DEFAULT_BASE;
  }
  return raw.replace(/\/+$/, '');
}

function jwtExp(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch {
    return 0;
  }
}

async function send(
  url: string,
  init: RequestInit,
  deps: GspDeps,
): Promise<{ status: number; body: any }> {
  const doFetch = deps.fetch ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await doFetch(url, { ...init, signal: ctrl.signal });
    let body: any;
    try {
      body = await res.json();
    } catch {
      throw new GspError('unreachable', 'Masters India returned a non-JSON response');
    }
    return { status: res.status, body };
  } catch (e: any) {
    if (e instanceof GspError) throw e;
    if (e?.name === 'AbortError') throw new GspError('timeout', 'Masters India did not respond in time');
    throw new GspError('unreachable', 'Could not reach Masters India');
  } finally {
    clearTimeout(timer);
  }
}

async function login(creds: GspCredentials, deps: GspDeps): Promise<string> {
  const base = gspBaseUrl();
  const { body } = await send(
    `${base}/token-auth/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: creds.username, password: creds.password }),
    },
    deps,
  );
  if (!body || body.error || typeof body.token !== 'string' || !body.token) {
    throw new GspError('auth', 'Masters India login was refused');
  }
  tokenCache.set(`${base}|${creds.username}`, { token: body.token, exp: jwtExp(body.token) });
  return body.token;
}

export async function gspLogin(creds: GspCredentials, deps: GspDeps = {}): Promise<string> {
  return login(creds, deps);
}

async function getToken(creds: GspCredentials, deps: GspDeps): Promise<string> {
  const base = gspBaseUrl();
  const now = (deps.now ?? Date.now)();
  const hit = tokenCache.get(`${base}|${creds.username}`);
  if (hit && hit.exp - now / 1000 > EXPIRY_MARGIN_S) return hit.token;
  return login(creds, deps);
}

export async function gspCall<T = any>(
  creds: GspCredentials,
  req: { method: 'GET' | 'POST'; path: string; query?: Record<string, string | number>; body?: unknown },
  deps: GspDeps = {},
): Promise<GspResult<T>> {
  const base = gspBaseUrl();
  let url = `${base}/${req.path.replace(/^\/+/, '')}`;
  if (req.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) qs.append(k, String(v));
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }

  const attempt = async (token: string) =>
    send(
      url,
      {
        method: req.method,
        headers: { Authorization: `JWT ${token}`, 'Content-Type': 'application/json' },
        body: req.method === 'POST' ? JSON.stringify(req.body ?? {}) : undefined,
      },
      deps,
    );

  let res = await attempt(await getToken(creds, deps));
  if (res.status === 401) {
    tokenCache.delete(`${base}|${creds.username}`);
    res = await attempt(await login(creds, deps));
  }

  const body = res.body;
  const results = body && typeof body === 'object' ? body.results : undefined;
  if (results && typeof results === 'object') {
    if (results.code === 200 && results.status === 'Success') {
      return {
        data: results.message as T,
        info: results.InfoDtls || null,
        requestId: results.requestId ?? results.request_id ?? null,
      };
    }
    const text: string =
      results.errorMessage ||
      (typeof results.message === 'string' ? results.message : '') ||
      'Masters India rejected the request';
    const lead = /^\s*(\d+)\s*:/.exec(text);
    const nic = results.nic_code ?? (lead ? lead[1] : null);
    throw new GspError('rejected', text, nic != null ? String(nic) : null);
  }
  if (res.status === 401) throw new GspError('auth', 'Masters India rejected the credentials');
  if (body && typeof body === 'object' && body.error) {
    throw new GspError('rejected', String(body.error_description || body.error));
  }
  throw new GspError('rejected', 'Masters India rejected the request');
}

const IST_OFFSET_MS = 5.5 * 3600 * 1000;

export function parseGspDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = s.trim();
  let y: number, mo: number, d: number, h: number, mi: number, sec: number;
  let m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ?(AM|PM)$/i.exec(t);
  if (m) {
    d = +m[1]; mo = +m[2]; y = +m[3]; h = +m[4] % 12; mi = +m[5]; sec = +m[6];
    if (m[7].toUpperCase() === 'PM') h += 12;
  } else {
    const iso = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(t);
    m = iso ?? /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(t);
    if (!m) return null;
    if (iso) { y = +m[1]; mo = +m[2]; d = +m[3]; } else { d = +m[1]; mo = +m[2]; y = +m[3]; }
    h = +m[4]; mi = +m[5]; sec = +m[6];
  }
  const ms = Date.UTC(y, mo - 1, d, h, mi, sec) - IST_OFFSET_MS;
  return Number.isNaN(ms) ? null : new Date(ms);
}
