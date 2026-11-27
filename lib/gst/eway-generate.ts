// Generate an e-way bill through Masters India and record it in the register.
// A generated bill is a real-world filing: the provider is never called inside an open
// database transaction, and a bill generated but not saved is recovered by the next click.
// Never log credentials, tokens or request bodies.
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import { setInvoiceAuditContext } from '@/lib/invoices/invoice-audit-context';
import { checkLimitInTransaction } from '@/lib/subscription';
import { computeValidUntil, EwayBillInputError, type EwayDocType, type EwaySubSupplyType, type ParsedEwayBill } from '@/lib/gst/eway-bills';
import { createEwayBill, getEwayBill, type EwayBillView } from '@/lib/gst/eway-bill-records';
import { buildEwayBill, SUB_SUPPLY_CODE, type NicEwayBill } from '@/lib/gst/eway-json';
import { GspError } from '@/lib/gsp/mastersindia/client';
import { loadGspCredentials } from '@/lib/gsp/mastersindia/credentials';
import {
  miFindEwayByDocument,
  miGenerateEway,
  miGetEwayDetails,
  toMiEwayPayload,
  type EwayTransport,
  type MiEwayDetails,
  type MiEwayResult,
} from '@/lib/gsp/mastersindia/eway';

export interface GenerateEwayInput {
  source_type: 'invoice' | 'delivery_challan';
  source_id: string;
  distance_km: number;
  transport_mode?: 'road' | 'rail' | 'air' | 'ship';
  vehicle_number?: string | null;
  is_odc?: boolean;
  transporter_gstin?: string | null;
  transporter_name?: string | null;
  transport_doc_number?: string | null;
  transport_doc_date?: string | null;
  ship_to_gstin?: string | null;
  /** All three or none: the ship-to place for a document address not saved on the customer. */
  ship_to_place?: string | null;
  ship_to_pincode?: string | null;
  ship_to_state_code?: string | null;
}

export type EwayGenerateDeps = {
  loadCredentials?: typeof loadGspCredentials;
  generate?: typeof miGenerateEway;
  findByDocument?: typeof miFindEwayByDocument;
  getDetails?: typeof miGetEwayDetails;
};

const SHIP_TO_NOT_SAVED = 'This document ships to an address that is not saved on the customer';
const MODES = ['road', 'rail', 'air', 'ship'] as const;
/** Invoice kinds that never move goods on an e-way bill. */
const NOT_EWAY_INVOICE_TYPES = ['proforma_invoice', 'credit_note', 'debit_note'];
const DOC_TYPE: Record<NicEwayBill['docType'], EwayDocType> = {
  INV: 'tax_invoice', BIL: 'bill_of_supply', CHL: 'delivery_challan',
};
const SUB_SUPPLY_BY_CODE = Object.fromEntries(
  Object.entries(SUB_SUPPLY_CODE).map(([k, v]) => [v, k as EwaySubSupplyType]),
) as Record<number, EwaySubSupplyType>;

const noAnswer = () =>
  new EwayBillInputError('Masters India did not answer. Check the e-way bill portal before trying again.', 502, 'GSP_NO_ANSWER');

export function gspFailure(e: unknown, fromGstin: string): unknown {
  if (!(e instanceof GspError)) return e;
  switch (e.kind) {
    case 'timeout':
    case 'unreachable':
      return noAnswer();
    case 'rejected':
      return new EwayBillInputError(`E-way bill portal: ${e.message} (GSTIN ${fromGstin})`, 422, 'GSP_REJECTED');
    case 'auth':
      return new EwayBillInputError('Masters India no longer accepts the saved login. Reconnect in Settings, Integrations.', 409, 'GSP_AUTH');
    case 'not_configured':
      return new EwayBillInputError('E-way bill generation is not set up on this server.', 503, 'GSP_NOT_CONFIGURED');
    default:
      return e;
  }
}

const text = (v: unknown) => String(v ?? '').trim();
const gstinOrNull = (g: string | null | undefined) => (g && g !== 'URP' ? g : null);
const pinOrNull = (p: number) => (p ? String(p) : null);

