/**
 * Real-PostgreSQL tests for GSTR-9 Table 8A sourcing: the latest portal GSTR-2B import per period
 * is authoritative, and only months without an import fall back to the purchase register.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database. All fixtures live in
 * one transaction that is rolled back, so nothing is committed or purged.
 */
import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { computeTable8A } from '@/lib/gst/gstr9-table8a';
import { GSTR9Generator } from '@/lib/gst/gstr9';

d('GSTR-9 Table 8A sourcing (real DB)', () => {
  jest.setTimeout(60000);

  let c: PoolClient;
  const B = randomUUID();
  const BR = randomUUID();
  const SUPP = randomUUID();
  const tag = B.slice(0, 8);
  const GSTIN = '27ABCDE1234F1Z5';

  async function bill(o: {
    date: string;
    taxable: number;
    rcm?: boolean;
    gstin?: string | null;
    status?: string;
    documentType?: string;
    itcEligible?: boolean;
  }) {
    const id = randomUUID();
    const half = Math.round(o.taxable * 9) / 100;
    await c.query(
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
          is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id, supplier_gstin, document_type)
       VALUES ($1, $2, $3, $4, $5, $6, '27', $7, $14, $8, $9, $10, $10, 0, $11, 0, $11, 'unpaid', $12, $13, $15)`,
      [id, B, SUPP, `T8-${tag}-${id.slice(0, 4)}`, o.date, o.status ?? 'final', o.rcm ?? false, o.taxable, 2 * half, half,
        o.taxable + 2 * half, BR, o.gstin === undefined ? GSTIN : o.gstin, o.itcEligible ?? true, o.documentType ?? null]
    );
    await c.query(
      `INSERT INTO purchase_items (purchase_id, item_name, quantity, unit_price, taxable_value, tax_rate, tax_amount,
          cgst_amount, sgst_amount, line_total)
       VALUES ($1, 'Widget', 1, $2, $2, 18, $3, $4, $4, $5)`,
      [id, o.taxable, 2 * half, half, o.taxable + 2 * half]
    );
    return id;
  }

  async function portalImport(period: string, importedAt: string, docs: Array<Record<string, unknown>>) {
    const imp = randomUUID();
    await c.query(
      `INSERT INTO gstr2b_imports (id, business_id, filing_period, import_date, file_hash, total_invoices)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [imp, B, period, importedAt, randomUUID().replace(/-/g, ''), docs.length]
    );
    for (const doc of docs) {
      await c.query(
        `INSERT INTO gstr2b_invoices (import_id, business_id, filing_period, supplier_gstin, invoice_number, invoice_date,
            document_type, taxable_value, igst_amount, cgst_amount, sgst_amount, cess_amount, itc_eligibility, reverse_charge)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [imp, B, period, GSTIN, doc.no, doc.date, doc.type ?? 'invoice', doc.taxable ?? 0, doc.igst ?? 0, doc.cgst ?? 0,
          doc.sgst ?? 0, doc.cess ?? 0, doc.elig ?? 'eligible', doc.rcm ?? 'N']
      );
    }
  }

  beforeAll(async () => {
    c = await getPool().connect();
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
      [B, `T8A ${tag}`]
    );
    await c.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    await c.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, gstin, current_balance) VALUES ($1, $2, 'T8A Supplier', '27', $3, 0)`,
      [SUPP, B, GSTIN]
    );

    // May has a portal import, so this books bill must not be counted from the books.
    await bill({ date: '2026-05-12', taxable: 5000 });
    // August has no import: the regular bill counts; RCM, unregistered, cancelled, draft, import
    // and ITC-ineligible bills do not.
    const aug = await bill({ date: '2026-08-05', taxable: 1000 });
    await bill({ date: '2026-08-06', taxable: 700, rcm: true });
    await bill({ date: '2026-08-07', taxable: 600, gstin: null });
    await bill({ date: '2026-08-08', taxable: 900, status: 'cancelled' });
    await bill({ date: '2026-08-09', taxable: 800, status: 'draft' });
    await bill({ date: '2026-08-10', taxable: 400, documentType: 'bill_of_entry' });
    await bill({ date: '2026-08-11', taxable: 300, documentType: 'import_service' });
    await bill({ date: '2026-08-12', taxable: 250, itcEligible: false });
    await c.query(
      `INSERT INTO purchase_returns (business_id, supplier_id, purchase_id, return_number, return_date, subtotal,
          tax_total, cgst_total, sgst_total, igst_total, grand_total, branch_id, status)
       VALUES ($1, $2, $3, $4, '2026-08-20', 200, 36, 18, 18, 0, 236, $5, 'final')`,
      [B, SUPP, aug, `PR-${tag}`, BR]
    );

    // May: superseded first import, then the re-import that must win.
    await portalImport('2026-05', '2026-06-14T10:00:00Z', [{ no: 'S-1', date: '2026-05-03', taxable: 9999, cgst: 900, sgst: 900 }]);
    await portalImport('2026-05', '2026-06-20T10:00:00Z', [
      { no: 'S-1', date: '2026-05-03', taxable: 2000, igst: 360 },
      { no: 'S-2', date: '2026-05-09', taxable: 1000, cgst: 90, sgst: 90, cess: 10 },
      { no: 'CN-1', date: '2026-05-15', type: 'credit_note', taxable: 500, cgst: 45, sgst: 45 },
      { no: 'R-1', date: '2026-05-16', taxable: 800, cgst: 72, sgst: 72, rcm: 'Y' },
    ]);
    // Next-FY period carrying a March document of this FY and an April document of the next FY.
    await portalImport('2027-05', '2027-06-14T10:00:00Z', [
      { no: 'L-1', date: '2027-03-30', taxable: 400, igst: 72 },
      { no: 'N-1', date: '2027-04-02', taxable: 300, igst: 54 },
    ]);
  });

  afterAll(async () => {
    if (!c) return;
    try {
      await c.query('ROLLBACK');
    } finally {
      c.release();
      await closePool();
    }
  });

  test('portal months use the latest import; months without an import fall back to the books', async () => {
    const r = await computeTable8A(c, B, 2026);
    expect(r.portal_periods).toEqual(['2026-05', '2027-05']);
    expect(r.books_periods).not.toContain('2026-05');
    expect(r.books_periods).toContain('2026-08');
    expect(r.books_periods).toHaveLength(11);

    // Portal: S-1 360 IGST + S-2 90/90/10 cess - CN-1 45/45 + L-1 72 IGST. Books (Aug): 90/90 - return 18/18.
    expect(r.A.igst).toBeCloseTo(432, 2);
    expect(r.A.cgst).toBeCloseTo(45 + 72, 2);
    expect(r.A.sgst).toBeCloseTo(45 + 72, 2);
    expect(r.A.cess).toBeCloseTo(10, 2);
    expect(r.A.taxable_value).toBeCloseTo(2000 + 1000 - 500 + 400 + 1000 - 200, 2);

    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('2026-08');
    expect(r.warnings[0]).not.toContain('2026-05');
  });

  test('GSTR-9 uses this 8A and 8D carries cess', async () => {
    const pool = getPool();
    const release = c.release;
    // Route every connection (promise and pg's internal callback form) to the fixture transaction.
    const spy = jest.spyOn(pool, 'connect').mockImplementation(((cb?: (e: unknown, cl: unknown, done: () => void) => void) => {
      (c as { release: unknown }).release = () => {};
      if (typeof cb === 'function') {
        cb(undefined, c, () => {});
        return undefined;
      }
      return Promise.resolve(c);
    }) as never);
    try {
      const gstr9 = await new GSTR9Generator().generate({ business_id: B, financial_year: 2026 });
      const { A, B: b8, C: c8, D } = gstr9.table_8;
      const own = await computeTable8A(c, B, 2026);
      expect(A).toEqual(own.A);
      expect(gstr9.validation.warnings).toEqual(expect.arrayContaining(own.warnings));
      expect(A.cess).toBeCloseTo(10, 2);
      expect(D.cess).toBeCloseTo(A.cess - (b8.cess + c8.cess), 2);
      expect(D.cess).not.toBe(0);
      expect(D.igst).toBeCloseTo(A.igst - (b8.igst + c8.igst), 2);
      expect(D.cgst).toBeCloseTo(A.cgst - (b8.cgst + c8.cgst), 2);
      expect(D.sgst).toBeCloseTo(A.sgst - (b8.sgst + c8.sgst), 2);
    } finally {
      spy.mockRestore();
      (c as { release: unknown }).release = release;
    }
  });
});
