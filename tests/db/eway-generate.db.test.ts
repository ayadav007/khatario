/**
 * Generating an e-way bill through Masters India and recording it in the register.
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

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { GspError } from '@/lib/gsp/mastersindia/client';
import type { MiEwayResult } from '@/lib/gsp/mastersindia/eway';
import { buildLimitCountQuery } from '@/lib/subscription/limit-registry';
import { generateEwayBillViaGsp, type EwayGenerateDeps, type GenerateEwayInput } from '@/lib/gst/eway-generate';

d('generate e-way bills through the GSP (kh_phase2_test)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const businessId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();
  const customerId = randomUUID();
  const itemId = randomUUID();
  const planId = `test_eway_${businessId.slice(0, 8)}`;
  const tag = businessId.slice(0, 8);
  const sellerGstin = '29ABCDE1234F1Z5';
  const [invoiceId, invoice2Id, invoice3Id, invoice4Id, invoice5Id, invoice6Id, invoice7Id, invoice8Id, invoice9Id] =
    Array.from({ length: 9 }, () => randomUUID());

  const creds = { username: 'u', password: 'p' };
  const ok: MiEwayResult = {
    ewbNumber: '301009218802', generatedAt: new Date(), validUntil: new Date(Date.now() + 864e5),
    printUrl: 'https://x/p', alert: null, duplicate: false, requestId: 'R1',
  };
  const deps = (over: Partial<EwayGenerateDeps> = {}): EwayGenerateDeps => ({
    loadCredentials: async () => creds,
    generate: jest.fn(async () => ok),
    findByDocument: jest.fn(async () => null),
    getStatus: jest.fn(async () => 'active' as const),
    ...over,
  });
  const forInvoice = (id: string, over: Partial<GenerateEwayInput> = {}): GenerateEwayInput => ({
    source_type: 'invoice', source_id: id, distance_km: 120, vehicle_number: 'KA01AB1234', ...over,
  });
  const input = forInvoice(invoiceId);
  const input2 = forInvoice(invoice2Id);
  const input3 = forInvoice(invoice3Id);

  const rowsFor = async (sourceId: string) =>
    (await pool.query('SELECT * FROM eway_bills WHERE business_id = $1 AND source_id = $2', [businessId, sourceId])).rows;
  const setPlanLimit = (n: number) =>
    pool.query(`UPDATE subscription_plan_limits SET limit_value = $2 WHERE plan_id = $1 AND limit_key = 'max_eway_bills_per_month'`, [planId, n]);

  async function seedInvoice(id: string, n: number, shippingAddress: string | null = null) {
    await pool.query(
      `INSERT INTO invoices (id, business_id, branch_id, customer_id, invoice_number, invoice_date, status, document_type,
                             place_of_supply_state_code, shipping_address, subtotal, grand_total, is_editable)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'final', 'tax_invoice', '27', $6, 1000, 1180, false)`,
      [id, businessId, branchId, customerId, `EW${n}-${tag}`, shippingAddress],
    );
    await pool.query(
      `INSERT INTO invoice_items (invoice_id, item_id, item_name, hsn_sac, quantity, unit, unit_price, tax_rate, tax_amount,
                                  taxable_value, igst_amount, line_total, sort_order)
       VALUES ($1, $2, 'Steel rack', '9403', 2, 'NOS', 500, 18, 180, 1000, 180, 1180, 0)`,
      [id, itemId],
    );
  }

  beforeAll(async () => {
    pool = getPool();
    const info = await pool.query<{ db: string }>('SELECT current_database() AS db');
    if (info.rows[0]?.db !== 'kh_phase2_test') throw new Error(`Refusing to mutate database ${info.rows[0]?.db}`);
    await pool.query(fs.readFileSync(path.resolve(process.cwd(), 'database/migrations/477_eway_bills_gsp.sql'), 'utf8'));

    await pool.query(
      `INSERT INTO subscription_plans (id, name, display_name, features, product_line, is_public)
       VALUES ($1, $1, 'Eway test plan', '{}'::jsonb, 'billing', false)`,
      [planId],
    );
    await pool.query(
      `INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value) VALUES ($1, 'max_eway_bills_per_month', 100)`,
      [planId],
    );
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state, state_code, gst_registration_type, primary_module,
                               address_line1, city, pincode)
       VALUES ($1, $2, $3, 'Karnataka', '29', 'regular', 'billing', '12 MG Road', 'Bengaluru', '560001')`,
      [businessId, `Eway gen ${tag}`, sellerGstin],
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
      [userId, businessId, `7${Date.now().toString().slice(-9)}`],
    );
    await pool.query(
      `INSERT INTO customers (id, business_id, name, gstin, billing_address, city, pincode, state, state_code)
       VALUES ($1, $2, 'Mehta Traders', '27ABCDE1234F2Z5', '4 Link Road, Andheri', 'Mumbai', '400053', 'Maharashtra', '27')`,
      [customerId, businessId],
    );
    await pool.query(`INSERT INTO items (id, business_id, name, hsn_sac, unit, uqc) VALUES ($1, $2, 'Steel rack', '9403', 'NOS', 'NOS')`, [itemId, businessId]);
    await seedInvoice(invoiceId, 1);
    await seedInvoice(invoice2Id, 2);
    await seedInvoice(invoice3Id, 3);
    await seedInvoice(invoice4Id, 4);
    await seedInvoice(invoice5Id, 5);
    await seedInvoice(invoice6Id, 6, 'Unit 9, Bhiwandi Logistics Park');
    await seedInvoice(invoice7Id, 7);
    await seedInvoice(invoice8Id, 8);
    await seedInvoice(invoice9Id, 9);
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

  it('records the generated bill and copies the number to the invoice', async () => {
    const d1 = deps();
    const v = await generateEwayBillViaGsp(businessId, userId, input, d1);
    expect([v.ewb_number, v.generated_via, v.print_url]).toEqual(['301009218802', 'api', 'https://x/p']);
    expect(d1.generate).toHaveBeenCalledTimes(1);
    expect(d1.findByDocument).not.toHaveBeenCalled();
    const inv = await pool.query('SELECT eway_bill_number FROM invoices WHERE id = $1', [invoiceId]);
    expect(inv.rows[0].eway_bill_number).toBe('301009218802');
    const [row] = await rowsFor(invoiceId);
    expect(row).toMatchObject({
      generated_via: 'api', gsp_request_id: 'R1', print_url: 'https://x/p', transaction_type: 1,
      doc_type: 'tax_invoice', sub_supply_type: 'supply', from_gstin: sellerGstin, to_gstin: '27ABCDE1234F2Z5',
      from_pincode: '560001', to_pincode: '400053', distance_km: 120, created_by: userId, status: 'active',
    });
    expect(Number(row.goods_value)).toBe(1180);
    expect(new Date(row.valid_until).getTime()).toBe(ok.validUntil!.getTime());
    expect(v.vehicle_number).toBe('KA01AB1234');
  });

  it('refuses a second bill for the same document without calling the provider', async () => {
    const d1 = deps();
    await expect(generateEwayBillViaGsp(businessId, userId, input, d1)).rejects.toMatchObject({ code: 'EWAY_EXISTS', status: 409 });
    expect(d1.generate).not.toHaveBeenCalled();
  });

  it('asks to connect when there is no login', async () => {
    await expect(generateEwayBillViaGsp(businessId, userId, input2, deps({ loadCredentials: async () => null })))
      .rejects.toMatchObject({ code: 'GSP_NOT_CONNECTED', status: 409 });
  });

  it('records nothing when the portal rejects, and names the GSTIN', async () => {
    const d1 = deps({ generate: jest.fn(async () => { throw new GspError('rejected', '702: GSTIN is not registered with this GSP', '702'); }) });
    await expect(generateEwayBillViaGsp(businessId, userId, input2, d1)).rejects.toMatchObject({
      code: 'GSP_REJECTED', status: 422,
      message: `E-way bill portal: 702: GSTIN is not registered with this GSP (GSTIN ${sellerGstin})`,
    });
    expect(d1.findByDocument).not.toHaveBeenCalled();
    expect((await pool.query('SELECT 1 FROM eway_bills WHERE source_id = $1', [invoice2Id])).rowCount).toBe(0);
  });

  it('asks to reconnect when Masters India refuses the saved login', async () => {
    const d1 = deps({ generate: jest.fn(async () => { throw new GspError('auth', 'bad login'); }) });
    await expect(generateEwayBillViaGsp(businessId, userId, input2, d1)).rejects.toMatchObject({ code: 'GSP_AUTH', status: 409 });
    expect(await rowsFor(invoice2Id)).toHaveLength(0);
  });

  it('says the server is not set up when the provider is not configured', async () => {
    const d1 = deps({ generate: jest.fn(async () => { throw new GspError('not_configured', 'MASTERSINDIA_BASE_URL is not set'); }) });
    await expect(generateEwayBillViaGsp(businessId, userId, input2, d1)).rejects.toMatchObject({ code: 'GSP_NOT_CONFIGURED', status: 503 });
    expect(await rowsFor(invoice2Id)).toHaveLength(0);
  });

  it('after a timeout, records the bill it finds by document number', async () => {
    const d1 = deps({
      generate: jest.fn(async () => { throw new GspError('timeout', 'slow'); }),
      findByDocument: jest.fn(async () => ({ ...ok, ewbNumber: '311009218805' })),
      getStatus: jest.fn(async () => 'active' as const),
    });
    expect((await generateEwayBillViaGsp(businessId, userId, input2, d1)).ewb_number).toBe('311009218805');
    expect(d1.findByDocument).toHaveBeenCalledTimes(1);
    expect(d1.findByDocument).toHaveBeenCalledWith(creds, sellerGstin, `EW2-${tag}`, 'INV');
    expect(d1.getStatus).toHaveBeenCalledTimes(1);
    expect(d1.getStatus).toHaveBeenCalledWith(creds, sellerGstin, '311009218805');
  });

  it('after a timeout, does not record a found bill the portal no longer holds as active', async () => {
    const d1 = deps({
      generate: jest.fn(async () => { throw new GspError('timeout', 'slow'); }),
      findByDocument: jest.fn(async () => ({ ...ok, ewbNumber: '371009218806' })),
      getStatus: jest.fn(async () => 'cancelled' as const),
    });
    await expect(generateEwayBillViaGsp(businessId, userId, forInvoice(invoice9Id), d1)).rejects.toMatchObject({
      code: 'EWAY_STALE_DUPLICATE', status: 409,
      message: 'The e-way bill portal still holds an old e-way bill 371009218806 for this document number. Cancelled bills cannot be regenerated on the same number from here; check the portal.',
    });
    expect(await rowsFor(invoice9Id)).toHaveLength(0);
  });

  it('after a timeout, when the status check of the found bill fails, tells the user to check the portal', async () => {
    const d1 = deps({
      generate: jest.fn(async () => { throw new GspError('unreachable', 'down'); }),
      findByDocument: jest.fn(async () => ({ ...ok, ewbNumber: '371009218806' })),
      getStatus: jest.fn(async () => { throw new GspError('auth', 'bad login'); }),
    });
    await expect(generateEwayBillViaGsp(businessId, userId, forInvoice(invoice9Id), d1)).rejects.toMatchObject({ code: 'GSP_NO_ANSWER', status: 502 });
    expect(await rowsFor(invoice9Id)).toHaveLength(0);
  });

  it('after a timeout with nothing found, tells the user to check the portal', async () => {
    const d1 = deps({ generate: jest.fn(async () => { throw new GspError('timeout', 'slow'); }) });
    await expect(generateEwayBillViaGsp(businessId, userId, input3, d1)).rejects.toMatchObject({ code: 'GSP_NO_ANSWER', status: 502 });
    expect(d1.findByDocument).toHaveBeenCalledTimes(1);
    expect(await rowsFor(invoice3Id)).toHaveLength(0);
  });

  it('when the lookup after an unreachable provider also fails, tells the user to check the portal', async () => {
    const d1 = deps({
      generate: jest.fn(async () => { throw new GspError('unreachable', 'down'); }),
      findByDocument: jest.fn(async () => { throw new GspError('unreachable', 'down'); }),
    });
    await expect(generateEwayBillViaGsp(businessId, userId, input3, d1)).rejects.toMatchObject({ code: 'GSP_NO_ANSWER', status: 502 });
    expect(await rowsFor(invoice3Id)).toHaveLength(0);
  });

  it('stops at the monthly limit before calling the provider', async () => {
    // Two api bills exist this month; the plan now allows one.
    await setPlanLimit(1);
    try {
      const d1 = deps();
      await expect(generateEwayBillViaGsp(businessId, userId, input3, d1)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED', status: 403 });
      const err = await generateEwayBillViaGsp(businessId, userId, input3, d1).catch((e) => e);
      expect(err.message).toContain('e-way bill limit');
      expect(err.message).not.toContain('eway_bills');
      expect(d1.generate).not.toHaveBeenCalled();
    } finally {
      await setPlanLimit(100);
    }
  });

  it('a generated-but-unsaved bill is recorded by the next click', async () => {
    const clash = '321009218809';
    // Same number already recorded by hand for no document: the insert of the generated bill fails.
    const pre = await pool.query(
      `INSERT INTO eway_bills (business_id, source_type, source_id, ewb_number, distance_km, generated_at)
       VALUES ($1, 'other', NULL, $2, 10, NOW()) RETURNING id`,
      [businessId, clash],
    );
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const first = deps({ generate: jest.fn(async () => ({ ...ok, ewbNumber: clash })) });
      await expect(generateEwayBillViaGsp(businessId, userId, forInvoice(invoice4Id), first)).rejects.toMatchObject({
        code: 'EWAY_NOT_SAVED', status: 500,
        message: `E-way bill ${clash} was generated but could not be saved here. Click Generate again to record it.`,
      });
      expect(await rowsFor(invoice4Id)).toHaveLength(0);
      for (const call of logged.mock.calls) expect(JSON.stringify(call)).not.toMatch(/password/i);
    } finally {
      logged.mockRestore();
    }
    await pool.query('DELETE FROM eway_bills WHERE id = $1', [pre.rows[0].id]);

    const second = deps({ generate: jest.fn(async () => ({ ...ok, ewbNumber: clash, duplicate: true, alert: 'E-way bill is already generated on this document number' })) });
    const v = await generateEwayBillViaGsp(businessId, userId, forInvoice(invoice4Id), second);
    expect(v.ewb_number).toBe(clash);
    expect(second.getStatus).toHaveBeenCalledWith(creds, sellerGstin, clash);
    const inv = await pool.query('SELECT eway_bill_number FROM invoices WHERE id = $1', [invoice4Id]);
    expect(inv.rows[0].eway_bill_number).toBe(clash);
  });

  it('when a concurrent click saved the same bill first, returns that bill instead of an error', async () => {
    const number = '381009218804';
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // The winner records the bill after this request passed the "active bill exists" check.
      const d1 = deps({
        generate: jest.fn(async () => {
          await pool.query(
            `INSERT INTO eway_bills (business_id, source_type, source_id, ewb_number, distance_km, generated_at, generated_via)
             VALUES ($1, 'invoice', $2, $3, 120, NOW(), 'api')`,
            [businessId, invoice8Id, number],
          );
          return { ...ok, ewbNumber: number };
        }),
      });
      const v = await generateEwayBillViaGsp(businessId, userId, forInvoice(invoice8Id), d1);
      expect([v.ewb_number, v.source_id, v.generated_via]).toEqual([number, invoice8Id, 'api']);
      expect(await rowsFor(invoice8Id)).toHaveLength(1);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('does not record a duplicate the portal no longer holds as active', async () => {
    const d1 = deps({
      generate: jest.fn(async () => ({ ...ok, ewbNumber: '331009218801', duplicate: true })),
      getStatus: jest.fn(async () => 'cancelled' as const),
    });
    await expect(generateEwayBillViaGsp(businessId, userId, forInvoice(invoice5Id), d1)).rejects.toMatchObject({
      code: 'EWAY_STALE_DUPLICATE', status: 409, message: expect.stringContaining('331009218801'),
    });
    expect(await rowsFor(invoice5Id)).toHaveLength(0);
  });

  it('asks for the ship-to place when the invoice ships to an address not saved on the customer', async () => {
    const d1 = deps();
    await expect(generateEwayBillViaGsp(businessId, userId, forInvoice(invoice6Id), d1)).rejects.toMatchObject({
      code: 'SHIP_TO_NEEDED', status: 422,
      message: 'This document ships to an address that is not saved on the customer. Enter the ship-to city, PIN code and state.',
    });
    expect(d1.generate).not.toHaveBeenCalled();
  });

  it('wants the ship-to city, PIN code and state together', async () => {
    const d1 = deps();
    await expect(
      generateEwayBillViaGsp(businessId, userId, forInvoice(invoice6Id, { ship_to_place: 'Bhiwandi', ship_to_pincode: '421302' }), d1),
    ).rejects.toMatchObject({ status: 400, message: 'Enter the ship-to city, PIN code and state together' });
    expect(d1.generate).not.toHaveBeenCalled();
  });

  it('uses a typed ship-to place', async () => {
    const d1 = deps({ generate: jest.fn(async () => ({ ...ok, ewbNumber: '341009218803' })) });
    const v = await generateEwayBillViaGsp(
      businessId, userId,
      forInvoice(invoice6Id, { ship_to_place: 'Bhiwandi', ship_to_pincode: '421302', ship_to_state_code: '27' }), d1,
    );
    expect(v.to_pincode).toBe('421302');
    const payload = (d1.generate as jest.Mock).mock.calls[0][1];
    expect(payload).toMatchObject({ place_of_consignee: 'Bhiwandi', pincode_of_consignee: 421302, transaction_type: 2 });
    expect((await rowsFor(invoice6Id))[0].transaction_type).toBe(2);
  });

  it('stores no validity for a Part A only bill the portal sent none for', async () => {
    const d1 = deps({ generate: jest.fn(async () => ({ ...ok, ewbNumber: '351009218807', validUntil: null })) });
    const v = await generateEwayBillViaGsp(
      businessId, userId, forInvoice(invoice7Id, { vehicle_number: null, transporter_gstin: '29AAACT1234A1Z5' }), d1,
    );
    expect(v.valid_until).toBeNull();
    expect((await rowsFor(invoice7Id))[0].valid_until).toBeNull();
  });

  it('manually recorded bills do not count towards the limit', async () => {
    const { sql, params } = buildLimitCountQuery('eway_bills', businessId);
    const before = (await pool.query(sql, params)).rows[0].count;
    expect(before).toBeGreaterThan(0);
    await pool.query(
      `INSERT INTO eway_bills (business_id, source_type, source_id, ewb_number, distance_km, generated_at)
       VALUES ($1, 'other', NULL, '361009218800', 10, NOW())`,
      [businessId],
    );
    expect((await pool.query(sql, params)).rows[0].count).toBe(before);
  });
});
