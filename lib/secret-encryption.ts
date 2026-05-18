/**
 * AES-256-GCM encryption for tenant secrets (SMTP passwords, etc.).
 * Key: SECRETS_ENCRYPTION_KEY or PAYMENT_ENCRYPTION_KEY — 64 hex / base64 32 bytes.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;

function getKey(): Buffer {
  const k = process.env.SECRETS_ENCRYPTION_KEY || process.env.PAYMENT_ENCRYPTION_KEY;
  if (!k || !k.trim()) {
    throw new Error(
      'SECRETS_ENCRYPTION_KEY (or PAYMENT_ENCRYPTION_KEY) is required to store tenant secrets'
    );
  }
  const s = k.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    return Buffer.from(s, 'hex');
  }
  const b64 = Buffer.from(s, 'base64');
  if (b64.length === 32) {
    return b64;
  }
  if (s.length === 32) {
    return Buffer.from(s, 'utf8');
  }
  throw new Error(
    'SECRETS_ENCRYPTION_KEY must be 64 hex characters, or base64 encoding 32 bytes, or a 32-char UTF-8 string'
  );
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(ciphertextB64: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertextB64, 'base64');
  if (buf.length < IV_LEN + AUTH_TAG_LEN + 1) {
    throw new Error('Invalid encrypted payload length');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const data = buf.subarray(IV_LEN + AUTH_TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
