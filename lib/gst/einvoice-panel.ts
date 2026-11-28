// What the e-invoice panel on the invoice shows, worked out from the server's view and a few invoice facts.
// Pure (no fetch, no React), so every state and every error the panel can meet is unit tested.
import type { EinvoiceView } from '@/lib/gst/einvoice';
import type { EinvoiceProblem } from '@/lib/gsp/mastersindia/einvoice-payload';
import { validateEwayForm, type EwayForm, type EwayFormErrors } from '@/lib/gst/eway-generate-form';

export const EWAY_GOODS_LIMIT = 50000;
export const PENDING_NOTE = "This invoice is not valid for your customer's tax credit until its e-invoice is generated.";
export const CANCEL_WARNING = 'After cancelling, this invoice number cannot be used for another e-invoice.';
export const RECHECK_STILL_ACTIVE = 'The portal still shows this e-invoice as active, or it could not be checked.';

const IST_OFFSET_MS = 5.5 * 3600e3;

/** DD/MM/YYYY in Indian time (no daylight saving, so a fixed offset is exact on any machine). Null when unreadable. */
export function formatIndianDate(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  const iso = new Date(t + IST_OFFSET_MS).toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export const CANCEL_REASONS: ReadonlyArray<{ value: 'duplicate' | 'data_entry' | 'order_cancelled' | 'others'; label: string }> = [
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'data_entry', label: 'Data entry mistake' },
  { value: 'order_cancelled', label: 'Order cancelled' },
  { value: 'others', label: 'Other' },
];

/** The stored reason (`data_entry: Wrong rate`) in words (`Data entry mistake: Wrong rate`). */
export function cancelReasonText(stored: string | null | undefined): string | null {
  const s = (stored ?? '').trim();
  if (!s) return null;
  const sep = s.indexOf(':');
  const key = (sep >= 0 ? s.slice(0, sep) : s).trim();
  const rest = sep >= 0 ? s.slice(sep + 1).trim() : '';
  const label = CANCEL_REASONS.find((r) => r.value === key)?.label;
  if (!label) return s;
  return rest ? `${label}: ${rest}` : label;
}

/** Where the Fix link of a problem goes; null when its target has no id (no broken link). */
export function problemFixHref(problem: EinvoiceProblem, documentType: string): string | null {
  const fix = problem.fix;
  if (!fix) return null;
  if (fix.kind === 'business') return '/settings/business';
  if (!fix.id) return null;
  const id = encodeURIComponent(fix.id);
  switch (fix.kind) {
    case 'customer':
      return `/customers/${id}/edit`;
    case 'item':
      return `/items/new?edit=${id}`;
    case 'invoice':
      return `/invoices/new?edit=${id}&type=${encodeURIComponent(documentType || 'tax_invoice')}`;
    default:
      return null;
  }
}

export type EinvoiceLine = {
  hsn_sac?: string | null;
  charge_line?: boolean | null;
  taxable_value?: number | string | null;
  cgst_amount?: number | string | null;
  sgst_amount?: number | string | null;
  igst_amount?: number | string | null;
  cess_amount?: number | string | null;
};
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Goods lines (not services, HSN 99..., and not charge lines) and their value with tax, as the e-way bill counts them. */
export function einvoiceGoodsFacts(items: EinvoiceLine[] | null | undefined): { count: number; value: number } {
  let count = 0;
  let value = 0;
  for (const l of items ?? []) {
    if (l.charge_line === true) continue;
    if (String(l.hsn_sac ?? '').trim().startsWith('99')) continue;
    count += 1;
    value += num(l.taxable_value) + num(l.cgst_amount) + num(l.sgst_amount) + num(l.igst_amount) + num(l.cess_amount);
  }
  return { count, value: Math.round(value * 100) / 100 };
}

export type PanelFacts = {
  documentType: string;
  /** The plan includes e-way bills. */
  ewayAllowed: boolean;
  /** The invoice's e-way bills have been loaded, so hasActiveEwayBill can be trusted. */
  ewayBillsKnown: boolean;
  hasActiveEwayBill: boolean;
  goodsLineCount: number;
  goodsValue: number;
};

