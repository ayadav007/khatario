/** Payments are recorded only against a final invoice or final purchase. */
export const DOCUMENT_NOT_FINAL_CODE = 'DOCUMENT_NOT_FINAL';

export function draftDocumentPaymentError(document: 'invoice' | 'purchase'): {
  error: string;
  code: typeof DOCUMENT_NOT_FINAL_CODE;
} {
  const label = document === 'invoice' ? 'invoice' : 'purchase';
  return {
    error: `Finalize this ${label} before recording a payment.`,
    code: DOCUMENT_NOT_FINAL_CODE,
  };
}

/** `type` is not receivable or payable, so no payment voucher would be posted. */
export const PAYMENT_TYPE_INVALID = 'PAYMENT_TYPE_INVALID';

/** `reference_type` and `reference_id` are incomplete or not invoice/purchase. */
export const PAYMENT_REFERENCE_INVALID = 'PAYMENT_REFERENCE_INVALID';

/** Receivable must target an invoice; payable must target a purchase. */
export const PAYMENT_TYPE_DOCUMENT_MISMATCH = 'PAYMENT_TYPE_DOCUMENT_MISMATCH';

/** On-account party id is missing, malformed, or names both a customer and a supplier. */
export const PAYMENT_PARTY_INVALID = 'PAYMENT_PARTY_INVALID';

/** Party id is not a customer or supplier of the session business. */
export const PAYMENT_PARTY_NOT_FOUND = 'PAYMENT_PARTY_NOT_FOUND';

/**
 * Walk-in (no customer) cash is already on the invoice voucher.
 * A separate receipt would move `paid_amount` without a payment voucher.
 */
export const WALK_IN_RECEIPT_NOT_SUPPORTED = 'WALK_IN_RECEIPT_NOT_SUPPORTED';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPaymentUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function blankPaymentId(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

export type PaymentReferenceOk = {
  ok: true;
  type: 'receivable' | 'payable';
  referenceType: 'invoice' | 'purchase' | null;
  referenceId: string | null;
};

export type PaymentReferenceRejection = {
  ok: false;
  status: 400;
  body: { error: string; code: string };
};

/** Reject combinations that would settle a document or party and then skip the voucher. */
export function resolvePaymentReference(input: {
  type: unknown;
  referenceType: unknown;
  referenceId: unknown;
}): PaymentReferenceOk | PaymentReferenceRejection {
  const type = typeof input.type === 'string' ? input.type.trim() : '';
  const referenceType = typeof input.referenceType === 'string' ? input.referenceType.trim() : '';
  const referenceId = blankPaymentId(input.referenceId);

  if (type !== 'receivable' && type !== 'payable') {
    return {
      ok: false,
      status: 400,
      body: { error: 'type must be receivable or payable', code: PAYMENT_TYPE_INVALID },
    };
  }

  const hasType = referenceType.length > 0;
  const hasId = referenceId.length > 0;
  if (hasType !== hasId) {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'reference_type and reference_id must be supplied together',
        code: PAYMENT_REFERENCE_INVALID,
      },
    };
  }
  if (hasId && !isPaymentUuid(referenceId)) {
    return {
      ok: false,
      status: 400,
      body: { error: 'reference_id must be a document id', code: PAYMENT_REFERENCE_INVALID },
    };
  }
  if (!hasType) {
    return { ok: true, type, referenceType: null, referenceId: null };
  }
  if (referenceType !== 'invoice' && referenceType !== 'purchase') {
    return {
      ok: false,
      status: 400,
      body: { error: 'reference_type must be invoice or purchase', code: PAYMENT_REFERENCE_INVALID },
    };
  }
  if (referenceType === 'invoice' && type !== 'receivable') {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'A payment against an invoice must be type receivable',
        code: PAYMENT_TYPE_DOCUMENT_MISMATCH,
      },
    };
  }
  if (referenceType === 'purchase' && type !== 'payable') {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'A payment against a purchase must be type payable',
        code: PAYMENT_TYPE_DOCUMENT_MISMATCH,
      },
    };
  }
  return { ok: true, type, referenceType, referenceId };
}

