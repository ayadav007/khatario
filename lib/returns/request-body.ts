import { isReturnMethod, type ReturnMethod } from './labels';
import type { PickupDetails } from './pickup';

/**
 * Reading the way back and the pickup details from a return request body (the merchant's
 * PATCH /api/returns/:id and POST /api/returns). Business and user never come from here.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** A method that is given must be one of the three; absent or blank means "not chosen". */
export function parseReturnMethod(raw: unknown): Parsed<ReturnMethod | null> {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (!isReturnMethod(raw)) return { ok: false, error: 'Choose how the goods come back' };
  return { ok: true, value: raw };
}

/** Package sizes: a finite number above zero, anything else is left blank (prefilled later). */
function positive(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function text(raw: unknown, max: number): string | null {
  return typeof raw === 'string' ? raw.trim().slice(0, max) || null : null;
}

/**
 * `{ address, pincode, phone, weight_kg, length_cm, breadth_cm, height_cm }`, every part optional.
 * A PIN code that is given must be 6 digits.
 */
export function parsePickupBody(raw: unknown): Parsed<PickupDetails | null> {
  if (raw == null || typeof raw !== 'object') return { ok: true, value: null };
  const p = raw as Record<string, unknown>;
  const pin = p.pincode == null ? '' : String(p.pincode).replace(/\s+/g, '');
  if (pin && !/^\d{6}$/.test(pin)) return { ok: false, error: 'Enter a 6-digit PIN code' };
  return {
    ok: true,
    value: {
      address: text(p.address, 500),
      pincode: pin || null,
      phone: text(p.phone, 20),
      weightKg: positive(p.weight_kg),
      lengthCm: positive(p.length_cm),
      breadthCm: positive(p.breadth_cm),
      heightCm: positive(p.height_cm),
    },
  };
}