export type PanelState =
  | { visible: false }
  | {
      visible: true;
      status: EinvoiceView['status'];
      badge: { text: string; tone: 'red' | 'green' | 'grey' };
      pendingNote: string | null;
      problems: Array<{ message: string; href: string | null }>;
      lastError: string | null;
      showGenerate: boolean;
      generateDisabled: boolean;
      showEwbOption: boolean;
      ewbPreTicked: boolean;
      irn: string | null;
      ackNo: string | null;
      ackDate: string | null;
      qrValue: string | null;
      showCancel: boolean;
      showRecheck: boolean;
      cancelledNote: string | null;
    };

export function einvoicePanelState(view: EinvoiceView | null, facts: PanelFacts): PanelState {
  if (!view) return { visible: false };
  if (!view.applies && view.status === 'none') return { visible: false };
  const pending = view.status === 'none';
  const problems = pending ? view.problems.map((p) => ({ message: p.message, href: problemFixHref(p, facts.documentType) })) : [];
  const showEwbOption =
    pending && facts.ewayAllowed && facts.ewayBillsKnown && !facts.hasActiveEwayBill && facts.goodsLineCount > 0;
  let cancelledNote: string | null = null;
  if (view.status === 'cancelled') {
    const date = formatIndianDate(view.cancelled_at);
    const reason = cancelReasonText(view.cancel_reason);
    cancelledNote = [date ? `Cancelled on ${date}.` : null, reason ? `Reason: ${reason}` : null].filter(Boolean).join(' ') || null;
  }
  return {
    visible: true,
    status: view.status,
    badge:
      view.status === 'active'
        ? { text: 'E-invoice generated', tone: 'green' }
        : view.status === 'cancelled'
          ? { text: 'E-invoice cancelled', tone: 'grey' }
          : { text: 'E-invoice pending', tone: 'red' },
    pendingNote: pending ? PENDING_NOTE : null,
    problems,
    lastError: pending ? view.last_error : null,
    // Hidden, not just disabled, once there is an e-invoice: the server refuses a second one.
    showGenerate: pending && view.applies,
    generateDisabled: problems.length > 0,
    showEwbOption,
    ewbPreTicked: showEwbOption && facts.goodsValue > EWAY_GOODS_LIMIT,
    irn: view.status === 'none' ? null : view.irn,
    ackNo: view.status === 'active' ? view.ack_no : null,
    ackDate: view.status === 'active' ? formatIndianDate(view.ack_date) : null,
    qrValue: view.status === 'active' ? view.signed_qr : null,
    showCancel: view.status === 'active' && view.can_cancel,
    showRecheck: view.status === 'active' && !view.can_cancel && view.can_recheck,
    cancelledNote,
  };
}

/** The `ewb` part of the generate request, checked with the e-way bill form rules; only the names the server reads. */
export type EinvoiceEwbBody = {
  ewb: {
    distance_km: number;
    transport_mode: EwayForm['mode'];
    is_odc: boolean;
    vehicle_number?: string;
    transporter_gstin?: string;
    transporter_name?: string;
    transport_doc_number?: string;
    transport_doc_date?: string;
  };
};

export function einvoiceEwbRequest(form: EwayForm): { ok: true; body: EinvoiceEwbBody } | { ok: false; errors: EwayFormErrors } {
  // Ship-to is not part of this request: the e-way bill made with the IRN goes to the invoice's own address.
  const r = validateEwayForm({ ...form, shipToGstin: '', shipToPlace: '', shipToPincode: '', shipToStateCode: '' });
  if (!r.ok) return r;
  const b = r.body;
  const ewb: EinvoiceEwbBody['ewb'] = {
    distance_km: b.distance_km,
    transport_mode: b.transport_mode as EwayForm['mode'],
    is_odc: !!b.is_odc,
  };
  if (b.vehicle_number) ewb.vehicle_number = b.vehicle_number;
  if (b.transporter_gstin) ewb.transporter_gstin = b.transporter_gstin;
  if (b.transporter_name) ewb.transporter_name = b.transporter_name;
  if (b.transport_doc_number) ewb.transport_doc_number = b.transport_doc_number;
  if (b.transport_doc_date) ewb.transport_doc_date = b.transport_doc_date;
  return { ok: true, body: { ewb } };
}

export type PanelAction = 'load' | 'generate' | 'cancel' | 'recheck';
export type ErrorDisplay = {
  message: string;
  /** Show the Connect Masters India button. */
  connect: boolean;
  /** Open the upgrade prompt for the monthly limit. */
  upgrade: 'limit' | null;
  problems: EinvoiceProblem[];
  /** The e-invoice may have changed: load the view again (the message stays). */
  refresh: boolean;
};

