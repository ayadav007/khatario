import { generateKeyPairSync, sign } from 'crypto';
import {
  canonicalRequest,
  formatPairingCode,
  generatePairingCode,
  normalizePairingCode,
  parseDevicePublicKey,
  verifyDeviceSignature,
} from '@/lib/hr/staff-app/device-auth';

function phoneKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  // Same format Android's SHA256withECDSA produces: DER.
  const signText = (text: string) => sign('sha256', Buffer.from(text), privateKey).toString('base64');
  return { spki, signText };
}

it('verifies a request signed by the phone key', () => {
  const { spki, signText } = phoneKey();
  const text = canonicalRequest('post', '/api/staff-app/punch', '1760500000000', '{"a":1}');
  expect(text.split('\n').slice(0, 3)).toEqual(['POST', '/api/staff-app/punch', '1760500000000']);
  expect(verifyDeviceSignature(spki, text, signText(text))).toBe(true);
});

it('rejects a changed body, path or another phone key', () => {
  const { spki, signText } = phoneKey();
  const other = phoneKey();
  const text = canonicalRequest('POST', '/api/staff-app/punch', '1760500000000', '{"a":1}');
  const sig = signText(text);
  expect(verifyDeviceSignature(spki, canonicalRequest('POST', '/api/staff-app/punch', '1760500000000', '{"a":2}'), sig)).toBe(false);
  expect(verifyDeviceSignature(spki, canonicalRequest('POST', '/api/staff-app/pair', '1760500000000', '{"a":1}'), sig)).toBe(false);
  expect(verifyDeviceSignature(other.spki, text, sig)).toBe(false);
  expect(verifyDeviceSignature(spki, text, 'not-base64!')).toBe(false);
});

it('accepts only EC P-256 device keys', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  expect(() => parseDevicePublicKey(rsa)).toThrow(/P-256/);
  expect(() => parseDevicePublicKey(p384)).toThrow(/P-256/);
  expect(() => parseDevicePublicKey('garbage')).toThrow();
  expect(() => parseDevicePublicKey(phoneKey().spki)).not.toThrow();
});

it('pairing codes are 10 unambiguous letters and survive QR and typing', () => {
  const code = generatePairingCode();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
  expect(normalizePairingCode(`KHSTAFF1:${code}`)).toBe(code);
  expect(normalizePairingCode(formatPairingCode(code).toLowerCase())).toBe(code);
  expect(normalizePairingCode(' abcde fghjk ')).toBe('ABCDEFGHJK');
});
