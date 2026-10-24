/**
 * Rule 47A (Notification 20/2024-Central Tax): 30 days from the date of receipt,
 * only where section 31(3)(f) requires the recipient to issue the invoice and tax
 * is payable under section 9(3) or 9(4). A blank GSTIN does not establish that
 * the supplier was unregistered.
 */

export type SupplierRegistrationStatus = 'registered' | 'unregistered' | 'unknown';

export const RULE_47A_EFFECTIVE = '2024-11-01';
export const RULE_47A_DAYS = 30;

export interface Rule47aSupply {
  id: string;
  document: 'purchase' | 'expense';
  number: string | null;
  supplierName: string | null;
  tax: number;
  reverseCharge: boolean;
  registrationStatus: SupplierRegistrationStatus;
  supplyReceivedOn: string | null;
}

export type Rule47aResult =
  | { kind: 'deadline'; due: string }
  | { kind: 'unverified'; message: string }
  | { kind: 'not_applicable'; message: string };

export function parseRegistrationStatus(value: unknown): SupplierRegistrationStatus {
  if (value === 'registered' || value === 'unregistered' || value === 'unknown') return value;
  return 'unknown';
}

function addDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function rule47aResult(supply: Rule47aSupply): Rule47aResult {
  if (supply.registrationStatus === 'unknown') {
    return {
      kind: 'unverified',
      message: 'Supplier registration is unknown. Rule 47A applicability is unverified.',
    };
  }
  if (supply.registrationStatus === 'registered') {
    return {
      kind: 'not_applicable',
      message: 'No Rule 47A deadline. Section 31(3)(f) is the unregistered-supplier case.',
    };
  }
  if (!supply.reverseCharge) {
    return {
      kind: 'unverified',
      message: 'No Rule 47A deadline. Applicability is unverified until reverse charge is confirmed.',
    };
  }
  if (!supply.supplyReceivedOn) {
    return {
      kind: 'unverified',
      message: 'Rule 47A may apply. The deadline is unverified until the receipt date is entered.',
    };
  }
  if (supply.supplyReceivedOn < RULE_47A_EFFECTIVE) {
    return {
      kind: 'not_applicable',
      message: 'No 30-day Rule 47A date. The rule was not in force on the receipt date. A self-invoice can still be required.',
    };
  }
  return { kind: 'deadline', due: addDays(supply.supplyReceivedOn, RULE_47A_DAYS) };
}
