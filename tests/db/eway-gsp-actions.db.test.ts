/**
 * Cancel, change vehicle, extend and close an e-way bill through Masters India.
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
import { getEwayBill } from '@/lib/gst/eway-bill-records';
import { applyEwayBillAction, type EwayActionDeps } from '@/lib/gst/eway-gsp-actions';
import type { EwayBillAction } from '@/lib/gst/eway-bill-records';

d('e-way bill actions through the GSP (kh_phase2_test)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const businessId = randomUUID();
  const userId = randomUUID();
  const tag = businessId.slice(0, 8);
  const sellerGstin = '29ABCDE1234F1Z5';
  const creds = { username: 'u', password: 'p' };
  let serial = 0;
  const hour = 3600e3;

  async function seedBill(opts: { via: 'manual' | 'api'; generatedAgoH?: number; validInH?: number; vehicle?: string; gstin?: string | null }) {
    const id = randomUUID();
    const number = String(400000000000 + Date.now() % 1e6 * 100 + ++serial);
    await pool.query(
      `INSERT INTO eway_bills (id, business_id, source_type, direction, ewb_number, doc_type, sub_supply_type, from_gstin,
                               distance_km, generated_at, valid_until, created_by, generated_via)
       VALUES ($1, $2, 'other', 'outward', $3, 'tax_invoice', 'supply', $4, 100, $5, $6, $7, $8)`,
      [
        id, businessId, number, opts.gstin === undefined ? sellerGstin : opts.gstin,
        new Date(Date.now() - (opts.generatedAgoH ?? 1) * hour), new Date(Date.now() + (opts.validInH ?? 2) * hour), userId, opts.via,
      ],
    );
    if (opts.vehicle) {
      await pool.query(
        `INSERT INTO eway_bill_vehicles (eway_bill_id, transport_mode, vehicle_number, reason, created_by) VALUES ($1, 'road', $2, 'Initial', $3)`,
        [id, opts.vehicle, userId],
      );
    }
    return { id, number };
  }
  const patch = (id: string, body: EwayBillAction, deps: EwayActionDeps = {}) =>
    applyEwayBillAction(businessId, userId, id, body, { loadCredentials: async () => creds, ...deps });
  const get = (id: string) => getEwayBill(pool, businessId, id);
  const rejection = () => { throw new GspError('rejected', '338: E-way bill cannot be changed now', '338'); };

  beforeAll(async () => {
    pool = getPool();
    const info = await pool.query<{ db: string }>('SELECT current_database() AS db');
    if (info.rows[0]?.db !== 'kh_phase2_test') throw new Error(`Refusing to mutate database ${info.rows[0]?.db}`);
    await pool.query(fs.readFileSync(path.resolve(process.cwd(), 'database/migrations/477_eway_bills_gsp.sql'), 'utf8'));
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state, state_code, gst_registration_type, primary_module, address_line1, city, pincode)
       VALUES ($1, $2, $3, 'Karnataka', '29', 'regular', 'billing', '12 MG Road', 'Bengaluru', '560001')`,
      [businessId, `Eway act ${tag}`, sellerGstin],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $2, 'Owner', $3, true, 1, true)`,
      [userId, businessId, `7${Date.now().toString().slice(-9)}`],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'tenant_purge', userId, async () => {
        await client.query(`DELETE FROM eway_bills WHERE business_id = $1`, [businessId]);
        await client.query(`DELETE FROM businesses WHERE id = $1`, [businessId]);
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      await closePool();
    }
  });

  describe('cancel', () => {
    it('cancels at the portal first, then locally', async () => {
      const b = await seedBill({ via: 'api' });
      const cancel = jest.fn(async () => ({ cancelledAt: new Date() }));
      await patch(b.id, { action: 'cancel', reason: 'Order cancelled', reason_code: 'order_cancelled' }, { cancel });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledWith(
        creds,
        { gstin: sellerGstin, ewbNumber: b.number, reason: 'order_cancelled', remark: 'Order cancelled' },
        undefined,
      );
      expect((await get(b.id))!.stored_status).toBe('cancelled');
    });
    it('never calls the provider for a manually recorded bill', async () => {
      const b = await seedBill({ via: 'manual' });
      const cancel = jest.fn();
      await patch(b.id, { action: 'cancel' }, { cancel });
      expect(cancel).not.toHaveBeenCalled();
      expect((await get(b.id))!.stored_status).toBe('cancelled');
    });
    it('refuses outside the 24-hour window without calling the provider', async () => {
      const b = await seedBill({ via: 'api', generatedAgoH: 30 });
      const cancel = jest.fn();
      await expect(patch(b.id, { action: 'cancel' }, { cancel })).rejects.toMatchObject({ status: 409 });
      expect(cancel).not.toHaveBeenCalled();
      expect((await get(b.id))!.stored_status).toBe('active');
    });
    it('leaves the bill unchanged when the portal rejects', async () => {
      const b = await seedBill({ via: 'api' });
      const cancel = jest.fn(async () => rejection());
      await expect(patch(b.id, { action: 'cancel' }, { cancel })).rejects.toMatchObject({ code: 'GSP_REJECTED', status: 422 });
      expect((await get(b.id))!.stored_status).toBe('active');
    });
    it('does not call the provider when there is no saved login', async () => {
      const b = await seedBill({ via: 'api' });
      const cancel = jest.fn();
      await expect(patch(b.id, { action: 'cancel' }, { cancel, loadCredentials: async () => null })).rejects.toMatchObject({ code: 'GSP_NOT_CONNECTED' });
      expect(cancel).not.toHaveBeenCalled();
    });
    it('asks the user to check the portal when it does not answer', async () => {
      const b = await seedBill({ via: 'api' });
      const cancel = jest.fn(async () => { throw new GspError('timeout', 'slow'); });
      await expect(patch(b.id, { action: 'cancel' }, { cancel })).rejects.toMatchObject({ code: 'GSP_NO_ANSWER', status: 502 });
      expect((await get(b.id))!.stored_status).toBe('active');
    });
    it('needs a supplier GSTIN on an API bill', async () => {
      const b = await seedBill({ via: 'api', gstin: null });
      const cancel = jest.fn();
      await expect(patch(b.id, { action: 'cancel' }, { cancel })).rejects.toMatchObject({
        status: 409, message: 'This e-way bill has no supplier GSTIN recorded',
      });
      expect(cancel).not.toHaveBeenCalled();
    });
  });

  describe('vehicle', () => {
    const body: EwayBillAction = {
      action: 'vehicle', vehicle_number: 'ka 01 ab 9999', from_place: 'Hosur', from_state_code: '33',
      reason_code: 'breakdown', reason: 'Truck broke down', transport_doc_number: 'LR1', transport_doc_date: '2026-11-27',
    };
    it('updates Part B at the portal first, then locally, with the portal validity', async () => {
      const b = await seedBill({ via: 'api', vehicle: 'KA01AB1234' });
      const newValid = new Date(Date.now() + 40 * hour);
      const partB = jest.fn(async () => ({ validUntil: newValid, printUrl: null }));
      const v = await patch(b.id, body, { partB });
      expect(partB).toHaveBeenCalledTimes(1);
      expect(partB).toHaveBeenCalledWith(
        creds,
        {
          gstin: sellerGstin, ewbNumber: b.number, fromPlace: 'Hosur', fromStateCode: '33', reason: 'breakdown', remark: 'Truck broke down',
          transport: { mode: 'road', vehicleNumber: 'KA01AB9999', isOdc: false, docNumber: 'LR1', docDate: '2026-11-27' },
        },
        undefined,
      );
      expect(v.vehicle_number).toBe('KA01AB9999');
      expect(new Date(v.valid_until!).getTime()).toBe(newValid.getTime());
    });
    it('never calls the provider for a manually recorded bill', async () => {
      const b = await seedBill({ via: 'manual' });
      const partB = jest.fn();
      const v = await patch(b.id, { action: 'vehicle', vehicle_number: 'MH12AB1111' }, { partB });
      expect(partB).not.toHaveBeenCalled();
      expect(v.vehicle_number).toBe('MH12AB1111');
    });
    it('refuses a cancelled bill without calling the provider', async () => {
      const b = await seedBill({ via: 'api' });
      await pool.query(`UPDATE eway_bills SET status = 'cancelled' WHERE id = $1`, [b.id]);
      const partB = jest.fn();
      await expect(patch(b.id, body, { partB })).rejects.toMatchObject({ status: 409 });
      expect(partB).not.toHaveBeenCalled();
    });
    it('asks for the place and state before calling the provider', async () => {
      const b = await seedBill({ via: 'api' });
      const partB = jest.fn();
      await expect(patch(b.id, { action: 'vehicle', vehicle_number: 'KA01AB1111' }, { partB })).rejects.toMatchObject({
        message: 'Enter the place and state the goods are in now',
      });
      expect(partB).not.toHaveBeenCalled();
    });
    it('records no vehicle when the portal rejects', async () => {
      const b = await seedBill({ via: 'api', vehicle: 'KA01AB1234' });
      const partB = jest.fn(async () => rejection());
      await expect(patch(b.id, body, { partB })).rejects.toMatchObject({ code: 'GSP_REJECTED' });
      expect((await get(b.id))!.vehicle_number).toBe('KA01AB1234');
    });
  });

  describe('extend', () => {
    const body: EwayBillAction = {
      action: 'extend', remaining_km: 150, from_place: 'Pune', from_state_code: '27', from_pincode: '411001',
      reason_code: 'accident', reason: 'Accident on the highway', in_transit: 'road',
    };
    it('extends at the portal first and stores the provider validity, not the computed one', async () => {
      const b = await seedBill({ via: 'api', vehicle: 'KA01AB1234', validInH: 2 });
      const newValid = new Date(Date.now() + 77 * hour);
      const extend = jest.fn(async () => ({ validUntil: newValid }));
      const v = await patch(b.id, body, { extend });
      expect(extend).toHaveBeenCalledTimes(1);
      expect(extend).toHaveBeenCalledWith(
        creds,
        {
          gstin: sellerGstin, ewbNumber: b.number, transport: { mode: 'road', vehicleNumber: 'KA01AB1234', isOdc: false },
          fromPlace: 'Pune', fromStateCode: '27', fromPincode: '411001', remainingKm: 150, reason: 'accident',
          remark: 'Accident on the highway', inTransit: 'road',
        },
        undefined,
      );
      expect(new Date(v.valid_until!).getTime()).toBe(newValid.getTime());
      expect(v.extension_count).toBe(1);
    });
    it('never calls the provider for a manually recorded bill', async () => {
      const b = await seedBill({ via: 'manual', validInH: 2 });
      const extend = jest.fn();
      const v = await patch(b.id, { action: 'extend', remaining_km: 150 }, { extend });
      expect(extend).not.toHaveBeenCalled();
      expect(v.extension_count).toBe(1);
    });
    it('refuses outside the extension window without calling the provider', async () => {
      const b = await seedBill({ via: 'api', validInH: 40 });
      const extend = jest.fn();
      await expect(patch(b.id, body, { extend })).rejects.toMatchObject({ status: 409 });
      expect(extend).not.toHaveBeenCalled();
    });
    it('asks for the place, state and PIN code before calling the provider', async () => {
      const b = await seedBill({ via: 'api', validInH: 2 });
      const extend = jest.fn();
      await expect(patch(b.id, { ...body, from_pincode: '' } as EwayBillAction, { extend })).rejects.toMatchObject({
        message: 'Enter the place, state and PIN code the goods are in now',
      });
      await expect(patch(b.id, { ...body, reason: '' } as EwayBillAction, { extend })).rejects.toMatchObject({
        message: 'Enter the reason for the extension',
      });
      expect(extend).not.toHaveBeenCalled();
    });
    it('leaves the validity unchanged when the portal rejects', async () => {
      const b = await seedBill({ via: 'api', validInH: 2 });
      const before = (await get(b.id))!.valid_until;
      const extend = jest.fn(async () => rejection());
      await expect(patch(b.id, body, { extend })).rejects.toMatchObject({ code: 'GSP_REJECTED' });
      const after = await get(b.id);
      expect([after!.valid_until, after!.extension_count]).toEqual([before, 0]);
    });
  });

  describe('close', () => {
    it('closes at the portal with today\'s Indian date, then locally', async () => {
      const b = await seedBill({ via: 'api' });
      const close = jest.fn(async () => ({ closedAt: new Date() }));
      await patch(b.id, { action: 'close', remarks: 'Delivered' }, { close });
      expect(close).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledWith(
        creds,
        { gstin: sellerGstin, ewbNumber: b.number, closureDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), remark: 'Delivered' },
        undefined,
      );
      expect((await get(b.id))!.stored_status).toBe('closed');
    });
    it('never calls the provider for a manually recorded bill', async () => {
      const b = await seedBill({ via: 'manual' });
      const close = jest.fn();
      await patch(b.id, { action: 'close' }, { close });
      expect(close).not.toHaveBeenCalled();
      expect((await get(b.id))!.stored_status).toBe('closed');
    });
    it('refuses a closed bill and asks for remarks without calling the provider', async () => {
      const b = await seedBill({ via: 'api' });
      const close = jest.fn();
      await expect(patch(b.id, { action: 'close' }, { close })).rejects.toMatchObject({ message: 'Enter remarks for closing the e-way bill' });
      await pool.query(`UPDATE eway_bills SET status = 'closed' WHERE id = $1`, [b.id]);
      await expect(patch(b.id, { action: 'close', remarks: 'x' }, { close })).rejects.toMatchObject({ status: 409 });
      expect(close).not.toHaveBeenCalled();
    });
    it('leaves the bill open when the portal rejects', async () => {
      const b = await seedBill({ via: 'api' });
      const close = jest.fn(async () => rejection());
      await expect(patch(b.id, { action: 'close', remarks: 'Delivered' }, { close })).rejects.toMatchObject({ code: 'GSP_REJECTED' });
      expect((await get(b.id))!.stored_status).toBe('active');
    });
  });

  it('never calls the provider to reject a bill', async () => {
    const b = await seedBill({ via: 'api' });
    const cancel = jest.fn();
    await patch(b.id, { action: 'reject' }, { cancel });
    expect(cancel).not.toHaveBeenCalled();
    expect((await get(b.id))!.stored_status).toBe('rejected');
  });
});
