// Generate the e-invoice (IRN) of a final sales invoice through Masters India and store it on the invoice.
// An IRN is a real filing: no database client or transaction is held across a provider call, and an IRN
// issued but not saved is picked up by the next click. Never log credentials, tokens, request or response bodies.
import type { Pool } from 'pg';
import { getPool } from '@/lib/db';
import { runWithInvoiceAudit } from '@/lib/invoices/invoice-audit-context';
import { checkLimitInTransaction } from '@/lib/subscription';
import { EwayBillInputError } from '@/lib/gst/eway-bills';
import { createEwayBill } from '@/lib/gst/eway-bill-records';
import { buildEwayBill, type NicEwayBill } from '@/lib/gst/eway-json';
import { toParsed, transportOf } from '@/lib/gst/eway-generate';
import { einvoiceApplies, einvoiceFromFor } from '@/lib/gst/einvoice-settings';
import { resolveSupplierRegistration } from '@/lib/gst/registration';
import { GspError } from '@/lib/gsp/mastersindia/client';
import { loadGspCredentials } from '@/lib/gsp/mastersindia/credentials';
import type { EwayTransport } from '@/lib/gsp/mastersindia/eway';
import { buildEinvoice, type EinvoiceProblem } from '@/lib/gsp/mastersindia/einvoice-payload';
import {
  IRN_DUPLICATE_CODES,
  miCancelIrn,
  miGenerateEwbByIrn,
  miGenerateIrn,
  miGetIrnByDocument,
  type MiIrnResult,
} from '@/lib/gsp/mastersindia/einvoice';

export class EinvoiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly problems?: EinvoiceProblem[]) {
    super(message);
    this.name = 'EinvoiceError';
  }
}

export type EinvoiceDeps = {
  loadCredentials?: typeof loadGspCredentials;
  generate?: typeof miGenerateIrn;
  getByDocument?: typeof miGetIrnByDocument;
  cancel?: typeof miCancelIrn;
  ewbByIrn?: typeof miGenerateEwbByIrn;
};

export type EinvoiceView = {
  applies: boolean;
  status: 'none' | 'active' | 'cancelled';
  irn: string | null;
  ack_no: string | null;
  ack_date: string | null;
  signed_qr: string | null;
  can_cancel: boolean;
  /** An active IRN past the cancel window: the page can ask the portal whether it was cancelled there. */
  can_recheck: boolean;
  last_error: string | null;
  problems: EinvoiceProblem[];
  eway_warning: string | null;
};

export type EinvoiceEwb = { distanceKm: number; transport: EwayTransport };

const CANCEL_WINDOW_MS = 24 * 3600e3;
const MAX_ERROR_TEXT = 1000;

const noAnswer = () =>
  new EinvoiceError(
    'The e-invoice portal did not answer. Wait a minute and try again; Khatario will pick up the e-invoice if it was created.',
    502,
    'GSP_NO_ANSWER',
  );
const rejected = (message: string) => new EinvoiceError('E-invoice portal: ' + message, 422, 'GSP_REJECTED');

/** Login and server set-up failures, with the messages and codes the e-way bill generator uses. */
function gspFailure(e: unknown): unknown {
  if (!(e instanceof GspError)) return e;
  switch (e.kind) {
    case 'timeout':
    case 'unreachable':
      return noAnswer();
    case 'rejected':
      return rejected(e.message);
    case 'auth':
      return new EinvoiceError('Masters India no longer accepts the saved login. Reconnect in Settings, Integrations.', 409, 'GSP_AUTH');
    case 'not_configured':
      return new EinvoiceError('E-invoice generation is not set up on this server.', 503, 'GSP_NOT_CONFIGURED');
    default:
      return e;
  }
}

function assertEwbDistance(distanceKm: number): void {
  // The same range buildEwayBill accepts; 0 lets the portal work out the distance from the PIN codes.
  if (!Number.isFinite(distanceKm) || distanceKm < 0 || distanceKm > 4000) {
    throw new EinvoiceError('Enter the distance in km (0 to 4000)', 400, 'INVALID_EWB');
  }
}

/**
 * The optional `ewb` part of the request body, with the field names of the e-way bill generator.
 * Null when absent; a missing distance or a bad transport mode is a 400.
 */
