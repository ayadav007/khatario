/** Return reasons, statuses and labels: safe to import in the browser (no DB code). */

export const RETURN_REASONS = [
  'damaged',
  'wrong_item',
  'not_as_described',
  'size_fit',
  'not_needed',
  'not_delivered',
  'other',
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];
export type ReturnStatus = 'requested' | 'approved' | 'rejected' | 'received' | 'closed' | 'cancelled';
export type ReturnCondition = 'restock' | 'damaged';
export type ReturnRefundMethod = 'store_credit' | 'cash' | 'upi' | 'bank';

export const RETURN_REASON_LABELS: Record<ReturnReason, string> = {
  damaged: 'Damaged or defective',
  wrong_item: 'Wrong item sent',
  not_as_described: 'Not as described',
  size_fit: 'Size or fit',
  not_needed: 'No longer needed',
  not_delivered: 'Not delivered (came back)',
  other: 'Other',
};

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  requested: 'Requested',
  approved: 'Awaiting goods',
  rejected: 'Rejected',
  received: 'Refund due',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const REFUND_METHOD_LABELS: Record<ReturnRefundMethod, string> = {
  store_credit: 'Keep as credit',
  cash: 'Cash',
  upi: 'UPI',
  bank: 'Bank transfer',
};
