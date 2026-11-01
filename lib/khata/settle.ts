/**
 * One khata payment settles the customer's open bills, oldest due date first
 * (docs/plan/STORE_KHATA.md, section 7). Each bill gets its own receipt in the caller's
 * transaction, sharing one reference, through the same receipt posting as store orders.
 */
import type { PoolClient } from 'pg';
import { postStoreInvoiceReceipt, storeSettlementChoice } from '@/lib/store/store-receipt';
import { getAccountForPaymentMode } from '@/lib/ledger-utils';
import { KhataError } from './service';

export type KhataAllocation = { invoiceId: string; invoiceNumber: string; amount: number; paymentId: string };

export type KhataSettlement = {
  allocations: KhataAllocation[];
  settled: number;
  /** Amount above the open bills, kept as an advance (online payments only). */
  advance: number;
  advanceId: string | null;
};

export const KHATA_PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'card', 'cheque'] as const;
export type KhataPaymentMode = (typeof KHATA_PAYMENT_MODES)[number];

export function isKhataPaymentMode(v: unknown): v is KhataPaymentMode {
  return typeof v === 'string' && (KHATA_PAYMENT_MODES as readonly string[]).includes(v);
}

type OpenBill = {
  id: string;
  customer_id: string;
  branch_id: string | null;
  invoice_number: string;
  balance_amount: string;
};

/** Open final bills of the customer, oldest due first. Locks them. */
export async function lockOpenKhataBills(client: PoolClient, businessId: string, customerId: string): Promise<OpenBill[]> {
  const r = await client.query<OpenBill>(
    `SELECT id, customer_id, branch_id, invoice_number, balance_amount::text
       FROM invoices
      WHERE business_id = $1 AND customer_id = $2
        AND status = 'final' AND deleted_at IS NULL
        AND COALESCE(balance_amount, 0) > 0.005
      ORDER BY due_date ASC NULLS LAST, invoice_date ASC, created_at ASC
      FOR UPDATE`,
    [businessId, customerId],
  );
  return r.rows;
}

export async function settleKhataPayment(
  client: PoolClient,
  p: {
    businessId: string;
    customerId: string;
    amount: number;
    paymentMode: string;
    createdBy: string | null;
    reference: string;
    paymentDate?: Date;
    settlementAccountId?: string | null;
    /** Online payments may exceed the bills (paid twice, bills changed); the rest becomes an advance. */
    allowAdvance?: boolean;
  },
): Promise<KhataSettlement> {
  const amount = round2(p.amount);
  if (!(amount > 0)) throw new KhataError('Enter an amount above zero', 400, 'INVALID_AMOUNT');

  const customer = await client.query<{ id: string }>(
    `SELECT id FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
    [p.customerId, p.businessId],
  );
  if (!customer.rows[0]) throw new KhataError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');

  const bills = await lockOpenKhataBills(client, p.businessId, p.customerId);
  const owed = round2(bills.reduce((s, b) => s + (Number(b.balance_amount) || 0), 0));
  if (amount > owed + 0.005 && !p.allowAdvance) {
    throw new KhataError(
      owed > 0
        ? `₹${amount.toLocaleString('en-IN')} is more than the ₹${owed.toLocaleString('en-IN')} owed on open bills. Record the extra as an advance from Advances.`
        : 'There are no open bills on this khata. Record the money as an advance from Advances.',
      400,
      'MORE_THAN_OWED',
    );
  }

  let left = amount;
  const allocations: KhataAllocation[] = [];
  for (const bill of bills) {
    if (left <= 0.005) break;
    const due = round2(Number(bill.balance_amount) || 0);
    const pay = round2(Math.min(due, left));
    if (pay <= 0.005) continue;
    const paymentId = await postStoreInvoiceReceipt(client, {
      businessId: p.businessId,
      invoice: { id: bill.id, customer_id: bill.customer_id, branch_id: bill.branch_id, invoice_number: bill.invoice_number },
      amount: pay,
      paymentMode: p.paymentMode,
      createdBy: p.createdBy,
      notes: `Khata payment ${p.reference}`,
      description: `Khata payment ${p.reference} for invoice ${bill.invoice_number}`,
      settlementAccountId: p.settlementAccountId ?? null,
      paymentDate: p.paymentDate,
    });
    allocations.push({ invoiceId: bill.id, invoiceNumber: bill.invoice_number, amount: pay, paymentId });
    left = round2(left - pay);
  }

  let advanceId: string | null = null;
  let advance = 0;
  if (left > 0.005 && p.allowAdvance) {
    advance = left;
    advanceId = await postKhataAdvance(client, { ...p, amount: left });
  }
  return { allocations, settled: round2(amount - left), advance, advanceId };
}

async function postKhataAdvance(
  client: PoolClient,
  p: {
    businessId: string;
    customerId: string;
    amount: number;
    paymentMode: string;
    createdBy: string | null;
    reference: string;
    paymentDate?: Date;
    settlementAccountId?: string | null;
  },
): Promise<string> {
  const choice = p.settlementAccountId
    ? { mode: p.paymentMode, accountId: p.settlementAccountId }
    : await storeSettlementChoice(p.businessId, p.paymentMode);
  const account = await getAccountForPaymentMode(p.businessId, choice.mode, choice.accountId);
  if (!account) throw new KhataError('No ledger account is mapped for khata payments', 409, 'NO_SETTLEMENT_ACCOUNT');
  let userId = p.createdBy;
  if (!userId) {
    const admin = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE business_id = $1 AND COALESCE(is_active, true) = true
        ORDER BY COALESCE(is_primary_admin, false) DESC, created_at ASC LIMIT 1`,
      [p.businessId],
    );
    userId = admin.rows[0]?.id ?? null;
  }
  if (!userId) throw new KhataError('No business user to record the advance', 409, 'ACTOR_REQUIRED');
  const { createAdvance } = await import('@/lib/accounting/advance-service');
  const date = ymdIst(p.paymentDate ?? new Date());
  const created = await createAdvance(client, {
    businessId: p.businessId,
    branchId: null,
    userId,
    type: 'received',
    partyId: p.customerId,
    amount: p.amount,
    date,
    supplyType: 'goods',
    taxRate: 0,
    paymentAccountId: account.id,
    reference: p.reference,
    notes: `Khata payment ${p.reference} above the open bills`,
  });
  return created.id;
}

function ymdIst(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
