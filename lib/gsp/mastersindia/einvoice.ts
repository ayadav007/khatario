// Masters India e-invoice: wrap the generate, by-document, cancel and e-way-bill-by-IRN endpoints and parse their replies.
// Never log credentials, JWTs or request bodies.
import type { EwayTransport } from './eway';
import { GspError, gspCall, parseGspDate, type GspCredentials, type GspDeps } from './client';

export type MiIrnResult = {
  irn: string; ackNo: string; ackDate: Date; signedQr: string; signedInvoice: string | null; status: 'ACT' | 'CNL';
  ewb: { number: string; generatedAt: Date; validUntil: Date | null; printUrl: string | null } | null;
  ewbError: string | null; // from InfoDtls when the IRN succeeded but the e-way bill did not
  pdfUrl: string | null; requestId: string | null;
  /** True when the provider answered an already-registered document with its existing IRN (see `alert`). */
  duplicate: boolean;
  /** The provider's alert text, if any (a duplicate says which document number already has an IRN). */
  alert: string | null;
  /** The document the IRN was issued for, read from the signed invoice (not signature-checked). Null when unreadable. */
  docNumber: string | null;
  /** YYYY-MM-DD. */
  docDate: string | null;
  sellerGstin: string | null;
};

/**
 * Portal code for "Duplicate IRN". The sandbox did not reject a repeated document: it answered success with the
 * same IRN and an `alert` ("IRN already generated on this document number ..."), which sets `duplicate` instead.
 */
export const IRN_DUPLICATE_CODES: readonly string[] = ['2150'];
const NOT_FOUND_CODE = '2154';
const MODE_CODE = { road: '1', rail: '2', air: '3', ship: '4' } as const;