/** Codes whose server message is already written for the user. */
const EINVOICE_CODES = new Set([
  'NOT_FOUND', 'NOT_APPLICABLE', 'IRN_EXISTS', 'IRN_CANCELLED', 'IRN_MISMATCH', 'IRN_NOT_SAVED', 'GSP_NOT_CONNECTED', 'GSP_AUTH',
  'GSP_NOT_CONFIGURED', 'GSP_NO_ANSWER', 'GSP_REJECTED', 'PRECHECK_FAILED', 'LIMIT_EXCEEDED', 'INVALID_EWB', 'EWAY_EXISTS',
  'BAD_REQUEST', 'NO_IRN', 'CANCEL_WINDOW_CLOSED', 'EWAY_ACTIVE', 'REMARKS_REQUIRED', 'REASON_REQUIRED', 'EWB_NOT_ALLOWED', 'NO_GSTIN',
]);
const REFRESH_CODES = new Set(['IRN_EXISTS', 'IRN_CANCELLED', 'IRN_NOT_SAVED', 'GSP_NO_ANSWER', 'NO_IRN', 'CANCEL_WINDOW_CLOSED', 'NOT_APPLICABLE']);
const PLAN_CODES = new Set(['FEATURE_NOT_IN_PLAN', 'FEATURE_NOT_AVAILABLE']);
const SESSION_CODES = new Set(['UNAUTHENTICATED', 'SESSION_REVOKED', 'SESSION_EXPIRED']);

const NO_ANSWER: Record<PanelAction, string> = {
  load: 'The e-invoice details could not be loaded. Reload the page to try again.',
  generate: 'No answer yet. Wait a minute, then reload this page to see whether the e-invoice was created before trying again.',
  cancel: 'No answer yet. Wait a minute, then reload this page to see whether the e-invoice was cancelled before trying again.',
  recheck: 'The portal could not be checked just now. Try again in a minute.',
};

/**
 * The message (and extras) for a failed request. `status` 0 means the request never got an answer;
 * `body` is the parsed JSON reply, or null when it could not be read.
 */
export function einvoiceErrorDisplay(input: { status: number; body: Record<string, unknown> | null; action: PanelAction }): ErrorDisplay {
  const { status, body, action } = input;
  const code = typeof body?.code === 'string' ? body.code : '';
  const serverText = typeof body?.error === 'string' && body.error.trim() ? body.error.trim() : '';
  const out = (message: string, extra: Partial<ErrorDisplay> = {}): ErrorDisplay => ({
    message, connect: false, upgrade: null, problems: [], refresh: false, ...extra,
  });

  if (action === 'recheck' && code === 'CANCEL_WINDOW_CLOSED') return out(RECHECK_STILL_ACTIVE);
  if (status === 401 || SESSION_CODES.has(code)) return out('Your session has ended. Sign in again.');
  if (PLAN_CODES.has(code)) {
    return body?.feature === 'eway_bill'
      ? out('E-way bills are not part of your plan. Untick "Also create the e-way bill", or upgrade your plan.')
      : out('E-invoices are not part of your plan. Upgrade your plan to use them.');
  }
  if (code === 'GSP_NOT_CONNECTED' || code === 'GSP_AUTH') {
    return out(serverText || 'Connect your Masters India account in Settings, Integrations first.', { connect: true });
  }
  if (code === 'LIMIT_EXCEEDED') {
    return out(serverText || "You have reached this month's e-invoice limit for your plan. Upgrade your plan to generate more.", { upgrade: 'limit' });
  }
  if (code === 'PRECHECK_FAILED') {
    const problems = Array.isArray(body?.problems) ? (body!.problems as EinvoiceProblem[]) : [];
    return out(serverText || 'Fix these before generating the e-invoice', { problems });
  }
  if (EINVOICE_CODES.has(code) && serverText) return out(serverText, { refresh: action !== 'load' && REFRESH_CODES.has(code) });
  if (status === 403) return out('You do not have permission to do this. Ask the business owner for access.');
  // No reply, an unreadable one, or a server failure: the request may still have gone through.
  if (status === 0 || status >= 500 || !serverText) return out(NO_ANSWER[action], { refresh: action !== 'load' });
  return out(serverText);
}
