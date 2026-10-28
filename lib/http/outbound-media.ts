import { lookup } from 'dns/promises';
import net from 'net';

/** Largest media file we will load for an outbound WhatsApp message. */
export const MAX_OUTBOUND_MEDIA_BYTES = 16 * 1024 * 1024;

export class OutboundMediaError extends Error {}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inV4Range(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const BLOCKED_V4 = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
  '192.0.0.0/24', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4',
];

/** True for loopback, private, link-local (cloud metadata), CGNAT, multicast and reserved addresses. */
export function isNonPublicIp(ip: string): boolean {
  if (net.isIPv4(ip)) return BLOCKED_V4.some((cidr) => inV4Range(ip, cidr));
  if (!net.isIPv6(ip)) return true;
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isNonPublicIp(mapped[1]);
  return (
    v6 === '::' ||
    v6 === '::1' ||
    v6.startsWith('fc') ||
    v6.startsWith('fd') ||
    v6.startsWith('fe8') ||
    v6.startsWith('fe9') ||
    v6.startsWith('fea') ||
    v6.startsWith('feb') ||
    v6.startsWith('ff')
  );
}

/**
 * Resolve the host of an http(s) URL and refuse it unless every address is public.
 * Use before any server-side fetch of a URL that a tenant or user supplied.
 */
export async function assertPublicHttpUrl(raw: string, opts: { httpsOnly?: boolean } = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundMediaError('Invalid URL');
  }
  const allowed = opts.httpsOnly ? ['https:'] : ['https:', 'http:'];
  if (!allowed.includes(url.protocol)) throw new OutboundMediaError('URL scheme not allowed');
  if (url.username || url.password) throw new OutboundMediaError('URL credentials not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isNonPublicIp)) {
    throw new OutboundMediaError('URL host is not allowed');
  }
  return url;
}

/**
 * Turn caller-supplied WhatsApp media into bytes the server controls. Accepts a Buffer, a
 * `data:` URL, or an https URL on a public host (no redirects). Anything else — local file
 * paths, `file:`, http, private or metadata addresses — is refused, because Baileys would
 * otherwise read local files or fetch internal URLs on the server's behalf.
 */
export async function loadOutboundMedia(media: string | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(media)) return media;
  const value = String(media).trim();
  if (value.startsWith('data:')) {
    const comma = value.indexOf(',');
    if (comma < 0) throw new OutboundMediaError('Invalid data URL');
    const meta = value.slice(5, comma);
    const payload = value.slice(comma + 1);
    const buf = meta.endsWith(';base64')
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
    if (buf.length > MAX_OUTBOUND_MEDIA_BYTES) throw new OutboundMediaError('Media is too large');
    return buf;
  }
  const url = await assertPublicHttpUrl(value, { httpsOnly: true });
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new OutboundMediaError(`Media download failed (${res.status})`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_OUTBOUND_MEDIA_BYTES) throw new OutboundMediaError('Media is too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_OUTBOUND_MEDIA_BYTES) throw new OutboundMediaError('Media is too large');
  return buf;
}
