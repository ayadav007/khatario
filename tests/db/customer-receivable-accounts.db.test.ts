/**
 * Customer receivable accounts by category (Domestic Debtors, Foreign Debtors, ...).
 * Spec: docs/superpowers/specs/2026-11-10-customer-receivable-accounts-design.md
 *
 * Connects only after current_database() is kh_phase2_test on localhost port 5433.
 * Applies migration 468 itself, creates its own businesses and removes only those.
 * The tests run in order and share the data they build.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';

function readEnvFile(file: string): Record<string, string> {
  const text = fs.readFileSync(file, 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[m[1]] = val;
  }
  return out;
}

function forceDisposableDatabase(): void {
  const env = readEnvFile(path.resolve(process.cwd(), '.env'));
  const host = env.DB_HOST || '';
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('Refusing customer receivable account tests: database host is not local');
  }
  if (!env.DB_USER || env.DB_PASSWORD == null) {
    throw new Error('Refusing customer receivable account tests: local database credentials are missing');
  }
  const port = env.DB_PORT || '5432';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
  process.env.DB_NAME = 'kh_phase2_test';
}

forceDisposableDatabase();

const headerBag: { current: Record<string, string> } = { current: {} };
(global as unknown as { __craHeaders: typeof headerBag }).__craHeaders = headerBag;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({
    get: (name: string) =>
      (global as unknown as { __craHeaders: { current: Record<string, string> } }).__craHeaders.current[
        name.toLowerCase()
      ] ?? null,
  })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(),
  shouldRotateTokens: jest.fn(async () => ({ rotate: false, payload: null })),
}));
jest.mock('@/lib/platform-jwt', () => ({ getPlatformSessionFromRequest: jest.fn(async () => null) }));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn() }));
jest.mock('@/lib/activity-logger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  getClientIP: jest.fn(() => '127.0.0.1'),
  getUserAgent: jest.fn(() => 'jest'),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { POST as postAccount } from '@/app/api/accounts/route';
import { PATCH as patchAccount, DELETE as deleteAccount } from '@/app/api/accounts/[id]/route';
import {
  assertReceivableTarget,
  receivableAccountIds,
  resolveCustomerReceivableAccountId,
} from '@/lib/accounting/receivable-accounts';
import {
  createInvoiceLedgerEntries,
  createCreditNoteLedgerEntries,
  createDebitNoteLedgerEntries,
  postOpeningBalanceLedgerEntry,
} from '@/lib/ledger-utils';
import { createAdvance, adjustAdvance } from '@/lib/accounting/advance-service';
import { refundCreditNote } from '@/lib/credit-notes/refund';
import { POST as postPayment } from '@/app/api/payments/route';
import { insertVoucherLines } from '@/lib/accounting/voucher-posting';
import { customerIdForVoucher, customerReceivableBalances } from '@/lib/accounting/customer-vouchers';
import { fetchPartyLedgerDocs } from '@/lib/reports/party-ledger-docs';
import { moveCustomerReceivableAccount } from '@/lib/accounting/receivable-account-move';
import { reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';
import { GET as agingReceivables } from '@/app/api/reports/aging/receivables/route';
import { GET as getCustomers, POST as postCustomer } from '@/app/api/customers/route';
import { GET as getCustomer, PUT as putCustomer } from '@/app/api/customers/[id]/route';
import { setPartyOpeningBalance } from '@/lib/accounting/account-rules';
import { GET as getReceivableAccounts } from '@/app/api/customers/receivable-accounts/route';
import { POST as postMove } from '@/app/api/customers/[id]/receivable-account/route';
import { POST as postBulk } from '@/app/api/customers/receivable-account/route';
import * as receivableSchema from '@/lib/accounting/receivable-accounts-schema';
import { PATCH as amendInvoice } from '@/app/api/invoices/[id]/amend/route';
import { assessPaymentReversal, executePaymentReversal, currentReversalDate } from '@/lib/accounting/payment-reversal';
import { updateAccountMappings } from '@/lib/account-mappings';
import { GET as getBalanceSheet } from '@/app/api/reports/balance-sheet/route';
import { GET as getPartyStatement } from '@/app/api/reports/party/statement/route';

const migration468 = fs.readFileSync(
  path.join(__dirname, '../../database/migrations/468_customer_receivable_accounts.sql'),
  'utf8',
);

describe('customer receivable accounts', () => {
  jest.setTimeout(240000);

  let pool: Pool;
  const A = randomUUID();
  const B = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const BR = randomUUID();
  const CD = randomUUID(); // Domestic customer
  const CF = randomUUID(); // Foreign customer
  const CU = randomUUID(); // no account chosen
  const customerOfB = randomUUID();
  const tag = A.slice(0, 8);
  const inv: Record<string, string> = {};
  const doc: Record<string, string> = {}; // other vouchers by a short name
  const CZ = randomUUID(); // customer with no entries
  const CM = randomUUID(); // customer moved after an invoice and a receipt
  let before = 0; // balance of CD in DOM before the first move

  let AR = '';
  let DOM = '';
  let NORTH = '';
  let FOR = '';

  function session(userId: string, businessId: string) {
    headerBag.current = {
      'x-authenticated-user-id': userId,
      'x-authenticated-business-id': businessId,
      'x-authenticated-session-version': '1',
    };
  }

  async function call(
    handler: (request: NextRequest, ctx?: any) => Promise<Response>,
    method: string,
    urlPath: string,
    body: Record<string, unknown> | null,
    id?: string,
  ) {
    const res = await handler(
      new NextRequest(`http://localhost${urlPath}`, {
        method,
        headers: { 'content-type': 'application/json', ...headerBag.current },
        body: body ? JSON.stringify(body) : undefined,
      }),
      id ? { params: { id } } : undefined,
    );
    const text = await res.text();
    let json: Record<string, any> = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text.slice(0, 400) };
    }
    return { status: res.status, json };
  }

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async function groupId(businessId: string, code: string) {
    const row = await pool.query<{ id: string }>(
      `SELECT id FROM account_groups WHERE business_id = $1 AND group_code = $2`,
      [businessId, code],
    );
    if (!row.rows[0]) throw new Error(`Missing group ${code}`);
    return row.rows[0].id;
  }

  async function accountByCode(businessId: string, code: string) {
    const row = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE business_id = $1 AND account_code = $2`,
      [businessId, code],
    );
    if (!row.rows[0]) throw new Error(`Missing account ${code}`);
    return row.rows[0];
  }

  async function subAccount(code: string, name: string, parentId: string) {
    session(ownerA, A);
    const res = await call(postAccount, 'POST', '/api/accounts', {
      account_code: `${code}${tag}`,
      account_name: `${name} ${tag}`,
      account_type: 'asset',
      account_group_id: await groupId(A, '1100'),
      parent_account_id: parentId,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    if (res.status !== 201) throw new Error(`account ${name}: ${res.status} ${JSON.stringify(res.json)}`);
    return (res.json.account as { id: string }).id;
  }

  type ArLine = { account_id: string; debit: number; credit: number };

  /** Lines of one voucher that sit on a receivable account, oldest first. */
  async function arLines(voucherType: string, voucherId: string): Promise<ArLine[]> {
    const res = await pool.query<ArLine>(
      `SELECT account_id, debit::float AS debit, credit::float AS credit
         FROM ledger_entry_lines
        WHERE business_id = $1 AND voucher_type = $2 AND voucher_id = $3 AND account_id = ANY($4::uuid[])
        ORDER BY created_at, id`,
      [A, voucherType, voucherId, [AR, DOM, NORTH, FOR]],
    );
    return res.rows;
  }

  /** Receivable lines of every voucher of a type, newest first. */
  async function arLinesOfType(voucherType: string): Promise<ArLine[]> {
    const res = await pool.query<ArLine>(
      `SELECT account_id, debit::float AS debit, credit::float AS credit
         FROM ledger_entry_lines
        WHERE business_id = $1 AND voucher_type = $2 AND account_id = ANY($3::uuid[])
        ORDER BY created_at DESC, id DESC`,
      [A, voucherType, [AR, DOM, NORTH, FOR]],
    );
    return res.rows;
  }

  /** The customer's balance in each receivable account. */
  const bal = (customerId: string) =>
    tx((c) => customerReceivableBalances(c, A, customerId, [AR, DOM, NORTH, FOR]));

  async function ledgerNet(accountId: string): Promise<number> {
    const res = await pool.query<{ n: number }>(
      `SELECT COALESCE(SUM(debit - credit), 0)::float AS n FROM ledger_entry_lines WHERE business_id = $1 AND account_id = $2`,
      [A, accountId],
    );
    return res.rows[0].n;
  }

  async function invoice(key: string, customer: string, date: string, due: string, total: number, branch: string = BR) {
    const id = randomUUID();
    const number = `${key}-${tag}`;
    await tx(async (c) => {
      await c.query(
        `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, due_date, status, document_type,
            place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
            paid_amount, balance_amount, payment_status, branch_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'final', 'tax_invoice', '29', $7, 0, 0, 0, 0, $7, 0, $7, 'unpaid', $8)`,
        [id, A, customer, number, date, due, total, branch],
      );
      await createInvoiceLedgerEntries({
        businessId: A, invoiceId: id, invoiceNumber: number, invoiceDate: date, grandTotal: total,
        customerId: customer, isCashSale: false, branchId: branch, taxableValue: total, poolClient: c,
      });
      await c.query(`UPDATE customers SET current_balance = current_balance + $1 WHERE id = $2`, [total, customer]);
    });
    inv[key] = id;
    return id;
  }

  async function pay(body: Record<string, unknown>) {
    session(ownerA, A);
    const res = await call(postPayment, 'POST', '/api/payments', { payment_mode: 'cash', ...body });
    if (res.status !== 201) throw new Error(`payment ${res.status} ${JSON.stringify(res.json)}`);
    return res.json.payment as { id: string };
  }

  async function creditNote(customer: string, invoiceId: string | null, date: string, total: number) {
    const id = randomUUID();
    const number = `CN-${id.slice(0, 6)}`;
    await tx(async (c) => {
      await c.query(
        `INSERT INTO credit_notes (id, business_id, customer_id, invoice_id, credit_note_number, credit_note_date, status,
            subtotal, grand_total, branch_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $7, $8)`,
        [id, A, customer, invoiceId, number, date, total, BR],
      );
      await createCreditNoteLedgerEntries({
        businessId: A, creditNoteId: id, creditNoteNumber: number, creditNoteDate: date,
        grandTotal: total, customerId: customer, branchId: BR, taxableValue: total, poolClient: c,
      });
    });
    return id;
  }

  async function debitNote(customer: string, date: string, total: number) {
    const id = randomUUID();
    const number = `DN-${id.slice(0, 6)}`;
    await tx(async (c) => {
      await c.query(
        `INSERT INTO debit_notes (id, business_id, customer_id, debit_note_number, debit_note_date, subtotal, grand_total)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [id, A, customer, number, date, total],
      );
      await createDebitNoteLedgerEntries({
        businessId: A, debitNoteId: id, debitNoteNumber: number, debitNoteDate: date,
        grandTotal: total, customerId: customer, branchId: BR, taxableValue: total, poolClient: c,
      });
    });
    return id;
  }

  /** A new customer of business A, recorded in `accountId` (null = Accounts Receivable). */
  async function newCustomer(name: string, accountId: string | null) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance, credit_limit, receivable_account_id)
       VALUES ($1, $2, $3, '29', 0, 0, $4)`,
      [id, A, name, accountId],
    );
    return id;
  }

  async function purge(ids: string[]) {
    await tx(async (c) => {
      await withLedgerDelete(c, 'tenant_purge', null, async () => {
        await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [ids]);
      });
    });
    await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = ANY($1::uuid[])`, [ids]).catch(() => {});
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; addr: string | null; port: number }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`,
    );
    const info = db.rows[0];
    if (
      info.db !== 'kh_phase2_test' ||
      info.port !== 5433 ||
      !info.addr ||
      (!info.addr.includes('127.0.0.1') && !info.addr.includes('::1'))
    ) {
      throw new Error(`Refusing customer receivable account tests against ${info.db} at ${info.addr}:${info.port}`);
    }

    await tx((c) => c.query(migration468));
    await tx((c) => c.query(migration468));

    const plan = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM subscription_plan_features
        WHERE enabled = true AND feature_id IN ('accounting_chart', 'advanced_ledger', 'reports_advanced')
        GROUP BY plan_id
        HAVING COUNT(DISTINCT feature_id) = 3
        LIMIT 1`,
    );
    if (!plan.rows[0]) {
      throw new Error('No plan grants accounting_chart, advanced_ledger, and reports_advanced on kh_phase2_test');
    }
    const orphans = await pool.query<{ id: string }>(`SELECT id FROM businesses WHERE name LIKE 'CRA %'`);
    if (orphans.rows.length) await purge(orphans.rows.map((row) => row.id));

    const phone = Date.now().toString().slice(-7);
    for (const [id, name, gst, userId, userPhone, branchId] of [
      [A, `CRA A ${tag}`, `29ABCDE${tag.slice(0, 4)}A1Z5`, ownerA, `75${phone}1`, BR],
      [B, `CRA B ${tag}`, `27ABCDE${tag.slice(0, 4)}A1Z5`, ownerB, `75${phone}2`, randomUUID()],
    ] as const) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
         VALUES ($1, $2, $3, $4, 'regular', 'billing')`,
        [id, name, gst, gst.slice(0, 2)],
      );
      await pool.query(
        `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
        [id],
      );
      await pool.query(
        `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
         VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
        [id, plan.rows[0].plan_id],
      );
      await pool.query(`SELECT create_default_chart_of_accounts($1)`, [id]);
      await pool.query(`SELECT ensure_standard_account_heads($1)`, [id]);
      await pool.query(
        `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
         VALUES ($1, $2, 'Main', $3, true, true, true)`,
        [branchId, id, gst.slice(0, 2)],
      );
      await pool.query(
        `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
         VALUES ($1, $2, $3, $4, true, 1, true)`,
        [userId, id, name, userPhone],
      );
    }
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance, credit_limit)
       VALUES ($1, $5, 'CRA Domestic', '29', 0, 0), ($2, $5, 'CRA Foreign', '29', 0, 0),
              ($3, $5, 'CRA Unassigned', '29', 0, 0), ($4, $6, 'CRA Other business', '27', 0, 0)`,
      [CD, CF, CU, customerOfB, A, B],
    );

    AR = (await accountByCode(A, '1103')).id;
    DOM = await subAccount('CRD', 'Domestic Debtors', AR);
    NORTH = await subAccount('CRN', 'North Zone', DOM);
    FOR = await subAccount('CRF', 'Foreign Debtors', AR);
  });

  afterAll(async () => {
    try {
      if (pool) await purge([A, B]);
    } finally {
      await closePool();
    }
  });

  // --- Task 2: the receivable set and target validation ---------------------------------------

  test('three levels of sub-accounts are created and form the receivable set', async () => {
    expect(new Set(await receivableAccountIds(A))).toEqual(new Set([AR, DOM, NORTH, FOR]));
  });

  test('target validation', async () => {
    await expect(assertReceivableTarget(A, null)).resolves.toBe(AR);
    await expect(assertReceivableTarget(A, NORTH)).resolves.toBe(NORTH);
    const cash = await accountByCode(A, '1101');
    await expect(assertReceivableTarget(A, cash.id)).rejects.toMatchObject({ code: 'RECEIVABLE_ACCOUNT_INVALID' });
    const foreignAr = await accountByCode(B, '1103');
    await expect(assertReceivableTarget(A, foreignAr.id)).rejects.toMatchObject({ code: 'RECEIVABLE_ACCOUNT_INVALID' });
  });

  // --- Task 3: documents post to the customer's account ---------------------------------------

  test('each customer document posts to the customer account', async () => {
    await pool.query(`UPDATE customers SET receivable_account_id = $1 WHERE id = $2`, [DOM, CD]);
    await pool.query(`UPDATE customers SET receivable_account_id = $1 WHERE id = $2`, [FOR, CF]);

    const i1 = await invoice('D1', CD, '2026-10-01', '2026-10-16', 1000);
    expect(await arLines('invoice', i1)).toEqual([{ account_id: DOM, debit: 1000, credit: 0 }]);

    const pay1 = await pay({ type: 'receivable', reference_type: 'invoice', reference_id: i1, amount: 400, payment_date: '2026-10-05' });
    expect(await arLines('payment', pay1.id)).toEqual([{ account_id: DOM, debit: 0, credit: 400 }]);
    doc.pay1 = pay1.id;

    const cn = await creditNote(CD, i1, '2026-10-06', 100);
    expect(await arLines('credit_note', cn)).toEqual([{ account_id: DOM, debit: 0, credit: 100 }]);
    doc.cn = cn;

    const dn = await debitNote(CD, '2026-10-07', 50);
    expect(await arLines('debit_note', dn)).toEqual([{ account_id: DOM, debit: 50, credit: 0 }]);
    doc.dn = dn;

    const i2 = await invoice('F1', CF, '2026-10-02', '2026-10-17', 2000);
    expect((await arLines('invoice', i2))[0].account_id).toBe(FOR);

    const i3 = await invoice('U1', CU, '2026-10-03', '2026-10-18', 300);
    expect((await arLines('invoice', i3))[0].account_id).toBe(AR);
  });

  test('advance adjustment and credit-note refund use the customer account', async () => {
    const cash = (await accountByCode(A, '1101')).id;
    await tx(async (c) => {
      const adv = await createAdvance(c, {
        businessId: A, branchId: BR, userId: ownerA, type: 'received', partyId: CF, amount: 500, date: '2026-10-03',
        supplyType: 'goods', taxRate: 0, paymentAccountId: cash,
      });
      await adjustAdvance(c, { businessId: A, branchId: BR, userId: ownerA, advanceId: adv.id, invoiceId: inv.F1, amount: 500, date: '2026-10-04' });
    });
    expect((await arLinesOfType('advance_adjustment'))[0]).toMatchObject({ account_id: FOR, credit: 500 });

    const standalone = await creditNote(CD, null, '2026-10-08', 100);
    await tx((c) =>
      refundCreditNote(c, { businessId: A, userId: ownerA, creditNoteId: standalone, amount: 100, mode: 'cash', date: '2026-10-09' }),
    );
    expect((await arLinesOfType('credit_note_refund'))[0]).toMatchObject({ account_id: DOM, debit: 100 });
  });

  test('a customer opening balance posts to the customer account', async () => {
    const CO = randomUUID();
    doc.CO = CO;
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance, credit_limit, receivable_account_id)
       VALUES ($1, $2, 'CRA Opening', '29', 0, 0, $3)`,
      [CO, A, NORTH],
    );
    await postOpeningBalanceLedgerEntry({
      businessId: A, entityType: 'customer', entityId: CO, entityName: 'CRA Opening', openingBalance: 700, openingBalanceType: 'debit',
    });
    expect((await arLines('opening_balance', CO))[0]).toMatchObject({ account_id: NORTH, debit: 700 });
  });

  test('a saved account that is no longer valid falls back to the control account', async () => {
    await pool.query(`UPDATE accounts SET is_active = false WHERE id = $1`, [FOR]);
    try {
      expect(await resolveCustomerReceivableAccountId(A, CF)).toBe(AR);
    } finally {
      await pool.query(`UPDATE accounts SET is_active = true WHERE id = $1`, [FOR]);
    }
    expect(await resolveCustomerReceivableAccountId(A, CF)).toBe(FOR);
    expect(await resolveCustomerReceivableAccountId(A, CU)).toBe(AR);
    expect(await resolveCustomerReceivableAccountId(A, null)).toBe(AR);
    expect(await resolveCustomerReceivableAccountId(A, customerOfB)).toBe(AR);
  });

  // --- Task 4: voucher → customer, and a customer's balance per account -----------------------

  test('every voucher on a receivable account belongs to the customer it was raised for', async () => {
    await tx(async (c) => {
      expect(await customerIdForVoucher(c, A, 'invoice', inv.D1)).toBe(CD);
      expect(await customerIdForVoucher(c, A, 'payment', doc.pay1)).toBe(CD);
      expect(await customerIdForVoucher(c, A, 'credit_note', doc.cn)).toBe(CD);
      expect(await customerIdForVoucher(c, A, 'debit_note', doc.dn)).toBe(CD);
      expect(await customerIdForVoucher(c, A, 'opening_balance', doc.CO)).toBe(doc.CO);
      const vouchers = await c.query<{ voucher_type: string; voucher_id: string }>(
        `SELECT DISTINCT voucher_type, voucher_id FROM ledger_entry_lines
          WHERE business_id = $1 AND account_id = ANY($2::uuid[])`,
        [A, [AR, DOM, NORTH, FOR]],
      );
      expect(vouchers.rows.length).toBeGreaterThanOrEqual(8);
      for (const v of vouchers.rows) {
        expect([CD, CF, CU, doc.CO]).toContain(await customerIdForVoucher(c, A, v.voucher_type, v.voucher_id));
      }
      const adjustment = vouchers.rows.find((v) => v.voucher_type === 'advance_adjustment')!;
      expect(await customerIdForVoucher(c, A, 'advance_adjustment', adjustment.voucher_id)).toBe(CF);
      const refund = vouchers.rows.find((v) => v.voucher_type === 'credit_note_refund')!;
      expect(await customerIdForVoucher(c, A, 'credit_note_refund', refund.voucher_id)).toBe(CD);
    });
  });

  test('every voucher the aging report attributes is attributed the same way here', async () => {
    const docs = await fetchPartyLedgerDocs({ businessId: A, partyType: 'customer', asOfDate: '2026-12-31' });
    expect(docs.length).toBeGreaterThan(0);
    await tx(async (c) => {
      for (const d of docs.filter((x) => x.partyId)) {
        expect(await customerIdForVoucher(c, A, d.voucherType, d.voucherId!)).toBe(d.partyId);
      }
    });
  });

  test('a receipt taken at invoice time is found through the invoice', async () => {
    const cash = (await accountByCode(A, '1101')).id;
    await tx((c) =>
      insertVoucherLines(c, {
        businessId: A, branchId: BR, voucherId: inv.D1, voucherType: 'payment', entryDate: '2026-10-01', reference: 'at sale',
        lines: [
          { accountId: cash, debit: 60, credit: 0, narration: 'Received at sale' },
          { accountId: DOM, debit: 0, credit: 60, narration: 'Received at sale' },
        ],
      }),
    );
    await tx(async (c) => expect(await customerIdForVoucher(c, A, 'payment', inv.D1)).toBe(CD));
  });

  test('balances per account, and a voucher of another business is not found', async () => {
    await tx(async (c) => {
      const b = await customerReceivableBalances(c, A, CD, [AR, DOM, NORTH, FOR]);
      expect(b.get(DOM)).toBeCloseTo(await ledgerNet(DOM), 2); // CD is the only customer posting to DOM so far
      expect(b.get(DOM)).toBeCloseTo(1000 - 400 - 100 + 50 - 100 + 100 - 60, 2);
      expect(b.has(FOR)).toBe(false);
      expect(b.has(AR)).toBe(false);
      const f = await customerReceivableBalances(c, A, CF, [AR, DOM, NORTH, FOR]);
      expect(f.get(FOR)).toBeCloseTo(2000 - 500, 2);
      expect(await customerIdForVoucher(c, B, 'invoice', inv.D1)).toBeNull();
      expect((await customerReceivableBalances(c, B, CD, [AR, DOM, NORTH, FOR])).size).toBe(0);
    });
  });

  // --- Task 5: moving a customer --------------------------------------------------------------

  test('moving a customer with a balance posts one transfer and settles the old account', async () => {
    before = (await bal(CD)).get(DOM)!;
    expect(before).toBeGreaterThan(0);
    const r = await moveCustomerReceivableAccount({ businessId: A, customerId: CD, toAccountId: FOR, actorId: ownerA });
    expect(r).toMatchObject({ changed: true, toAccountId: FOR, transfers: [{ fromAccountId: DOM, amount: before }] });
    expect(r.transferredAmount).toBeCloseTo(before, 2);
    expect(r.transferDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const b = await bal(CD);
    expect(b.get(DOM) ?? 0).toBeCloseTo(0, 2);
    expect(b.get(FOR)).toBeCloseTo(before, 2);
    const v = await pool.query<{ account_id: string; debit: number; credit: number }>(
      `SELECT account_id, debit::float AS debit, credit::float AS credit FROM ledger_entry_lines
        WHERE business_id = $1 AND voucher_type = 'receivable_transfer' AND voucher_id = $2`,
      [A, r.moveId],
    );
    expect(v.rows).toHaveLength(2);
    expect(v.rows.find((l) => l.account_id === FOR)).toMatchObject({ debit: before, credit: 0 });
    expect(v.rows.find((l) => l.account_id === DOM)).toMatchObject({ debit: 0, credit: before });
    const row = await pool.query(
      `SELECT c.receivable_account_id, m.to_account_id, m.transferred_amount::float AS amount, m.created_by
         FROM customers c JOIN customer_receivable_account_moves m ON m.id = $2 WHERE c.id = $1`,
      [CD, r.moveId],
    );
    expect(row.rows[0]).toMatchObject({ receivable_account_id: FOR, to_account_id: FOR, amount: before, created_by: ownerA });
  });

  test('dry run changes nothing', async () => {
    const lines = await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE business_id = $1`, [A]);
    const r = await moveCustomerReceivableAccount({ businessId: A, customerId: CD, toAccountId: DOM, actorId: ownerA, dryRun: true });
    expect(r.transferredAmount).toBeCloseTo(before, 2);
    expect(r.moveId).toBeNull();
    const row = await pool.query(`SELECT receivable_account_id FROM customers WHERE id = $1`, [CD]);
    expect(row.rows[0].receivable_account_id).toBe(FOR);
    const after = await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE business_id = $1`, [A]);
    expect(after.rows[0].n).toBe(lines.rows[0].n);
  });

  test('moving back, and moving to the default, stay exact; the same account with nothing to sweep records nothing', async () => {
    await moveCustomerReceivableAccount({ businessId: A, customerId: CD, toAccountId: DOM, actorId: ownerA });
    const toDefault = await moveCustomerReceivableAccount({ businessId: A, customerId: CD, toAccountId: null, actorId: ownerA });
    expect(toDefault.toAccountId).toBe(AR);
    const stored = await pool.query(`SELECT receivable_account_id FROM customers WHERE id = $1`, [CD]);
    expect(stored.rows[0].receivable_account_id).toBeNull();
    const moves = await pool.query(`SELECT COUNT(*)::int AS n FROM customer_receivable_account_moves WHERE customer_id = $1`, [CD]);
    const again = await moveCustomerReceivableAccount({ businessId: A, customerId: CD, toAccountId: null, actorId: ownerA });
    expect(again).toMatchObject({ changed: false, moveId: null, transferredAmount: 0 });
    const movesAfter = await pool.query(`SELECT COUNT(*)::int AS n FROM customer_receivable_account_moves WHERE customer_id = $1`, [CD]);
    expect(movesAfter.rows[0].n).toBe(moves.rows[0].n);
    const b = await bal(CD);
    expect(b.get(AR)).toBeCloseTo(before, 2);
    expect((b.get(DOM) ?? 0) + (b.get(FOR) ?? 0)).toBeCloseTo(0, 2);
  });

  test('a customer with no balance moves without a voucher', async () => {
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance, credit_limit) VALUES ($1, $2, 'CRA Empty', '29', 0, 0)`,
      [CZ, A],
    );
    const r = await moveCustomerReceivableAccount({ businessId: A, customerId: CZ, toAccountId: NORTH, actorId: ownerA });
    expect(r).toMatchObject({ changed: true, transferDate: null, transferredAmount: 0, toAccountId: NORTH });
    expect(r.moveId).not.toBeNull();
    const v = await pool.query(`SELECT 1 FROM ledger_entry_lines WHERE voucher_id = $1`, [r.moveId]);
    expect(v.rows).toHaveLength(0);
  });

  test('a locked period refuses the move and changes nothing', async () => {
    const lock = await pool.query<{ id: string }>(
      `INSERT INTO period_locks (business_id, branch_id, financial_year, period_start, period_end, is_locked, locked_by)
       VALUES ($1, NULL, 'TEST', CURRENT_DATE - 1, CURRENT_DATE, true, $2) RETURNING id`,
      [A, ownerA],
    );
    try {
      await expect(
        moveCustomerReceivableAccount({ businessId: A, customerId: CU, toAccountId: DOM, actorId: ownerA }),
      ).rejects.toMatchObject({ code: 'PERIOD_LOCKED', status: 400 });
    } finally {
      await pool.query(`DELETE FROM period_locks WHERE id = $1`, [lock.rows[0].id]);
    }
    const row = await pool.query(`SELECT receivable_account_id FROM customers WHERE id = $1`, [CU]);
    expect(row.rows[0].receivable_account_id).toBeNull();
    expect((await bal(CU)).get(AR)).toBeCloseTo(300, 2);
  });

  test('other businesses are refused', async () => {
    await expect(
      moveCustomerReceivableAccount({ businessId: A, customerId: customerOfB, toAccountId: DOM, actorId: ownerA }),
    ).rejects.toMatchObject({ status: 404 });
    const arOfB = (await accountByCode(B, '1103')).id;
    await expect(
      moveCustomerReceivableAccount({ businessId: A, customerId: CU, toAccountId: arOfB, actorId: ownerA }),
    ).rejects.toMatchObject({ code: 'RECEIVABLE_ACCOUNT_INVALID' });
  });

  test('an invoice posted while a move is in flight lands in the new account or is transferred', async () => {
    await Promise.all([
      moveCustomerReceivableAccount({ businessId: A, customerId: CU, toAccountId: DOM, actorId: ownerA }),
      invoice('RACE', CU, '2026-10-20', '2026-11-04', 900),
    ]);
    const b = await bal(CU);
    expect(b.get(AR) ?? 0).toBeCloseTo(0, 2);
    expect(b.get(DOM)).toBeCloseTo(300 + 900, 2);
  });

  // --- Task 6: corrections of old documents after a move ---------------------------------------

  test('editing an old invoice after a move leaves the old account settled', async () => {
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance, credit_limit, receivable_account_id)
       VALUES ($1, $2, 'CRA Moved', '29', 0, 0, $3)`,
      [CM, A, DOM],
    );
    await invoice('M1', CM, '2026-10-01', '2026-10-16', 1000);
    doc.payM = (await pay({ type: 'receivable', reference_type: 'invoice', reference_id: inv.M1, amount: 400, payment_date: '2026-10-05' })).id;
    await moveCustomerReceivableAccount({ businessId: A, customerId: CM, toAccountId: FOR, actorId: ownerA });
    expect((await bal(CM)).get(FOR)).toBeCloseTo(600, 2);

    await tx(async (c) => {
      await reverseVoucherLedgerEntries(c, { businessId: A, voucherType: 'invoice', voucherId: inv.M1, reason: 'edit' });
      await createInvoiceLedgerEntries({
        businessId: A, invoiceId: inv.M1, invoiceNumber: `M1-${tag}`, invoiceDate: '2026-10-01', grandTotal: 1200,
        customerId: CM, isCashSale: false, branchId: BR, taxableValue: 1200, poolClient: c,
      });
    });
    const b = await bal(CM);
    expect(b.get(DOM) ?? 0).toBeCloseTo(0, 2);
    expect(b.get(FOR)).toBeCloseTo(1200 - 400, 2);
    // The mirror of the old receivable line is on the old account, dated like the invoice.
    const m1 = await arLines('invoice', inv.M1);
    expect(m1).toHaveLength(3);
    expect(m1).toEqual(
      expect.arrayContaining([
        { account_id: DOM, debit: 1000, credit: 0 },
        { account_id: DOM, debit: 0, credit: 1000 },
        { account_id: FOR, debit: 1200, credit: 0 },
      ]),
    );
  });

  test('cancelling an old invoice after a move takes it out of the new account', async () => {
    await tx((c) => reverseVoucherLedgerEntries(c, { businessId: A, voucherType: 'invoice', voucherId: inv.M1, reason: 'cancel' }));
    const b = await bal(CM);
    expect(b.get(DOM) ?? 0).toBeCloseTo(0, 2);
    expect(b.get(FOR)).toBeCloseTo(-400, 2);
  });

  test('reversing the receipt after a move undoes it in the new account', async () => {
    await tx((c) => reverseVoucherLedgerEntries(c, { businessId: A, voucherType: 'payment', voucherId: doc.payM, reason: 'reversed' }));
    const b = await bal(CM);
    expect(b.get(FOR) ?? 0).toBeCloseTo(0, 2);
    expect(b.get(DOM) ?? 0).toBeCloseTo(0, 2);
  });

  test('a voucher with no customer mirrors on the original accounts', async () => {
    const vid = randomUUID();
    const cash = (await accountByCode(A, '1101')).id;
    await tx((c) =>
      insertVoucherLines(c, {
        businessId: A, branchId: null, voucherId: vid, voucherType: 'journal', entryDate: '2026-10-10', reference: 'J',
        lines: [
          { accountId: DOM, debit: 10, credit: 0, narration: 'j' },
          { accountId: cash, debit: 0, credit: 10, narration: 'j' },
        ],
      }),
    );
    await tx((c) => reverseVoucherLedgerEntries(c, { businessId: A, voucherType: 'journal', voucherId: vid, reason: 'undo' }));
    const rows = await pool.query<{ account_id: string; n: number }>(
      `SELECT account_id, SUM(debit - credit)::float AS n FROM ledger_entry_lines WHERE voucher_id = $1 GROUP BY account_id`,
      [vid],
    );
    expect(rows.rows.map((r) => r.account_id).sort()).toEqual([DOM, cash].sort());
    expect(rows.rows.every((r) => Math.abs(r.n) < 0.005)).toBe(true);
  });

  test('a reversed line on an old account is carried to the account the customer posts to now', async () => {
    await tx((c) => reverseVoucherLedgerEntries(c, { businessId: A, voucherType: 'debit_note', voucherId: doc.dn, reason: 'cancel' }));
    // The mirror stays on the original account (the database requires an exact mirror) ...
    expect(await arLines('debit_note', doc.dn)).toEqual([
      { account_id: DOM, debit: 50, credit: 0 },
      { account_id: DOM, debit: 0, credit: 50 },
    ]);
    // ... and a correction carries it to the control account, where CD posts by now.
    const correction = await pool.query<{ id: string; to_account_id: string; amount: number; source_voucher_id: string }>(
      `SELECT id, to_account_id, transferred_amount::float AS amount, source_voucher_id
         FROM customer_receivable_account_moves
        WHERE customer_id = $1 AND kind = 'correction' AND source_voucher_type = 'debit_note'`,
      [CD],
    );
    expect(correction.rows).toHaveLength(1);
    expect(correction.rows[0]).toMatchObject({ to_account_id: AR, amount: -50, source_voucher_id: doc.dn });
    expect(await arLines('receivable_transfer', correction.rows[0].id)).toEqual(
      expect.arrayContaining([
        { account_id: DOM, debit: 50, credit: 0 },
        { account_id: AR, debit: 0, credit: 50 },
      ]),
    );
    const b = await bal(CD);
    expect(b.get(DOM) ?? 0).toBeCloseTo(0, 2);
    expect(b.get(AR)).toBeCloseTo(before - 50, 2);
  });

  // --- Task 7: reports read every receivable account -------------------------------------------

  test('aging, statement and balance sheet agree with the ledger across all receivable accounts', async () => {
    const ledger = await pool.query<{ n: number }>(
      `SELECT COALESCE(SUM(debit - credit), 0)::float AS n FROM ledger_entry_lines
        WHERE business_id = $1 AND account_id = ANY($2::uuid[])`,
      [A, [AR, DOM, NORTH, FOR]],
    );
    const total = ledger.rows[0].n;
    expect(total).toBeGreaterThan(0);
    // Balances sit in more than one receivable account, so a single-account reader cannot agree.
    expect((await ledgerNet(AR)) !== total).toBe(true);

    session(ownerA, A);
    const aging = await call(agingReceivables, 'GET', '/api/reports/aging/receivables?as_on_date=2026-12-31', null);
    expect(aging.status).toBe(200);
    expect(aging.json.gl_balance).toBeCloseTo(total, 2);
    expect(aging.json.totals.total_outstanding + aging.json.totals.on_account).toBeCloseTo(total, 2);

    const bs = await call(getBalanceSheet, 'GET', '/api/reports/balance-sheet?as_on_date=2026-12-31', null);
    expect(bs.status).toBe(200);
    expect(bs.json.assets.current.receivables).toBeCloseTo(total, 2);
    expect(bs.json.is_balanced).toBe(true);

    const statement = await call(
      getPartyStatement, 'GET',
      `/api/reports/party/statement?party_type=customer&party_id=${CD}&from_date=2026-04-01&to_date=2026-12-31`,
      null,
    );
    expect(statement.status).toBe(200);
    const b = await bal(CD);
    const owed = [AR, DOM, NORTH, FOR].reduce((sum, id) => sum + (b.get(id) ?? 0), 0);
    expect(statement.json.closing_balance).toBeCloseTo(owed, 2);
    const rows = statement.json.transactions as Array<{ transaction_type: string; description: string }>;
    expect(rows.some((r) => r.transaction_type === 'receivable_transfer')).toBe(false);
    // The invoice is a credit sale; it must not be shown a second time as a cash sale.
    expect(rows.filter((r) => r.description === 'Sale (cash)')).toHaveLength(0);
  });

  // --- Task 8: accounts that customers use are protected ---------------------------------------

  test('an account in use cannot be deactivated or moved out from under receivables', async () => {
    session(ownerA, A); // CF and CM post to FOR; CU posts to DOM; CZ posts to NORTH (under DOM)
    const off = await call(patchAccount, 'PATCH', `/api/accounts/${FOR}`, { is_active: false }, FOR);
    expect(off).toMatchObject({ status: 400, json: { code: 'ACCOUNT_IN_USE_BY_CUSTOMERS' } });
    expect(off.json.error).toMatch(/2 customers/);
    const del = await call(deleteAccount, 'DELETE', `/api/accounts/${FOR}`, null, FOR);
    expect(del).toMatchObject({ status: 400, json: { code: 'ACCOUNT_IN_USE_BY_CUSTOMERS' } });
    const out = await call(patchAccount, 'PATCH', `/api/accounts/${DOM}`, { parent_account_id: null }, DOM);
    expect(out).toMatchObject({ status: 400, json: { code: 'ACCOUNT_IN_USE_BY_CUSTOMERS' } });
    const within = await call(patchAccount, 'PATCH', `/api/accounts/${NORTH}`, { parent_account_id: FOR }, NORTH);
    expect(within.status).toBe(200);
    const back = await call(patchAccount, 'PATCH', `/api/accounts/${NORTH}`, { parent_account_id: DOM }, NORTH);
    expect(back.status).toBe(200); // later tests expect NORTH under DOM
    const still = await pool.query<{ id: string; is_active: boolean; parent_account_id: string | null }>(
      `SELECT id, is_active, parent_account_id FROM accounts WHERE id = ANY($1::uuid[])`,
      [[FOR, DOM, NORTH]],
    );
    const byId = new Map(still.rows.map((r) => [r.id, r]));
    expect(byId.get(FOR)).toMatchObject({ is_active: true, parent_account_id: AR });
    expect(byId.get(DOM)).toMatchObject({ is_active: true, parent_account_id: AR });
    expect(byId.get(NORTH)).toMatchObject({ parent_account_id: DOM });
  });

  test('an unused sub-account can still be deactivated and deleted', async () => {
    const spare = await subAccount('CRS', 'Spare Debtors', AR);
    session(ownerA, A);
    const off = await call(patchAccount, 'PATCH', `/api/accounts/${spare}`, { is_active: false }, spare);
    expect(off.status).toBe(200);
    const del = await call(deleteAccount, 'DELETE', `/api/accounts/${spare}`, null, spare);
    expect(del.status).toBe(200);
  });

  // --- Task 9: customer API --------------------------------------------------------------------

  test('the move endpoint previews, then moves, with the session business only', async () => {
    session(ownerA, A);
    const preview = await call(postMove, 'POST', `/api/customers/${CF}/receivable-account`, { receivable_account_id: DOM, dry_run: true }, CF);
    expect(preview.status).toBe(200);
    const amount = preview.json.result.transferredAmount;
    expect(amount).toBeCloseTo(1500, 2);
    expect((await pool.query(`SELECT receivable_account_id FROM customers WHERE id = $1`, [CF])).rows[0].receivable_account_id).toBe(FOR);

    // A business_id in the body is ignored: the session decides.
    const done = await call(postMove, 'POST', `/api/customers/${CF}/receivable-account`, { receivable_account_id: DOM, business_id: B }, CF);
    expect(done.status).toBe(200);
    expect(done.json.result).toMatchObject({ changed: true, toAccountId: DOM, transferredAmount: amount });
    const move = await pool.query(`SELECT created_by, kind FROM customer_receivable_account_moves WHERE id = $1`, [done.json.result.moveId]);
    expect(move.rows[0]).toMatchObject({ created_by: ownerA, kind: 'move' });

    const bad = await call(postMove, 'POST', `/api/customers/${CF}/receivable-account`, { receivable_account_id: 'not-an-id' }, CF);
    expect(bad).toMatchObject({ status: 400, json: { code: 'RECEIVABLE_ACCOUNT_INVALID' } });

    session(ownerB, B);
    const foreign = await call(postMove, 'POST', `/api/customers/${CF}/receivable-account`, { receivable_account_id: null }, CF);
    expect(foreign.status).toBe(404);
    expect((await pool.query(`SELECT receivable_account_id FROM customers WHERE id = $1`, [CF])).rows[0].receivable_account_id).toBe(DOM);
  });

  test('bulk move reports each customer and does not stop at a failure', async () => {
    session(ownerA, A);
    const r = await call(postBulk, 'POST', '/api/customers/receivable-account', {
      customer_ids: [CU, customerOfB, CZ],
      receivable_account_id: FOR,
    });
    expect(r.status).toBe(200);
    const byId = new Map<string, any>((r.json.results as any[]).map((x) => [x.customer_id, x]));
    expect(byId.get(CU)).toMatchObject({ ok: true });
    expect(byId.get(CU).transferred_amount).toBeCloseTo(1200, 2);
    expect(byId.get(customerOfB)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(byId.get(CZ)).toMatchObject({ ok: true, transferred_amount: 0 });
    const stored = await pool.query<{ id: string; receivable_account_id: string | null }>(
      `SELECT id, receivable_account_id FROM customers WHERE id = ANY($1::uuid[])`,
      [[CU, CZ, customerOfB]],
    );
    const acct = new Map(stored.rows.map((x) => [x.id, x.receivable_account_id]));
    expect(acct.get(CU)).toBe(FOR);
    expect(acct.get(CZ)).toBe(FOR);
    expect(acct.get(customerOfB)).toBeNull();

    const many = await call(postBulk, 'POST', '/api/customers/receivable-account', {
      customer_ids: Array.from({ length: 501 }, () => randomUUID()),
      receivable_account_id: null,
    });
    expect(many).toMatchObject({ status: 400, json: { code: 'TOO_MANY_CUSTOMERS' } });
    const badTarget = await call(postBulk, 'POST', '/api/customers/receivable-account', {
      customer_ids: [CU],
      receivable_account_id: (await accountByCode(A, '1101')).id,
    });
    expect(badTarget).toMatchObject({ status: 400, json: { code: 'RECEIVABLE_ACCOUNT_INVALID' } });
  });

  test('create with an account, list filter, detail, and the account list', async () => {
    session(ownerA, A);
    const created = await call(postCustomer, 'POST', '/api/customers', {
      name: `CRA New ${tag}`,
      receivable_account_id: NORTH,
      opening_balance: 250,
      opening_balance_type: 'debit',
    });
    expect([200, 201]).toContain(created.status);
    const id = created.json.customer.id as string;
    expect(created.json.customer.receivable_account_id).toBe(NORTH);
    expect((await arLines('opening_balance', id))[0]).toMatchObject({ account_id: NORTH, debit: 250 });

    const asDefault = await call(postCustomer, 'POST', '/api/customers', { name: `CRA Default ${tag}`, receivable_account_id: AR });
    expect([200, 201]).toContain(asDefault.status);
    expect(asDefault.json.customer.receivable_account_id ?? null).toBeNull();

    const bad = await call(postCustomer, 'POST', '/api/customers', {
      name: `CRA Bad ${tag}`,
      receivable_account_id: (await accountByCode(A, '1101')).id,
    });
    expect(bad).toMatchObject({ status: 400, json: { code: 'RECEIVABLE_ACCOUNT_INVALID' } });
    expect((await pool.query(`SELECT 1 FROM customers WHERE business_id = $1 AND name = $2`, [A, `CRA Bad ${tag}`])).rows).toHaveLength(0);

    const underDom = await call(getCustomers, 'GET', `/api/customers?receivable_account_id=${DOM}&limit=500`, null);
    expect(underDom.status).toBe(200);
    const domIds = (underDom.json.customers as any[]).map((c) => c.id);
    expect(domIds).toContain(id); // NORTH is under DOM
    expect(domIds).toContain(CF);
    expect(domIds).not.toContain(CU);
    const onDefault = await call(getCustomers, 'GET', `/api/customers?receivable_account_id=${AR}&limit=500`, null);
    const defaultIds = (onDefault.json.customers as any[]).map((c) => c.id);
    expect(defaultIds).toContain(CD);
    expect(defaultIds).not.toContain(CF);
    const badFilter = await call(getCustomers, 'GET', `/api/customers?receivable_account_id=${(await accountByCode(A, '1101')).id}`, null);
    expect(badFilter).toMatchObject({ status: 400, json: { code: 'RECEIVABLE_ACCOUNT_INVALID' } });

    const detail = await call(getCustomer, 'GET', `/api/customers/${CF}`, null, CF);
    expect(detail.status).toBe(200);
    expect(detail.json.customer.receivable_account).toMatchObject({ id: DOM });
    const moves = detail.json.customer.receivable_account_moves as any[];
    expect(moves.length).toBeGreaterThanOrEqual(1);
    expect(moves[0]).toMatchObject({ to_account_id: DOM });
    expect(moves[0].transferred_amount).toBeCloseTo(1500, 2);
    const plain = await call(getCustomer, 'GET', `/api/customers/${CD}`, null, CD);
    expect(plain.json.customer.receivable_account).toMatchObject({ id: AR });
    // Corrections are bookkeeping, not changes of account: they are not listed.
    expect((plain.json.customer.receivable_account_moves as any[]).every((m) => m.kind === undefined || m.kind === 'move')).toBe(true);
    expect((plain.json.customer.receivable_account_moves as any[]).some((m) => m.transferred_amount === -50)).toBe(false);

    const list = await call(getReceivableAccounts, 'GET', '/api/customers/receivable-accounts', null);
    expect(list.status).toBe(200);
    expect(list.json.control_account_id).toBe(AR);
    expect((list.json.accounts as any[]).map((a) => a.id)).toEqual(expect.arrayContaining([AR, DOM, NORTH, FOR]));
    session(ownerB, B);
    const other = await call(getReceivableAccounts, 'GET', '/api/customers/receivable-accounts', null);
    expect((other.json.accounts as any[]).map((a) => a.id)).not.toContain(DOM);
  });

  test('before migration 468 is applied, posting uses the control account and does not fail', async () => {
    const spy = jest.spyOn(receivableSchema, 'hasCustomerReceivableAccounts').mockResolvedValue(false);
    try {
      expect(await resolveCustomerReceivableAccountId(A, CF)).toBe(AR);
      session(ownerA, A);
      const list = await call(getReceivableAccounts, 'GET', '/api/customers/receivable-accounts', null);
      expect(list.json).toMatchObject({ available: false, accounts: [] });
      const move = await call(postMove, 'POST', `/api/customers/${CF}/receivable-account`, { receivable_account_id: null }, CF);
      expect(move).toMatchObject({ status: 400, json: { code: 'RECEIVABLE_ACCOUNTS_UNAVAILABLE' } });
    } finally {
      spy.mockRestore();
    }
    expect(await resolveCustomerReceivableAccountId(A, CF)).toBe(DOM);
  });

  // --- Task 10: aging by receivable account ----------------------------------------------------

  test('aging carries the account, filters by it, and subtotals add up', async () => {
    session(ownerA, A);
    const all = await call(agingReceivables, 'GET', '/api/reports/aging/receivables?as_on_date=2026-12-31', null);
    expect(all.status).toBe(200);
    const rows = all.json.aging as any[];
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every((r) => typeof r.receivable_account_id === 'string' && typeof r.receivable_account_name === 'string')).toBe(true);
    expect(rows.find((r) => r.party_id === CF)).toMatchObject({ receivable_account_id: DOM });
    expect(rows.find((r) => r.party_id === CU)).toMatchObject({ receivable_account_id: FOR });
    expect(rows.find((r) => r.party_id === CD)).toMatchObject({ receivable_account_id: AR });

    const byAccount = all.json.by_account as any[];
    expect(byAccount.length).toBeGreaterThanOrEqual(3);
    const sub = byAccount.reduce((sum, a) => sum + a.total_outstanding, 0);
    expect(sub).toBeCloseTo(all.json.totals.total_outstanding, 2);
    expect(byAccount.find((a) => a.account_id === FOR).total_outstanding).toBeCloseTo(
      rows.filter((r) => r.receivable_account_id === FOR).reduce((sum, r) => sum + r.total_outstanding, 0),
      2,
    );

    const dom = await call(agingReceivables, 'GET', `/api/reports/aging/receivables?as_on_date=2026-12-31&receivable_account_id=${DOM}`, null);
    const domRows = dom.json.aging as any[];
    expect(domRows.length).toBeGreaterThanOrEqual(2); // CF on DOM, the new customer on NORTH
    expect(domRows.every((r) => [DOM, NORTH].includes(r.receivable_account_id))).toBe(true);
    expect(dom.json.totals.total_outstanding).toBeCloseTo(
      domRows.reduce((sum, r) => sum + r.total_outstanding, 0),
      2,
    );
    // The ledger figure is for all receivables, whatever the filter.
    expect(dom.json.gl_balance).toBeCloseTo(all.json.gl_balance, 2);

    const onDefault = await call(agingReceivables, 'GET', `/api/reports/aging/receivables?as_on_date=2026-12-31&receivable_account_id=${AR}`, null);
    expect((onDefault.json.aging as any[]).every((r) => r.receivable_account_id === AR)).toBe(true);
    expect((onDefault.json.aging as any[]).some((r) => r.party_id === CD)).toBe(true);

    const cash = (await accountByCode(A, '1101')).id;
    const bad = await call(agingReceivables, 'GET', `/api/reports/aging/receivables?as_on_date=2026-12-31&receivable_account_id=${cash}`, null);
    expect(bad).toMatchObject({ status: 400, json: { code: 'RECEIVABLE_ACCOUNT_INVALID' } });
  });

  // --- Final review: paths the first pass missed ------------------------------------------------

  test('amending the date of an old invoice after a move keeps it in the new account', async () => {
    const CQ = await newCustomer('CRA Amend', DOM);
    const id = await invoice('Q1', CQ, '2026-10-21', '2026-11-05', 1000);
    await moveCustomerReceivableAccount({ businessId: A, customerId: CQ, toAccountId: FOR, actorId: ownerA });
    session(ownerA, A);
    for (const date of ['2026-10-22', '2026-10-23']) {
      const res = await call(amendInvoice, 'PATCH', `/api/invoices/${id}/amend`, { invoice_date: date, due_date: '2026-11-05' }, id);
      if (res.status !== 200) throw new Error(`amend ${date}: ${res.status} ${JSON.stringify(res.json)}`);
      const b = await bal(CQ);
      expect(b.get(DOM) ?? 0).toBeCloseTo(0, 2);
      expect(b.get(FOR)).toBeCloseTo(1000, 2);
    }
  });

  test('a customer who was never moved gets no correction, whatever account the old line is on', async () => {
    // The account was changed directly, as an old mapping change would: no move, nothing was transferred.
    const CG = await newCustomer('CRA Never moved', DOM);
    const id = await invoice('G1', CG, '2026-10-21', '2026-11-05', 400);
    await pool.query(`UPDATE customers SET receivable_account_id = NULL WHERE id = $1`, [CG]);
    await tx((c) => reverseVoucherLedgerEntries(c, { businessId: A, voucherType: 'invoice', voucherId: id, reason: 'cancel' }));
    expect(await arLines('invoice', id)).toEqual([
      { account_id: DOM, debit: 400, credit: 0 },
      { account_id: DOM, debit: 0, credit: 400 },
    ]);
    const rows = await pool.query(`SELECT 1 FROM customer_receivable_account_moves WHERE customer_id = $1`, [CG]);
    expect(rows.rows).toHaveLength(0);
    expect((await bal(CG)).size).toBe(0);
  });

  test('a line posted after the last move, on another account, is mirrored in place', async () => {
    // The customer was moved to FOR; FOR was then unusable for a while, so an invoice went to
    // Accounts Receivable. That line was never transferred, so its reversal needs no correction.
    const CL = await newCustomer('CRA Late line', DOM);
    await invoice('L0', CL, '2026-10-21', '2026-11-05', 100);
    await moveCustomerReceivableAccount({ businessId: A, customerId: CL, toAccountId: FOR, actorId: ownerA });
    await pool.query(`UPDATE accounts SET is_active = false WHERE id = $1`, [FOR]);
    let late = '';
    try {
      late = await invoice('L1', CL, '2026-10-22', '2026-11-06', 250);
    } finally {
      await pool.query(`UPDATE accounts SET is_active = true WHERE id = $1`, [FOR]);
    }
    expect((await arLines('invoice', late))[0].account_id).toBe(AR);
    await tx((c) => reverseVoucherLedgerEntries(c, { businessId: A, voucherType: 'invoice', voucherId: late, reason: 'cancel' }));
    const b = await bal(CL);
    expect(b.get(AR) ?? 0).toBeCloseTo(0, 2);
    expect(b.get(FOR)).toBeCloseTo(100, 2);
  });

  test('reversing a receipt through the payment reversal service after a move lands in the new account', async () => {
    const CP = await newCustomer('CRA Receipt reversal', DOM);
    const id = await invoice('P1', CP, '2026-10-21', '2026-11-05', 800);
    const payment = await pay({ type: 'receivable', reference_type: 'invoice', reference_id: id, amount: 300, payment_date: '2026-10-25' });
    await moveCustomerReceivableAccount({ businessId: A, customerId: CP, toAccountId: FOR, actorId: ownerA });
    expect((await bal(CP)).get(FOR)).toBeCloseTo(500, 2);
    await tx(async (c) => {
      const plan = await assessPaymentReversal(c, A, payment.id, { lock: true });
      await executePaymentReversal(c, plan, {
        businessId: A, actorId: ownerA, reason: 'cheque bounced', reversalDate: await currentReversalDate(c),
      });
    });
    const b = await bal(CP);
    expect(b.get(DOM) ?? 0).toBeCloseTo(0, 2);
    expect(b.get(FOR)).toBeCloseTo(800, 2);
  });

  test('a balance in two branches is transferred branch by branch', async () => {
    const BR2 = randomUUID();
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Second', '29', false, false, true)`,
      [BR2, A],
    );
    const CT = await newCustomer('CRA Two branches', DOM);
    await invoice('T1', CT, '2026-10-21', '2026-11-05', 500, BR);
    await invoice('T2', CT, '2026-10-21', '2026-11-05', 300, BR2);
    const r = await moveCustomerReceivableAccount({ businessId: A, customerId: CT, toAccountId: FOR, actorId: ownerA });
    expect(r.transferredAmount).toBeCloseTo(800, 2);
    expect(r.transfers).toEqual([{ fromAccountId: DOM, amount: 800 }]);
    const lines = await pool.query<{ branch_id: string; account_id: string; net: number }>(
      `SELECT branch_id, account_id, SUM(debit - credit)::float AS net FROM ledger_entry_lines
        WHERE business_id = $1 AND voucher_type = 'receivable_transfer' AND voucher_id = $2
        GROUP BY branch_id, account_id`,
      [A, r.moveId],
    );
    const net = (branch: string, account: string) =>
      lines.rows.find((l) => l.branch_id === branch && l.account_id === account)?.net;
    expect(net(BR, FOR)).toBeCloseTo(500, 2);
    expect(net(BR, DOM)).toBeCloseTo(-500, 2);
    expect(net(BR2, FOR)).toBeCloseTo(300, 2);
    expect(net(BR2, DOM)).toBeCloseTo(-300, 2);
  });

  test('two invoices for one customer saved at the same moment both post', async () => {
    const CC = await newCustomer('CRA Concurrent', DOM);
    await Promise.all([
      invoice('X1', CC, '2026-10-21', '2026-11-05', 110),
      invoice('X2', CC, '2026-10-21', '2026-11-05', 220),
      invoice('X3', CC, '2026-10-21', '2026-11-05', 330),
    ]);
    expect((await bal(CC)).get(DOM)).toBeCloseTo(660, 2);
  });

  test('before migration 468 a reversal mirrors in place and posts no correction', async () => {
    const CH = await newCustomer('CRA Guard', DOM);
    const id = await invoice('H1', CH, '2026-10-21', '2026-11-05', 200);
    await moveCustomerReceivableAccount({ businessId: A, customerId: CH, toAccountId: FOR, actorId: ownerA });
    const spy = jest.spyOn(receivableSchema, 'hasCustomerReceivableAccounts').mockResolvedValue(false);
    try {
      await tx((c) => reverseVoucherLedgerEntries(c, { businessId: A, voucherType: 'invoice', voucherId: id, reason: 'cancel' }));
    } finally {
      spy.mockRestore();
    }
    expect(await arLines('invoice', id)).toEqual([
      { account_id: DOM, debit: 200, credit: 0 },
      { account_id: DOM, debit: 0, credit: 200 },
    ]);
    const corrections = await pool.query(
      `SELECT 1 FROM customer_receivable_account_moves WHERE customer_id = $1 AND kind = 'correction'`,
      [CH],
    );
    expect(corrections.rows).toHaveLength(0);
  });

  test('mapping receivables to another account keeps the category accounts and their balances', async () => {
    session(ownerA, A);
    const before = await call(agingReceivables, 'GET', '/api/reports/aging/receivables?as_on_date=2026-12-31', null);
    // The balance sheet is for the default branch, so it is compared with itself, not with aging.
    const bsBefore = await call(getBalanceSheet, 'GET', '/api/reports/balance-sheet?as_on_date=2026-12-31', null);
    expect(bsBefore.json.assets.current.receivables).toBeGreaterThan(0);
    const other = await call(postAccount, 'POST', '/api/accounts', {
      account_code: `CRX${tag}`,
      account_name: `Other receivables ${tag}`,
      account_type: 'asset',
      account_group_id: await groupId(A, '1100'),
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    expect(other.status).toBe(201);
    const X = other.json.account.id as string;
    await updateAccountMappings(A, { accounts_receivable_account_id: X });
    try {
      expect(new Set(await receivableAccountIds(A))).toEqual(new Set([X, AR, DOM, NORTH, FOR]));
      // Customers keep their category; only customers with none follow the mapping.
      expect(await resolveCustomerReceivableAccountId(A, CF)).toBe(DOM);
      expect(await resolveCustomerReceivableAccountId(A, CD)).toBe(X);
      const after = await call(agingReceivables, 'GET', '/api/reports/aging/receivables?as_on_date=2026-12-31', null);
      expect(after.json.gl_balance).toBeCloseTo(before.json.gl_balance, 2);
      expect(after.json.totals.total_outstanding).toBeCloseTo(before.json.totals.total_outstanding, 2);
      const bs = await call(getBalanceSheet, 'GET', '/api/reports/balance-sheet?as_on_date=2026-12-31', null);
      expect(bs.json.assets.current.receivables).toBeCloseTo(bsBefore.json.assets.current.receivables, 2);
    } finally {
      await updateAccountMappings(A, { accounts_receivable_account_id: AR });
    }
    expect(await resolveCustomerReceivableAccountId(A, CD)).toBe(AR);
  });

  // --- Editing an opening balance re-posts the ledger -------------------------------------------

  /** Debit minus credit of a party's opening-balance voucher on one account. */
  async function openingNet(partyId: string, accountId: string): Promise<number> {
    const res = await pool.query<{ n: number }>(
      `SELECT COALESCE(SUM(debit - credit), 0)::float AS n FROM ledger_entry_lines
        WHERE business_id = $1 AND voucher_type = 'opening_balance' AND voucher_id = $2 AND account_id = $3`,
      [A, partyId, accountId],
    );
    return res.rows[0].n;
  }

  async function openingVoucherBalanced(partyId: string): Promise<boolean> {
    const res = await pool.query<{ n: number }>(
      `SELECT COALESCE(SUM(debit - credit), 0)::float AS n FROM ledger_entry_lines
        WHERE business_id = $1 AND voucher_type = 'opening_balance' AND voucher_id = $2`,
      [A, partyId],
    );
    return Math.abs(res.rows[0].n) < 0.005;
  }

  test('editing a customer opening balance re-posts it in the ledger', async () => {
    session(ownerA, A);
    const created = await call(postCustomer, 'POST', '/api/customers', {
      name: `CRA Opening edit ${tag}`, opening_balance: 5000, opening_balance_type: 'debit',
    });
    expect([200, 201]).toContain(created.status);
    const id = created.json.customer.id as string;
    expect(await openingNet(id, AR)).toBeCloseTo(5000, 2);

    const lower = await call(putCustomer, 'PUT', `/api/customers/${id}`, { opening_balance: 3000 }, id);
    expect(lower.status).toBe(200);
    expect(await openingNet(id, AR)).toBeCloseTo(3000, 2);
    expect((await bal(id)).get(AR)).toBeCloseTo(3000, 2);
    expect(await openingVoucherBalanced(id)).toBe(true);

    const credit = await call(putCustomer, 'PUT', `/api/customers/${id}`, { opening_balance_type: 'credit' }, id);
    expect(credit.status).toBe(200);
    expect(await openingNet(id, AR)).toBeCloseTo(-3000, 2);

    const zero = await call(putCustomer, 'PUT', `/api/customers/${id}`, { opening_balance: 0 }, id);
    expect(zero.status).toBe(200);
    expect(await openingNet(id, AR)).toBeCloseTo(0, 2);
    expect((await bal(id)).size).toBe(0);
    const stored = await pool.query(`SELECT opening_balance::float AS ob, opening_balance_type AS t FROM customers WHERE id = $1`, [id]);
    expect(stored.rows[0]).toMatchObject({ ob: 0, t: 'credit' });

    // A name change alone leaves the ledger alone.
    const linesBefore = await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE business_id = $1`, [A]);
    const rename = await call(putCustomer, 'PUT', `/api/customers/${id}`, { name: `CRA Opening renamed ${tag}` }, id);
    expect(rename.status).toBe(200);
    const linesAfter = await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE business_id = $1`, [A]);
    expect(linesAfter.rows[0].n).toBe(linesBefore.rows[0].n);
  });

  test('a customer created with no opening balance gets one posted when it is entered later', async () => {
    session(ownerA, A);
    const created = await call(postCustomer, 'POST', '/api/customers', {
      name: `CRA Opening later ${tag}`, receivable_account_id: NORTH,
    });
    const id = created.json.customer.id as string;
    expect(await openingNet(id, NORTH)).toBeCloseTo(0, 2);
    const set = await call(putCustomer, 'PUT', `/api/customers/${id}`, { opening_balance: 700, opening_balance_type: 'debit' }, id);
    expect(set.status).toBe(200);
    expect(await openingNet(id, NORTH)).toBeCloseTo(700, 2);
    expect(await openingVoucherBalanced(id)).toBe(true);
  });

  test('editing the opening balance of a customer who was moved leaves the old account settled', async () => {
    session(ownerA, A);
    const created = await call(postCustomer, 'POST', '/api/customers', {
      name: `CRA Opening moved ${tag}`, receivable_account_id: DOM, opening_balance: 600, opening_balance_type: 'debit',
    });
    const id = created.json.customer.id as string;
    await moveCustomerReceivableAccount({ businessId: A, customerId: id, toAccountId: FOR, actorId: ownerA });
    expect((await bal(id)).get(FOR)).toBeCloseTo(600, 2);

    const raised = await call(putCustomer, 'PUT', `/api/customers/${id}`, { opening_balance: 900 }, id);
    expect(raised.status).toBe(200);
    let b = await bal(id);
    expect(b.get(DOM) ?? 0).toBeCloseTo(0, 2);
    expect(b.get(FOR)).toBeCloseTo(900, 2);

    const lowered = await call(putCustomer, 'PUT', `/api/customers/${id}`, { opening_balance: 100 }, id);
    expect(lowered.status).toBe(200);
    b = await bal(id);
    expect(b.get(DOM) ?? 0).toBeCloseTo(0, 2);
    expect(b.get(FOR)).toBeCloseTo(100, 2);
    expect(await openingVoucherBalanced(id)).toBe(true);
  });

  test('an opening balance cannot be edited once the customer has an invoice, and the ledger is untouched', async () => {
    session(ownerA, A);
    const before = await openingNet(doc.CO, NORTH);
    await invoice('OB1', doc.CO, '2026-10-21', '2026-11-05', 50);
    const refused = await call(putCustomer, 'PUT', `/api/customers/${doc.CO}`, { opening_balance: 1 }, doc.CO);
    expect(refused).toMatchObject({ status: 400, json: { code: 'OPENING_BALANCE_LOCKED' } });
    expect(await openingNet(doc.CO, NORTH)).toBeCloseTo(before, 2);
  });

  test('a supplier opening balance is re-posted when it changes', async () => {
    const payable = (await accountByCode(A, '2101')).id;
    const SUP = randomUUID();
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, current_balance, opening_balance, opening_balance_type)
       VALUES ($1, $2, 'CRA Supplier', '29', 0, 400, 'credit')`,
      [SUP, A],
    );
    await postOpeningBalanceLedgerEntry({
      businessId: A, entityType: 'supplier', entityId: SUP, entityName: 'CRA Supplier', openingBalance: 400, openingBalanceType: 'credit',
    });
    expect(await openingNet(SUP, payable)).toBeCloseTo(-400, 2);

    // PUT /api/suppliers/[id] cannot run on this database (its UPDATE names suppliers.notes, which
    // kh_phase2_test does not have), so the function the route calls is exercised directly.
    await setPartyOpeningBalance({
      businessId: A, entityType: 'supplier', entityId: SUP, entityName: 'CRA Supplier', amount: 250, type: 'credit',
    });
    expect(await openingNet(SUP, payable)).toBeCloseTo(-250, 2);
    expect(await openingVoucherBalanced(SUP)).toBe(true);
    await setPartyOpeningBalance({
      businessId: A, entityType: 'supplier', entityId: SUP, entityName: 'CRA Supplier', amount: 250, type: 'debit',
    });
    expect(await openingNet(SUP, payable)).toBeCloseTo(250, 2);
    await setPartyOpeningBalance({
      businessId: A, entityType: 'supplier', entityId: SUP, entityName: 'CRA Supplier', amount: 0, type: 'credit',
    });
    expect(await openingNet(SUP, payable)).toBeCloseTo(0, 2);
    expect(await openingVoucherBalanced(SUP)).toBe(true);
  });

  test('the books stay balanced', async () => {
    const t = await pool.query<{ d: number; c: number }>(
      `SELECT SUM(debit)::float AS d, SUM(credit)::float AS c FROM ledger_entry_lines WHERE business_id = $1`,
      [A],
    );
    expect(t.rows[0].d).toBeCloseTo(t.rows[0].c, 2);
  });
});
