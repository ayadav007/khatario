import type { PoolClient } from 'pg';
import { allocateJournalVoucherNumber } from '@/lib/accounting/journal-number';
import { listSettlementAccounts } from '@/lib/accounting/settlement-accounts-db';
import { createLedgerEntryLine } from '@/lib/ledger-utils';
import { postStoreInvoiceReceipt, storeSettlementChoice } from '@/lib/store/store-receipt';

/**
 * COD remittance: cash the courier (or the shop's own rider) collected on delivery and has to pay
 * over. Lists delivered COD parcels not yet matched to a remittance, and records a remittance
 * against the parcels it covers; any shortfall is kept as deductions (courier COD fees, etc).
 *
 * Accounts: each parcel whose cash was not already recorded gets a receipt against its invoice into
 * the account the money reached (Dr bank, Cr receivable). The deductions are an expense paid out of
 * that same account (Dr Courier & COD Charges, Cr bank), so the bank moves by what was received.
 * A parcel already marked "cash collected" was received into cash then; it is only linked here.
 */

type Db = Pick<PoolClient, 'query'>;

export const REMITTANCE_SOURCES = ['shiprocket', 'courier', 'own_rider', 'local_app'] as const;
export type RemittanceSource = (typeof REMITTANCE_SOURCES)[number];

export class CodRemittanceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CodRemittanceError';
  }
}

export type OpenCodParcel = {
  id: string;
  order_number: string;
  seq: number;
  method: RemittanceSource;
  partner_name: string | null;
  rider_name: string | null;
  awb: string | null;
  buyer_name: string | null;
  cod_amount: number;
  delivered_at: string | null;
};

/** Delivered COD parcels whose cash has not reached the shop yet. */
export async function listOpenCod(db: Db, businessId: string, branchIds: string[] | null): Promise<OpenCodParcel[]> {
  const r = await db.query<OpenCodParcel>(
    `SELECT f.id, COALESCE(so.order_number, s.order_number, i.invoice_number, left(f.id::text, 8)) AS order_number,
            f.seq, f.method, f.partner_name, f.rider_name, f.awb, f.buyer_name,
            f.cod_amount::float8 AS cod_amount, f.delivered_at
       FROM order_fulfilments f
       LEFT JOIN store_orders so ON so.id = f.store_order_id
       LEFT JOIN sales_orders s ON s.id = f.sales_order_id
       LEFT JOIN invoices i ON i.id = f.invoice_id
      WHERE f.business_id = $1
        AND ($2::uuid[] IS NULL OR f.branch_id IS NULL OR f.branch_id = ANY($2::uuid[]))
        AND f.cod_amount > 0
        AND f.cod_remittance_id IS NULL
        AND f.status = 'delivered'
        AND f.method = ANY($3::varchar[])
      ORDER BY f.delivered_at NULLS LAST, f.created_at
      LIMIT 500`,
    [businessId, branchIds, REMITTANCE_SOURCES],
  );
  return r.rows;
}

export async function listRemittances(db: Db, businessId: string, limit = 50) {
  const r = await db.query(
    `SELECT c.id, c.source, c.partner_name, c.reference, c.remitted_on::text AS remitted_on,
            c.expected_amount::float8 AS expected_amount, c.received_amount::float8 AS received_amount,
            c.deductions::float8 AS deductions, c.notes,
            (SELECT COUNT(*)::int FROM order_fulfilments f WHERE f.cod_remittance_id = c.id) AS parcels
       FROM cod_remittances c
      WHERE c.business_id = $1
      ORDER BY c.remitted_on DESC, c.created_at DESC
      LIMIT $2`,
    [businessId, limit],
  );
  return r.rows;
}

