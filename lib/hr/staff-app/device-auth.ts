/**
 * Khatario Staff authentication. A phone is linked to one employee by scanning a one-time code
 * the owner shows; at that moment it makes a P-256 key pair in the Android keystore and sends
 * the public half. Every later request is signed with the private half, which never leaves the
 * phone, so there is no password or bearer token to copy to another phone or a script.
 *
 * Signed text: METHOD \n PATH \n TIMESTAMP_MS \n sha256-hex(body)
 * Headers: x-staff-device (device id), x-staff-timestamp, x-staff-signature (base64 DER).
 */
import { createHash, createPublicKey, randomBytes, verify, type KeyObject } from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export const STAFF_DEVICE_HEADER = 'x-staff-device';
export const STAFF_TIMESTAMP_HEADER = 'x-staff-timestamp';
export const STAFF_SIGNATURE_HEADER = 'x-staff-signature';
/** How far the phone clock may drift from the server's. The app corrects itself from `server_time`. */
export const MAX_CLOCK_SKEW_MS = 10 * 60_000;
export const PAIRING_CODE_TTL_MS = 15 * 60_000;
/** Prefix inside the owner's QR code, so the app ignores unrelated QR codes. */
export const PAIRING_QR_PREFIX = 'KHSTAFF1:';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 letters, no I/O/0/1
const CODE_LENGTH = 10;

export class StaffAuthError extends Error {
  constructor(message: string, readonly code: string, readonly status = 401) {
    super(message);
  }

  toNextResponse(): NextResponse {
    return NextResponse.json(
      { error: this.message, code: this.code, server_time: Date.now() },
      { status: this.status },
    );
  }
}

export function sha256Hex(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

export function canonicalRequest(method: string, path: string, timestampMs: string, body: string): string {
  return `${method.toUpperCase()}\n${path}\n${timestampMs}\n${sha256Hex(body)}`;
}

/** Accepts base64 DER SPKI for an EC P-256 key; anything else is refused. */
export function parseDevicePublicKey(base64: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' });
  } catch {
    throw new StaffAuthError('Device key is not valid.', 'BAD_DEVICE_KEY', 400);
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new StaffAuthError('Device key must be EC P-256.', 'BAD_DEVICE_KEY', 400);
  }
  return key;
}

export function verifyDeviceSignature(publicKeyBase64: string, signed: string, signatureBase64: string): boolean {
  try {
    const key = parseDevicePublicKey(publicKeyBase64);
    return verify('sha256', Buffer.from(signed), key, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

export function generatePairingCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] & 31];
  return code;
}

/** Turns "khstaff1:abcde-fghjk", "ABCDE FGHJK" etc. into "ABCDEFGHJK". */
export function normalizePairingCode(raw: string): string {
  let text = String(raw ?? '').trim();
  if (text.toUpperCase().startsWith(PAIRING_QR_PREFIX)) text = text.slice(PAIRING_QR_PREFIX.length);
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatPairingCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export type StaffDevice = {
  device_id: string;
  employee_id: string;
  business_id: string;
  employee_name: string;
  employee_code: string | null;
  business_name: string;
};

/**
 * Checks the signature on a Khatario Staff request and returns whose phone it is.
 * Business and employee always come from the device row, never from the request.
 */
export async function authenticateStaffRequest(request: NextRequest, rawBody: string): Promise<StaffDevice> {
  const deviceId = request.headers.get(STAFF_DEVICE_HEADER) ?? '';
  const timestamp = request.headers.get(STAFF_TIMESTAMP_HEADER) ?? '';
  const signature = request.headers.get(STAFF_SIGNATURE_HEADER) ?? '';
  if (!UUID_RE.test(deviceId) || !/^\d{10,16}$/.test(timestamp) || !signature) {
    throw new StaffAuthError('This phone is not linked. Ask your employer for a new code.', 'STAFF_UNSIGNED');
  }
  if (Math.abs(Date.now() - Number(timestamp)) > MAX_CLOCK_SKEW_MS) {
    throw new StaffAuthError("The phone's clock is wrong. Set the time automatically and try again.", 'CLOCK_SKEW');
  }

  const device = await queryOne<StaffDevice & { public_key: string; revoked_at: Date | null; active: boolean }>(
    `SELECT d.id AS device_id, d.employee_id, d.business_id, d.public_key, d.revoked_at,
            (e.is_active AND u.is_active) AS active,
            u.name AS employee_name, e.employee_code, b.name AS business_name
     FROM staff_app_devices d
     JOIN employees e ON e.id = d.employee_id AND e.business_id = d.business_id
     JOIN users u ON u.id = e.id
     JOIN businesses b ON b.id = d.business_id
     WHERE d.id = $1`,
    [deviceId],
  );
  if (!device || device.revoked_at || !device.active) {
    throw new StaffAuthError('This phone was unlinked. Ask your employer for a new code.', 'DEVICE_REVOKED');
  }

  const signed = canonicalRequest(request.method, request.nextUrl.pathname, timestamp, rawBody);
  if (!verifyDeviceSignature(device.public_key, signed, signature)) {
    throw new StaffAuthError('Request signature did not match this phone.', 'BAD_SIGNATURE');
  }

  await query('UPDATE staff_app_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE id = $1', [deviceId]);
  return {
    device_id: device.device_id,
    employee_id: device.employee_id,
    business_id: device.business_id,
    employee_name: device.employee_name,
    employee_code: device.employee_code,
    business_name: device.business_name,
  };
}
