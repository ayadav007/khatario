// Cancel, change vehicle, extend and close an e-way bill made through Masters India.
// The provider is called first and never inside an open database transaction; the local
// record follows. A bill recorded by hand never reaches the provider.
// Never log credentials, tokens or request bodies.
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import { EwayBillInputError, istDate } from '@/lib/gst/eway-bills';
import {
  assertCancelWindow,
  assertExtendWindow,
  assertOpenFor,
  assertRemainingKm,
  getEwayBill,
  updateEwayBill,
  type EwayBillAction,
  type EwayBillView,
} from '@/lib/gst/eway-bill-records';
import { gspFailure } from '@/lib/gst/eway-generate';
import { loadGspCredentials } from '@/lib/gsp/mastersindia/credentials';
import { miCancelEway, miCloseEway, miExtendEway, miUpdatePartB, type EwayTransport } from '@/lib/gsp/mastersindia/eway';

export type EwayActionDeps = {
  loadCredentials?: typeof loadGspCredentials;
  cancel?: typeof miCancelEway;
  partB?: typeof miUpdatePartB;
  extend?: typeof miExtendEway;
  close?: typeof miCloseEway;
};

const text = (v: unknown) => String(v ?? '').trim();
const vehicleOf = (v: unknown) => text(v).toUpperCase().replace(/\s+/g, '') || null;
const MODES = ['road', 'rail', 'air', 'ship'] as const;
const CANCEL_CODES = ['duplicate', 'order_cancelled', 'data_entry', 'others'] as const;
const PART_B_CODES = ['breakdown', 'transhipment', 'others', 'first_time'] as const;
const EXTEND_CODES = ['natural_calamity', 'law_and_order', 'transhipment', 'accident', 'others'] as const;
const IN_TRANSIT = ['road', 'warehouse', 'others'] as const;

function pick<T extends string>(list: readonly T[], v: unknown, fallback: T | null, label: string): T {
  if (v === undefined || v === null || v === '') {
    if (fallback) return fallback;
    throw new EwayBillInputError(`Choose ${label}`);
  }
  if (!list.includes(v as T)) throw new EwayBillInputError(`Choose ${label}`);
  return v as T;
}

/**
 * Sends the action to the portal for a bill generated through the provider.
 * Returns null for a manual bill or an action with no portal side (reject).
 */
