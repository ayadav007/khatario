// Masters India e-way bill: map Khatario's NIC-shaped bill to the provider's field names and wrap its endpoints.
// Never log credentials, JWTs or request bodies.
import { GST_STATE_NAMES } from '@/lib/tax/gstin';
import { EwayBillInputError } from '@/lib/gst/eway-bills';
import type { NicEwayBill } from '@/lib/gst/eway-json';
import { GspError, gspCall, parseGspDate, type GspCredentials, type GspDeps } from './client';

export type EwayTransport = {
  mode: 'road' | 'rail' | 'air' | 'ship';
  vehicleNumber?: string | null; isOdc?: boolean;
  transporterId?: string | null; transporterName?: string | null;
  docNumber?: string | null; docDate?: string | null; // YYYY-MM-DD
};
export type MiEwayResult = {
  ewbNumber: string; generatedAt: Date; validUntil: Date | null; printUrl: string | null;
  alert: string | null; duplicate: boolean; requestId: string | null;
};

const SUB_SUPPLY: Record<number, string> = {
  1: 'Supply', 3: 'Export', 4: 'Job Work', 5: 'For Own Use', 8: 'Others', 9: 'SKD/CKD',
  10: 'Line Sales', 11: 'Recipient not known', 12: 'Exhibition or fairs',
};
const DOC_TYPE = { INV: 'Tax Invoice', BIL: 'Bill of Supply', CHL: 'Delivery Challan' } as const;
const MODE_NAME = { road: 'Road', rail: 'Rail', air: 'Air', ship: 'Ship' } as const;
const MODE_CODE = { road: '1', rail: '2', air: '3', ship: '4' } as const;
const CANCEL_REASON = {
  duplicate: 'Duplicate', order_cancelled: 'Order Cancelled', data_entry: 'Data Entry Mistake', others: 'Others',
} as const;
const PART_B_REASON = {
  breakdown: 'Due to Break Down', transhipment: 'Due to Transhipment', others: 'Others', first_time: 'First Time',
} as const;
const EXTEND_REASON = {
  natural_calamity: 'Natural Calamity', law_and_order: 'Law and Order Situation', transhipment: 'Transhipment',
  accident: 'Accident', others: 'Others',
} as const;
const TRANSIT_TYPE = { road: 'R', warehouse: 'W', others: 'O' } as const;

const MAX_ITEMS = 250;

