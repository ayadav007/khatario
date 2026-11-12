import * as db from '@/lib/db';
import { receivableAccountIds } from '@/lib/accounting/receivable-accounts';
import { fetchPartyLedgerDocs, type PartyType } from '@/lib/reports/party-ledger-docs';

export type PartyStatementRow = {
  id: string | null;
  reference_number: string;
  transaction_date: string;
  transaction_type: string;
  description: string;
  debit: number;
  credit: number;
  running_balance: number;
  is_virtual?: boolean;
};

export type PartyStatement = {
  opening_balance: number;
  /** Includes the virtual opening balance row first. */
  transactions: PartyStatementRow[];
  total_debit: number;
  total_credit: number;
  closing_balance: number;
};

/**
 * Period statement for one customer or supplier: opening balance, documents, running balance.
 * Used by Reports → Party statement and by the combined payment reminder's ledger PDF.
 * `branchFilter` narrows to one branch only when the caller explicitly asks.
 */
export async function computePartyStatement(input: {
  businessId: string;
  partyType: PartyType;
  partyId: string;
  fromDate: string;
  toDate: string;
  branchFilter: string | null;
}): Promise<PartyStatement> {
  const { businessId, partyType, partyId, fromDate, toDate, branchFilter } = input;
  const docs = await fetchPartyLedgerDocs({
    businessId,
    partyType,
    asOfDate: toDate,
    partyId,
    branchId: branchFilter,
  });

  type Row = {
    id: string | null;
    reference_number: string;
    transaction_date: string;
    transaction_type: string;
    description: string;
    debit: number;
    credit: number;
  };
  // Customer: debit = amount owed by the party. Supplier statements keep the ledger view
  // (bill = credit, payment/return/TDS = debit) with the balance signed as "to pay".
  const toRow = (d: { voucherId: string | null; reference: string; docDate: string; voucherType: string; description: string; amount: number }): Row => {
    const increase = d.amount > 0 ? d.amount : 0;
    const decrease = d.amount < 0 ? -d.amount : 0;
    return {
      id: d.voucherId,
      reference_number: d.reference,
      transaction_date: d.docDate,
      transaction_type: d.voucherType,
      description: d.description,
      debit: partyType === 'customer' ? increase : decrease,
      credit: partyType === 'customer' ? decrease : increase,
    };
  };
  const signed = (r: Row) => (partyType === 'customer' ? r.debit - r.credit : r.credit - r.debit);

  const allDocRows: Row[] = docs.map(toRow);

  if (partyType === 'customer') {
    // Cash sales post straight to cash/bank, so they never touch receivables; show them as sale + receipt.
    const cashSales = await db.queryRows<{ id: string; invoice_number: string; invoice_date: string; grand_total: string }>(
      `SELECT i.id, i.invoice_number, i.invoice_date::text AS invoice_date, i.grand_total
         FROM invoices i
        WHERE i.business_id = $1 AND i.customer_id = $2 AND i.deleted_at IS NULL
          AND i.status NOT IN ('draft', 'cancelled')
          AND COALESCE(i.document_type, 'tax_invoice') NOT IN ('proforma_invoice', 'quotation', 'delivery_challan')
          AND i.invoice_date <= $3::date
          AND ($4::uuid IS NULL OR i.branch_id = $4::uuid)
          AND NOT EXISTS (
            SELECT 1 FROM ledger_entry_lines l
             WHERE l.voucher_type = 'invoice' AND l.voucher_id = i.id AND l.account_id = ANY($5::uuid[])
          )`,
      [businessId, partyId, toDate, branchFilter, await receivableAccountIds(businessId)]
    );
    for (const inv of cashSales) {
      const amount = Number(inv.grand_total) || 0;
      const date = String(inv.invoice_date).slice(0, 10);
      allDocRows.push(
        { id: inv.id, reference_number: inv.invoice_number, transaction_date: date, transaction_type: 'invoice', description: 'Sale (cash)', debit: amount, credit: 0 },
        { id: inv.id, reference_number: inv.invoice_number, transaction_date: date, transaction_type: 'payment', description: 'Received at sale', debit: 0, credit: amount }
      );
    }
  }

  const advances = await db.queryRows<{ id: string; payment_date: string; amount: string }>(
    `SELECT ap.id, ap.payment_date::text AS payment_date, ap.amount
       FROM advance_payments ap
      WHERE ap.business_id = $1 AND ${partyType === 'customer' ? 'ap.customer_id' : 'ap.supplier_id'} = $2
        AND ap.type = $3 AND ap.payment_date <= $4::date`,
    [businessId, partyId, partyType === 'customer' ? 'received' : 'paid', toDate]
  ).catch(() => []);
  for (const ap of advances) {
    const amount = Number(ap.amount) || 0;
    allDocRows.push({
      id: ap.id,
      reference_number: `ADV-${ap.id.slice(0, 8)}`,
      transaction_date: String(ap.payment_date).slice(0, 10),
      transaction_type: 'advance',
      description: partyType === 'customer' ? 'Advance received' : 'Advance paid',
      debit: partyType === 'customer' ? 0 : amount,
      credit: partyType === 'customer' ? amount : 0,
    });
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const adjustedOpeningBalance = r2(
    allDocRows.filter((r) => r.transaction_date < fromDate).reduce((s, r) => s + signed(r), 0)
  );

  const openingBalanceRow = {
    id: null,
    reference_number: 'Opening Balance',
    transaction_date: fromDate,
    transaction_type: 'opening_balance',
    description: 'Opening Balance',
    debit: partyType === 'customer' ? Math.max(adjustedOpeningBalance, 0) : Math.max(-adjustedOpeningBalance, 0),
    credit: partyType === 'customer' ? Math.max(-adjustedOpeningBalance, 0) : Math.max(adjustedOpeningBalance, 0),
    running_balance: adjustedOpeningBalance,
    is_virtual: true,
  };

  let runningBalance = adjustedOpeningBalance;
  const transactions = allDocRows
    .filter((r) => r.transaction_date >= fromDate)
    .sort((a, b) =>
      a.transaction_date !== b.transaction_date
        ? a.transaction_date < b.transaction_date ? -1 : 1
        : signed(b) - signed(a)
    )
    .map((r) => {
      runningBalance = r2(runningBalance + signed(r));
      return { ...r, running_balance: runningBalance };
    });

  const allRows = [openingBalanceRow, ...transactions];
  const totalDebit = r2(allRows.reduce((sum, t) => sum + Number(t.debit || 0), 0));
  const totalCredit = r2(allRows.reduce((sum, t) => sum + Number(t.credit || 0), 0));
  const closingBalance = runningBalance;
  return {
    opening_balance: adjustedOpeningBalance,
    transactions: allRows as PartyStatementRow[],
    total_debit: totalDebit,
    total_credit: totalCredit,
    closing_balance: closingBalance,
  };
}