export async function pushEwayActionToGsp(
  businessId: string,
  bill: EwayBillView,
  a: EwayBillAction,
  deps: EwayActionDeps = {},
  now = new Date(),
): Promise<{ validUntil?: Date | null } | null> {
  if (!a || typeof a !== 'object') throw new EwayBillInputError('Unknown action');
  if (bill.generated_via === 'manual' || a.action === 'reject') return null;

  // Local rules first, so a request the portal would refuse anyway is never sent.
  const validUntil = bill.valid_until ? new Date(bill.valid_until) : null;
  switch (a.action) {
    case 'cancel':
      assertOpenFor(bill.stored_status, 'be cancelled');
      assertCancelWindow(new Date(bill.generated_at), now);
      break;
    case 'close':
      assertOpenFor(bill.stored_status, 'be closed');
      break;
    case 'extend':
      assertOpenFor(bill.stored_status, 'be extended');
      assertExtendWindow(validUntil, now);
      assertRemainingKm(a.remaining_km);
      break;
    case 'vehicle':
      assertOpenFor(bill.stored_status, 'take a new vehicle');
      break;
    default:
      throw new EwayBillInputError('Unknown action');
  }

  // Required fields.
  const place = text((a as any).from_place);
  const stateCode = text((a as any).from_state_code);
  const pincode = text((a as any).from_pincode);
  if (a.action === 'vehicle') {
    if (!place || !stateCode) throw new EwayBillInputError('Enter the place and state the goods are in now');
    // A road vehicle needs its number; rail, air and ship are identified by the transport document, which the provider call checks.
    if (pick(MODES, a.transport_mode, 'road', 'a valid transport mode') === 'road' && !vehicleOf(a.vehicle_number)) {
      throw new EwayBillInputError('Enter the vehicle number');
    }
  }
  if (a.action === 'extend') {
    if (!place || !stateCode || !pincode) throw new EwayBillInputError('Enter the place, state and PIN code the goods are in now');
    if (!text(a.reason)) throw new EwayBillInputError('Enter the reason for the extension');
  }
  if (a.action === 'close' && !text(a.remarks)) throw new EwayBillInputError('Enter remarks for closing the e-way bill');

  const gstin = bill.from_gstin;
  if (!gstin) throw new EwayBillInputError('This e-way bill has no supplier GSTIN recorded', 409);

  const loadCredentials = deps.loadCredentials ?? loadGspCredentials;
  let creds;
  try {
    creds = await loadCredentials(businessId);
  } catch (e) {
    throw gspFailure(e, gstin);
  }
  if (!creds) {
    throw new EwayBillInputError('Connect your Masters India account in Settings, Integrations first.', 409, 'GSP_NOT_CONNECTED');
  }

  // The portal call: no transaction is open here.
  try {
    switch (a.action) {
      case 'cancel': {
        const reason = pick(CANCEL_CODES, a.reason_code, 'others', 'a cancellation reason');
        await (deps.cancel ?? miCancelEway)(creds, { gstin, ewbNumber: bill.ewb_number, reason, remark: text(a.reason) || 'Cancelled' }, undefined);
        return {};
      }
      case 'vehicle': {
        const transport: EwayTransport = {
          mode: pick(MODES, a.transport_mode, 'road', 'a valid transport mode'),
          vehicleNumber: vehicleOf(a.vehicle_number),
          isOdc: bill.is_odc,
          docNumber: text(a.transport_doc_number) || null,
          docDate: text(a.transport_doc_date) || null,
        };
        const r = await (deps.partB ?? miUpdatePartB)(creds, {
          gstin, ewbNumber: bill.ewb_number, transport, fromPlace: place, fromStateCode: stateCode,
          reason: pick(PART_B_CODES, a.reason_code, 'others', 'a reason for the vehicle change'), remark: text(a.reason),
        }, undefined);
        return { validUntil: r.validUntil };
      }
      case 'extend': {
        const transport: EwayTransport = {
          mode: pick(MODES, a.transport_mode, 'road', 'a valid transport mode'),
          vehicleNumber: vehicleOf(a.vehicle_number) ?? vehicleOf(bill.vehicle_number),
          isOdc: bill.is_odc,
        };
        const inTransit = a.in_transit ? pick(IN_TRANSIT, a.in_transit, null, 'where the goods are in transit') : null;
        const r = await (deps.extend ?? miExtendEway)(creds, {
          gstin, ewbNumber: bill.ewb_number, transport, fromPlace: place, fromStateCode: stateCode, fromPincode: pincode,
          remainingKm: Number(a.remaining_km), reason: pick(EXTEND_CODES, a.reason_code, null, 'a reason for the extension'),
          remark: text(a.reason), inTransit,
        }, undefined);
        return { validUntil: r.validUntil };
      }
      case 'close': {
        await (deps.close ?? miCloseEway)(creds, {
          gstin, ewbNumber: bill.ewb_number, closureDate: istDate(now), remark: text(a.remarks),
        }, undefined);
        return {};
      }
    }
  } catch (e) {
    throw gspFailure(e, gstin);
  }
  return null;
}

/** The whole PATCH: load, portal first, then one local transaction. */
export async function applyEwayBillAction(
  businessId: string,
  userId: string,
  id: string,
  action: EwayBillAction,
  deps: EwayActionDeps = {},
): Promise<EwayBillView> {
  if (!action || typeof action !== 'object') throw new EwayBillInputError('Unknown action');
  const pool = getPool();
  const now = new Date();
  const bill = await getEwayBill(pool, businessId, id);
  if (!bill) throw new EwayBillInputError('E-way bill not found', 404);

  const pushed = await pushEwayActionToGsp(businessId, bill, action, deps, now);

  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const view = await updateEwayBill(client, businessId, id, action, userId, now, pushed?.validUntil ? { validUntil: pushed.validUntil } : undefined);
    await client.query('COMMIT');
    return view;
  } catch (e: any) {
    await client?.query('ROLLBACK').catch(() => undefined);
    if (!pushed) throw e;
    // The row changed under us (for example a double click): the portal call is already made, but it is not a save failure.
    if (e instanceof EwayBillInputError && e.status === 409) {
      throw new EwayBillInputError(
        'This e-way bill was changed by another request while yours was running. Reload to see its current state.',
        409,
        'EWAY_STATE_CHANGED',
      );
    }
    console.error('[eway-actions] portal change not saved', { id, action: action.action, error: e?.message });
    throw new EwayBillInputError(
      'The change was made on the e-way bill portal but could not be saved here. Reload and record it manually.',
      500,
      'EWAY_NOT_SAVED',
    );
  } finally {
    client?.release();
  }
}
