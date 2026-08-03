/**
 * Contextual business profile requirements — used when an action needs specific fields
 * (finalize GST invoice, print bill, GST returns), not for global banners.
 */

import type { Business } from '@/types/database';

export type ProfileRequirementContext =
  | 'print_or_finalize_invoice'
  | 'finalize_gst_invoice'
  | 'gst_compliance';

export type BusinessProfileLike = Pick<
  Business,
  | 'name'
  | 'email'
  | 'phone'
  | 'address'
  | 'address_line1'
  | 'city'
  | 'state'
  | 'pincode'
  | 'gstin'
  | 'pan'
  | 'logo_url'
  | 'state_code'
> | null | undefined;

export interface ProfileFieldGap {
  key: string;
  label: string;
  /** Query param for /settings/business?highlight= */
  highlightParam: string;
}

const FIELD_META: Record<
  string,
  { label: string; highlightParam: string; isFilled: (b: BusinessProfileLike) => boolean }
> = {
  name: {
    label: 'Business name',
    highlightParam: 'name',
    isFilled: (b) => Boolean(b?.name?.trim()),
  },
  address: {
    label: 'Business address',
    highlightParam: 'address_line1',
    isFilled: (b) => Boolean(getBusinessAddress(b)),
  },
  city: {
    label: 'City',
    highlightParam: 'city',
    isFilled: (b) => Boolean(b?.city?.trim()),
  },
  state: {
    label: 'State',
    highlightParam: 'state',
    isFilled: (b) => Boolean(b?.state?.trim()),
  },
  pincode: {
    label: 'Pincode',
    highlightParam: 'pincode',
    isFilled: (b) => Boolean(b?.pincode?.trim()),
  },
  gstin: {
    label: 'GSTIN',
    highlightParam: 'gstin',
    isFilled: (b) => Boolean(b?.gstin?.trim()),
  },
};

const CONTEXT_FIELD_KEYS: Record<ProfileRequirementContext, string[]> = {
  print_or_finalize_invoice: ['name', 'address', 'city', 'state', 'pincode'],
  finalize_gst_invoice: ['name', 'address', 'city', 'state', 'pincode', 'gstin'],
  gst_compliance: ['name', 'address', 'city', 'state', 'pincode', 'gstin'],
};

export function getBusinessAddress(business: BusinessProfileLike): string {
  if (!business) return '';
  return (business.address_line1 || business.address || '').trim();
}

export function getProfileGaps(
  business: BusinessProfileLike,
  context: ProfileRequirementContext,
): ProfileFieldGap[] {
  const gaps: ProfileFieldGap[] = [];
  for (const key of CONTEXT_FIELD_KEYS[context]) {
    const meta = FIELD_META[key];
    if (!meta) continue;
    if (!meta.isFilled(business)) {
      gaps.push({ key, label: meta.label, highlightParam: meta.highlightParam });
    }
  }
  return gaps;
}

export function isProfileReady(
  business: BusinessProfileLike,
  context: ProfileRequirementContext,
): boolean {
  return getProfileGaps(business, context).length === 0;
}

export function getProfileSettingsUrl(gap?: ProfileFieldGap | null): string {
  if (!gap) return '/settings/business';
  return `/settings/business?highlight=${encodeURIComponent(gap.highlightParam)}`;
}

export function getContextTitle(context: ProfileRequirementContext): string {
  switch (context) {
    case 'finalize_gst_invoice':
      return 'Complete your business profile to finalize this tax invoice';
    case 'print_or_finalize_invoice':
      return 'Complete your business profile to print or finalize this bill';
    case 'gst_compliance':
      return 'Complete your business profile for GST compliance';
    default:
      return 'Complete your business profile';
  }
}

export function getContextDescription(context: ProfileRequirementContext): string {
  switch (context) {
    case 'finalize_gst_invoice':
      return 'Tax invoices must show your legal business name, address, and GSTIN on the document.';
    case 'print_or_finalize_invoice':
      return 'Printed and finalized bills need your business name and address on the invoice header.';
    case 'gst_compliance':
      return 'GST returns and exports require a registered GSTIN and complete business address on file.';
    default:
      return 'Add the missing details in Business Profile settings to continue.';
  }
}

/** Pick requirement context for invoice finalize / print from document + registration type. */
export function getInvoiceProfileContext(
  documentType: string,
  gstRegistrationType: string | null | undefined,
): ProfileRequirementContext {
  if (documentType === 'tax_invoice') {
    return 'finalize_gst_invoice';
  }
  if (gstRegistrationType === 'regular') {
    return 'finalize_gst_invoice';
  }
  return 'print_or_finalize_invoice';
}