/** `YYYY-MM-DD` to the `DD/MM/YYYY` Masters India expects; blank when absent. */
function dmy(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Upper-case state name for a state code that may arrive as a number such as 5. */
function stateName(code: string | number): string {
  const key = String(code).padStart(2, '0');
  const name = GST_STATE_NAMES[key];
  if (!name) throw new EwayBillInputError(`Unknown state code ${code}`);
  return name.toUpperCase();
}

function withScheme(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  const u = url.trim();
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

function needTransportDoc(t: EwayTransport): void {
  if (t.mode !== 'road' && (!t.docNumber || !t.docDate)) {
    throw new EwayBillInputError('Enter the transport document number and date');
  }
}

export function toMiEwayPayload(bill: NicEwayBill, t: EwayTransport): Record<string, unknown> {
  if (t.mode === 'road' && !t.vehicleNumber && !t.transporterId) {
    throw new EwayBillInputError("Enter the vehicle number, or the transporter's GSTIN to generate Part A only");
  }
  needTransportDoc(t);
  if (bill.itemList.length > MAX_ITEMS) throw new EwayBillInputError(`An e-way bill can carry at most ${MAX_ITEMS} items`);
  const subSupply = SUB_SUPPLY[bill.subSupplyType];
  if (!subSupply) throw new EwayBillInputError('This kind of movement cannot be sent to the e-way bill portal from here yet');
  return {
    userGstin: bill.fromGstin,
    gstin_of_consignor: bill.fromGstin,
    supply_type: 'outward',
    sub_supply_type: subSupply,
    sub_supply_description: bill.subSupplyDesc,
    document_type: DOC_TYPE[bill.docType],
    document_number: bill.docNo,
    document_date: bill.docDate,
    legal_name_of_consignor: bill.fromTrdName,
    address1_of_consignor: bill.fromAddr1,
    address2_of_consignor: bill.fromAddr2,
    place_of_consignor: bill.fromPlace,
    pincode_of_consignor: bill.fromPincode,
    state_of_consignor: stateName(bill.fromStateCode),
    actual_from_state_name: stateName(bill.actFromStateCode),
    gstin_of_consignee: bill.toGstin,
    legal_name_of_consignee: bill.toTrdName,
    address1_of_consignee: bill.toAddr1,
    address2_of_consignee: bill.toAddr2,
    place_of_consignee: bill.toPlace,
    pincode_of_consignee: bill.toPincode,
    state_of_supply: stateName(bill.toStateCode),
    actual_to_state_name: stateName(bill.actToStateCode),
    transaction_type: bill.transactionType,
    ship_to_gstin: bill.shipToGstin ?? '',
    ship_to_tradename: bill.shipToTradeName ?? '',
    other_value: bill.otherValue,
    total_invoice_value: bill.totInvValue,
    taxable_amount: bill.totalValue,
    cgst_amount: bill.cgstValue,
    sgst_amount: bill.sgstValue,
    igst_amount: bill.igstValue,
    cess_amount: bill.cessValue,
    cess_nonadvol_value: bill.cessNonAdvolValue,
    transporter_id: t.transporterId ?? '',
    transporter_name: t.transporterName ?? '',
    transporter_document_number: t.docNumber ?? '',
    transporter_document_date: dmy(t.docDate),
    transportation_mode: MODE_NAME[t.mode],
    transportation_distance: bill.transDistance,
    vehicle_number: t.vehicleNumber ?? '',
    vehicle_type: t.isOdc ? 'ODC' : 'Regular',
    generate_status: 1,
    data_source: 'erp',
    user_ref: '',
    location_code: '',
    eway_bill_status: 'ABC',
    auto_print: 'N',
    email: '',
    delete_record: 'N',
    itemList: bill.itemList.map((i) => ({
      product_name: i.productName,
      product_description: i.productDesc,
      hsn_code: i.hsnCode,
      quantity: i.quantity,
      unit_of_product: i.qtyUnit,
      cgst_rate: i.cgstRate,
      sgst_rate: i.sgstRate,
      igst_rate: i.igstRate,
      cess_rate: i.cessRate,
      cessNonAdvol: i.cessNonadvol,
      taxable_amount: i.taxableAmount,
    })),
  };
}

function toResult(m: any, requestId: string | null): MiEwayResult {
  const generatedAt = parseGspDate(m?.ewayBillDate);
  if (m?.ewayBillNo == null || !generatedAt) throw new GspError('rejected', 'Masters India sent an e-way bill reply we could not read');
  const alert = typeof m.alert === 'string' && m.alert.trim() ? m.alert.trim() : null;
  return {
    ewbNumber: String(m.ewayBillNo),
    generatedAt,
    validUntil: parseGspDate(m.validUpto),
    printUrl: withScheme(m.url),
    alert,
    duplicate: !!alert && /already generated on this document number/i.test(alert),
    requestId,
  };
}

export async function miGenerateEway(creds: GspCredentials, payload: Record<string, unknown>, deps: GspDeps = {}): Promise<MiEwayResult> {
  const r = await gspCall(creds, { method: 'POST', path: 'ewayBillsGenerate/', body: payload }, deps);
  return toResult(r.data, r.requestId);
}

export async function miFindEwayByDocument(
  creds: GspCredentials, gstin: string, docNumber: string, docType: 'INV' | 'BIL' | 'CHL', deps: GspDeps = {},
): Promise<MiEwayResult | null> {
  try {
    const r = await gspCall(creds, {
      method: 'GET', path: 'getEwayBillData/',
      query: { action: 'GetEwayBillGeneratedByConsigner', gstin, document_number: docNumber, document_type: DOC_TYPE[docType] },
    }, deps);
    return toResult(r.data, r.requestId);
  } catch (e) {
    if (e instanceof GspError && e.kind === 'rejected' && e.nicCode === '418') return null;
    throw e;
  }
}

export type MiEwayStatus = 'active' | 'cancelled' | 'other';
/** What the portal holds for a bill: its status, the document it was made for, and its current Part B. */
export type MiEwayDetails = {
  status: MiEwayStatus;
  documentNumber: string;
  /** DD/MM/YYYY, as the portal sends it. */
  documentDate: string;
  validUntil: Date | null;
  vehicleNumber: string | null;
  distanceKm: number | null;
};

/** The bill as the portal holds it (GetEwayBill). */
export async function miGetEwayDetails(
  creds: GspCredentials, gstin: string, ewbNumber: string, deps: GspDeps = {},
): Promise<MiEwayDetails> {
  const r = await gspCall<any>(creds, {
    method: 'GET', path: 'getEwayBillData/', query: { action: 'GetEwayBill', gstin, eway_bill_number: ewbNumber },
  }, deps);
  const m = r.data ?? {};
  const s = String(m.eway_bill_status ?? '').trim().toLowerCase();
  // The latest vehicle entry is the one in use; entries carry their update time.
  const vehicles: any[] = Array.isArray(m.VehiclListDetails) ? [...m.VehiclListDetails] : [];
  const at = (v: any) => parseGspDate(v?.vehicle_number_update_date)?.getTime() ?? 0;
  vehicles.sort((a, b) => at(b) - at(a));
  const vehicle = String(vehicles[0]?.vehicle_number ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const km = Number(m.transportation_distance);
  return {
    status: s === 'active' ? 'active' : s.startsWith('cancel') ? 'cancelled' : 'other',
    documentNumber: String(m.document_number ?? '').trim(),
    documentDate: String(m.document_date ?? '').trim(),
    validUntil: parseGspDate(m.eway_bill_valid_date),
    vehicleNumber: vehicle || null,
    distanceKm: m.transportation_distance != null && Number.isFinite(km) ? km : null,
  };
}

/** Status of a bill as the portal reports it. */
export async function miGetEwayStatus(
  creds: GspCredentials, gstin: string, ewbNumber: string, deps: GspDeps = {},
): Promise<MiEwayStatus> {
  return (await miGetEwayDetails(creds, gstin, ewbNumber, deps)).status;
}

function dateOf(s: unknown, what: string): Date {
  const d = parseGspDate(typeof s === 'string' ? s : null);
  if (!d) throw new GspError('rejected', `Masters India did not send the ${what}`);
  return d;
}

export async function miCancelEway(
  creds: GspCredentials,
  a: { gstin: string; ewbNumber: string; reason: keyof typeof CANCEL_REASON; remark: string },
  deps: GspDeps = {},
): Promise<{ cancelledAt: Date }> {
  const r = await gspCall<any>(creds, {
    method: 'POST', path: 'ewayBillCancel/',
    body: {
      userGstin: a.gstin, eway_bill_number: Number(a.ewbNumber), reason_of_cancel: CANCEL_REASON[a.reason],
      cancel_remark: a.remark, data_source: 'erp',
    },
  }, deps);
  return { cancelledAt: dateOf(r.data?.cancelDate, 'cancellation time') };
}

export async function miUpdatePartB(
  creds: GspCredentials,
  a: {
    gstin: string; ewbNumber: string; transport: EwayTransport; fromPlace: string; fromStateCode: string;
    reason: keyof typeof PART_B_REASON; remark?: string;
  },
  deps: GspDeps = {},
): Promise<{ validUntil: Date | null; printUrl: string | null }> {
  needTransportDoc(a.transport);
  const t = a.transport;
  const r = await gspCall<any>(creds, {
    method: 'POST', path: 'updateVehicleNumber/',
    body: {
      userGstin: a.gstin, eway_bill_number: Number(a.ewbNumber), vehicle_number: t.vehicleNumber ?? '',
      vehicle_type: t.isOdc ? 'o' : 'r', place_of_consignor: a.fromPlace, state_of_consignor: stateName(a.fromStateCode),
      reason_code_for_vehicle_updation: PART_B_REASON[a.reason], reason_for_vehicle_updation: a.remark ?? '',
      transporter_document_number: t.docNumber ?? '', transporter_document_date: dmy(t.docDate),
      mode_of_transport: MODE_CODE[t.mode], data_source: 'erp',
    },
  }, deps);
  return { validUntil: parseGspDate(r.data?.validUpto), printUrl: withScheme(r.data?.url) };
}

export async function miExtendEway(
  creds: GspCredentials,
  a: {
    gstin: string; ewbNumber: string; transport: EwayTransport; fromPlace: string; fromStateCode: string; fromPincode: string;
    remainingKm: number; reason: keyof typeof EXTEND_REASON; remark: string; inTransit?: keyof typeof TRANSIT_TYPE | null;
  },
  deps: GspDeps = {},
): Promise<{ validUntil: Date }> {
  needTransportDoc(a.transport);
  const t = a.transport;
  const r = await gspCall<any>(creds, {
    method: 'POST', path: 'ewayBillValidityExtend/',
    body: {
      userGstin: a.gstin, eway_bill_number: Number(a.ewbNumber), vehicle_number: t.vehicleNumber ?? '',
      place_of_consignor: a.fromPlace, state_of_consignor: stateName(a.fromStateCode), remaining_distance: a.remainingKm,
      transporter_document_number: t.docNumber ?? '', transporter_document_date: dmy(t.docDate),
      mode_of_transport: a.inTransit ? '5' : MODE_CODE[t.mode],
      extend_validity_reason: EXTEND_REASON[a.reason], extend_remarks: a.remark,
      consignment_status: a.inTransit ? 'T' : 'M', from_pincode: Number(a.fromPincode),
      transit_type: a.inTransit ? TRANSIT_TYPE[a.inTransit] : '',
      address_line1: a.fromPlace, address_line2: '', address_line3: '', data_source: 'erp',
    },
  }, deps);
  return { validUntil: dateOf(r.data?.validUpto, 'new validity') };
}

export async function miCloseEway(
  creds: GspCredentials,
  a: { gstin: string; ewbNumber: string; closureDate: string; remark: string },
  deps: GspDeps = {},
): Promise<{ closedAt: Date }> {
  const r = await gspCall<any>(creds, {
    method: 'POST', path: 'ewayBillClosure/',
    body: {
      userGstin: a.gstin, eway_bill_number: Number(a.ewbNumber), closure_date: dmy(a.closureDate),
      remarks: a.remark, data_source: 'erp',
    },
  }, deps);
  return { closedAt: dateOf(r.data?.ewbClosureDate, 'closure time') };
}