function shipToOf(input: GenerateEwayInput): { place: string; pincode: string; stateCode: string } | null {
  const place = text(input.ship_to_place);
  const pincode = text(input.ship_to_pincode);
  const stateCode = text(input.ship_to_state_code);
  if (!place && !pincode && !stateCode) return null;
  if (!place || !pincode || !stateCode) throw new EwayBillInputError('Enter the ship-to city, PIN code and state together', 400);
  return { place, pincode, stateCode };
}

function transportOf(input: GenerateEwayInput): EwayTransport {
  const mode = input.transport_mode ?? 'road';
  if (!MODES.includes(mode)) throw new EwayBillInputError('Invalid transport mode');
  return {
    mode,
    vehicleNumber: text(input.vehicle_number).toUpperCase().replace(/\s+/g, '') || null,
    isOdc: !!input.is_odc,
    transporterId: text(input.transporter_gstin).toUpperCase() || null,
    transporterName: text(input.transporter_name) || null,
    docNumber: text(input.transport_doc_number) || null,
    docDate: text(input.transport_doc_date) || null,
  };
}

/** A duplicate or found bill is recorded with the portal's own vehicle, distance and validity, not this click's. */
type PortalFacts = Pick<MiEwayDetails, 'vehicleNumber' | 'distanceKm'>;

function toParsed(input: GenerateEwayInput, bill: NicEwayBill, click: EwayTransport, r: MiEwayResult, portal: PortalFacts | null): ParsedEwayBill {
  const t: EwayTransport = portal ? { ...click, vehicleNumber: portal.vehicleNumber } : click;
  const distance = portal?.distanceKm != null ? portal.distanceKm : Number(bill.transDistance) || 0;
  const isOdc = !!t.isOdc;
  return {
    source_type: input.source_type,
    source_id: input.source_id,
    direction: 'outward',
    ewb_number: r.ewbNumber,
    doc_type: DOC_TYPE[bill.docType],
    sub_supply_type: SUB_SUPPLY_BY_CODE[bill.subSupplyType] ?? 'supply',
    from_gstin: gstinOrNull(bill.fromGstin),
    to_gstin: gstinOrNull(bill.toGstin),
    from_pincode: pinOrNull(bill.fromPincode),
    to_pincode: pinOrNull(bill.toPincode),
    distance_km: distance,
    is_odc: isOdc,
    goods_value: bill.totInvValue,
    generated_at: r.generatedAt.toISOString(),
    generated: r.generatedAt,
    valid_until: r.validUntil ?? (t.vehicleNumber ? computeValidUntil(r.generatedAt, distance, isOdc) : null),
    vehicle_number: t.vehicleNumber ?? null,
    transporter_name: t.transporterName ?? null,
    transporter_gstin: t.transporterId ?? null,
    transport_mode: t.mode,
    notes: null,
  };
}

