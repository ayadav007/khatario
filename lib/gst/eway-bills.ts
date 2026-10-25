import { parseEwayBillNumber } from '@/lib/gst/eway';

/**
 * E-way bill rules used for stock reconciliation (Rule 138, 138A-138D). Times are kept in UTC;
 * day boundaries are Indian Standard Time, as the portal counts them.
 */

export const EWAY_SOURCE_TYPES = ['invoice', 'delivery_challan', 'stock_transfer', 'purchase', 'purchase_return', 'credit_note', 'other'] as const;
export type EwaySourceType = (typeof EWAY_SOURCE_TYPES)[number];

export const EWAY_DOC_TYPES = ['tax_invoice', 'bill_of_supply', 'delivery_challan', 'bill_of_entry', 'credit_note', 'others'] as const;
export type EwayDocType = (typeof EWAY_DOC_TYPES)[number];

export const EWAY_SUB_SUPPLY_TYPES = [
  'supply', 'export', 'import', 'job_work', 'job_work_returns', 'skd_ckd', 'recipient_not_known',
  'own_use', 'exhibition', 'line_sales', 'sales_return', 'others',
] as const;
export type EwaySubSupplyType = (typeof EWAY_SUB_SUPPLY_TYPES)[number];

export type EwayStoredStatus = 'active' | 'cancelled' | 'rejected' | 'closed';
export type EwayStatus = EwayStoredStatus | 'expired';

/** Km covered per day of validity: 200 for normal cargo, 20 for over-dimensional cargo. */
export function kmPerDay(isOdc: boolean): number {
  return isOdc ? 20 : 200;
}

export function validityDays(distanceKm: number, isOdc = false): number {
  return Math.max(1, Math.ceil(Math.max(0, distanceKm) / kmPerDay(isOdc)));
}

const IST_OFFSET_MS = 330 * 60 * 1000;

