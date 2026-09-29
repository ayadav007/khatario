/** Wording and request helpers for expense / journal deletes, which the server performs by reversal. */

export const REVERSAL_COPY = {
  expense: {
    button: 'Reverse',
    title: 'Reverse expense',
    description:
      'This expense will be reversed by posting corresponding reversing entries. The original entry will remain available for audit history.',
  },
  journal: {
    button: 'Reverse',
    title: 'Reverse journal entry',
    description:
      'This journal entry will be reversed by posting corresponding reversing entries. The original entry will remain available for audit history.',
  },
  confirm: 'Reverse entry',
  reasonLabel: 'Reason for reversal',
  reasonPlaceholder: 'e.g. Entered twice, wrong amount',
  success: 'Entry reversed successfully.',
} as const;

/** DELETE URL for an expense or journal entry, carrying the reversal reason as `?reason=`. */
export function buildReversalUrl(path: string, businessId: string, reason: string): string {
  const params = new URLSearchParams({ business_id: businessId, reason: reason.trim() });
  return `${path}?${params.toString()}`;
}
