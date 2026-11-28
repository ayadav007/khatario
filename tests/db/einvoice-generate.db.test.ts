/**
 * Generating an e-invoice (IRN) through Masters India and storing it on the invoice.
 * The provider is always an injected fake. Runs only when PHASE2_TEST_DATABASE_URL is set,
 * and writes only after current_database() is kh_phase2_test.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  denyIfFeatureMissing: jest.fn().mockResolvedValue(null),
}));

import { NextRequest } from 'next/server';
import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { GspError } from '@/lib/gsp/mastersindia/client';
import { IRN_DUPLICATE_CODES, type MiIrnResult } from '@/lib/gsp/mastersindia/einvoice';
import { generateIrn, getEinvoiceView, parseEinvoiceEwb, type EinvoiceDeps } from '@/lib/gst/einvoice';
import { generateEwayBillViaGsp } from '@/lib/gst/eway-generate';

d('generate the IRN for a final invoice (kh_phase2_test)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const businessId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();
  const customerId = randomUUID();
  const itemId = randomUUID();
  const planId = `test_einv_${businessId.slice(0, 8)}`;
  const tag = businessId.slice(0, 8);
  const sellerGstin = '29ABCDE1234F1Z5';
  const ids = Array.from({ length: 16 }, () => randomUUID());
  const [invoiceId, invoice2Id, invoice3Id, invoice4Id, invoice5Id, invoice6Id, invoice7Id, invoice8Id, invoice9Id,
    invoice10Id, invoice11Id, invoice12Id] = ids;
  const [invoiceWithoutHsnId, oldInvoiceId, b2cInvoiceId, serviceInvoiceId] = ids.slice(12);
  const [ewbFailInvoiceId, cancelledInvoiceId] = [randomUUID(), randomUUID()];
  // Final review fixes: no stored supply type, HSN taken from the item, ship-to typed in the panel.
  const [nullB2bId, nullB2cId, nullB2bEwayId, hsnRefreshId, hsnStuckId, shipToId] = Array.from({ length: 6 }, () => randomUUID());
  const customerNoGstinId = randomUUID();
  const shortHsnItemId = randomUUID();

  /** Today in India, YYYY-MM-DD. */
  const todayIso = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const docNo = (n: number) => `EI${n}-${tag}`;
  const irnOf = (n: number) => (n.toString(16) + tag).padEnd(64, 'a');

  /** A portal answer for invoice n of this run: fresh, active, issued now for this very document. */
  const res = (n: number, over: Partial<MiIrnResult> = {}): MiIrnResult => ({
    irn: irnOf(n), ackNo: `14231001593438${n % 10}`, ackDate: new Date(), signedQr: `QR${n}`, signedInvoice: `SI${n}`,
    status: 'ACT', ewb: null, ewbError: null, pdfUrl: null, requestId: `R${n}`,
    duplicate: false, alert: null, docNumber: docNo(n), docDate: todayIso, sellerGstin,
    ...over,
  });
  const irn = irnOf(1);
  const ok = res(1);
  const creds = { username: 'u', password: 'p' };
  const deps = (o: Partial<EinvoiceDeps> = {}): EinvoiceDeps => ({
    loadCredentials: async () => creds,
    generate: jest.fn(async () => ok),
    getByDocument: jest.fn(async () => null),
    ...o,
  });
  const ewb = { distanceKm: 296, transport: { mode: 'road' as const, vehicleNumber: 'KA01AB1234' } };
  const rowOf = async (id: string) =>
    (await pool.query('SELECT irn, irn_status, irn_ack_no, irn_signed_invoice, irn_last_error FROM invoices WHERE id = $1', [id])).rows[0];
  const setPlanLimit = (n: number) =>
    pool.query(`UPDATE subscription_plan_limits SET limit_value = $2 WHERE plan_id = $1 AND limit_key = 'max_einvoices_per_month'`, [planId, n]);

  async function seedInvoice(
    id: string,
    n: number,
    o: { hsn?: string; date?: string; supplyType?: string | null; customer?: string; item?: string; shipping?: string } = {},
  ) {
    await pool.query(
      `INSERT INTO invoices (id, business_id, branch_id, customer_id, invoice_number, invoice_date, status, document_type, supply_type,
                             place_of_supply_state_code, subtotal, grand_total, is_editable, shipping_address)
       VALUES ($1, $2, $3, $4, $5, $6::date, 'final', 'tax_invoice', $7, '27', 1000, 1180, false, $8)`,
      [id, businessId, branchId, o.customer ?? customerId, docNo(n), o.date ?? todayIso, o.supplyType === undefined ? 'b2b' : o.supplyType, o.shipping ?? null],
    );
    await pool.query(
      `INSERT INTO invoice_items (invoice_id, item_id, item_name, hsn_sac, quantity, unit, unit_price, tax_rate, tax_amount,
                                  taxable_value, igst_amount, line_total, sort_order)
       VALUES ($1, $2, 'Steel bar', $3, 2, 'NOS', 500, 18, 180, 1000, 180, 1180, 0)`,
      [id, o.item ?? itemId, o.hsn ?? '721410'],
    );
  }

  beforeAll(async () => {
    pool = getPool();
    const info = await pool.query<{ db: string }>('SELECT current_database() AS db');
    if (info.rows[0]?.db !== 'kh_phase2_test') throw new Error(`Refusing to mutate database ${info.rows[0]?.db}`);
    for (const m of ['477_eway_bills_gsp.sql', '478_einvoice_irn.sql']) {
      await pool.query(fs.readFileSync(path.resolve(process.cwd(), 'database/migrations', m), 'utf8'));
    }

    await pool.query(
      `INSERT INTO subscription_plans (id, name, display_name, features, product_line, is_public)
       VALUES ($1, $1, 'E-invoice test plan', '{}'::jsonb, 'billing', false)`,
      [planId],
    );
    await pool.query(
      `INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
       VALUES ($1, 'max_einvoices_per_month', 100), ($1, 'max_eway_bills_per_month', 100)
       ON CONFLICT (plan_id, limit_key) DO UPDATE SET limit_value = EXCLUDED.limit_value`,
      [planId],
    );
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state, state_code, gst_registration_type, primary_module,
                               address_line1, city, pincode, einvoice_from)
       VALUES ($1, $2, $3, 'Karnataka', '29', 'regular', 'billing', '12 MG Road', 'Bengaluru', '560001', $4::date - 10)`,
      [businessId, `Einv gen ${tag}`, sellerGstin, todayIso],
    );
    await pool.query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`, [businessId]);
    await pool.query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
      [businessId, planId],
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active) VALUES ($1, $2, 'Main', '29', true, true, true)`,
      [branchId, businessId],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $2, 'Owner', $3, true, 1, true)`,
      [userId, businessId, `6${Date.now().toString().slice(-9)}`],
    );
    await pool.query(
      `INSERT INTO customers (id, business_id, name, gstin, billing_address, city, pincode, state, state_code)
       VALUES ($1, $2, 'Mehta Traders', '27ABCDE1234F2Z5', '4 Link Road, Andheri', 'Mumbai', '400053', 'Maharashtra', '27')`,
      [customerId, businessId],
    );
    await pool.query(`INSERT INTO items (id, business_id, name, hsn_sac, unit, uqc) VALUES ($1, $2, 'Steel bar', '721410', 'NOS', 'NOS')`, [itemId, businessId]);
    await pool.query(`INSERT INTO items (id, business_id, name, hsn_sac, unit, uqc) VALUES ($1, $2, 'Steel bar', '7214', 'NOS', 'NOS')`, [shortHsnItemId, businessId]);
    await pool.query(
      `INSERT INTO customers (id, business_id, name, billing_address, city, pincode, state, state_code)
       VALUES ($1, $2, 'Walk-in Buyer', '9 Hill Road, Bandra', 'Mumbai', '400050', 'Maharashtra', '27')`,
      [customerNoGstinId, businessId],
    );
    await seedInvoice(nullB2bId, 21, { supplyType: null });
    await seedInvoice(nullB2cId, 22, { supplyType: null, customer: customerNoGstinId });
    await seedInvoice(nullB2bEwayId, 23, { supplyType: null });
    await seedInvoice(hsnRefreshId, 24, { hsn: '7214' });
    await seedInvoice(hsnStuckId, 25, { hsn: '7214', item: shortHsnItemId });
    await seedInvoice(shipToId, 26, { shipping: 'Gate 4, Chakan MIDC, Pune' });
    for (let i = 0; i < 12; i++) await seedInvoice(ids[i], i + 1);
    // No HSN on the line, and none usable on its item either: the problem stays.
    await seedInvoice(invoiceWithoutHsnId, 13, { hsn: '', item: shortHsnItemId });
    const old = new Date(Date.parse(todayIso) - 20 * 864e5).toISOString().slice(0, 10);
    await seedInvoice(oldInvoiceId, 14, { date: old });
    await seedInvoice(b2cInvoiceId, 15, { supplyType: 'b2c_large' });
    await seedInvoice(serviceInvoiceId, 16, { hsn: '998314' });
    await seedInvoice(ewbFailInvoiceId, 17);
    await seedInvoice(cancelledInvoiceId, 18);
    await pool.query(
      `UPDATE invoices SET irn = $2, irn_ack_no = '1', irn_ack_date = NOW() - INTERVAL '2 days', irn_signed_qr = 'Q',
                           irn_status = 'cancelled', irn_cancelled_at = NOW() - INTERVAL '1 day'
        WHERE id = $1`,
      [cancelledInvoiceId, irnOf(18)],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'tenant_purge', userId, async () => {
        await client.query(`DELETE FROM eway_bills WHERE business_id = $1`, [businessId]);
        await client.query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [businessId]);
        await client.query(`DELETE FROM business_modules WHERE business_id = $1`, [businessId]);
        await client.query(`DELETE FROM businesses WHERE id = $1`, [businessId]);
      });
      await client.query(`DELETE FROM subscription_plan_limits WHERE plan_id = $1`, [planId]);
      await client.query(`DELETE FROM subscription_plans WHERE id = $1`, [planId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      await closePool();
    }
  });

  it('shows an invoice that needs an e-invoice and has none yet', async () => {
    const v = await getEinvoiceView(businessId, invoiceId);
    expect(v).toMatchObject({ applies: true, status: 'none', irn: null, can_cancel: false, problems: [], eway_warning: null });
    expect(await getEinvoiceView(businessId, randomUUID())).toBeNull();
    expect((await getEinvoiceView(businessId, invoiceWithoutHsnId))!.problems).toEqual([expect.objectContaining({ field: 'hsn' })]);
  });

  it('stores the IRN, acknowledgement and QR on the invoice', async () => {
    const v = await generateIrn(businessId, userId, invoiceId, undefined, deps());
    expect([v.status, v.irn, v.ack_no, v.signed_qr, v.can_cancel]).toEqual(['active', irn, ok.ackNo, 'QR1', true]);
    expect(await rowOf(invoiceId)).toMatchObject({ irn, irn_status: 'active', irn_signed_invoice: 'SI1', irn_last_error: null });
    const rev = await pool.query(
      `SELECT action, actor_user_id FROM invoice_revisions WHERE invoice_id = $1 ORDER BY revision_no DESC LIMIT 1`,
      [invoiceId],
    );
    expect(rev.rows[0]).toEqual({ action: 'einvoice_generated', actor_user_id: userId });
  });

  it('refuses an invoice that already has an e-invoice without calling the portal', async () => {
    const d1 = deps();
    await expect(generateIrn(businessId, userId, invoiceId, undefined, d1)).rejects.toMatchObject({ code: 'IRN_EXISTS', status: 409 });
    expect(d1.generate).not.toHaveBeenCalled();
  });

  it('says not found for an invoice of another business', async () => {
    await expect(generateIrn(randomUUID(), userId, invoice2Id, undefined, deps())).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('does not call the portal when a pre-check fails, and returns the problems', async () => {
    const d1 = deps();
    await expect(generateIrn(businessId, userId, invoiceWithoutHsnId, undefined, d1)).rejects.toMatchObject({
      code: 'PRECHECK_FAILED', status: 422, problems: [expect.objectContaining({ message: expect.stringContaining('HSN') })],
    });
    expect(d1.generate).not.toHaveBeenCalled();
  });

  it('refuses an invoice dated before the start date and a B2C invoice', async () => {
    for (const id of [oldInvoiceId, b2cInvoiceId]) {
      const d1 = deps();
      await expect(generateIrn(businessId, userId, id, undefined, d1)).rejects.toMatchObject({ code: 'NOT_APPLICABLE', status: 409 });
      expect(d1.generate).not.toHaveBeenCalled();
    }
  });

  it('asks to connect when there is no Masters India login', async () => {
    await expect(generateIrn(businessId, userId, invoice2Id, undefined, deps({ loadCredentials: async () => null })))
      .rejects.toMatchObject({ code: 'GSP_NOT_CONNECTED', status: 409 });
  });

  it('asks to reconnect when Masters India refuses the saved login', async () => {
    const d1 = deps({ generate: jest.fn(async () => { throw new GspError('auth', 'bad login'); }) });
    await expect(generateIrn(businessId, userId, invoice2Id, undefined, d1)).rejects.toMatchObject({ code: 'GSP_AUTH', status: 409 });
    expect((await rowOf(invoice2Id)).irn).toBeNull();
  });

  it('after a timeout, stores the IRN it finds by document number', async () => {
    const ok2 = res(2);
    const d1 = deps({ generate: jest.fn(async () => { throw new GspError('timeout', 'slow'); }), getByDocument: jest.fn(async () => ok2) });
    expect((await generateIrn(businessId, userId, invoice2Id, undefined, d1)).irn).toBe(ok2.irn);
    expect(d1.getByDocument).toHaveBeenCalledTimes(1);
    expect(d1.getByDocument).toHaveBeenCalledWith(creds, { gstin: sellerGstin, docNumber: docNo(2), docDate: dmy(todayIso) });
  });

  it('after a duplicate rejection, stores the IRN it finds by document number', async () => {
    const ok5 = res(5);
    const d1 = deps({
      generate: jest.fn(async () => { throw new GspError('rejected', 'Duplicate IRN', IRN_DUPLICATE_CODES[0]); }),
      getByDocument: jest.fn(async () => ok5),
    });
    expect((await generateIrn(businessId, userId, invoice5Id, undefined, d1)).irn).toBe(ok5.irn);
  });

  it('after a timeout with nothing found, asks to try again and stores nothing', async () => {
    const d1 = deps({ generate: jest.fn(async () => { throw new GspError('unreachable', 'down'); }) });
    await expect(generateIrn(businessId, userId, invoice12Id, undefined, d1)).rejects.toMatchObject({ code: 'GSP_NO_ANSWER', status: 502 });
    expect((await rowOf(invoice12Id)).irn).toBeNull();
  });

  it('keeps the rejection text on the invoice and stores no IRN', async () => {
    const d1 = deps({ generate: jest.fn(async () => { throw new GspError('rejected', '3038: Seller details Details:Pincode-101301 does not exists', '3038'); }) });
    await expect(generateIrn(businessId, userId, invoice3Id, undefined, d1)).rejects.toMatchObject({
      code: 'GSP_REJECTED', status: 422, message: 'E-invoice portal: 3038: Seller details Details:Pincode-101301 does not exists',
    });
    expect(d1.getByDocument).not.toHaveBeenCalled();
    const row = await rowOf(invoice3Id);
    expect([row.irn, row.irn_last_error]).toEqual([null, expect.stringContaining('3038')]);
    expect((await getEinvoiceView(businessId, invoice3Id))!.last_error).toContain('3038');
  });

  it('clears the last error once the IRN is stored', async () => {
    const v = await generateIrn(businessId, userId, invoice3Id, undefined, deps({ generate: jest.fn(async () => res(3)) }));
    expect([v.status, v.last_error]).toEqual(['active', null]);
  });

  it('records the e-way bill that came with the IRN as generated through the IRN', async () => {
    const d1 = deps({
      generate: jest.fn(async () => ({
        ...res(4), ewb: { number: '471008880909', generatedAt: new Date(), validUntil: new Date(Date.now() + 864e5), printUrl: null },
      })),
    });
    const v = await generateIrn(businessId, userId, invoice4Id, { ewb }, d1);
    expect(v.eway_warning).toBeNull();
    const rows = (await pool.query(`SELECT generated_via, ewb_number, distance_km FROM eway_bills WHERE source_id = $1`, [invoice4Id])).rows;
    expect(rows).toEqual([{ generated_via: 'irn', ewb_number: '471008880909', distance_km: 296 }]);
    expect((d1.generate as jest.Mock).mock.calls[0][1]).toHaveProperty('ewaybill_details.transportation_distance', 296);
  });

  it('warns when the IRN came but the e-way bill did not', async () => {
    const d1 = deps({ generate: jest.fn(async () => ({ ...res(6), ewbError: 'Vehicle number is not valid' })) });
    const v = await generateIrn(businessId, userId, invoice6Id, { ewb }, d1);
    expect(v.irn).toBe(irnOf(6));
    expect(v.eway_warning).toBe('E-invoice generated. The e-way bill was not: Vehicle number is not valid');
    expect((await pool.query(`SELECT 1 FROM eway_bills WHERE source_id = $1`, [invoice6Id])).rowCount).toBe(0);
  });

  it('refuses an e-way bill for a service-only invoice or without a distance, before calling the portal', async () => {
    const d1 = deps();
    await expect(generateIrn(businessId, userId, serviceInvoiceId, { ewb }, d1)).rejects.toMatchObject({
      status: 400, code: 'EWB_NOT_ALLOWED', message: 'An e-way bill needs at least one goods line',
    });
    await expect(generateIrn(businessId, userId, invoice7Id, { ewb: { ...ewb, distanceKm: NaN } }, d1)).rejects.toMatchObject({
      status: 400, code: 'INVALID_EWB',
    });
    expect(d1.generate).not.toHaveBeenCalled();
    expect(() => parseEinvoiceEwb({ transport_mode: 'road', vehicle_number: 'KA01AB1234' })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => parseEinvoiceEwb({ distance_km: null })).toThrow(expect.objectContaining({ status: 400 }));
    expect(parseEinvoiceEwb({ distance_km: '120', vehicle_number: 'ka 01 ab 1234' })).toMatchObject({
      distanceKm: 120, transport: { mode: 'road', vehicleNumber: 'KA01AB1234' },
    });
    expect(parseEinvoiceEwb(undefined)).toBeNull();
  });

  it('stops at the monthly e-invoice limit before calling the portal', async () => {
    await setPlanLimit(1);
    try {
      const d1 = deps({ generate: jest.fn(async () => res(7)) });
      await expect(generateIrn(businessId, userId, invoice7Id, undefined, d1)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED', status: 403 });
      expect(d1.generate).not.toHaveBeenCalled();
    } finally {
      await setPlanLimit(100);
    }
  });

  it('stores a repeat answer that matches this invoice', async () => {
    const d1 = deps({ generate: jest.fn(async () => res(8, { duplicate: true, alert: 'IRN already generated on this document number' })) });
    expect((await generateIrn(businessId, userId, invoice8Id, undefined, d1)).irn).toBe(irnOf(8));
  });

  it('refuses a repeat answer for a different document date and stores nothing', async () => {
    const d1 = deps({ generate: jest.fn(async () => res(9, { duplicate: true, docDate: '2025-04-01' })) });
    await expect(generateIrn(businessId, userId, invoice9Id, undefined, d1)).rejects.toMatchObject({
      code: 'IRN_MISMATCH', status: 409,
      message: 'The e-invoice portal already has an e-invoice for this document number, but it does not match this invoice. Check the e-invoice portal before trying again.',
    });
    expect(await rowOf(invoice9Id)).toMatchObject({ irn: null, irn_status: null });
  });

  it('does not store a cancelled IRN found by document number', async () => {
    const d1 = deps({ generate: jest.fn(async () => { throw new GspError('timeout', 'slow'); }), getByDocument: jest.fn(async () => res(10, { status: 'CNL' })) });
    await expect(generateIrn(businessId, userId, invoice10Id, undefined, d1)).rejects.toMatchObject({ code: 'IRN_MISMATCH', status: 409 });
    expect(await rowOf(invoice10Id)).toMatchObject({ irn: null, irn_status: null });
  });

  it('stores the IRN and warns when the e-way bill that came with it cannot be saved', async () => {
    // The e-way bills table only takes 12-digit numbers: the insert fails inside the transaction.
    const d1 = deps({
      generate: jest.fn(async () => ({
        ...res(17), ewb: { number: 'EWB-BAD', generatedAt: new Date(), validUntil: null, printUrl: null },
      })),
    });
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const v = await generateIrn(businessId, userId, ewbFailInvoiceId, { ewb }, d1);
    expect([v.status, v.irn]).toEqual(['active', irnOf(17)]);
    expect(v.eway_warning).toBe(
      'E-invoice generated. The e-way bill EWB-BAD was created on the portal but could not be saved here. The number is saved on the invoice.',
    );
    expect(await rowOf(ewbFailInvoiceId)).toMatchObject({ irn: irnOf(17), irn_status: 'active' });
    // The portal's number survives a reload and prints.
    const saved = (await pool.query(`SELECT eway_bill_number, eway_bill_date::text AS d FROM invoices WHERE id = $1`, [ewbFailInvoiceId])).rows[0];
    expect(saved).toEqual({ eway_bill_number: 'EWB-BAD', d: todayIso });
    expect((await pool.query(`SELECT 1 FROM eway_bills WHERE source_id = $1`, [ewbFailInvoiceId])).rowCount).toBe(0);
    expect(log).toHaveBeenCalledWith('[einvoice] e-way bill issued with the IRN but not saved', { invoiceId: ewbFailInvoiceId, error: '23514' });
    log.mockRestore();
  });

  describe('final review fixes', () => {
    const SHIP_TO = 'This invoice ships to an address that is not saved on the customer. Enter the ship-to city, PIN code and state.';
    const nashik = { place: 'Nashik', pincode: '422001', stateCode: '27' };

    it('offers and generates the e-invoice of an invoice saved without a supply type that has a customer GSTIN', async () => {
      expect(await getEinvoiceView(businessId, nullB2bId)).toMatchObject({ applies: true, status: 'none', problems: [], ship_to_needed: false });
      const d1 = deps({ generate: jest.fn(async () => res(21)) });
      expect((await generateIrn(businessId, userId, nullB2bId, undefined, d1)).status).toBe('active');
      expect((d1.generate as jest.Mock).mock.calls[0][1]).toHaveProperty('transaction_details.supply_type', 'B2B');
      // Nothing is stored as the supply type: the composer's value is left alone.
      expect((await pool.query(`SELECT supply_type FROM invoices WHERE id = $1`, [nullB2bId])).rows[0].supply_type).toBeNull();
    });

    it('does not offer one for an invoice saved without a supply type and without a GSTIN', async () => {
      expect(await getEinvoiceView(businessId, nullB2cId)).toMatchObject({ applies: false, status: 'none', problems: [] });
      const d1 = deps();
      await expect(generateIrn(businessId, userId, nullB2cId, undefined, d1)).rejects.toMatchObject({ code: 'NOT_APPLICABLE', status: 409 });
      expect(d1.generate).not.toHaveBeenCalled();
    });

    it('sends the e-way bill of such an invoice through the e-invoice, never the plain call', async () => {
      const d1 = { loadCredentials: async () => creds, generate: jest.fn(), ewbByIrn: jest.fn(), findByDocument: jest.fn(), getDetails: jest.fn() };
      await expect(
        generateEwayBillViaGsp(businessId, userId, { source_type: 'invoice', source_id: nullB2bEwayId, distance_km: 100, vehicle_number: 'KA01AB1234' }, d1),
      ).rejects.toMatchObject({ code: 'IRN_REQUIRED', status: 409 });
      expect(d1.generate).not.toHaveBeenCalled();
      expect(d1.ewbByIrn).not.toHaveBeenCalled();
    });

    it("takes the item's current HSN for a short line code and writes it to the line with the IRN", async () => {
      expect((await getEinvoiceView(businessId, hsnRefreshId))!.problems).toEqual([]);
      const d1 = deps({ generate: jest.fn(async () => res(24)) });
      expect((await generateIrn(businessId, userId, hsnRefreshId, undefined, d1)).status).toBe('active');
      expect((d1.generate as jest.Mock).mock.calls[0][1].item_list[0].hsn_code).toBe('721410');
      const line = (await pool.query(`SELECT hsn_sac FROM invoice_items WHERE invoice_id = $1`, [hsnRefreshId])).rows[0];
      expect(line.hsn_sac).toBe('721410');
      const rev = await pool.query(
        `SELECT action, snapshot->'lines'->0->>'hsn_sac' AS hsn FROM invoice_revisions WHERE invoice_id = $1 ORDER BY revision_no DESC LIMIT 1`,
        [hsnRefreshId],
      );
      expect(rev.rows[0]).toEqual({ action: 'einvoice_generated', hsn: '721410' });
    });

    it('keeps the HSN problem, with the item to fix, when the item record is short too', async () => {
      expect((await getEinvoiceView(businessId, hsnStuckId))!.problems).toEqual([
        { field: 'hsn', message: 'Use the 6-digit HSN code for Steel bar. E-invoices do not accept shorter codes.', fix: { kind: 'item', id: shortHsnItemId } },
      ]);
    });

    it('asks for the ship-to place of goods sent to an unsaved address, refuses without it, and sends it in the e-invoice', async () => {
      expect(await getEinvoiceView(businessId, shipToId)).toMatchObject({ applies: true, problems: [], ship_to_needed: true });
      const d1 = deps({ generate: jest.fn(async () => res(26)) });
      await expect(generateIrn(businessId, userId, shipToId, undefined, d1)).rejects.toMatchObject({
        code: 'PRECHECK_FAILED', status: 422, problems: [{ field: 'ship_to', message: SHIP_TO }],
      });
      expect(d1.generate).not.toHaveBeenCalled();
      const v = await generateIrn(businessId, userId, shipToId, { shipTo: nashik }, d1);
      expect(v.status).toBe('active');
      expect((d1.generate as jest.Mock).mock.calls[0][1].ship_details).toMatchObject({
        gstin: '27ABCDE1234F2Z5', address1: 'Gate 4, Chakan MIDC, Pune', location: 'Nashik', pincode: 422001, state_code: '27',
      });
    });
  });

  it('refuses an invoice whose e-invoice was cancelled, without calling the portal', async () => {
    const d1 = deps();
    await expect(generateIrn(businessId, userId, cancelledInvoiceId, undefined, d1)).rejects.toMatchObject({
      code: 'IRN_CANCELLED', status: 409,
      message: 'The e-invoice for this invoice was cancelled. The portal does not give a new e-invoice on the same invoice number. Make a new invoice instead.',
    });
    expect(d1.generate).not.toHaveBeenCalled();
    expect(await getEinvoiceView(businessId, cancelledInvoiceId)).toMatchObject({ status: 'cancelled', problems: [], can_cancel: false });
  });

  describe('route', () => {
    const headers = {
      'content-type': 'application/json',
      'x-authenticated-user-id': userId,
      'x-authenticated-business-id': businessId,
      'x-authenticated-session-version': '1',
    };
    const post = async (id: string, body: string) => {
      const { POST } = await import('@/app/api/invoices/[id]/einvoice/route');
      const r = await POST(new NextRequest(`http://localhost/api/invoices/${id}/einvoice`, { method: 'POST', headers, body }), { params: { id } });
      return { status: r.status, json: await r.json() };
    };

    it('refuses a body that is not JSON instead of generating without the e-way bill', async () => {
      expect(await post(cancelledInvoiceId, '{"ewb": {')).toEqual({ status: 400, json: { error: 'The request could not be read.', code: 'BAD_REQUEST' } });
    });

    it('treats an empty body as no e-way bill and reaches the generator', async () => {
      const r = await post(cancelledInvoiceId, '');
      expect([r.status, r.json.code]).toEqual([409, 'IRN_CANCELLED']);
    });

    it('takes the ship-to place next to ewb, all three together', async () => {
      const partial = await post(cancelledInvoiceId, JSON.stringify({ ship_to_place: 'Nashik', ship_to_pincode: '422001' }));
      expect([partial.status, partial.json.code, partial.json.error]).toEqual([400, 'INVALID_SHIP_TO', 'Enter the ship-to city, PIN code and state together']);
      const full = await post(cancelledInvoiceId, JSON.stringify({ ship_to_place: 'Nashik', ship_to_pincode: '422001', ship_to_state_code: '27' }));
      expect([full.status, full.json.code]).toEqual([409, 'IRN_CANCELLED']);
    });

    it('refuses an e-way bill request without a distance', async () => {
      const r = await post(cancelledInvoiceId, JSON.stringify({ ewb: { transport_mode: 'road' } }));
      expect([r.status, r.json.code]).toEqual([400, 'INVALID_EWB']);
    });

    it('returns the view on GET', async () => {
      const { GET } = await import('@/app/api/invoices/[id]/einvoice/route');
      const r = await GET(new NextRequest(`http://localhost/api/invoices/${invoiceId}/einvoice`, { headers }), { params: { id: invoiceId } });
      expect(r.status).toBe(200);
      expect((await r.json()).einvoice).toMatchObject({ status: 'active', irn });
    });
  });

  it('says the IRN was created but not saved when storing it fails', async () => {
    // The portal answers with an IRN this business already holds on another invoice: the unique index refuses it.
    const d1 = deps({ generate: jest.fn(async () => res(11, { irn })) });
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(generateIrn(businessId, userId, invoice11Id, undefined, d1)).rejects.toMatchObject({
      code: 'IRN_NOT_SAVED', status: 500,
      message: 'The e-invoice was created on the portal but could not be saved here. Click Generate again and Khatario will pick it up.',
    });
    expect((await rowOf(invoice11Id)).irn).toBeNull();
    // Logged without the portal's reply.
    expect(log).toHaveBeenCalledWith('[einvoice] IRN issued but not saved', { invoiceId: invoice11Id, error: '23505' });
    log.mockRestore();
  });
});