function dmy(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function url(u: unknown): string | null {
  if (typeof u !== 'string' || !u.trim()) return null;
  const t = u.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** Error messages of the EWBERR entries in InfoDtls, joined; null when there are none or the text is not JSON. */
function ewbErrorOf(info: unknown): string | null {
  let parsed: unknown = info;
  if (typeof info === 'string') {
    try { parsed = JSON.parse(info); } catch { return null; }
  }
  if (!Array.isArray(parsed)) return null;
  const msgs: string[] = [];
  for (const e of parsed) {
    if (e?.InfCd !== 'EWBERR' || !Array.isArray(e.Desc)) continue;
    for (const d of e.Desc) {
      const t = typeof d?.ErrorMessage === 'string' ? d.ErrorMessage.trim() : '';
      if (t) msgs.push(t);
    }
  }
  return msgs.length ? msgs.join(' ') : null;
}

const EWB_UNREADABLE = 'The e-way bill details could not be read. Check the e-way bill portal.';

/** Never throws: an issued IRN must not be lost because the e-way part is unreadable. */
function ewbOf(m: any): { ewb: MiIrnResult['ewb']; problem: string | null } {
  if (m?.EwbNo == null || m.EwbNo === '') return { ewb: null, problem: null };
  const generatedAt = parseGspDate(m.EwbDt);
  if (!generatedAt) return { ewb: null, problem: EWB_UNREADABLE };
  return { ewb: { number: String(m.EwbNo), generatedAt, validUntil: parseGspDate(m.EwbValidTill), printUrl: url(m.EwaybillPdf) }, problem: null };
}

/** Document number, date and seller read from the payload segment of the signed invoice. The signature is not verified. */
function signedDocument(signed: unknown): { docNumber: string | null; docDate: string | null; sellerGstin: string | null } {
  const none = { docNumber: null, docDate: null, sellerGstin: null };
  try {
    if (typeof signed !== 'string') return none;
    const payload = JSON.parse(Buffer.from(signed.split('.')[1] || '', 'base64url').toString('utf8'));
    const inv = typeof payload?.data === 'string' ? JSON.parse(payload.data) : payload?.data;
    const no = typeof inv?.DocDtls?.No === 'string' && inv.DocDtls.No ? inv.DocDtls.No : null;
    const dt = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(inv?.DocDtls?.Dt ?? ''));
    const gstin = typeof inv?.SellerDtls?.Gstin === 'string' && inv.SellerDtls.Gstin ? inv.SellerDtls.Gstin : null;
    return { docNumber: no, docDate: dt ? `${dt[3]}-${dt[2]}-${dt[1]}` : null, sellerGstin: gstin };
  } catch {
    return none;
  }
}

function toResult(m: any, info: string | null, requestId: string | null): MiIrnResult {
  const ackDate = parseGspDate(m?.AckDt);
  if (!m || typeof m !== 'object' || typeof m.Irn !== 'string' || !m.Irn || m.AckNo == null || !ackDate || typeof m.SignedQRCode !== 'string') {
    throw new GspError('rejected', 'Masters India sent an e-invoice reply we could not read');
  }
  const alert = typeof m.alert === 'string' && m.alert.trim() ? m.alert.trim() : null;
  const { ewb, problem } = ewbOf(m);
  return {
    irn: m.Irn,
    ackNo: String(m.AckNo),
    ackDate,
    signedQr: m.SignedQRCode,
    signedInvoice: typeof m.SignedInvoice === 'string' && m.SignedInvoice ? m.SignedInvoice : null,
    status: m.Status === 'CNL' ? 'CNL' : 'ACT',
    ewb,
    ewbError: ewbErrorOf(info) ?? problem,
    pdfUrl: url(m.EinvoicePdf),
    requestId,
    duplicate: !!alert && /already generated on this document number/i.test(alert),
    alert,
    ...signedDocument(m.SignedInvoice),
  };
}

export async function miGenerateIrn(creds: GspCredentials, payload: Record<string, unknown>, deps: GspDeps = {}): Promise<MiIrnResult> {
  const r = await gspCall(creds, { method: 'POST', path: 'einvoice/', body: payload }, deps);
  return toResult(r.data, r.info, r.requestId);
}

export async function miGetIrnByDocument(
  creds: GspCredentials, a: { gstin: string; docNumber: string; docDate: string }, deps: GspDeps = {},
): Promise<MiIrnResult | null> {
  try {
    const r = await gspCall(creds, {
      method: 'GET', path: 'get-einvoice-bydoc',
      query: { user_gstin: a.gstin, document_type: 'INV', document_number: a.docNumber, document_date: a.docDate },
    }, deps);
    return toResult(r.data, r.info, r.requestId);
  } catch (e) {
    if (e instanceof GspError && e.kind === 'rejected' && e.nicCode === NOT_FOUND_CODE) return null;
    throw e;
  }
}

export async function miCancelIrn(
  creds: GspCredentials, a: { gstin: string; irn: string; reason: '1' | '2' | '3' | '4'; remarks: string }, deps: GspDeps = {},
): Promise<{ cancelledAt: Date }> {
  const r = await gspCall<any>(creds, {
    method: 'POST', path: 'cancel-einvoice/',
    body: { user_gstin: a.gstin, irn: a.irn, cancel_reason: a.reason, cancel_remarks: a.remarks, ewaybill_cancel: '' },
  }, deps);
  const cancelledAt = parseGspDate(r.data?.CancelDate);
  if (!cancelledAt) throw new GspError('rejected', 'Masters India did not send the cancellation time');
  return { cancelledAt };
}

export async function miGenerateEwbByIrn(
  creds: GspCredentials, a: { gstin: string; irn: string; distanceKm: number; transport: EwayTransport }, deps: GspDeps = {},
): Promise<NonNullable<MiIrnResult['ewb']>> {
  const t = a.transport;
  const r = await gspCall<any>(creds, {
    method: 'POST', path: 'gen-ewb-by-irn/',
    body: {
      user_gstin: a.gstin, irn: a.irn, transporter_id: t.transporterId ?? '', transportation_mode: MODE_CODE[t.mode],
      transporter_document_number: t.docNumber ?? '', transporter_document_date: dmy(t.docDate),
      vehicle_number: String(t.vehicleNumber ?? '').toUpperCase().replace(/\s+/g, ''),
      distance: Math.max(0, Math.round(a.distanceKm)), vehicle_type: t.isOdc ? 'O' : 'R',
      transporter_name: t.transporterName ?? '', data_source: 'erp',
    },
  }, deps);
  const m = r.data;
  const generatedAt = parseGspDate(m?.EwbDt);
  if (m?.EwbNo == null || !generatedAt) throw new GspError('rejected', 'Masters India sent an e-way bill reply we could not read');
  return { number: String(m.EwbNo), generatedAt, validUntil: parseGspDate(m.EwbValidTill), printUrl: url(m.EwaybillPdf) };
}
