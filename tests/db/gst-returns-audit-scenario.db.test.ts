/**
 * GST returns audit scenario: one Karnataka business, every common supply / inward case for
 * September 2026, documents created through the real invoice / credit-note / purchase routes, then
 * GSTR-1, GSTR-3B, GSTR-9 and the GSTR-2B reconciliation are generated and compared with the figures
 * a return preparer would file by hand.
 *
 * It is an audit harness: each expectation is recorded as pass / fail with the law it rests on, and
 * the whole list is printed (and written to GST_AUDIT_OUT when set). It does not fail on a finding.
 * Opt-in, disposable DB only:
 *   PHASE2_TEST_DATABASE_URL=postgresql://…/kh_phase2_test npx jest tests/db/gst-returns-audit-scenario.db.test.ts --runInBand
 */
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn() }));
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/enforce-access', () => ({
  ...jest.requireActual('@/lib/enforce-access'),
  enforceAccess: jest.fn().mockResolvedValue(undefined),
  enforceAccessErrorResponse: jest.fn(() => null),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
  assertReportAccess: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/backdate-controls', () => ({
  ...jest.requireActual('@/lib/backdate-controls'),
  hasBackdateApprovalPermission: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/lib/activity-logger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  getClientIP: jest.fn(() => null),
  getUserAgent: jest.fn(() => null),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { POST as postInvoice } from '@/app/api/invoices/route';