export function paymentPartyInvalidError(error: string): { error: string; code: typeof PAYMENT_PARTY_INVALID } {
  return { error, code: PAYMENT_PARTY_INVALID };
}

export function paymentPartyNotFoundError(party: 'customer' | 'supplier'): {
  error: string;
  code: typeof PAYMENT_PARTY_NOT_FOUND;
} {
  const label = party === 'customer' ? 'Customer' : 'Supplier';
  return { error: `${label} was not found for this business`, code: PAYMENT_PARTY_NOT_FOUND };
}

export function walkInReceiptNotSupportedError(): {
  error: string;
  code: typeof WALK_IN_RECEIPT_NOT_SUPPORTED;
} {
  return {
    error:
      'A walk-in invoice already records cash on the invoice voucher. A separate receipt is not supported.',
    code: WALK_IN_RECEIPT_NOT_SUPPORTED,
  };
}

/** Amount or TDS is not a finite, non-negative number that fits `payments.amount`. */
export const PAYMENT_AMOUNT_INVALID = 'PAYMENT_AMOUNT_INVALID';

/** `payment_date` is present but is not a calendar date. */
export const PAYMENT_DATE_INVALID = 'PAYMENT_DATE_INVALID';

/** `payment_mode` is not a non-empty string that fits `payments.payment_mode`. */
export const PAYMENT_MODE_INVALID = 'PAYMENT_MODE_INVALID';

/** Largest value `DECIMAL(12,2)` can hold. */
const MAX_PAYMENT_MONEY = 9999999999.99;
const PAYMENT_MODE_MAX_LENGTH = 50;
const MONEY_STRING_RE = /^\d+(\.\d+)?$/;
const DATE_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Returns null for malformed, negative, non-finite, or out-of-column-range money. */
export function parsePaymentMoney(value: unknown): number | null {
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string' && MONEY_STRING_RE.test(value.trim())) {
    n = Number(value.trim());
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n < 0 || n > MAX_PAYMENT_MONEY) return null;
  return n;
}

/** Returns the `YYYY-MM-DD` day, null when absent, or false when present but invalid. */
export function parsePaymentDay(value: unknown): string | null | false {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return false;
  const m = DATE_PREFIX_RE.exec(value.trim());
  if (!m) return false;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return false;
  return day;
}

/** Missing mode keeps the existing `cash` default; anything else must be a short non-empty string. */
export function parsePaymentMode(value: unknown): string | null {
  if (value === undefined || value === null) return 'cash';
  if (typeof value !== 'string') return null;
  const mode = value.trim();
  if (!mode || mode.length > PAYMENT_MODE_MAX_LENGTH) return null;
  return mode;
}

export function paymentAmountInvalidError(error: string): { error: string; code: typeof PAYMENT_AMOUNT_INVALID } {
  return { error, code: PAYMENT_AMOUNT_INVALID };
}

export function paymentDateInvalidError(): { error: string; code: typeof PAYMENT_DATE_INVALID } {
  return { error: 'payment_date must be a valid YYYY-MM-DD date', code: PAYMENT_DATE_INVALID };
}

export function paymentModeInvalidError(): { error: string; code: typeof PAYMENT_MODE_INVALID } {
  return {
    error: `payment_mode must be a non-empty string of at most ${PAYMENT_MODE_MAX_LENGTH} characters`,
    code: PAYMENT_MODE_INVALID,
  };
}

/** Restoring the payment row would not match the ledger, and this route does not post one. */
export const PAYMENT_RESTORE_ACCOUNTING_UNSAFE = 'PAYMENT_RESTORE_ACCOUNTING_UNSAFE';

export function paymentRestoreUnsafeError(): {
  error: string;
  code: typeof PAYMENT_RESTORE_ACCOUNTING_UNSAFE;
} {
  return {
    error:
      'This payment cannot be restored because its ledger posting is missing or already reversed.',
    code: PAYMENT_RESTORE_ACCOUNTING_UNSAFE,
  };
}
