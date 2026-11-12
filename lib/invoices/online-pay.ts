/**
 * Paying one invoice online from its public link (/i/<token>), which is the link payment
 * reminders carry. A row in invoice_online_payments is made first; the gateway's verified notice
 * posts one receipt against that invoice (store receipt posting, so ledger, customer balance and
 * invoice balance move together). The business and invoice come from the stored row, never from
 * the gateway payload. Same shape as khata online payments (lib/khata/online-pay.ts).
 */
import { getPool, queryOne } from '@/lib/db';
import { setInvoiceAuditContext } from '@/lib/invoices/invoice-audit-context';
import { getBusinessPaymentProviderConfig } from '@/lib/payments/business-provider-config';
import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';
import { EasebuzzPaymentProvider } from '@/lib/payments/providers/easebuzz-payment-provider';
import { storePaymentAmountMatches } from '@/lib/store/fulfillment-rules';
import { postStoreInvoiceReceipt, storeReceiptPaymentMode } from '@/lib/store/store-receipt';
import { khataGateway, type KhataGatewayProvider } from '@/lib/khata/online-pay';
import { postKhataAdvance } from '@/lib/khata/settle';
import { getAppPublicOrigin } from '@/lib/customer-surface/urls';

export type InvoiceGatewayProvider = KhataGatewayProvider;

export class InvoicePayError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
    this.name = 'InvoicePayError';
  }
}

/** The business's online gateway for invoice payments (Razorpay or Easebuzz on the plan), or null. */
export async function invoiceGateway(businessId: string): Promise<InvoiceGatewayProvider | null> {
  return khataGateway(businessId);
}

type PayableInvoice = {
  id: string;
  business_id: string;
  customer_id: string | null;
  invoice_number: string;
  balance_amount: string;
  status: string;
  public_token: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
};

async function loadPayableInvoice(token: string): Promise<PayableInvoice | null> {
  const t = token?.trim();
  if (!t || t.length > 64) return null;
  return queryOne<PayableInvoice>(
    `SELECT i.id, i.business_id, i.customer_id, i.invoice_number, COALESCE(i.balance_amount, 0)::text AS balance_amount,
            i.status, i.public_token, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
      WHERE i.public_token = $1 AND i.deleted_at IS NULL`,
    [t],
  );
}

/** Whether "Pay now" can be offered on this public bill. */
export async function invoicePayAvailable(input: {
  businessId: string;
  customerId: string | null;
  status: string;
  balance: number;
}): Promise<boolean> {
  if (input.status !== 'final' || !input.customerId || !(input.balance >= 1)) return false;
  return (await invoiceGateway(input.businessId)) !== null;
}

