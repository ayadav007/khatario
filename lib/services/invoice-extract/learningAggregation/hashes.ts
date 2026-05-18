import { createHash } from 'crypto';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function normalizeGstin(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim().replace(/\s+/g, '').toUpperCase();
  return /^[0-9A-Z]{15}$/.test(s) ? s : '';
}

function normalizeName(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Privacy-preserving vendor key: hashed GSTIN-only identity or hashed name fallback. */
export function vendorIdentityFromSupplierJson(supplier: unknown): {
  vendorKey: string;
  vendorNameHash: string;
  gstinHash: string | null;
} {
  const obj = supplier && typeof supplier === 'object' ? (supplier as Record<string, unknown>) : {};
  const gstinPlain = normalizeGstin(obj.gstin);
  const nameNorm = normalizeName(obj.name).slice(0, 512);
  const gstinHash = gstinPlain ? sha256Hex(gstinPlain) : null;
  const vendorNameHash = sha256Hex(nameNorm.length ? nameNorm : '__empty_vendor_name__');

  const vendorKey = gstinHash ? `g:${gstinHash}` : `n:${vendorNameHash}`;

  return { vendorKey, vendorNameHash, gstinHash };
}
