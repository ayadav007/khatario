/** Labels and chip colours for Supplier Hub order statuses. */
export const SUPPLY_ORDER_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  proposed: 'Waiting for buyer',
  pending: 'Waiting for supplier',
  confirmed: 'Confirmed',
  partial: 'Partly confirmed',
  declined: 'Declined',
  invoiced: 'Billed',
  dispatched: 'On the way',
  received: 'Received',
  cancelled: 'Cancelled',
};

export function supplyOrderChipVariant(status: string): 'default' | 'success' | 'warning' | 'error' | 'secondary' {
  if (status === 'received' || status === 'confirmed') return 'success';
  if (status === 'proposed' || status === 'pending' || status === 'partial' || status === 'invoiced' || status === 'dispatched') return 'warning';
  if (status === 'declined' || status === 'cancelled') return 'error';
  return 'secondary';
}