export function parseEinvoiceEwb(raw: unknown): EinvoiceEwb | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new EinvoiceError('Send the e-way bill details as an object', 400, 'INVALID_EWB');
  const b = raw as Record<string, unknown>;
  const distanceKm = b.distance_km === undefined || b.distance_km === null || String(b.distance_km).trim() === '' ? NaN : Number(b.distance_km);
  assertEwbDistance(distanceKm);
  let transport: EwayTransport;
  try {
    transport = transportOf(b as Parameters<typeof transportOf>[0]);
  } catch (e) {
    if (e instanceof EwayBillInputError) throw new EinvoiceError(e.message, 400, 'INVALID_EWB');
    throw e;
  }
  return { distanceKm, transport };
}

type InvoiceRow = {
  id: string; branch_id: string | null; status: string; document_type: string | null; supply_type: string | null;
  invoice_number: string; invoice_date: string; irn: string | null; irn_ack_no: string | null; irn_ack_date: Date | null; irn_signed_qr: string | null;
  irn_status: 'active' | 'cancelled' | null; irn_last_error: string | null;
};

async function readInvoice(pool: Pool, businessId: string, invoiceId: string): Promise<InvoiceRow | null> {
  const r = await pool.query<InvoiceRow>(
    `SELECT id, branch_id, status, document_type, supply_type, invoice_number, invoice_date::text AS invoice_date,
            irn, irn_ack_no, irn_ack_date, irn_signed_qr, irn_status, irn_last_error
       FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [invoiceId, businessId],
  );
  return r.rows[0] ?? null;
}

export async function getEinvoiceView(businessId: string, invoiceId: string): Promise<EinvoiceView | null> {
  const pool = getPool();
  const inv = await readInvoice(pool, businessId, invoiceId);
  if (!inv) return null;
  const applies = einvoiceApplies(inv, await einvoiceFromFor(pool, businessId, inv.branch_id));
  const status = inv.irn_status ?? 'none';
  // A cancelled e-invoice cannot be made again on the same number, so there is nothing to fix.
  const problems = applies && status === 'none' ? (await buildEinvoice(pool, businessId, invoiceId)).problems : [];
  const ackDate = inv.irn_ack_date ? new Date(inv.irn_ack_date) : null;
  const canCancel = status === 'active' && !!ackDate && Date.now() - ackDate.getTime() < CANCEL_WINDOW_MS;
  return {
    applies,
    status,
    irn: inv.irn,
    ack_no: inv.irn_ack_no,
    ack_date: ackDate ? ackDate.toISOString() : null,
    signed_qr: inv.irn_signed_qr,
    can_cancel: canCancel,
    can_recheck: status === 'active' && !canCancel,
    last_error: inv.irn_last_error,
    problems,
    eway_warning: null,
  };
}

/** True when a repeat or found IRN was issued for this very invoice and has the status asked for (still active by default). */
function sameDocument(
  r: MiIrnResult,
  doc: { number: string; dateIso: string; sellerGstin: string },
  status: MiIrnResult['status'] = 'ACT',
): boolean {
  const up = (s: string) => s.trim().toUpperCase();
  return (
    r.status === status &&
    r.docNumber !== null && r.docDate !== null && r.sellerGstin !== null &&
    up(r.docNumber) === up(doc.number) && r.docDate === doc.dateIso && up(r.sellerGstin) === up(doc.sellerGstin)
  );
}

export async function generateIrn(
  businessId: string,
  userId: string,
  invoiceId: string,
  opts: { ewb?: EinvoiceEwb | null } = {},
  deps: EinvoiceDeps = {},
): Promise<EinvoiceView> {
  const loadCredentials = deps.loadCredentials ?? loadGspCredentials;
  const generate = deps.generate ?? miGenerateIrn;
  const getByDocument = deps.getByDocument ?? miGetIrnByDocument;
  const pool = getPool();
  const wantEwb = opts?.ewb ?? null;

  // 1. The invoice, in this business, without an e-invoice yet.
  const inv = await readInvoice(pool, businessId, invoiceId);
  if (!inv) throw new EinvoiceError('Invoice not found', 404, 'NOT_FOUND');
  if (inv.irn_status === 'active') throw new EinvoiceError('This invoice already has an e-invoice.', 409, 'IRN_EXISTS');
  if (inv.irn_status === 'cancelled') {
    throw new EinvoiceError(
      'The e-invoice for this invoice was cancelled. The portal does not give a new e-invoice on the same invoice number. Make a new invoice instead.',
      409,
      'IRN_CANCELLED',
    );
  }

  // 2. E-invoicing is on for this GSTIN and this invoice needs one.
  if (!einvoiceApplies(inv, await einvoiceFromFor(pool, businessId, inv.branch_id))) {
    throw new EinvoiceError('E-invoicing is not switched on for this GSTIN, or this invoice does not need one.', 409, 'NOT_APPLICABLE');
  }
  if (wantEwb) {
    assertEwbDistance(wantEwb.distanceKm);
    const active = await pool.query(
      `SELECT 1 FROM eway_bills WHERE business_id = $1 AND source_type = 'invoice' AND source_id = $2 AND status = 'active' LIMIT 1`,
      [businessId, invoiceId],
    );
    if (active.rows.length) throw new EinvoiceError('This invoice already has an active e-way bill.', 409, 'EWAY_EXISTS');
  }

  // 3. A saved Masters India login.
  let creds;
  try {
    creds = await loadCredentials(businessId);
  } catch (e) {
    throw gspFailure(e);
  }
  if (!creds) throw new EinvoiceError('Connect your Masters India account in Settings, Integrations first.', 409, 'GSP_NOT_CONNECTED');

  // 4. The request body, or what to fix first.
  const build = await buildEinvoice(pool, businessId, invoiceId, { ewb: wantEwb });
  const ewbRefused = build.problems.find((p) => p.field === 'ewaybill');
  if (ewbRefused) throw new EinvoiceError(ewbRefused.message, 400, 'EWB_NOT_ALLOWED');
  if (build.problems.length || !build.payload || !build.sellerGstin) {
    throw new EinvoiceError('Fix these before generating the e-invoice', 422, 'PRECHECK_FAILED', build.problems);
  }
  let bill: NicEwayBill | null = null;
  if (wantEwb) {
    try {
      bill = await buildEwayBill(pool, businessId, 'invoice', invoiceId, { distanceKm: wantEwb.distanceKm });
    } catch (e) {
      if (e instanceof EwayBillInputError) {
        throw new EinvoiceError('Fix these before generating the e-invoice', 422, 'PRECHECK_FAILED', [{ field: 'ewaybill', message: e.message }]);
      }
      throw e;
    }
  }
  const doc = { number: build.docNumber, dateIso: inv.invoice_date.slice(0, 10), sellerGstin: build.sellerGstin };

  // 5. Monthly plan limit, in its own short transaction.
  const limitClient = await pool.connect();
  let check: Awaited<ReturnType<typeof checkLimitInTransaction>>;
  try {
    await limitClient.query('BEGIN');
    check = await checkLimitInTransaction(limitClient, businessId, 'einvoices');
    await limitClient.query('COMMIT');
  } catch (e) {
    await limitClient.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    limitClient.release();
  }
  if (!check.allowed) {
    throw new EinvoiceError(
      check.limit > 0
        ? "You have reached this month's e-invoice limit for your plan. Upgrade your plan to generate more."
        : check.message || 'Your plan does not include e-invoices.',
      403,
      'LIMIT_EXCEEDED',
    );
  }

  /** Keeps the portal's refusal on the invoice for the page to show. Best effort: the user is told either way. */
  const keepError = (message: string) =>
    runWithInvoiceAudit({ actorUserId: userId, action: 'einvoice_rejected' }, (client) =>
      client.query(
        `UPDATE invoices SET irn_last_error = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND business_id = $2`,
        [invoiceId, businessId, message.slice(0, MAX_ERROR_TEXT)],
      ),
    ).catch(() => undefined);

  // 6. Generate; nothing is held open here. When the call went unanswered or the portal refused it as a
  // duplicate, look the document up once.
  let result: MiIrnResult;
  let mustMatch: boolean;
  try {
    result = await generate(creds, build.payload);
    mustMatch = result.duplicate;
  } catch (e) {
    if (!(e instanceof GspError)) throw e;
    const unanswered = e.kind === 'timeout' || e.kind === 'unreachable';
    const duplicate = e.kind === 'rejected' && e.nicCode !== null && IRN_DUPLICATE_CODES.includes(e.nicCode);
    if (e.kind === 'rejected' && !duplicate) {
      await keepError(e.message);
      throw rejected(e.message);
    }
    if (!unanswered && !duplicate) throw gspFailure(e);
    let found: MiIrnResult | null = null;
    try {
      found = await getByDocument(creds, { gstin: build.sellerGstin, docNumber: build.docNumber, docDate: build.docDate });
    } catch {
      found = null;
    }
    if (!found) {
      if (unanswered) throw noAnswer();
      await keepError(e.message);
      throw rejected(e.message);
    }
    result = found;
    mustMatch = true;
  }
  // A repeat or found IRN is stored only when it was issued for this very invoice and is still active.
  if (mustMatch && !sameDocument(result, doc)) {
    throw new EinvoiceError(
      'The e-invoice portal already has an e-invoice for this document number, but it does not match this invoice. Check the e-invoice portal before trying again.',
      409,
      'IRN_MISMATCH',
    );
  }

  // 7. Store in one transaction, with the e-way bill that came with it; on failure the next click
  // reaches the duplicate path and stores it.
  const issued = result;
  let ewbNotSaved: string | null = null;
  try {
    await runWithInvoiceAudit({ actorUserId: userId, action: 'einvoice_generated' }, async (client) => {
      const u = await client.query(
        `UPDATE invoices
            SET irn = $3, irn_ack_no = $4, irn_ack_date = $5, irn_signed_qr = $6, irn_signed_invoice = $7,
                irn_status = 'active', irn_last_error = NULL, irn_cancelled_at = NULL, irn_cancel_reason = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
            AND (irn_status IS DISTINCT FROM 'active' OR irn = $3)`,
        [invoiceId, businessId, issued.irn, issued.ackNo, issued.ackDate, issued.signedQr, issued.signedInvoice],
      );
      if (!u.rowCount) throw new Error('invoice changed before the e-invoice was stored');
      if (issued.ewb && bill && wantEwb) {
        // The e-way bill must never cost the IRN: on any failure only its own writes are undone.
        await client.query('SAVEPOINT einvoice_ewb');
        try {
          const held = await client.query(`SELECT 1 FROM eway_bills WHERE business_id = $1 AND ewb_number = $2 LIMIT 1`, [businessId, issued.ewb.number]);
          if (!held.rows.length) {
            const ewbResult = {
              ewbNumber: issued.ewb.number, generatedAt: issued.ewb.generatedAt, validUntil: issued.ewb.validUntil,
              printUrl: issued.ewb.printUrl, alert: null, duplicate: false, requestId: issued.requestId,
            };
            await createEwayBill(client, businessId, toParsed({ source_type: 'invoice', source_id: invoiceId }, bill, wantEwb.transport, ewbResult, null), userId, {
              generatedVia: 'irn',
              requestId: issued.requestId,
              printUrl: issued.ewb.printUrl,
              transactionType: bill.transactionType,
            });
          }
          await client.query('RELEASE SAVEPOINT einvoice_ewb');
        } catch (ewbError: any) {
          await client.query('ROLLBACK TO SAVEPOINT einvoice_ewb');
          console.error('[einvoice] e-way bill issued with the IRN but not saved', { invoiceId, error: ewbError?.code ?? null });
          ewbNotSaved = issued.ewb.number;
        }
      }
    });
  } catch (e: any) {
    // A concurrent click may have stored this very IRN first.
    const saved = await pool
      .query(`SELECT 1 FROM invoices WHERE id = $1 AND business_id = $2 AND irn = $3 AND irn_status = 'active'`, [invoiceId, businessId, issued.irn])
      .then((r) => r.rows.length > 0)
      .catch(() => false);
    if (!saved) {
      console.error('[einvoice] IRN issued but not saved', { invoiceId, error: e?.code ?? e?.name });
      throw new EinvoiceError(
        'The e-invoice was created on the portal but could not be saved here. Click Generate again and Khatario will pick it up.',
        500,
        'IRN_NOT_SAVED',
      );
    }
  }

  // 8. The stored state, with a warning when the e-way bill asked for did not come.
  const view = (await getEinvoiceView(businessId, invoiceId)) as EinvoiceView;
  if (ewbNotSaved) {
    view.eway_warning = `E-invoice generated. The e-way bill ${ewbNotSaved} was created on the portal but could not be saved here. Add it to the invoice by hand.`;
  } else if (wantEwb && !issued.ewb) {
    view.eway_warning = 'E-invoice generated. The e-way bill was not: ' + (issued.ewbError ?? 'the portal did not say why.');
  }
  return view;
}

export type CancelReason = 'duplicate' | 'data_entry' | 'order_cancelled' | 'others';
const CANCEL_CODE: Record<CancelReason, '1' | '2' | '3' | '4'> = { duplicate: '1', data_entry: '2', order_cancelled: '3', others: '4' };
const MAX_CANCEL_REASON_TEXT = 120;

/**
 * Cancel the active IRN of an invoice at the portal and mark it cancelled here; the IRN stays on the row and the
 * invoice itself is not cancelled. A cancellation the portal accepted is never reported as failed: when the call
 * goes unanswered or is refused (for example because the IRN is already cancelled there), the document is looked
 * up once and a cancelled IRN for this very invoice is stored. Past the 24-hour window only that lookup is made (no
 * cancel call and no reason needed), so a cancellation that could not be saved earlier is still picked up.
 * No database client is held across a provider call.
 */
export async function cancelIrn(
  businessId: string,
  userId: string,
  invoiceId: string,
  a: { reason: CancelReason; remarks: string },
  deps: EinvoiceDeps = {},
): Promise<EinvoiceView> {
  const loadCredentials = deps.loadCredentials ?? loadGspCredentials;
  const cancel = deps.cancel ?? miCancelIrn;
  const getByDocument = deps.getByDocument ?? miGetIrnByDocument;
  const pool = getPool();

  // 1. The invoice, in this business, with an active IRN.
  const inv = await readInvoice(pool, businessId, invoiceId);
  if (!inv) throw new EinvoiceError('Invoice not found', 404, 'NOT_FOUND');
  if (inv.irn_status !== 'active' || !inv.irn) throw new EinvoiceError('This invoice has no active e-invoice', 409, 'NO_IRN');
  const irn = inv.irn;
  const dateIso = inv.invoice_date.slice(0, 10);
  const ackDate = inv.irn_ack_date ? new Date(inv.irn_ack_date) : null;
  const windowClosed = !ackDate || Date.now() - ackDate.getTime() >= CANCEL_WINDOW_MS;
  const remarks = typeof a?.remarks === 'string' ? a.remarks.trim() : '';
  const reasonKey = Object.prototype.hasOwnProperty.call(CANCEL_CODE, a?.reason) ? a.reason : null;
  const windowClosedError = () =>
    new EinvoiceError('An e-invoice can be cancelled only within 24 hours. Issue a credit note instead.', 409, 'CANCEL_WINDOW_CLOSED');

  /** The portal's record for this invoice, or null when there is none or the lookup failed. */
  const lookUp = async (creds: NonNullable<Awaited<ReturnType<typeof loadGspCredentials>>>, sellerGstin: string): Promise<MiIrnResult | null> => {
    try {
      return await getByDocument(creds, { gstin: sellerGstin, docNumber: inv.invoice_number, docDate: `${dateIso.slice(8, 10)}/${dateIso.slice(5, 7)}/${dateIso.slice(0, 4)}` });
    } catch {
      return null;
    }
  };
  const cancelledThere = (found: MiIrnResult | null, sellerGstin: string) =>
    !!found && found.irn === irn && sameDocument(found, { number: inv.invoice_number, dateIso, sellerGstin }, 'CNL');

  let cancelledAt: Date;
  if (windowClosed) {
    // 2a. Past the window nothing is cancelled from here, but a cancellation the portal accepted earlier and that
    // could not be saved is picked up: look the document up once (no cancel call) and store it when cancelled there.
    const sellerGstin = (await resolveSupplierRegistration(pool, businessId, inv.branch_id)).gstin;
    if (!sellerGstin) throw windowClosedError();
    const creds = await loadCredentials(businessId).catch(() => null);
    if (!creds) throw windowClosedError();
    if (!cancelledThere(await lookUp(creds, sellerGstin), sellerGstin)) throw windowClosedError();
    cancelledAt = new Date();
  } else {
    // 2b. No active e-way bill, a reason, the GSTIN the IRN was issued under and a saved Masters India login.
    const ewayActive = await pool.query(
      `SELECT 1 FROM eway_bills WHERE business_id = $1 AND source_type = 'invoice' AND source_id = $2 AND status = 'active' LIMIT 1`,
      [businessId, invoiceId],
    );
    if (ewayActive.rows.length) throw new EinvoiceError('Cancel the e-way bill first', 409, 'EWAY_ACTIVE');
    if (!remarks) throw new EinvoiceError('Enter the reason for cancelling', 400, 'REMARKS_REQUIRED');
    if (!reasonKey) throw new EinvoiceError('Choose why the e-invoice is being cancelled', 400, 'REASON_REQUIRED');
    const sellerGstin = (await resolveSupplierRegistration(pool, businessId, inv.branch_id)).gstin;
    if (!sellerGstin) throw new EinvoiceError('Add your GSTIN in Business settings', 409, 'NO_GSTIN');
    let creds;
    try {
      creds = await loadCredentials(businessId);
    } catch (e) {
      throw gspFailure(e);
    }
    if (!creds) throw new EinvoiceError('Connect your Masters India account in Settings, Integrations first.', 409, 'GSP_NOT_CONNECTED');

    // 3. Cancel; nothing is held open here.
    try {
      cancelledAt = (await cancel(creds, { gstin: sellerGstin, irn, reason: CANCEL_CODE[reasonKey], remarks }, undefined)).cancelledAt;
    } catch (e) {
      if (!(e instanceof GspError)) throw e;
      const unanswered = e.kind === 'timeout' || e.kind === 'unreachable';
      if (!unanswered && e.kind !== 'rejected') throw gspFailure(e);
      if (!cancelledThere(await lookUp(creds, sellerGstin), sellerGstin)) {
        if (unanswered) {
          throw new EinvoiceError('The e-invoice portal did not answer. Wait a minute and check again before retrying.', 502, 'GSP_NO_ANSWER');
        }
        throw rejected(e.message);
      }
      cancelledAt = new Date();
    }
  }

  // 4. Store; on failure the next click finds the IRN cancelled at the portal and stores it then.
  const reasonText = [reasonKey, remarks].filter(Boolean).join(': ').slice(0, MAX_CANCEL_REASON_TEXT) || null;
  try {
    await runWithInvoiceAudit({ actorUserId: userId, action: 'einvoice_cancelled', reason: remarks || null }, async (client) => {
      const u = await client.query(
        `UPDATE invoices
            SET irn_status = 'cancelled', irn_cancelled_at = $4, irn_cancel_reason = $5,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND business_id = $2 AND irn = $3 AND irn_status = 'active'`,
        [invoiceId, businessId, irn, cancelledAt, reasonText],
      );
      if (!u.rowCount) throw new Error('invoice changed before the cancellation was stored');
    });
  } catch (e: any) {
    // A concurrent click may have stored this very cancellation first.
    const saved = await pool
      .query(`SELECT 1 FROM invoices WHERE id = $1 AND business_id = $2 AND irn = $3 AND irn_status = 'cancelled'`, [invoiceId, businessId, irn])
      .then((r) => r.rows.length > 0)
      .catch(() => false);
    if (!saved) {
      console.error('[einvoice] IRN cancelled but not saved', { invoiceId, error: e?.code ?? e?.name });
      throw new EinvoiceError(
        'The e-invoice was cancelled on the portal but that could not be saved here. Click Cancel again and Khatario will pick it up.',
        500,
        'IRN_NOT_SAVED',
      );
    }
  }

  return (await getEinvoiceView(businessId, invoiceId)) as EinvoiceView;
}
