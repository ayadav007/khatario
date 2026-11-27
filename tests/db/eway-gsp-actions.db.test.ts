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
    applyEwayBillAction(businessId, userId, id, body, { loadCredentials: async () => creds, getStatus: async () => 'active', ...deps });
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
        await client.query(`DELETE FROM delivery_challans WHERE business_id = $1`, [businessId]);
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

  describe('Part B by rail, as the dialog sends it', () => {
    it('saves a rail change with only the transport document, and stores the document number', async () => {
      const b = await seedBill({ via: 'api', vehicle: 'KA01AB1234' });
      const partB = jest.fn(async () => ({ validUntil: null, printUrl: null }));
      // Exactly the dialog's body for rail: no vehicle number, no transporter name.
      const dialog = JSON.parse(JSON.stringify({
        action: 'vehicle', from_place: 'Hosur', from_state_code: '33', reason_code: 'transhipment', reason: undefined,
        transport_mode: 'rail', vehicle_number: undefined, transport_doc_number: 'RR901', transport_doc_date: '2026-11-27',
      })) as EwayBillAction;
      const v = await patch(b.id, dialog, { partB });
      expect(partB).toHaveBeenCalledTimes(1);
      expect(v.vehicle_number).toBeNull();
      const hist = await pool.query(
        `SELECT transport_mode, vehicle_number, transport_doc_number FROM eway_bill_vehicles WHERE eway_bill_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [b.id],
      );
      expect(hist.rows[0]).toEqual({ transport_mode: 'rail', vehicle_number: null, transport_doc_number: 'RR901' });
    });
  });

  describe('Part B by rail', () => {
    it('does not need a vehicle number for rail, but still does for road', async () => {
      const b = await seedBill({ via: 'api' });
      const partB = jest.fn(async () => ({ validUntil: null, printUrl: null }));
      const rail: EwayBillAction = {
        action: 'vehicle', transport_mode: 'rail', from_place: 'Hosur', from_state_code: '33',
        transport_doc_number: 'RR55', transport_doc_date: '2026-11-27', transporter_name: 'Indian Railways',
      };
      await patch(b.id, rail, { partB });
      expect(partB).toHaveBeenCalledTimes(1);
      const hist = await pool.query('SELECT transport_mode, vehicle_number FROM eway_bill_vehicles WHERE eway_bill_id = $1', [b.id]);
      expect(hist.rows).toEqual([{ transport_mode: 'rail', vehicle_number: null }]);

      const road = jest.fn();
      await expect(patch(b.id, { ...rail, transport_mode: 'road' } as EwayBillAction, { partB: road })).rejects.toMatchObject({
        message: 'Enter the vehicle number',
      });
      expect(road).not.toHaveBeenCalled();
    });
  });

  describe('a portal change made earlier but not saved here', () => {
    it('a repeated cancel the portal refuses is recorded when the portal shows the bill cancelled', async () => {
      const b = await seedBill({ via: 'api' });
      const cancel = jest.fn(async () => { throw new GspError('rejected', '312: This eway bill is either not generated by you or cancelled', '312'); });
      const getStatus = jest.fn(async () => 'cancelled' as const);
      const v = await patch(b.id, { action: 'cancel', reason_code: 'others' }, { cancel, getStatus });
      expect(getStatus).toHaveBeenCalledWith(creds, sellerGstin, b.number, undefined);
      expect(v.stored_status).toBe('cancelled');
    });
    it('a repeated close the portal refuses is recorded when the portal no longer shows the bill active', async () => {
      const b = await seedBill({ via: 'api' });
      const close = jest.fn(async () => rejection());
      const getStatus = jest.fn(async () => 'other' as const);
      const v = await patch(b.id, { action: 'close', remarks: 'Delivered' }, { close, getStatus });
      expect(getStatus).toHaveBeenCalledTimes(1);
      expect(v.stored_status).toBe('closed');
    });
    it('still reports the refusal when the portal shows the bill active, or cannot be asked', async () => {
      const b = await seedBill({ via: 'api' });
      const cancel = jest.fn(async () => rejection());
      await expect(patch(b.id, { action: 'cancel' }, { cancel, getStatus: async () => 'active' })).rejects.toMatchObject({ code: 'GSP_REJECTED' });
      await expect(patch(b.id, { action: 'cancel' }, { cancel, getStatus: async () => { throw new GspError('timeout', 'slow'); } }))
        .rejects.toMatchObject({ code: 'GSP_REJECTED' });
      expect((await get(b.id))!.stored_status).toBe('active');
    });
  });

  describe('a cancel clears the number from its document', () => {
    let invoiceId: string;
    let challanId: string;
    const customerId = randomUUID();
    const branchId = randomUUID();
    beforeAll(async () => {
      invoiceId = randomUUID();
      challanId = randomUUID();
      await pool.query(
        `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active) VALUES ($1, $2, 'Main', '29', true, true, true)`,
        [branchId, businessId],
      );
      await pool.query(`INSERT INTO customers (id, business_id, name) VALUES ($1, $2, 'Buyer')`, [customerId, businessId]);
      await pool.query(
        `INSERT INTO invoices (id, business_id, branch_id, customer_id, invoice_number, invoice_date, status, document_type, subtotal, grand_total, is_editable, eway_bill_number, eway_bill_date)
         VALUES ($1, $2, $5, $3, $4, CURRENT_DATE, 'final', 'tax_invoice', 100, 100, false, '481009218801', CURRENT_DATE)`,
        [invoiceId, businessId, customerId, `CX1-${tag}`, branchId],
      );
      await pool.query(
        `INSERT INTO delivery_challans (id, business_id, branch_id, customer_id, challan_number, challan_date, status, e_way_bill_number)
         VALUES ($1, $2, $5, $3, $4, CURRENT_DATE, 'sent', '481009218802')`,
        [challanId, businessId, customerId, `CX2-${tag}`, branchId],
      );
    });
    const seedFor = async (sourceType: string, sourceId: string, number: string, via: 'api' | 'manual') => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO eway_bills (id, business_id, source_type, source_id, direction, ewb_number, doc_type, sub_supply_type, from_gstin,
                                 distance_km, generated_at, valid_until, created_by, generated_via)
         VALUES ($1, $2, $3, $4, 'outward', $5, 'tax_invoice', 'supply', $6, 100, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '2 hours', $7, $8)`,
        [id, businessId, sourceType, sourceId, number, sellerGstin, userId, via],
      );
      return id;
    };
    it('clears the invoice e-way number and date, under the invoice audit context', async () => {
      const id = await seedFor('invoice', invoiceId, '481009218801', 'api');
      await patch(id, { action: 'cancel' }, { cancel: jest.fn(async () => ({ cancelledAt: new Date() })) });
      const inv = await pool.query('SELECT eway_bill_number, eway_bill_date FROM invoices WHERE id = $1', [invoiceId]);
      expect(inv.rows[0]).toEqual({ eway_bill_number: null, eway_bill_date: null });
      const rev = await pool.query(
        `SELECT action, actor_user_id FROM invoice_revisions WHERE invoice_id = $1 ORDER BY revision_no DESC LIMIT 1`,
        [invoiceId],
      );
      expect(rev.rows[0]).toEqual({ action: 'eway_updated', actor_user_id: userId });
    });
    it('clears the challan e-way number for a manual cancel too, and leaves another number alone', async () => {
      const id = await seedFor('delivery_challan', challanId, '481009218802', 'manual');
      await patch(id, { action: 'cancel' });
      expect((await pool.query('SELECT e_way_bill_number FROM delivery_challans WHERE id = $1', [challanId])).rows[0].e_way_bill_number).toBeNull();

      await pool.query(`UPDATE delivery_challans SET e_way_bill_number = '481009218899' WHERE id = $1`, [challanId]);
      const other = await seedFor('delivery_challan', challanId, '481009218803', 'manual');
      await patch(other, { action: 'cancel' });
      expect((await pool.query('SELECT e_way_bill_number FROM delivery_challans WHERE id = $1', [challanId])).rows[0].e_way_bill_number).toBe('481009218899');
    });
  });

  describe('after the portal has said yes', () => {
    // The service logs the unsaved change; keep the test output clean.
    beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => undefined); });
    afterEach(() => { jest.restoreAllMocks(); });
    it('reports EWAY_NOT_SAVED (500) when the local save fails for another reason, including a vanished row', async () => {
      const b = await seedBill({ via: 'api' });
      const cancel = jest.fn(async () => {
        await pool.query('DELETE FROM eway_bills WHERE id = $1', [b.id]);
        return { cancelledAt: new Date() };
      });
      await expect(patch(b.id, { action: 'cancel' }, { cancel })).rejects.toMatchObject({
        status: 500, code: 'EWAY_NOT_SAVED',
        message: 'The change was made on the e-way bill portal but could not be saved here. Try the same action again and Khatario will pick it up.',
      });
      expect(cancel).toHaveBeenCalledTimes(1);
    });
    it('asks to check the portal before retrying a vehicle change that was not saved', async () => {
      const b = await seedBill({ via: 'api' });
      const spy = jest.spyOn(pool, 'connect');
      const partB = jest.fn(async () => {
        spy.mockImplementationOnce((() => Promise.reject(new Error('pool exhausted'))) as any);
        return { validUntil: null, printUrl: null };
      });
      try {
        await expect(
          patch(b.id, { action: 'vehicle', vehicle_number: 'KA01AB2222', from_place: 'Hosur', from_state_code: '33' }, { partB }),
        ).rejects.toMatchObject({
          status: 500, code: 'EWAY_NOT_SAVED',
          message: 'The change was made on the e-way bill portal but could not be saved here. Reload and check the bill on the portal before trying again.',
        });
      } finally {
        spy.mockRestore();
      }
    });
    it('reports EWAY_STATE_CHANGED (409) when the row changed state during the portal call', async () => {
      const b = await seedBill({ via: 'api' });
      const cancel = jest.fn(async () => {
        await pool.query(`UPDATE eway_bills SET status = 'cancelled' WHERE id = $1`, [b.id]);
        return { cancelledAt: new Date() };
      });
      await expect(patch(b.id, { action: 'cancel' }, { cancel })).rejects.toMatchObject({ status: 409, code: 'EWAY_STATE_CHANGED' });
    });
    it('reports EWAY_NOT_SAVED when no database connection can be had to save', async () => {
      const b = await seedBill({ via: 'api' });
      const spy = jest.spyOn(pool, 'connect');
      const cancel = jest.fn(async () => {
        spy.mockImplementationOnce((() => Promise.reject(new Error('pool exhausted'))) as any);
        return { cancelledAt: new Date() };
      });
      try {
        await expect(patch(b.id, { action: 'cancel' }, { cancel })).rejects.toMatchObject({ status: 500, code: 'EWAY_NOT_SAVED' });
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('refuses a missing action body', async () => {
    const b = await seedBill({ via: 'api' });
    await expect(patch(b.id, null as unknown as EwayBillAction)).rejects.toMatchObject({ message: 'Unknown action' });
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
          gstin: sellerGstin, ewbNumber: b.number,
          transport: { mode: 'road', vehicleNumber: 'KA01AB1234', isOdc: false, docNumber: null, docDate: null },
          fromPlace: 'Pune', fromStateCode: '27', fromPincode: '411001', remainingKm: 150, reason: 'accident',
          remark: 'Accident on the highway', inTransit: 'road',
        },
        undefined,
      );
      expect(new Date(v.valid_until!).getTime()).toBe(newValid.getTime());
      expect(v.extension_count).toBe(1);
    });
    it('extends a rail bill with the transport document, as the dialog sends it', async () => {
      const b = await seedBill({ via: 'api', vehicle: 'KA01AB1234', validInH: 2 });
      const extend = jest.fn(async () => ({ validUntil: new Date(Date.now() + 50 * hour) }));
      const dialog = JSON.parse(JSON.stringify({
        action: 'extend', from_place: 'Nagpur', from_state_code: '27', from_pincode: '440001', reason_code: 'transhipment',
        reason: 'Rake delayed', remaining_km: 300, in_transit: null, transport_mode: 'rail', vehicle_number: undefined,
        transport_doc_number: 'RR77', transport_doc_date: '2026-11-26',
      })) as EwayBillAction;
      await patch(b.id, dialog, { extend });
      expect(extend).toHaveBeenCalledWith(
        creds,
        {
          gstin: sellerGstin, ewbNumber: b.number, fromPlace: 'Nagpur', fromStateCode: '27', fromPincode: '440001', remainingKm: 300,
          reason: 'transhipment', remark: 'Rake delayed', inTransit: null,
          transport: { mode: 'rail', vehicleNumber: null, isOdc: false, docNumber: 'RR77', docDate: '2026-11-26' },
        },
        undefined,
      );
    });
    it('does not need a vehicle number for goods in transit, but does for goods on a road vehicle', async () => {
      const b = await seedBill({ via: 'api', validInH: 2 });
      const extend = jest.fn(async () => ({ validUntil: new Date(Date.now() + 50 * hour) }));
      const onVehicle = { ...body, in_transit: null } as EwayBillAction;
      await expect(patch(b.id, onVehicle, { extend })).rejects.toMatchObject({ message: 'Enter the vehicle number' });
      expect(extend).not.toHaveBeenCalled();
      await patch(b.id, { ...body, in_transit: 'warehouse' } as EwayBillAction, { extend });
      expect(extend).toHaveBeenCalledTimes(1);
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