export async function generateEwayBillViaGsp(
  businessId: string,
  userId: string,
  input: GenerateEwayInput,
  deps: EwayGenerateDeps = {},
): Promise<EwayBillView> {
  const loadCredentials = deps.loadCredentials ?? loadGspCredentials;
  const generate = deps.generate ?? miGenerateEway;
  const findByDocument = deps.findByDocument ?? miFindEwayByDocument;
  const getDetails = deps.getDetails ?? miGetEwayDetails;
  const pool = getPool();

  if (input?.source_type !== 'invoice' && input?.source_type !== 'delivery_challan') {
    throw new EwayBillInputError('Choose an invoice or a delivery challan');
  }
  if (!text(input.source_id)) throw new EwayBillInputError('Link the e-way bill to its document');

  // 1. A saved Masters India login.
  let creds;
  try {
    creds = await loadCredentials(businessId);
  } catch (e) {
    throw gspFailure(e, '');
  }
  if (!creds) {
    throw new EwayBillInputError('Connect your Masters India account in Settings, Integrations first.', 409, 'GSP_NOT_CONNECTED');
  }

  // 2. One active bill per document.
  const existing = await pool.query(
    `SELECT 1 FROM eway_bills WHERE business_id = $1 AND source_type = $2 AND source_id = $3 AND status = 'active' LIMIT 1`,
    [businessId, input.source_type, input.source_id],
  );
  if (existing.rows.length) throw new EwayBillInputError('This document already has an active e-way bill.', 409, 'EWAY_EXISTS');

  // 2b. Only a document that moves goods can carry an e-way bill (the same rule the pages use).
  if (input.source_type === 'invoice') {
    const inv = (
      await pool.query(`SELECT status, document_type, deleted_at FROM invoices WHERE id = $1 AND business_id = $2`, [input.source_id, businessId])
    ).rows[0];
    if (!inv) throw new EwayBillInputError('Invoice not found', 404);
    if (inv.status !== 'final' || inv.deleted_at || NOT_EWAY_INVOICE_TYPES.includes(String(inv.document_type || ''))) {
      throw new EwayBillInputError('Only a final invoice can get an e-way bill', 409, 'NOT_ELIGIBLE');
    }
  } else {
    const dc = (
      await pool.query(`SELECT status FROM delivery_challans WHERE id = $1 AND business_id = $2`, [input.source_id, businessId])
    ).rows[0];
    if (!dc) throw new EwayBillInputError('Delivery challan not found', 404);
    if (dc.status !== 'sent' && dc.status !== 'delivered') {
      throw new EwayBillInputError('Only a sent or delivered challan can get an e-way bill', 409, 'NOT_ELIGIBLE');
    }
  }

  // 3. The bill and the provider payload.
  const transport = transportOf(input);
  let bill: NicEwayBill;
  try {
    bill = await buildEwayBill(pool, businessId, input.source_type, input.source_id, {
      distanceKm: Number(input.distance_km),
      shipToGstin: text(input.ship_to_gstin).toUpperCase() || null,
      shipTo: shipToOf(input),
    });
  } catch (e) {
    if (e instanceof EwayBillInputError && e.message.startsWith(SHIP_TO_NOT_SAVED)) {
      throw new EwayBillInputError(e.message, 422, 'SHIP_TO_NEEDED');
    }
    throw e;
  }
  const payload = toMiEwayPayload(bill, transport);
  const fromGstin = String(bill.fromGstin ?? '');

  // 4. Monthly plan limit, in its own short transaction.
  const limitClient = await pool.connect();
  let check: Awaited<ReturnType<typeof checkLimitInTransaction>>;
  try {
    await limitClient.query('BEGIN');
    check = await checkLimitInTransaction(limitClient, businessId, 'eway_bills');
    await limitClient.query('COMMIT');
  } catch (e) {
    await limitClient.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    limitClient.release();
  }
  if (!check.allowed) {
    // A positive limit was reached; otherwise the check explains why (no subscription, a plan without e-way bills).
    throw new EwayBillInputError(
      check.limit > 0
        ? "You have reached this month's e-way bill limit for your plan. Upgrade your plan to generate more."
        : check.message || 'Your plan does not include e-way bill generation.',
      403,
      'LIMIT_EXCEEDED',
    );
  }

  /**
   * A bill the portal already held for this document number is recorded only when it was made for this very
   * document (number and date) and is still active; it is then stored with the portal's own details.
   */
  const portalCheck = async (ewbNumber: string, onError: (e: unknown) => unknown): Promise<MiEwayDetails> => {
    let d: MiEwayDetails;
    try {
      d = await getDetails(creds, fromGstin, ewbNumber);
    } catch (e) {
      throw onError(e);
    }
    const sameDoc =
      d.documentNumber.toUpperCase() === String(bill.docNo).trim().toUpperCase() && d.documentDate === String(bill.docDate).trim();
    if (!sameDoc) {
      throw new EwayBillInputError(
        `The e-way bill portal holds e-way bill ${ewbNumber} for document ${d.documentNumber} dated ${d.documentDate}, which does not match this document. Check the portal.`,
        409,
        'EWAY_MISMATCH',
      );
    }
    if (d.status !== 'active') {
      throw new EwayBillInputError(
        'The e-way bill portal still holds an old e-way bill ' + ewbNumber +
          ' for this document number. Cancelled bills cannot be regenerated on the same number from here; check the portal.',
        409,
        'EWAY_STALE_DUPLICATE',
      );
    }
    return d;
  };

  /** True when we already hold this number for this document as no longer active (for example cancelled earlier). */
  const heldInactive = async (ewbNumber: string) =>
    (
      await pool.query(
        `SELECT 1 FROM eway_bills WHERE business_id = $1 AND source_type = $2 AND source_id = $3 AND ewb_number = $4 AND status <> 'active' LIMIT 1`,
        [businessId, input.source_type, input.source_id, ewbNumber],
      )
    ).rows.length > 0;

  // 5-6. Generate; no transaction is open here. Look up by document number when the call went unanswered,
  // or when the portal refused it as a repeat of a document number that already has a bill.
  let result: MiEwayResult;
  let portal: MiEwayDetails | null = null;
  try {
    result = await generate(creds, payload);
  } catch (e) {
    const unanswered = e instanceof GspError && (e.kind === 'timeout' || e.kind === 'unreachable');
    const repeat =
      e instanceof GspError && e.kind === 'rejected' && (e.nicCode === '604' || /already.*generated|duplicate/i.test(e.message));
    if (!unanswered && !repeat) throw gspFailure(e, fromGstin);
    // When the lookup gives no usable answer: unanswered means check the portal; a refused repeat keeps the portal's own words.
    const giveUp = (err?: unknown): unknown => {
      if (err !== undefined && !(err instanceof GspError)) return err;
      return unanswered ? noAnswer() : gspFailure(e, fromGstin);
    };
    let found: MiEwayResult | null = null;
    try {
      found = await findByDocument(creds, fromGstin, bill.docNo, bill.docType);
    } catch {
      found = null;
    }
    if (!found) throw giveUp();
    // The lookup can return the bill cancelled earlier on this document rather than a newer one: no answer, not a stale duplicate.
    if (unanswered && (await heldInactive(found.ewbNumber))) throw noAnswer();
    portal = await portalCheck(found.ewbNumber, giveUp);
    result = found;
  }
  if (result.duplicate && !portal) portal = await portalCheck(result.ewbNumber, (err) => gspFailure(err, fromGstin));
  if (portal) result = { ...result, validUntil: portal.validUntil ?? result.validUntil };

  // 7-8. Record in one transaction; on failure the next click reaches the duplicate path and records it.
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await setInvoiceAuditContext(client, { actorUserId: userId, action: 'eway_updated' });
    const view = await createEwayBill(client, businessId, toParsed(input, bill, transport, result, portal), userId, {
      generatedVia: 'api',
      requestId: result.requestId,
      printUrl: result.printUrl,
      transactionType: bill.transactionType,
    });
    await client.query('COMMIT');
    return view;
  } catch (e: any) {
    if (client) {
      await client.query('ROLLBACK').catch(() => undefined);
      // Release before the lookups below, so this request never holds two pooled connections.
      client.release();
      client = null;
    }
    // A concurrent request for the same document may have saved this very bill first.
    const saved = await pool
      .query(
        `SELECT id FROM eway_bills WHERE business_id = $1 AND ewb_number = $2 AND source_type = $3 AND source_id = $4 LIMIT 1`,
        [businessId, result.ewbNumber, input.source_type, input.source_id],
      )
      .then((r) => (r.rows[0] ? getEwayBill(pool, businessId, r.rows[0].id) : null))
      .catch(() => null);
    if (saved) return saved;
    // The number is already recorded here against another document: clicking again would fail the same way.
    if (e?.code === '23505') {
      const elsewhere = await pool
        .query(`SELECT 1 FROM eway_bills WHERE business_id = $1 AND ewb_number = $2 LIMIT 1`, [businessId, result.ewbNumber])
        .then((r) => r.rows.length > 0)
        .catch(() => false);
      if (elsewhere) {
        throw new EwayBillInputError(
          'E-way bill ' + result.ewbNumber + ' is already recorded here against another document. Open the e-way bills page to check it.',
          409,
          'EWAY_NUMBER_TAKEN',
        );
      }
    }
    console.error('[eway-generate] generated e-way bill not saved', { ewbNumber: result.ewbNumber, error: e?.message });
    throw new EwayBillInputError(
      'E-way bill ' + result.ewbNumber + ' was generated but could not be saved here. Click Generate again to record it.',
      500,
      'EWAY_NOT_SAVED',
    );
  } finally {
    client?.release();
  }
}
