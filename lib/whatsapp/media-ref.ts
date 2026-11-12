/**
 * WhatsApp media by reference.
 *
 * We do not keep WhatsApp photos, videos, voice notes or files. A message stores a signed link
 * (`/api/whatsapp/media/wa?r=…&s=…`) that carries WhatsApp's own pointer to the file: where the
 * encrypted copy sits on WhatsApp's media server and the key that unlocks it (QR-linked numbers),
 * or the Meta media id (Cloud API numbers). About 500 bytes instead of the whole file.
 *
 * The web inbox fetches the encrypted copy straight from WhatsApp and decrypts it in the browser
 * (`decryptWaMedia`). Anything else that opens the link (phone app, exports, old browsers) gets the
 * file streamed through the server by the route, which never writes it to disk.
 *
 * This module runs in both the browser and Node: no Node imports here. Signing lives in
 * `media-ref-server.ts`.
 */

export const WA_MEDIA_REF_PATH = '/api/whatsapp/media/wa';
export const WA_MEDIA_HOST = 'https://mmg.whatsapp.net';

export type WaMediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';

export interface WaMediaRef {
  v: 1;
  /** `wa` = QR-linked number (encrypted file on WhatsApp's server); `cloud` = Cloud API media id. */
  src: 'wa' | 'cloud';
  t: WaMediaKind;
  /** MIME type. */
  m: string;
  /** Path on mmg.whatsapp.net (wa). */
  p?: string;
  /** Media key, base64 (wa). */
  k?: string;
  /** SHA-256 of the encrypted file, base64 (wa). */
  h?: string;
  /** Size in bytes, when WhatsApp told us. */
  n?: number;
  /** Original file name (documents). */
  f?: string;
  /** Meta media id (cloud). */
  id?: string;
}

const KINDS: readonly WaMediaKind[] = ['image', 'video', 'audio', 'document', 'sticker'];

const HKDF_INFO: Record<WaMediaKind, string> = {
  image: 'WhatsApp Image Keys',
  sticker: 'WhatsApp Image Keys',
  video: 'WhatsApp Video Keys',
  audio: 'WhatsApp Audio Keys',
  document: 'WhatsApp Document Keys',
};

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return b64 + '='.repeat((4 - (b64.length % 4)) % 4);
}

/** The `r` query value for a ref. */
export function encodeWaMediaRef(ref: WaMediaRef): string {
  return toBase64Url(bytesToBase64(new TextEncoder().encode(JSON.stringify(ref))));
}

/** Parses an `r` value; null when it is not a well-formed ref. Does not check the signature. */
export function decodeWaMediaRef(body: string): WaMediaRef | null {
  try {
    const raw = JSON.parse(new TextDecoder().decode(base64ToBytes(fromBase64Url(body))));
    if (!raw || raw.v !== 1 || !KINDS.includes(raw.t) || typeof raw.m !== 'string') return null;
    if (raw.src === 'wa') {
      if (typeof raw.p !== 'string' || !raw.p.startsWith('/') || typeof raw.k !== 'string') return null;
    } else if (raw.src === 'cloud') {
      if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.id)) return null;
    } else {
      return null;
    }
    return raw as WaMediaRef;
  } catch {
    return null;
  }
}

export function isWaMediaRefUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith(`${WA_MEDIA_REF_PATH}?`);
}

/** Splits a media link into its ref and signature; null for any other URL. */
export function parseWaMediaRefUrl(url: string | null | undefined): { ref: WaMediaRef; body: string; sig: string } | null {
  if (!isWaMediaRefUrl(url)) return null;
  const params = new URLSearchParams(String(url).slice(WA_MEDIA_REF_PATH.length + 1));
  const body = params.get('r');
  const sig = params.get('s');
  if (!body || !sig) return null;
  const ref = decodeWaMediaRef(body);
  return ref ? { ref, body, sig } : null;
}

/** Where the encrypted copy of a QR-linked file sits. */
export function waMediaDownloadUrl(ref: WaMediaRef): string | null {
  return ref.src === 'wa' && ref.p ? `${WA_MEDIA_HOST}${ref.p}` : null;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Copies into a fresh ArrayBuffer so WebCrypto typings accept it in every TS lib version. */
function buf(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.length);
  new Uint8Array(out).set(bytes);
  return out;
}

/**
 * Decrypts a file downloaded from WhatsApp's media server (WebCrypto; browser or Node 18+).
 * Layout: AES-256-CBC ciphertext followed by the first 10 bytes of HMAC-SHA256(iv ‖ ciphertext).
 * Keys come from HKDF-SHA256 over the media key. Throws when the file was altered or the key is wrong.
 */
export async function decryptWaMedia(encrypted: Uint8Array, mediaKey: Uint8Array, kind: WaMediaKind): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto is not available');
  if (encrypted.length < 16 + 10) throw new Error('Media file is too short');

  const ikm = await subtle.importKey('raw', buf(mediaKey), 'HKDF', false, ['deriveBits']);
  const expanded = new Uint8Array(
    await subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new ArrayBuffer(0), info: buf(new TextEncoder().encode(HKDF_INFO[kind])) },
      ikm,
      112 * 8,
    ),
  );
  const iv = expanded.slice(0, 16);
  const cipherKey = expanded.slice(16, 48);
  const macKey = expanded.slice(48, 80);

  const cipher = encrypted.subarray(0, encrypted.length - 10);
  const mac = encrypted.subarray(encrypted.length - 10);
  const signed = new Uint8Array(iv.length + cipher.length);
  signed.set(iv, 0);
  signed.set(cipher, iv.length);
  const hmacKey = await subtle.importKey('raw', buf(macKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = new Uint8Array(await subtle.sign('HMAC', hmacKey, buf(signed))).subarray(0, 10);
  if (!sameBytes(expected, mac)) throw new Error('Media file failed its integrity check');

  const aesKey = await subtle.importKey('raw', buf(cipherKey), { name: 'AES-CBC' }, false, ['decrypt']);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv: buf(iv) }, aesKey, buf(cipher)));
}