/** Starts a gateway payment for the full balance of the invoice behind this public token. */
export async function startInvoiceOnlinePayment(token: string): Promise<{ paymentUrl: string; amount: number }> {
  const invoice = await loadPayableInvoice(token);
  if (!invoice || invoice.status !== 'final') throw new InvoicePayError('This bill is not available', 404, 'NOT_FOUND');
  if (!invoice.customer_id) {
    throw new InvoicePayError('Online payment is not available for this bill', 400, 'NO_CUSTOMER');
  }
  const amount = round2(Number(invoice.balance_amount));
  if (!(amount > 0.005)) throw new InvoicePayError('This bill is already paid', 400, 'NOTHING_DUE');
  if (amount < 1) throw new InvoicePayError('The amount due is below ₹1', 400, 'AMOUNT_TOO_SMALL');

  const provider = await invoiceGateway(invoice.business_id);
  if (!provider) throw new InvoicePayError('Online payment is not available for this shop', 400, 'NO_GATEWAY');
  const cfg = await getBusinessPaymentProviderConfig(invoice.business_id, provider);
  if (!cfg) throw new InvoicePayError('Online payment is not available for this shop', 400, 'NO_GATEWAY');

  const row = await queryOne<{ id: string }>(
    `INSERT INTO invoice_online_payments (business_id, invoice_id, customer_id, amount, provider)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [invoice.business_id, invoice.id, invoice.customer_id, amount, provider],
  );
  const rowId = row!.id;
  const psp = provider === 'easebuzz' ? new EasebuzzPaymentProvider(cfg) : new RazorpayPaymentProvider(cfg);
  let link;
  try {
    link = await psp.createHostedPaymentLink({
      businessId: invoice.business_id,
      orderId: rowId,
      amount,
      currency: 'INR',
      customerName: invoice.customer_name ?? '',
      customerPhone: invoice.customer_phone ?? '',
      customerEmail: invoice.customer_email ?? undefined,
      returnUrl: `${getAppPublicOrigin()}/i/${encodeURIComponent(invoice.public_token)}?payment=done`,
      metadata: {
        description: `Invoice ${invoice.invoice_number}`.slice(0, 100),
        invoice_payment_id: rowId,
        ...(provider === 'easebuzz' ? { easebuzz_context: 'IN' } : {}),
      },
    });
  } catch (err) {
    await getPool().query(
      `UPDATE invoice_online_payments SET status = 'failed', error_message = $2 WHERE id = $1`,
      [rowId, err instanceof Error ? err.message.slice(0, 500) : 'Payment link failed'],
    );
    throw new InvoicePayError('Could not start the online payment. Please try again.', 502, 'GATEWAY_ERROR');
  }
  if (!link?.paymentUrl) {
    throw new InvoicePayError('Could not start the online payment. Please try again.', 502, 'GATEWAY_ERROR');
  }
  await getPool().query(`UPDATE invoice_online_payments SET payment_ref = $2 WHERE id = $1`, [
    rowId,
    link.providerPaymentId ?? null,
  ]);
  return { paymentUrl: link.paymentUrl, amount };
}

type BillsCustomer = { id: string; business_id: string; name: string | null; phone: string | null; email: string | null };

export async function loadCustomerByBillsToken(token: string): Promise<BillsCustomer | null> {
  const t = token?.trim();
  if (!t || t.length > 64) return null;
  return queryOne<BillsCustomer>(
    `SELECT id, business_id, name, phone, email FROM customers
      WHERE bills_public_token = $1 AND deleted_at IS NULL`,
    [t],
  );
}

/**
 * Starts one gateway payment for several bills of the customer behind a public bills token.
 * No `invoiceIds`: every unpaid bill, less the customer's unadjusted advance ("to pay").
 * With `invoiceIds`: exactly those bills' balances. The bills and amount come from the database.
 */
export async function startCustomerBillsPayment(
  token: string,
  invoiceIds?: string[] | null,
): Promise<{ paymentUrl: string; amount: number }> {
  const customer = await loadCustomerByBillsToken(token);
  if (!customer) throw new InvoicePayError('This page is not available', 404, 'NOT_FOUND');
  const { customerDues } = await import('@/lib/payment-reminders/statement');
  const dues = await customerDues(customer.business_id, customer.id);
  if (dues.bills.length === 0) throw new InvoicePayError('Nothing is due', 400, 'NOTHING_DUE');

  let picked: string[] | null = null;
  let amount = dues.toPay;
  if (invoiceIds && invoiceIds.length > 0) {
    const wanted = new Set(invoiceIds);
    const bills = dues.bills.filter((b) => wanted.has(b.id));
    if (bills.length !== wanted.size) {
      throw new InvoicePayError('Some of these bills are already paid. Refresh the page.', 409, 'BILLS_CHANGED');
    }
    picked = bills.map((b) => b.id);
    amount = round2(bills.reduce((s, b) => s + b.balance, 0));
  }
  if (!(amount >= 1)) throw new InvoicePayError('The amount to pay is below ₹1', 400, 'AMOUNT_TOO_SMALL');

  const provider = await invoiceGateway(customer.business_id);
  if (!provider) throw new InvoicePayError('Online payment is not available for this shop', 400, 'NO_GATEWAY');
  const cfg = await getBusinessPaymentProviderConfig(customer.business_id, provider);
  if (!cfg) throw new InvoicePayError('Online payment is not available for this shop', 400, 'NO_GATEWAY');

  const row = await queryOne<{ id: string }>(
    `INSERT INTO invoice_online_payments (business_id, invoice_id, customer_id, invoice_ids, amount, provider)
     VALUES ($1, NULL, $2, $3, $4, $5) RETURNING id`,
    [customer.business_id, customer.id, picked, amount, provider],
  );
  const rowId = row!.id;
  const count = picked ? picked.length : dues.bills.length;
  const psp = provider === 'easebuzz' ? new EasebuzzPaymentProvider(cfg) : new RazorpayPaymentProvider(cfg);
  let link;
  try {
    link = await psp.createHostedPaymentLink({
      businessId: customer.business_id,
      orderId: rowId,
      amount,
      currency: 'INR',
      customerName: customer.name ?? '',
      customerPhone: customer.phone ?? '',
      customerEmail: customer.email ?? undefined,
      returnUrl: `${getAppPublicOrigin()}/b/${encodeURIComponent(token)}?payment=done`,
      metadata: {
        description: `Payment for ${count} bill${count === 1 ? '' : 's'}`,
        invoice_payment_id: rowId,
        ...(provider === 'easebuzz' ? { easebuzz_context: 'IN' } : {}),
      },
    });
  } catch (err) {
    await getPool().query(
      `UPDATE invoice_online_payments SET status = 'failed', error_message = $2 WHERE id = $1`,
      [rowId, err instanceof Error ? err.message.slice(0, 500) : 'Payment link failed'],
    );
    throw new InvoicePayError('Could not start the online payment. Please try again.', 502, 'GATEWAY_ERROR');
  }
  if (!link?.paymentUrl) {
    throw new InvoicePayError('Could not start the online payment. Please try again.', 502, 'GATEWAY_ERROR');
  }
  await getPool().query(`UPDATE invoice_online_payments SET payment_ref = $2 WHERE id = $1`, [
    rowId,
    link.providerPaymentId ?? null,
  ]);
  return { paymentUrl: link.paymentUrl, amount };
}

/** The invoice payment a gateway notice refers to, by the link id / txnid or captured payment id. */
export async function findInvoiceOnlinePayment(
  provider: InvoiceGatewayProvider,
  refs: { paymentRef?: string | null; providerPaymentId?: string | null },
): Promise<{ id: string; business_id: string; invoice_id: string } | null> {
  const ref = refs.paymentRef || '';
  const pid = refs.providerPaymentId || '';
  if (!ref && !pid) return null;
  return queryOne<{ id: string; business_id: string; invoice_id: string }>(
    `SELECT id, business_id, invoice_id FROM invoice_online_payments
      WHERE provider = $1 AND (($2 <> '' AND payment_ref = $2) OR ($3 <> '' AND provider_payment_id = $3))
      LIMIT 1`,
    [provider, ref, pid],
  );
}

export type InvoicePaymentAllocation = { invoiceId: string; invoiceNumber: string; amount: number; paymentId: string };

export type InvoicePaymentOutcome =
  | {
      outcome: 'settled';
      settled: number;
      advance: number;
      /** First receipt posted (single-invoice payments have exactly one). */
      paymentId: string | null;
      allocations: InvoicePaymentAllocation[];
    }
  | { outcome: 'duplicate' }
  | { outcome: 'rejected'; reason: 'AMOUNT_MISMATCH' | 'NOT_FOUND' };

type LockedBill = { id: string; customer_id: string | null; branch_id: string | null; invoice_number: string; balance_amount: string };

/**
 * Applies one verified successful gateway notice. Idempotent: a paid row is never posted twice.
 * A single-invoice payment posts against that invoice. A bills payment is spread across the
 * customer's bills (the ones they picked, or all unpaid), oldest due date first, one receipt per
 * bill. A bill settled some other way meanwhile is skipped; money above the bills becomes an advance.
 */
export async function applyInvoiceGatewayPayment(input: {
  invoicePaymentId: string;
  businessId: string;
  amount: number | null | undefined;
  providerPaymentId?: string | null;
  payload: unknown;
}): Promise<InvoicePaymentOutcome> {
  const client = await getPool().connect();
  let result: InvoicePaymentOutcome;
  try {
    await client.query('BEGIN');
    await setInvoiceAuditContext(client, { actorUserId: null, action: 'payment_recorded' });
    const r = await client.query<{
      id: string;
      invoice_id: string | null;
      invoice_ids: string[] | null;
      customer_id: string | null;
      amount: string;
      status: string;
    }>(
      `SELECT id, invoice_id, invoice_ids, customer_id, amount::text, status FROM invoice_online_payments
        WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [input.invoicePaymentId, input.businessId],
    );
    const row = r.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { outcome: 'rejected', reason: 'NOT_FOUND' };
    }
    if (row.status === 'paid') {
      await client.query('COMMIT');
      return { outcome: 'duplicate' };
    }
    const expected = Number(row.amount);
    if (!storePaymentAmountMatches(input.amount ?? null, expected)) {
      await client.query(`UPDATE invoice_online_payments SET error_message = 'AMOUNT_MISMATCH' WHERE id = $1`, [row.id]);
      await client.query('COMMIT');
      return { outcome: 'rejected', reason: 'AMOUNT_MISMATCH' };
    }

    let bills: LockedBill[];
    if (row.invoice_id) {
      bills = (
        await client.query<LockedBill>(
          `SELECT id, customer_id, branch_id, invoice_number, COALESCE(balance_amount, 0)::text AS balance_amount
             FROM invoices WHERE id = $1 AND business_id = $2 FOR UPDATE`,
          [row.invoice_id, input.businessId],
        )
      ).rows;
      if (bills.length === 0) {
        await client.query('ROLLBACK');
        return { outcome: 'rejected', reason: 'NOT_FOUND' };
      }
    } else {
      bills = (
        await client.query<LockedBill>(
          `SELECT id, customer_id, branch_id, invoice_number, COALESCE(balance_amount, 0)::text AS balance_amount
             FROM invoices
            WHERE business_id = $1 AND customer_id = $2
              AND status = 'final' AND deleted_at IS NULL
              AND COALESCE(balance_amount, 0) > 0.005
              AND COALESCE(document_type, 'tax_invoice') NOT IN ('proforma_invoice', 'quotation', 'delivery_challan')
              AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[]))
            ORDER BY COALESCE(due_date, invoice_date) ASC, invoice_date ASC, created_at ASC
            FOR UPDATE`,
          [input.businessId, row.customer_id, row.invoice_ids],
        )
      ).rows;
    }

    const reference = `IP-${row.id.slice(0, 8).toUpperCase()}`;
    const paymentMode = storeReceiptPaymentMode(input.payload);
    const allocations: InvoicePaymentAllocation[] = [];
    let left = round2(expected);
    for (const bill of bills) {
      if (left <= 0.005) break;
      const pay = round2(Math.min(left, Math.max(0, Number(bill.balance_amount) || 0)));
      if (pay <= 0.005) continue;
      const paymentId = await postStoreInvoiceReceipt(client, {
        businessId: input.businessId,
        invoice: { id: bill.id, customer_id: bill.customer_id, branch_id: bill.branch_id, invoice_number: bill.invoice_number },
        amount: pay,
        paymentMode,
        createdBy: null,
        notes: `Paid online ${reference}`,
        description: `Online payment ${reference} for invoice ${bill.invoice_number}`,
      });
      await client.query(
        `INSERT INTO invoice_online_payment_allocations (business_id, online_payment_id, invoice_id, payment_id, amount)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.businessId, row.id, bill.id, paymentId, pay],
      );
      allocations.push({ invoiceId: bill.id, invoiceNumber: bill.invoice_number, amount: pay, paymentId });
      left = round2(left - pay);
    }
    const settled = round2(expected - left);
    const advanceCustomer = row.customer_id ?? bills[0]?.customer_id ?? null;
    if (left > 0.005 && advanceCustomer) {
      await postKhataAdvance(client, {
        businessId: input.businessId,
        customerId: advanceCustomer,
        amount: left,
        paymentMode,
        createdBy: null,
        reference,
        note: `Online payment ${reference} above the bills it was for`,
      });
    }

    const firstPaymentId = allocations[0]?.paymentId ?? null;
    await client.query(
      `UPDATE invoice_online_payments
          SET status = 'paid', paid_at = CURRENT_TIMESTAMP, settled_amount = $2, payment_id = $3,
              provider_payment_id = COALESCE($4, provider_payment_id), error_message = NULL
        WHERE id = $1`,
      [row.id, settled, firstPaymentId, input.providerPaymentId ?? null],
    );
    await client.query('COMMIT');
    result = { outcome: 'settled', settled, advance: left > 0.005 ? left : 0, paymentId: firstPaymentId, allocations };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  if (result.outcome === 'settled' && result.allocations.length > 0) {
    const settledResult = result;
    void import('@/lib/invoices/payment-received-notify')
      .then(({ notifyInvoicePaymentReceived, notifyBillsPaymentReceived }) =>
        settledResult.allocations.length === 1
          ? notifyInvoicePaymentReceived({
              businessId: input.businessId,
              paymentId: settledResult.allocations[0].paymentId,
              source: 'online',
            })
          : notifyBillsPaymentReceived({ businessId: input.businessId, onlinePaymentId: input.invoicePaymentId }),
      )
      .catch((err) => console.error('[invoice online pay] payment received message failed:', err));
  }
  return result;
}

export async function markInvoiceOnlinePaymentFailed(invoicePaymentId: string, businessId: string): Promise<void> {
  await getPool().query(
    `UPDATE invoice_online_payments SET status = 'failed', error_message = 'PAYMENT_FAILED'
      WHERE id = $1 AND business_id = $2 AND status = 'pending'`,
    [invoicePaymentId, businessId],
  );
}

/** Where the customer lands after paying: the bill page or the bills page (Easebuzz return redirect). */
export async function onlinePaymentReturnPath(invoicePaymentId: string): Promise<string | null> {
  const r = await queryOne<{ invoice_token: string | null; bills_token: string | null }>(
    `SELECT i.public_token AS invoice_token, c.bills_public_token AS bills_token
       FROM invoice_online_payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN customers c ON c.id = p.customer_id
      WHERE p.id = $1`,
    [invoicePaymentId],
  );
  if (r?.invoice_token) return `/i/${encodeURIComponent(r.invoice_token)}`;
  if (r?.bills_token) return `/b/${encodeURIComponent(r.bills_token)}`;
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
