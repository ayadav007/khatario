import { describeAccountingError } from '@/lib/accounting-ui/errors';

export interface PurchaseActionInput {
  status: string;
  paid_amount: number | string | null | undefined;
}

export interface PurchaseTotalsInput extends PurchaseActionInput {
  grand_total: number | string | null | undefined;
  payment_status: string;
}

export type PurchaseActionKind = 'delete_draft' | 'cancel_bill' | 'none';

export interface PurchaseAction {
  kind: PurchaseActionKind;
  /** Set when the action is known to be refused by the server from list data alone. */
  blocked?: { code: string; message: string; shortLabel: string };
}

export type PurchaseStatusFilter = 'all' | 'draft' | 'final' | 'paid' | 'unpaid' | 'cancelled';

const toNumber = (v: number | string | null | undefined) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Draft bills are deleted, final bills are cancelled (reversed), cancelled bills have no action.
 * Only the payment blocker is visible in list data; returns, deposited TDS and consumed stock are
 * reported by the cancel API.
 */
export function getPurchaseAction(purchase: PurchaseActionInput): PurchaseAction {
  if (purchase.status === 'draft') return { kind: 'delete_draft' };
  if (purchase.status !== 'final') return { kind: 'none' };
  if (toNumber(purchase.paid_amount) > 0) {
    return {
      kind: 'cancel_bill',
      blocked: {
        code: 'PURCHASE_HAS_PAYMENTS',
        message: describeAccountingError(409, { code: 'PURCHASE_HAS_PAYMENTS' }, { context: 'purchase' }).message,
        shortLabel: 'Payment recorded',
      },
    };
  }
  return { kind: 'cancel_bill' };
}

export const isActivePurchase = (p: { status: string }) => p.status !== 'cancelled';

export function matchesPurchaseStatusFilter(p: PurchaseTotalsInput, filter: PurchaseStatusFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'cancelled':
      return p.status === 'cancelled';
    case 'draft':
    case 'final':
      return p.status === filter;
    case 'paid':
      return isActivePurchase(p) && p.payment_status === 'paid';
    case 'unpaid':
      return isActivePurchase(p) && (p.payment_status === 'unpaid' || p.payment_status === 'partially_paid');
    default:
      return true;
  }
}

/** Cancelled bills carry no payable, so they never count toward totals. */
export function computePurchaseTotals(purchases: PurchaseTotalsInput[]) {
  const active = purchases.filter(isActivePurchase);
  const total = active.reduce((s, p) => s + toNumber(p.grand_total), 0);
  const paid = active.reduce((s, p) => s + toNumber(p.paid_amount), 0);
  return { total, paid, due: total - paid };
}

/** Outstanding amount shown on a row; a cancelled bill owes nothing. */
export function purchaseRowBalance(p: PurchaseTotalsInput): number {
  return isActivePurchase(p) ? toNumber(p.grand_total) - toNumber(p.paid_amount) : 0;
}

/** Body for POST /api/purchases/[id]/cancel. The server records the canceller from the session. */
export function buildCancelPurchaseBody(reason: string): string {
  return JSON.stringify({ reason: reason.trim() });
}

export const formatRupees = (amount: number) =>
  `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function draftDeletedMessage(data: { supplier_balance_restored?: unknown } | null | undefined): string {
  const restored = typeof data?.supplier_balance_restored === 'number' ? data.supplier_balance_restored : 0;
  return restored !== 0
    ? `Draft deleted. Supplier balance adjusted by ${formatRupees(restored)}.`
    : 'Draft deleted.';
}

export const PURCHASE_ACTION_COPY = {
  deleteDraft: {
    button: 'Delete draft',
    title: 'Delete draft bill',
    description:
      'This draft bill will be deleted. Drafts are not posted to your accounts. Any payment, TDS or advance adjustment recorded against this draft will be reversed and the supplier balance restored.',
    confirm: 'Delete draft',
  },
  cancelBill: {
    button: 'Cancel bill',
    title: 'Cancel bill',
    description:
      'The accounting entries for this bill will be reversed, and any stock it added will be removed from inventory. The bill will remain as a cancelled record for audit history.',
    confirm: 'Cancel bill',
    reasonLabel: 'Reason for cancellation',
    reasonPlaceholder: 'e.g. Bill entered twice, wrong supplier',
  },
  cancelledSuccess: 'Bill cancelled. Its accounting entries have been reversed.',
} as const;
