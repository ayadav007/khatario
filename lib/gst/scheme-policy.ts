/**
 * Server-side GST scheme rules for outward documents and inward ITC.
 *
 * - A composition taxable person cannot collect tax and must issue a bill of supply
 *   (s.10(4), s.31(3)(c); Rule 49).
 * - A person without a GSTIN is not registered and cannot collect tax or take ITC.
 * - A bill of supply never carries tax, whoever issues it (Rule 49 — exempt / nil supplies of
 *   a regular taxpayer).
 * - A composition taxable person cannot take ITC (s.10(4)); GST paid becomes part of cost.
 */

export type GstScheme = 'regular' | 'composition' | 'unregistered';

/**
 * Effective scheme for a seller registration. `unregistered` with a GSTIN on the issuing
 * registration is treated as regular: a GSTIN holder is registered, and the flag is a stale
 * profile default (migration 169 defaults new businesses to `unregistered`).
 */
export function effectiveGstScheme(
  registrationType: string | null | undefined,
  gstin: string | null | undefined
): GstScheme {
  const t = String(registrationType || '').trim().toLowerCase();
  const hasGstin = !!(gstin && gstin.trim());
  if (t === 'composition') return 'composition';
  if (t === 'regular') return hasGstin ? 'regular' : 'unregistered';
  return hasGstin ? 'regular' : 'unregistered';
}

export interface OutwardTaxPolicy {
  collectTax: boolean;
  /** Document type to persist (a tax invoice is not permitted for non-regular schemes). */
  documentType: string;
  warning?: string;
}

export function outwardTaxPolicy(params: { scheme: GstScheme; documentType: string | null | undefined }): OutwardTaxPolicy {
  const requested = params.documentType || 'tax_invoice';
  if (params.scheme !== 'regular') {
    const documentType = requested === 'proforma_invoice' ? requested : 'bill_of_supply';
    const who = params.scheme === 'composition' ? 'A composition taxable person' : 'A business without a GSTIN';
    return {
      collectTax: false,
      documentType,
      warning:
        documentType !== requested
          ? `${who} cannot issue a tax invoice or collect GST; issued as a Bill of Supply without tax.`
          : undefined,
    };
  }
  if (requested === 'bill_of_supply') {
    return { collectTax: false, documentType: requested };
  }
  return { collectTax: true, documentType: requested };
}

/** Whether a purchase by this recipient may create recoverable Input GST. */
export function recipientMayClaimItc(scheme: GstScheme): boolean {
  return scheme === 'regular';
}