/** Calendar date (YYYY-MM-DD) of an instant in India. */
export function istDate(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * One day of validity runs to midnight of the day after generation; each further 200 km
 * (20 km over-dimensional) adds a day. Returns the last instant of validity.
 */
export function computeValidUntil(generatedAt: Date, distanceKm: number, isOdc = false): Date {
  const lastDay = addDays(istDate(generatedAt), validityDays(distanceKm, isOdc));
  return new Date(`${lastDay}T23:59:59+05:30`);
}

/** Extension is allowed from 8 hours before expiry to 8 hours after it. */
export function canExtend(validUntil: Date | null, now = new Date()): boolean {
  if (!validUntil) return false;
  const eightHours = 8 * 3600 * 1000;
  return now.getTime() >= validUntil.getTime() - eightHours && now.getTime() <= validUntil.getTime() + eightHours;
}

/** New validity counts from the old expiry, by the distance still to go. */
export function extendedValidUntil(validUntil: Date, remainingKm: number, isOdc = false): Date {
  return computeValidUntil(validUntil, remainingKm, isOdc);
}

/** The generator may cancel within 24 hours of generation. */
export function canCancel(generatedAt: Date, now = new Date()): boolean {
  return now.getTime() - generatedAt.getTime() <= 24 * 3600 * 1000;
}

/** An active bill past its validity reads as expired. */
export function effectiveEwayStatus(status: string | null, validUntil: Date | string | null, now = new Date()): EwayStatus {
  const s = (status || 'active') as EwayStoredStatus;
  if (s !== 'active' || !validUntil) return s;
  const until = validUntil instanceof Date ? validUntil : new Date(validUntil);
  return until.getTime() < now.getTime() ? 'expired' : 'active';
}

/** Hours left before expiry (negative once expired); null when there is no validity. */
export function hoursToExpiry(validUntil: Date | string | null, now = new Date()): number | null {
  if (!validUntil) return null;
  const until = validUntil instanceof Date ? validUntil : new Date(validUntil);
  return Math.round(((until.getTime() - now.getTime()) / 3600000) * 10) / 10;
}

export class EwayBillInputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const GSTIN = /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/;
const PIN = /^[1-9][0-9]{5}$/;

export interface EwayBillInput {
  source_type: EwaySourceType;
  source_id?: string | null;
  direction?: 'outward' | 'inward';
  ewb_number: string;
  doc_type?: EwayDocType;
  sub_supply_type?: EwaySubSupplyType;
  from_gstin?: string | null;
  to_gstin?: string | null;
  from_pincode?: string | null;
  to_pincode?: string | null;
  distance_km: number;
  is_odc?: boolean;
  goods_value?: number;
  generated_at: string;
  vehicle_number?: string | null;
  transporter_name?: string | null;
  transporter_gstin?: string | null;
  transport_mode?: 'road' | 'rail' | 'air' | 'ship';
  notes?: string | null;
}

export interface ParsedEwayBill extends Required<Omit<EwayBillInput, 'vehicle_number' | 'transporter_name' | 'transporter_gstin' | 'transport_mode' | 'notes' | 'source_id'>> {
  source_id: string | null;
  generated: Date;
  valid_until: Date;
  vehicle_number: string | null;
  transporter_name: string | null;
  transporter_gstin: string | null;
  transport_mode: 'road' | 'rail' | 'air' | 'ship';
  notes: string | null;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T, label: string): T {
  if (value === undefined || value === null || value === '') return fallback;
  if (!allowed.includes(value as T)) throw new EwayBillInputError(`Invalid ${label}`);
  return value as T;
}

function optional(value: unknown, re: RegExp, label: string): string | null {
  const v = String(value ?? '').trim().toUpperCase();
  if (!v) return null;
  if (!re.test(v)) throw new EwayBillInputError(`Invalid ${label}`);
  return v;
}

/** Validates a new e-way bill record and works out its validity. */
export function parseEwayBillInput(body: Partial<EwayBillInput>): ParsedEwayBill {
  const num = parseEwayBillNumber(body.ewb_number);
  if (num.error || !num.number) throw new EwayBillInputError(num.error || 'E-way bill number is required');
  const distance = Number(body.distance_km);
  if (!Number.isFinite(distance) || distance < 0 || distance > 4000) {
    throw new EwayBillInputError('Distance must be between 0 and 4000 km');
  }
  const generated = body.generated_at ? new Date(body.generated_at) : null;
  if (!generated || Number.isNaN(generated.getTime())) throw new EwayBillInputError('Generation date and time is required');
  if (generated.getTime() > Date.now() + 5 * 60 * 1000) throw new EwayBillInputError('Generation time cannot be in the future');
  const isOdc = !!body.is_odc;
  return {
    source_type: pick(body.source_type, EWAY_SOURCE_TYPES, 'other', 'source type'),
    source_id: body.source_id || null,
    direction: pick(body.direction, ['outward', 'inward'] as const, 'outward', 'direction'),
    ewb_number: num.number,
    doc_type: pick(body.doc_type, EWAY_DOC_TYPES, 'tax_invoice', 'document type'),
    sub_supply_type: pick(body.sub_supply_type, EWAY_SUB_SUPPLY_TYPES, 'supply', 'sub-supply type'),
    from_gstin: optional(body.from_gstin, GSTIN, 'from GSTIN'),
    to_gstin: optional(body.to_gstin, GSTIN, 'to GSTIN'),
    from_pincode: optional(body.from_pincode, PIN, 'from PIN code'),
    to_pincode: optional(body.to_pincode, PIN, 'to PIN code'),
    distance_km: Math.round(distance),
    is_odc: isOdc,
    goods_value: Math.max(0, Math.round((Number(body.goods_value) || 0) * 100) / 100),
    generated_at: generated.toISOString(),
    generated,
    valid_until: computeValidUntil(generated, distance, isOdc),
    vehicle_number: String(body.vehicle_number ?? '').trim().toUpperCase().replace(/\s+/g, '') || null,
    transporter_name: String(body.transporter_name ?? '').trim() || null,
    transporter_gstin: optional(body.transporter_gstin, GSTIN, 'transporter GSTIN'),
    transport_mode: pick(body.transport_mode, ['road', 'rail', 'air', 'ship'] as const, 'road', 'transport mode'),
    notes: String(body.notes ?? '').trim() || null,
  };
}

/** Where the goods count while this e-way bill is open, for the reconciliation screen. */
export function custodyForSubSupply(t: EwaySubSupplyType): 'in_transit' | 'with_third_party' | 'closes_custody' | 'leaves_books' {
  switch (t) {
    case 'job_work':
    case 'exhibition':
      return 'with_third_party';
    case 'job_work_returns':
    case 'sales_return':
      return 'closes_custody';
    case 'supply':
    case 'export':
    case 'line_sales':
    case 'skd_ckd':
      return 'leaves_books';
    default:
      return 'in_transit';
  }
}
