/**
 * AES-256-GCM encryption for values stored in payment_provider_configs.
 * Key: env PAYMENT_ENCRYPTION_KEY — 64 hex chars (32 bytes) OR base64-encoded 32 bytes.
 * Format stored: base64(iv 12 bytes + authTag 16 bytes + ciphertext)
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;

function getKey(): Buffer {
  const k = process.env.PAYMENT_ENCRYPTION_KEY;
  if (!k || !k.trim()) {
    throw new Error(
      'PAYMENT_ENCRYPTION_KEY is required to encrypt or decrypt payment provider secrets'
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
    'PAYMENT_ENCRYPTION_KEY must be 64 hex characters, or base64 encoding 32 bytes, or a 32-char UTF-8 string'
  );
}

/** Encrypt plaintext for DB storage; safe to persist in encrypted_* columns. */
export function encryptPaymentSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/** Decrypt value read from encrypted_* column. Server-side only. */
export function decryptPaymentSecret(ciphertextB64: string): string {
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