export async function recordRemittance(
  client: PoolClient,
  p: {
    businessId: string;
    userId: string;
    source: RemittanceSource;
    partnerName?: string | null;
    reference?: string | null;
    remittedOn: string;
    receivedAmount: number;
    fulfilmentIds: string[];
    notes?: string | null;
    /** Cash or bank account the money reached; the store default bank when omitted. */
    settlementAccountId?: string | null;
  },
): Promise<{ id: string; expected: number; deductions: number; receipts: number }> {
  const ids = [...new Set(p.fulfilmentIds)];
  if (ids.length === 0) throw new CodRemittanceError(400, 'Pick the parcels this payment covers');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.remittedOn)) throw new CodRemittanceError(400, 'Enter the date the money came in');
  const received = Math.round(Number(p.receivedAmount) * 100) / 100;
  if (!Number.isFinite(received) || received < 0) throw new CodRemittanceError(400, 'Enter the amount received');

  const parcels = await client.query<{
    id: string;
    cod: number;
    cod_collected_at: Date | null;
    store_order_id: string | null;
    invoice_id: string | null;
  }>(
    `SELECT f.id, f.cod_amount::float8 AS cod, f.cod_collected_at, f.store_order_id,
            COALESCE(so.invoice_id, f.invoice_id, s.converted_invoice_id) AS invoice_id
       FROM order_fulfilments f
       LEFT JOIN store_orders so ON so.id = f.store_order_id AND so.business_id = f.business_id
       LEFT JOIN sales_orders s ON s.id = f.sales_order_id AND s.business_id = f.business_id
      WHERE f.business_id = $1 AND f.id = ANY($2::uuid[])
        AND f.cod_amount > 0 AND f.cod_remittance_id IS NULL AND f.status = 'delivered'
      FOR UPDATE OF f`,
    [p.businessId, ids],
  );
  if (parcels.rows.length !== ids.length) {
    throw new CodRemittanceError(409, 'Some parcels are not delivered COD parcels waiting for cash, or were already matched');
  }
  const expected = Math.round(parcels.rows.reduce((s, r) => s + Number(r.cod), 0) * 100) / 100;
  if (received > expected + 0.005) {
    throw new CodRemittanceError(400, `Received ₹${received} is more than the ₹${expected} collected on these parcels`);
  }
  const deductions = Math.round((expected - received) * 100) / 100;
  const toReceive = parcels.rows.filter((r) => !r.cod_collected_at);
  if (toReceive.some((r) => !r.invoice_id)) {
    throw new CodRemittanceError(409, 'One of these parcels has no bill yet. Post the order bill, then record the remittance.');
  }
  const settlementAccountId =
    p.settlementAccountId || (await storeSettlementChoice(p.businessId, 'bank')).accountId;
  const account = (await listSettlementAccounts(p.businessId)).find(
    (a) => a.id === settlementAccountId && (a.kind === 'cash' || a.kind === 'bank'),
  );
  if (!settlementAccountId || !account) {
    throw new CodRemittanceError(400, 'Choose the cash or bank account the money reached');
  }
  const receiptMode = account.kind === 'cash' ? 'cash' : 'bank';
  const paymentDate = new Date(`${p.remittedOn}T12:00:00+05:30`);

  const ins = await client.query<{ id: string }>(
    `INSERT INTO cod_remittances
       (business_id, source, partner_name, reference, remitted_on, expected_amount, received_amount, deductions, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      p.businessId,
      p.source,
      p.partnerName?.trim().slice(0, 100) || null,
      p.reference?.trim().slice(0, 100) || null,
      p.remittedOn,
      expected,
      received,
      deductions,
      p.notes?.trim().slice(0, 500) || null,
      p.userId,
    ],
  );
  const id = ins.rows[0].id;
  const label = [p.partnerName?.trim(), p.reference?.trim()].filter(Boolean).join(' ') || p.source;

  let receipts = 0;
  for (const parcel of toReceive) {
    const inv = await client.query<{
      id: string;
      customer_id: string | null;
      branch_id: string | null;
      invoice_number: string;
      status: string;
      balance_amount: string;
    }>(
      `SELECT id, customer_id, branch_id, invoice_number, status, balance_amount::text
         FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [parcel.invoice_id, p.businessId],
    );
    const invoice = inv.rows[0];
    if (!invoice || invoice.status !== 'final') {
      throw new CodRemittanceError(409, 'The bill for one of these parcels is not final');
    }
    const amount = Math.round(Math.min(Number(parcel.cod), parseFloat(invoice.balance_amount) || 0) * 100) / 100;
    if (amount > 0.005) {
      await postStoreInvoiceReceipt(client, {
        businessId: p.businessId,
        invoice,
        amount,
        paymentMode: receiptMode,
        createdBy: p.userId,
        settlementAccountId,
        paymentDate,
        notes: `COD remittance ${label}`,
        description: `COD remitted by ${label} for invoice ${invoice.invoice_number}`,
      });
      receipts += 1;
    }
    if (parcel.store_order_id) {
      await client.query(
        `UPDATE store_orders SET cash_collected_at = COALESCE(cash_collected_at, NOW()), updated_at = NOW()
          WHERE id = $1 AND business_id = $2`,
        [parcel.store_order_id, p.businessId],
      );
    }
  }

  if (deductions > 0.004) {
    const expenseId = await courierChargesAccountId(client, p.businessId);
    const voucherNumber = await allocateJournalVoucherNumber(client, p.businessId, p.remittedOn);
    const voucherId = (await client.query<{ id: string }>(`SELECT uuid_generate_v4() AS id`)).rows[0].id;
    const narration = `Courier COD deductions: ${label}`;
    const legs: Array<[string, number, number]> = [
      [expenseId, deductions, 0],
      [settlementAccountId, 0, deductions],
    ];
    for (const [accountId, debit, credit] of legs) {
      await createLedgerEntryLine({
        businessId: p.businessId,
        voucherId,
        voucherType: 'journal',
        accountId,
        entryDate: p.remittedOn,
        debit,
        credit,
        narration,
        referenceNumber: voucherNumber,
        poolClient: client,
      });
    }
    await client.query(
      `INSERT INTO journal_entries (business_id, voucher_id, voucher_number, entry_date, reference_number, narration, is_locked, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,false,$7)`,
      [p.businessId, voucherId, voucherNumber, p.remittedOn, voucherNumber, narration, p.userId],
    );
  }

  await client.query(
    `UPDATE order_fulfilments
        SET cod_remittance_id = $3, cod_collected_at = COALESCE(cod_collected_at, NOW()), updated_at = NOW()
      WHERE business_id = $1 AND id = ANY($2::uuid[])`,
    [p.businessId, ids, id],
  );
  return { id, expected, deductions, receipts };
}

/** "Courier & COD Charges" under indirect expenses, added the first time a courier keeps a fee. */
async function courierChargesAccountId(client: PoolClient, businessId: string): Promise<string> {
  const found = await client.query<{ id: string }>(
    `SELECT id FROM accounts
      WHERE business_id = $1 AND is_active = true AND account_type = 'expense'
        AND (account_code = '5219' OR account_name ~* '(courier|cod charges|freight outward|carriage outward)')
      ORDER BY (account_code = '5219') DESC, account_code
      LIMIT 1`,
    [businessId],
  );
  if (found.rows[0]) return found.rows[0].id;
  const created = await client.query<{ id: string }>(
    `INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
     SELECT $1, '5219', 'Courier & COD Charges', 'expense', a.account_group_id, 'debit', true, 19
       FROM accounts a WHERE a.business_id = $1 AND a.account_code = '5217'
     ON CONFLICT (business_id, account_code) DO NOTHING
     RETURNING id`,
    [businessId],
  );
  if (created.rows[0]) return created.rows[0].id;
  throw new CodRemittanceError(409, 'Add an expense account for courier charges before recording a remittance with deductions');
}