import { PATCH as cancelInvoice } from '@/app/api/invoices/[id]/cancel/route';
import { POST as postCreditNote } from '@/app/api/credit-notes/route';
import { POST as postPurchase } from '@/app/api/purchases/route';
import { GET as gstr1Route } from '@/app/api/reports/gst/gstr1/route';
import { GSTR1Generator } from '@/lib/gst/gstr1';
import { GSTR3BGenerator } from '@/lib/gst/gstr3b';
import { GSTR9Generator } from '@/lib/gst/gstr9';
import { GSTR2BReconciliationEngine } from '@/lib/gst/gstr2b-reconciliation';
import { fillTable51 } from '@/lib/gst/gstr3b-table51';

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Appends the GSTN check character to a 14-character GSTIN body. */
function gstin(body: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(body[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return body + CHARS[(36 - (sum % 36)) % 36];
}

type Check = { area: string; case: string; law: string; expected: unknown; actual: unknown; pass: boolean };

d('GST returns audit scenario (real DB)', () => {
  jest.setTimeout(300000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const BR2 = randomUUID();
  const U = randomUUID();
  const tag = B.slice(0, 6).toUpperCase();
  const BIZ_GSTIN = gstin('29AAGCQ4321A1Z');
  const C = {
    REG_KA: randomUUID(), REG_MH: randomUUID(), URP_KA: randomUUID(), URP_MH: randomUUID(),
    FOREIGN: randomUUID(), SEZ_MH: randomUUID(),
  };
  const GST = { REG_KA: gstin('29AABCK1111A1Z'), REG_MH: gstin('27AABCM2222B1Z'), SEZ_MH: gstin('27AABCS3333C1Z') };
  const V = { KA: randomUUID(), MH: randomUUID(), URD: randomUUID() };
  const VGST = { KA: gstin('29AACCV4444D1Z'), MH: gstin('27AACCV5555E1Z') };
  const I = { WIDGET: randomUUID(), GADGET: randomUUID(), RICE: randomUUID(), CONSULT: randomUUID() };
  const inv: Record<string, string> = {};
  const bill: Record<string, string> = {};
  const setupErrors: string[] = [];
  const checks: Check[] = [];
  const out: Record<string, unknown> = {};

  const near = (a: unknown, b: unknown) =>
    typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.6 : JSON.stringify(a) === JSON.stringify(b);
  const check = (area: string, name: string, law: string, expected: unknown, actual: unknown) =>
    checks.push({ area, case: name, law, expected, actual, pass: near(expected, actual) });
  const sum = (rows: any[], k: string) => Math.round(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100;

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  const req = (p: string, method = 'GET', body?: unknown) =>
    new NextRequest(`http://localhost${p}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-authenticated-user-id': U, 'x-authenticated-business-id': B },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const call = async (res: Response | Promise<Response>) => {
    const r = await res;
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };

  const line = (item: keyof typeof I, quantity: number, unit_price: number, tax_rate: number) => {
    const meta = {
      WIDGET: ['Widget', '847130', 'PCS'], GADGET: ['Gadget', '847150', 'PCS'],
      RICE: ['Rice', '10063020', 'KGS'], CONSULT: ['Consulting', '998311', 'NOS'],
    }[item];
    return { item_id: I[item], item_name: meta[0], hsn_sac: meta[1], unit: meta[2], quantity, unit_price, tax_rate };
  };

  async function invoice(key: string, customer: string, pos: string, date: string, items: unknown[], extra: Record<string, unknown> = {}) {
    const res = await call(
      postInvoice(
        req('/api/invoices', 'POST', {
          branch_id: BR, customer_id: customer, invoice_date: date, due_date: date, items, status: 'final',
          document_type: 'tax_invoice', place_of_supply_state_code: pos, reference_number: `AUD-${key}`,
          backdate_reason: 'GST audit scenario', ...extra,
        })
      )
    );
    if (res.status !== 201 && res.status !== 200) {
      setupErrors.push(`invoice ${key}: ${res.status} ${JSON.stringify(res.json).slice(0, 300)}`);
      return null;
    }
    inv[key] = res.json.invoice?.id ?? res.json.id;
    return inv[key];
  }

  async function purchase(key: string, supplier: string, state: string, date: string, items: unknown[], extra: Record<string, unknown> = {}) {
    const res = await call(
      postPurchase(
        req('/api/purchases', 'POST', {
          branch_id: BR, supplier_id: supplier, bill_number: `${key}-${tag}`, bill_date: date, due_date: date,
          items, status: 'final', paid_amount: 0, supplier_state_code: state, place_of_supply_state_code: '29',
          backdate_reason: 'GST audit scenario', ...extra,
        })
      )
    );
    if (res.status !== 201 && res.status !== 200) {
      setupErrors.push(`purchase ${key}: ${res.status} ${JSON.stringify(res.json).slice(0, 300)}`);
      return null;
    }
    bill[key] = res.json.purchase?.id ?? res.json.id;
    return bill[key];
  }

  async function creditNote(key: string, customer: string, invoiceId: string | undefined, date: string, items: unknown[]) {
    const res = await call(
      postCreditNote(
        req('/api/credit-notes', 'POST', {
          branch_id: BR, customer_id: customer, invoice_id: invoiceId, credit_note_number: `AUD-${key}-${tag}`,
          credit_note_date: date, reason: 'Sales return', items,
        })
      )
    );
    if (res.status !== 201 && res.status !== 200) setupErrors.push(`credit note ${key}: ${res.status} ${JSON.stringify(res.json).slice(0, 300)}`);
  }

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, $3, '29', 'regular')`,
      [B, `GST Audit ${tag}`, BIZ_GSTIN]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $3, 'Main', '29', true, true, true), ($2, $3, 'Second shop (same GSTIN)', '29', false, false, true)`,
      [BR, BR2, B]
    );
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`, [
      U, B, `93${Date.now().toString().slice(-8)}`,
    ]);
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, gstin, current_balance) VALUES
         ($1, $7, 'Reg KA Pvt Ltd', '29', $8, 0),
         ($2, $7, 'Reg MH Pvt Ltd', '27', $9, 0),
         ($3, $7, 'Walk-in KA', '29', NULL, 0),
         ($4, $7, 'Retail MH', '27', NULL, 0),
         ($5, $7, 'Overseas Inc', '96', NULL, 0),
         ($6, $7, 'SEZ Unit MH', '27', $10, 0)`,
      [C.REG_KA, C.REG_MH, C.URP_KA, C.URP_MH, C.FOREIGN, C.SEZ_MH, B, GST.REG_KA, GST.REG_MH, GST.SEZ_MH]
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, gstin, current_balance) VALUES
         ($1, $4, 'Vendor KA', '29', $5, 0), ($2, $4, 'Vendor MH', '27', $6, 0), ($3, $4, 'Unregistered Transporter', '29', NULL, 0)`,
      [V.KA, V.MH, V.URD, B, VGST.KA, VGST.MH]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac) VALUES
         ($1, $5, 'Widget', 'goods', 'PCS', 1000, 600, 18, '847130'),
         ($2, $5, 'Gadget', 'goods', 'PCS', 500, 300, 5, '847150'),
         ($3, $5, 'Rice', 'goods', 'KGS', 100, 60, 0, '10063020'),
         ($4, $5, 'Consulting', 'service', 'NOS', 1000, 0, 18, '998311')`,
      [I.WIDGET, I.GADGET, I.RICE, I.CONSULT, B]
    );
    for (const br of [BR, BR2]) {
      for (const it of [I.WIDGET, I.GADGET, I.RICE]) {
        await pool.query(`INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1, $2, $3, 10000)`, [B, br, it]);
      }
    }

    // ── August: excess ITC that must be carried forward into September's electronic credit ledger
    await purchase('AUG-P1', V.KA, '29', '2026-08-10', [line('WIDGET', 100, 600, 18)]); // ITC CGST 5,400 + SGST 5,400
    await invoice('AUG-S1', C.URP_KA, '29', '2026-08-20', [line('WIDGET', 1, 1000, 18)]);

    // ── September outward supplies
    await invoice('S01-B2B-INTRA-MIXED', C.REG_KA, '29', '2026-09-02', [line('WIDGET', 10, 1000, 18), line('RICE', 5, 100, 0)]);
    await invoice('S02-B2B-INTER-2RATES', C.REG_MH, '27', '2026-09-03', [line('WIDGET', 20, 1000, 18), line('GADGET', 10, 500, 5)]);
    await invoice('S03-B2CL', C.URP_MH, '27', '2026-09-04', [line('WIDGET', 100, 1000, 18)]); // 1,18,000 > ₹1 lakh
    await invoice('S04-B2CS-INTER', C.URP_MH, '27', '2026-09-05', [line('WIDGET', 50, 1000, 18)]); // 59,000
    await invoice('S05-B2CS-INTRA', C.URP_KA, '29', '2026-09-06', [line('WIDGET', 5, 1000, 18)]);
    await invoice('S06-EXPORT-LUT', C.FOREIGN, '96', '2026-09-07', [line('WIDGET', 30, 1000, 18)], {
      is_export: true, export_type: 'wop', lut_declaration: true, port_code: 'INBLR4', shipping_bill_number: '1234567', shipping_bill_date: '2026-09-08',
    });
    await invoice('S07-SEZ-WPAY', C.SEZ_MH, '27', '2026-09-08', [line('WIDGET', 10, 1000, 18)], { supply_type: 'sez', export_type: 'wp' });
    await invoice('S08-NIL-B2C', C.URP_KA, '29', '2026-09-09', [line('RICE', 20, 100, 0)]);
    await invoice('S09-BOS-EXEMPT', C.URP_KA, '29', '2026-09-10', [line('RICE', 10, 100, 0)], { document_type: 'bill_of_supply' });
    await invoice('S10-SERVICE-B2B', C.REG_KA, '29', '2026-09-11', [line('CONSULT', 1, 20000, 18)]);
    await invoice('S11-TO-CANCEL', C.URP_KA, '29', '2026-09-12', [line('WIDGET', 1, 1000, 18)]);
    if (inv['S11-TO-CANCEL']) {
      const cr = await call(cancelInvoice(req(`/api/invoices/${inv['S11-TO-CANCEL']}/cancel`, 'PATCH', { reason: 'Void' }), { params: { id: inv['S11-TO-CANCEL'] } }));
      if (cr.status !== 200) setupErrors.push(`cancel S11: ${cr.status} ${JSON.stringify(cr.json).slice(0, 200)}`);
    }
    await invoice('S12-DRAFT', C.URP_KA, '29', '2026-09-13', [line('WIDGET', 7, 1000, 18)], { status: 'draft' });
    await invoice('S13-ECOM-B2C', C.URP_KA, '29', '2026-09-14', [line('GADGET', 4, 500, 5)], { ecommerce_operator_gstin: gstin('29AAICE7777F1Z'), is_ecommerce_supply: true });
    // Second shop of the same GSTIN — must be in the same GSTR-1 / 3B.
    await invoice('S14-BRANCH2', C.URP_KA, '29', '2026-09-15', [line('WIDGET', 2, 1000, 18)], { branch_id: BR2 });

    // Credit notes: mixed-rate note on a B2B invoice, and a note on a B2CS supply.
    await creditNote('CN1-MIXED', C.REG_MH, inv['S02-B2B-INTER-2RATES'], '2026-09-20', [
      { item_id: I.WIDGET, item_name: 'Widget', hsn_sac: '847130', qty: 1, unit_price: 1000, tax_rate: 18 },
      { item_id: I.GADGET, item_name: 'Gadget', hsn_sac: '847150', qty: 2, unit_price: 500, tax_rate: 5 },
    ]);
    await creditNote('CN2-B2CS', C.URP_MH, inv['S04-B2CS-INTER'], '2026-09-21', [
      { item_id: I.WIDGET, item_name: 'Widget', hsn_sac: '847130', qty: 5, unit_price: 1000, tax_rate: 18 },
    ]);

    // ── September inward supplies
    await purchase('P01-MATCH', V.KA, '29', '2026-09-03', [line('WIDGET', 10, 600, 18)]); // CGST 540 SGST 540
    await purchase('P02-WRONGHEAD', V.MH, '27', '2026-09-04', [line('WIDGET', 10, 600, 18)]); // IGST 1,080
    await purchase('INV/003', V.KA, '29', '2026-09-05', [line('GADGET', 10, 300, 5)]); // 2B shows INV-003
    await purchase('P04-LATE-FILER', V.KA, '29', '2026-09-25', [line('WIDGET', 5, 600, 18)]); // appears in October 2B
    await purchase('P05-RCM-URD', V.URD, '29', '2026-09-06', [line('CONSULT', 1, 10000, 18)], { is_reverse_charge: true });
    await purchase('P06-BLOCKED', V.KA, '29', '2026-09-07', [line('WIDGET', 2, 1000, 18)], { itc_eligible: false });
    await purchase('P07-IMPORT-BOE', V.URD, '96', '2026-09-08', [line('WIDGET', 10, 1000, 18)], { document_type: 'bill_of_entry', supplier_state_code: '96' });
    await purchase('P08-TAXVAL-DIFF', V.KA, '29', '2026-09-09', [line('WIDGET', 10, 600, 18)]); // 2B: same tax, different taxable
    const dup = await purchase('P09-DUP', V.KA, '29', '2026-09-10', [line('WIDGET', 1, 600, 18)]);
    if (dup) {
      // Same supplier bill booked twice (data entry slip) — bypass any UI duplicate guard by retrying the same number.
      const res = await call(
        postPurchase(
          req('/api/purchases', 'POST', {
            branch_id: BR, supplier_id: V.KA, bill_number: `P09-DUP-${tag}`, bill_date: '2026-09-10', due_date: '2026-09-10',
            items: [line('WIDGET', 1, 600, 18)], status: 'final', paid_amount: 0, supplier_state_code: '29', place_of_supply_state_code: '29',
            backdate_reason: 'GST audit scenario',
          })
        )
      );
      out.duplicate_bill_post_status = res.status;
    }

    // ── GSTR-2B for September (as downloaded from the portal)
    const imp = (await pool.query(
      `INSERT INTO gstr2b_imports (business_id, filing_period, import_type) VALUES ($1, '2026-09', 'json') RETURNING id`, [B]
    )).rows[0].id;
    const row2b = (g: string, no: string, date: string, tv: number, i: number, c: number, s: number, elig = 'eligible', period = '2026-09', impId = imp, docType = 'invoice') =>
      pool.query(
        `INSERT INTO gstr2b_invoices (import_id, business_id, supplier_gstin, invoice_number, invoice_date, document_type,
           taxable_value, igst_amount, cgst_amount, sgst_amount, cess_amount, itc_eligibility, filing_period)
         VALUES ($1, $2, $3, $4, $5, $12, $6, $7, $8, $9, 0, $10, $11)`,
        [impId, B, g, no, date, tv, i, c, s, elig, period, docType]
      );
    await row2b(VGST.KA, `P01-MATCH-${tag}`, '2026-09-03', 6000, 0, 540, 540);
    await row2b(VGST.MH, `P02-WRONGHEAD-${tag}`, '2026-09-04', 6000, 0, 540, 540); // supplier charged CGST+SGST on an inter-state supply
    await row2b(VGST.KA, `INV-003-${tag}`, '2026-09-05', 3000, 0, 75, 75);
    await row2b(VGST.KA, `P08-TAXVAL-DIFF-${tag}`, '2026-09-09', 9000, 0, 540, 540);
    await row2b(VGST.KA, `P09-DUP-${tag}`, '2026-09-10', 600, 0, 54, 54);
    await row2b(VGST.KA, `P06-BLOCKED-${tag}`, '2026-09-07', 2000, 0, 180, 180);
    // Bill of entry from ICEGATE (2B IMPG section): no supplier GSTIN, matched on the BoE number.
    await row2b('', `P07-IMPORT-BOE-${tag}`, '2026-09-08', 10000, 1800, 0, 0, 'eligible', '2026-09', imp, 'import_goods');
    const impOct = (await pool.query(
      `INSERT INTO gstr2b_imports (business_id, filing_period, import_type) VALUES ($1, '2026-10', 'json') RETURNING id`, [B]
    )).rows[0].id;
    await row2b(VGST.KA, `P04-LATE-FILER-${tag}`, '2026-09-25', 3000, 0, 270, 270, 'eligible', '2026-10', impOct);
  });

  afterAll(async () => {
    const failed = checks.filter((c) => !c.pass);
    // eslint-disable-next-line no-console
    console.log(
      `\nGST AUDIT: ${checks.length - failed.length}/${checks.length} checks pass\n` +
        (setupErrors.length ? `SETUP ERRORS:\n  ${setupErrors.join('\n  ')}\n` : '') +
        failed.map((c) => `FAIL [${c.area}] ${c.case} (${c.law})\n     expected ${JSON.stringify(c.expected)}  actual ${JSON.stringify(c.actual)}`).join('\n')
    );
    if (process.env.GST_AUDIT_OUT) writeFileSync(process.env.GST_AUDIT_OUT, JSON.stringify({ setupErrors, checks, ...out }, null, 2));
    if (!pool) return;
    try {
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', U, async () => {
          await c.query(`DELETE FROM businesses WHERE id = $1`, [B]);
        });
      });
      await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = $1`, [B]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  test('documents were created', () => {
    out.invoices = inv;
    out.bills = bill;
    expect(Object.keys(inv).length).toBeGreaterThan(10);
  });

  test('GSTR-1', async () => {
    const route = await call(gstr1Route(req('/api/reports/gst/gstr1?month=9&year=2026')));
    out.gstr1_route_status = route.status;
    const all = await new GSTR1Generator().generate({ business_id: B, month: 9, year: 2026 });
    const g = route.status === 200 ? route.json : all;
    out.gstr1 = g;
    const A = 'GSTR-1';

    const b2bFor = (k: string) => g.b2b.filter((r: any) => r.invoice_id === inv[k]);
    check(A, 'B2B intra mixed invoice: only the 18% line in Table 4A', 'Table 4 / 8', [18], b2bFor('S01-B2B-INTRA-MIXED').map((r: any) => r.rate));
    check(A, 'B2B intra: CGST 900 + SGST 900', 's.8 IGST Act', 1800, sum(b2bFor('S01-B2B-INTRA-MIXED'), 'cgst_amount') + sum(b2bFor('S01-B2B-INTRA-MIXED'), 'sgst_amount'));
    check(A, 'B2B inter: one row per rate (18%, 5%)', 'Table 4A rate-wise', [5, 18], b2bFor('S02-B2B-INTER-2RATES').map((r: any) => r.rate).sort((a: number, b: number) => a - b));
    check(A, 'B2B inter IGST 3,600 + 250', 's.7 IGST Act', 3850, sum(b2bFor('S02-B2B-INTER-2RATES'), 'igst_amount'));
    check(A, 'B2B service invoice reported', 'Table 4A', 20000, sum(b2bFor('S10-SERVICE-B2B'), 'taxable_value'));
    check(A, 'B2CL: inter-state unregistered > ₹1 lakh', 'Table 5, Notfn 12/2024-CT', 100000, sum(g.b2cl.filter((r: any) => r.invoice_id === inv['S03-B2CL']), 'taxable_value'));
    const b2cs27 = g.b2cs.filter((r: any) => r.place_of_supply === '27' && r.type === 'OE' && r.rate === 18);
    check(A, 'B2CS POS 27 @18% net of CN2 (50,000 − 5,000)', 'Table 7 net of notes', 45000, sum(b2cs27, 'taxable_value'));
    const b2cs29 = g.b2cs.filter((r: any) => r.place_of_supply === '29' && r.type === 'OE' && r.rate === 18);
    check(A, 'B2CS POS 29 @18% incl. second shop of same GSTIN (5,000 + 2,000)', 'One GSTR-1 per GSTIN', 7000, sum(b2cs29, 'taxable_value'));
    check(A, 'B2CS e-commerce row (operator collects TCS)', 'Table 7 type E', 2000, sum(g.b2cs.filter((r: any) => r.type === 'E-Commerce'), 'taxable_value'));
    check(A, 'Export under LUT in Table 6A as WOPAY', 'Table 6A, s.16 IGST', 'WOPAY', g.exports.find((r: any) => r.invoice_id === inv['S06-EXPORT-LUT'])?.export_type ?? null);
    check(A, 'Export under LUT carries no IGST', 'Rule 96A', 0, sum(g.exports, 'igst_amount'));
    check(A, 'SEZ with payment in Table 6B WPAY, IGST 1,800', 'Table 6B', 1800, sum(g.sez.filter((r: any) => r.sez_type === 'WPAY'), 'igst_amount'));
    const nil = (t: string, k: string) => Number(g.nil.find((n: any) => n.sply_ty === t)?.[k] ?? 0);
    check(A, 'Nil-rated intra B2B (rice on S01)', 'Table 8', 500, nil('INTRAB2B', 'nil_supply'));
    check(A, 'Nil-rated intra B2C (S08 on a tax invoice)', 'Table 8', 2000, nil('INTRAB2C', 'nil_supply'));
    check(A, 'Bill of supply (S09) reported as exempt', 'Table 8, s.31(3)(c)', 1000, nil('INTRAB2C', 'exempt_supply'));
    const cn1 = g.cdn.filter((n: any) => String(n.note_number).startsWith('AUD-CN1'));
    check(A, 'Mixed-rate credit note split by rate in CDNR', 'Table 9B rate-wise', [5, 18], cn1.map((n: any) => n.tax_rate).sort((a: number, b: number) => a - b));
    check(A, 'CDNR note on B2B: taxable 1,000 @18% + 1,000 @5%', 'Table 9B', 2000, sum(cn1, 'taxable_value'));
    check(A, 'CDNR note IGST 180 + 50', 'Table 9B', 230, sum(cn1, 'igst_amount'));
    check(A, 'Note on B2CS supply not in CDNUR', 'CDNUR only for B2CL/export', 0, g.cdn.filter((n: any) => String(n.note_number).startsWith('AUD-CN2')).length);
    check(A, 'Draft and cancelled invoices excluded from tables', 's.31 / Table 13', 0,
      [...g.b2b, ...g.b2cl].filter((r: any) => r.invoice_id === inv['S11-TO-CANCEL'] || r.invoice_id === inv['S12-DRAFT']).length);
    const docRows = (g.doc_issues ?? []).filter((r: any) => r.doc_num === 1);
    check(A, 'Table 13 invoices: cancelled counted once', 'Table 13', 1, sum(docRows, 'cancel'));
    const hsnW = g.hsn.filter((h: any) => h.hsn_sac === '847130' && h.rate === 18);
    // 10+20+100+50+5+30+10+2(S14) = 227 pcs sold, CN1 −1, CN2 −5
    check(A, 'HSN 847130 @18% qty net of notes, all shops', 'Table 12', 221, sum(hsnW, 'total_quantity'));
    check(A, 'HSN summary includes 0% rice', 'Table 12', true, g.hsn.some((h: any) => h.hsn_sac === '10063020'));
    const tax = (rows: any[]) => sum(rows, 'igst_amount') + sum(rows, 'cgst_amount') + sum(rows, 'sgst_amount');
    out.gstr1_vs_all_branches = { route_b2cs_29: b2cs29, all_branch_b2cs: all.b2cs };
    check(A, 'Route with no branch param covers whole GSTIN (BR2 sale included)', 'One GSTR-1 per GSTIN', true,
      [...(route.json?.b2cs ?? [])].some((r: any) => r.place_of_supply === '29' && Number(r.taxable_value) >= 7000));
    out.gstr1_total_tax = tax([...g.b2b, ...g.b2cl, ...g.b2cs]);

    // The customer later drops its GSTIN: September stays B2B (registration on the invoice date).
    await pool.query(`UPDATE customers SET gstin = NULL WHERE id = $1`, [C.REG_KA]);
    const again = await new GSTR1Generator().generate({ business_id: B, month: 9, year: 2026, branch_id: BR });
    check(A, 'Past B2B invoice stays B2B after the customer master GSTIN changes', 'Time of supply, s.12/13', 10000,
      sum(again.b2b.filter((r: any) => r.invoice_id === inv['S01-B2B-INTRA-MIXED']), 'taxable_value'));
    await pool.query(`UPDATE customers SET gstin = $2 WHERE id = $1`, [C.REG_KA, GST.REG_KA]);
  });

  test('GSTR-2B reconciliation', async () => {
    const engine = new GSTR2BReconciliationEngine();
    const m = (await engine.reconcile(B, '2026-09')).matches;
    out.recon = m.map((r) => ({ s: r.match_status, no: r.invoice_number, g: r.supplier_gstin, books: r.books_itc_amount, b2b: r.gstr2b_cgst + r.gstr2b_sgst + r.gstr2b_igst }));
    const A = 'GSTR-2B';
    const st = (no: string) => m.filter((r) => r.invoice_number === `${no}-${tag}`).map((r) => r.match_status);
    check(A, 'Exact match', 'Rule 36(4)', ['MATCHED'], st('P01-MATCH'));
    check(A, 'Books IGST vs 2B CGST+SGST (wrong head) flagged', 's.77 CGST / s.19 IGST', ['PARTIALLY_MATCHED'], st('P02-WRONGHEAD'));
    check(A, 'Taxable value differs by ₹3,000 (same tax) flagged', 'Tax invoice details', ['PARTIALLY_MATCHED'], st('P08-TAXVAL-DIFF'));
    check(A, '"INV/003" in books matches "INV-003" in 2B', 'Practical matching', ['MATCHED'], st('INV/003'));
    check(A, 'Same supplier bill number cannot be booked twice', 'Double ITC', 409, out.duplicate_bill_post_status);
    check(A, 'Domestic RCM bill from unregistered supplier left out (never in 2B)', 's.9(4)', 'excluded',
      m.some((r) => r.invoice_number === `P05-RCM-URD-${tag}`) ? 'listed' : 'excluded');
    const boe = m.find((r) => r.invoice_number === `P07-IMPORT-BOE-${tag}` && r.purchase_id);
    check(A, 'Import (bill of entry) matched to its 2B IMPG line', '2B IMPG', 'MATCHED import', boe ? `${boe.match_status}${boe.is_import_goods ? ' import' : ''}` : 'missing');
    check(A, 'September bill not in September 2B', 's.16(2)(aa)', ['MISSING_IN_2B'], st('P04-LATE-FILER'));
    check(A, 'Blocked-credit bill matched to its 2B line as not eligible', 's.17(5)', 'NOT_ELIGIBLE',
      m.find((r) => r.invoice_number === `P06-BLOCKED-${tag}`)?.match_status);
    check(A, 'No unexpected "only in 2B" lines', '—', [], m.filter((r) => r.match_status === 'ONLY_IN_2B').map((r) => r.invoice_number));

    // October: the late supplier's September bill is found in October's 2B.
    const oct = (await engine.reconcile(B, '2026-10')).matches;
    check(A, 'September bill matched in October 2B', 's.16(2)(aa)', ['MATCHED'],
      oct.filter((r) => r.invoice_number === `P04-LATE-FILER-${tag}`).map((r) => r.match_status));

    // Decision survives a re-run
    const rec = (await pool.query(`SELECT id FROM gstr2b_reconciliation WHERE business_id = $1 AND invoice_number = $2`, [B, `P02-WRONGHEAD-${tag}`])).rows[0];
    if (rec) {
      await engine.recordDecision(B, { reconciliation_id: rec.id, decision: 'PENDING_SUPPLIER_CORRECTION', decided_by_user_id: U, remarks: 'Supplier to amend' });
      await engine.reconcile(B, '2026-09');
      const left = (await pool.query(`SELECT COUNT(*)::int AS n FROM reconciliation_decisions WHERE business_id = $1`, [B])).rows[0].n;
      check(A, 'User decision kept after re-running reconciliation', 'Audit trail, s.35 / Rule 56', 1, left);
    }
  });

  test('GSTR-3B', async () => {
    const g = await new GSTR3BGenerator().generate({ business_id: B, month: 9, year: 2026, branch_id: BR });
    const all = await new GSTR3BGenerator().generate({ business_id: B, month: 9, year: 2026 });
    out.gstr3b = g;
    out.gstr3b_all_branches = all;
    const A = 'GSTR-3B';
    // 3.1(a): B2B 10,000 + 25,000 + 20,000; B2CL 1,00,000; B2CS 50,000 + 5,000 + 2,000(BR2) + 2,000(ecom); CN1 −2,000; CN2 −5,000
    check(A, '3.1(a) taxable value', 'Table 3.1(a)', 207000, all.outward_taxable_supplies.taxable_value);
    // IGST: 3,600+250 (S02) + 18,000 (S03) + 9,000 (S04) − (180+50) CN1 − 900 CN2 = 29,720
    check(A, '3.1(a) IGST', 'Table 3.1(a)', 29720, all.outward_taxable_supplies.igst);
    // CGST: 900 (S01) + 450 (S05) + 1,800 (S10) + 180 (S14) + 50 (S13) = 3,380
    check(A, '3.1(a) CGST', 'Table 3.1(a)', 3380, all.outward_taxable_supplies.cgst);
    check(A, '3.1(b) zero-rated: export 30,000 + SEZ 10,000', 'Table 3.1(b)', 40000, all.outward_zero_rated.taxable_value);
    check(A, '3.1(b) IGST on SEZ with payment', 'Table 3.1(b)', 1800, all.outward_zero_rated.igst);
    check(A, '3.1(c) nil + exempt: 500 + 2,000 + 1,000', 'Table 3.1(c)', 3500, all.other_outward_supplies.taxable_value);
    check(A, '3.1(d) inward RCM taxable (URD service)', 'Table 3.1(d), s.9(4)', 10000, all.inward_reverse_charge.taxable_value);
    const mh = all.inter_state_supplies_unregistered.find((r) => r.place_of_supply === '27');
    check(A, '3.2 POS 27 unregistered: B2CL 1,00,000 + B2CS 50,000 − CN2 5,000', 'Table 3.2', 145000, mh?.taxable_value ?? 0);
    check(A, '4A(1) import of goods IGST', 'Table 4A(1)', 1800, all.itc_details.imports.igst);
    check(A, '4A(3) RCM ITC (CGST 900)', 'Table 4A(3)', 900, all.itc_details.inward_reverse_charge.cgst);
    check(A, '4B(1) blocked credit reversed (s.17(5)): CGST 180', 'Table 4B(1)', 180, all.itc_details.itc_reversed.cgst);
    // Books CGST ITC: P01 540 + INV/003 75 + P04 270 + P08 540 + P09 54 = 1,479, plus blocked P06 180 shown in 4A and
    // reversed in 4B(1) = 1,659. Not in September's GSTR-2B: P04 (270, October 2B). INV/003 matches 2B's INV-003.
    check(A, '4A(5) CGST only what GSTR-2B supports (1,659 − 270)', 's.16(2)(aa), Rule 36(4)', 1389, all.itc_details.other_itc.cgst);
    // P02: books IGST 1,080, but the supplier reported CGST + SGST — no IGST credit until amended.
    check(A, '4A(5) IGST excludes the wrong-head bill', 's.16(2)(aa)', 0, all.itc_details.other_itc.igst);
    // Output Sep: IGST 31,520, CGST 3,380, SGST 3,380. Claimable ITC Sep: IGST 2,880 − 1,080 = 1,800,
    // CGST/SGST 2,379 − 270 = 2,109 each. August left 5,310 CGST and 5,310 SGST in the credit ledger (5,400 − 90).
    // IGST 31,520 − 1,800 = 29,720; CGST 7,419 clears 3,380, 4,039 to IGST; SGST the same:
    // IGST cash 29,720 − 4,039 − 4,039 = 21,642, plus RCM 1,800 in cash = 23,442.
    check(A, '6.1 cash payable uses ITC carried forward from August', 's.49(2), Rule 88A', 23442, all.summary.net_tax_payable);
    check(A, 'ITC brought forward from August', 's.49(2)', 5310, all.itc_brought_forward.cgst);

    // P04 deferred to October: its credit returns in October's 4A(5), not before.
    const p04 = (await pool.query(`SELECT id FROM gstr2b_reconciliation WHERE business_id = $1 AND invoice_number = $2`, [B, `P04-LATE-FILER-${tag}`])).rows[0];
    if (p04) {
      await new GSTR2BReconciliationEngine().recordDecision(B, {
        reconciliation_id: p04.id, decision: 'ITC_DEFERRED_TO_FUTURE', deferred_to_period: '2026-10', decided_by_user_id: U,
      });
      const oct = await new GSTR3BGenerator().generate({ business_id: B, month: 10, year: 2026 });
      check(A, 'Deferred ITC released in October 4A(5)', 's.16(2)(aa)', 270, oct.itc_details.other_itc.cgst);
    }
    // Filed and paid 30 Nov 2026, due 20 Oct: 41 days late.
    await fillTable51(all, { businessId: B, branchId: null, gstPeriod: '2026-09', filingDate: '2026-11-30' });
    out.table51 = { interest: all.interest, late_fee: all.late_fee, basis: all.table_51_basis };
    check(A, '5.1 late fee ₹50/day × 41 days, half CGST half SGST', 's.47', 2050, (all.late_fee?.cgst ?? 0) + (all.late_fee?.sgst ?? 0));
    // 18% p.a. on cash 23,442 for 41 days = 473.98
    check(A, '5.1 interest 18% on cash paid late', 's.50(1)', 473.98,
      Math.round(((all.interest?.igst ?? 0) + (all.interest?.cgst ?? 0) + (all.interest?.sgst ?? 0) + (all.interest?.cess ?? 0)) * 100) / 100);
    check(A, 'Report for Main shop only equals full GSTIN', 'One return per GSTIN', all.outward_taxable_supplies.taxable_value, g.outward_taxable_supplies.taxable_value);
  });

  test('GSTR-9', async () => {
    const g = await new GSTR9Generator().generate({ business_id: B, financial_year: 2026 } as any);
    out.gstr9 = { table_4: g.table_4, table_5: g.table_5, table_6: g.table_6 };
    const A = 'GSTR-9';
    const t4 = g.table_4 as any;
    const t5 = g.table_5 as any;
    // 4A B2C taxable: Aug 1,000 + S03 1,00,000 + S04 50,000 + S05 5,000 + S13 2,000 + S14 2,000 = 1,60,000
    check(A, '4A B2C taxable (excludes nil lines)', 'Table 4A', 160000, t4.A.taxable_value);
    // 4B B2B taxable: S01 10,000 (rice 500 belongs in Table 5) + S02 25,000 + S10 20,000 = 55,000
    check(A, '4B B2B taxable excludes nil-rated rice line of a mixed invoice', 'Table 4B vs 5D', 55000, t4.B.taxable_value);
    check(A, '5D exempted: bill of supply 1,000', 'Table 5D', 1000, t5.D.taxable_value);
    check(A, '5E nil rated: rice on tax invoices 500 + 2,000', 'Table 5E', 2500, t5.E.taxable_value);
    check(A, '4G RCM inward (URD service)', 'Table 4G', 10000, t4.G.taxable_value);
  });
});
