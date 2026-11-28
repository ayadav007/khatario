/**
 * Cancelling an e-invoice (IRN), refusing edits to an invoice that has an active IRN, and sending the
 * e-way bill of such an invoice through its IRN. The provider is always an injected fake. Runs only when
 * PHASE2_TEST_DATABASE_URL is set, and writes only after current_database() is kh_phase2_test.
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
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
  denyIfFeatureMissing: jest.fn().mockResolvedValue(null),
}));

import { NextRequest } from 'next/server';
import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import * as auditContext from '@/lib/invoices/invoice-audit-context';
import { GspError } from '@/lib/gsp/mastersindia/client';
import type { MiIrnResult } from '@/lib/gsp/mastersindia/einvoice';
import type { MiEwayDetails, MiEwayResult } from '@/lib/gsp/mastersindia/eway';
import { cancelIrn, getEinvoiceView, type EinvoiceDeps } from '@/lib/gst/einvoice';
import { IRN_LOCK_MESSAGE, irnLock } from '@/lib/gst/einvoice-lock';
import { generateEwayBillViaGsp, type EwayGenerateDeps } from '@/lib/gst/eway-generate';
import * as einvoiceLock from '@/lib/gst/einvoice-lock';
import { cancelPostedInvoiceInTransaction } from '@/lib/invoices/cancel-final-invoice';

d('cancel the IRN, lock the invoice, e-way bill through the IRN (kh_phase2_test)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const businessId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();
  const customerId = randomUUID();
  const itemId = randomUUID();
  const planId = `test_einvc_${businessId.slice(0, 8)}`;
  const tag = businessId.slice(0, 8);
  const sellerGstin = '29ABCDE1234F1Z5';
  const ids = Array.from({ length: 16 }, () => randomUUID());
  const [invoiceId, oldAckId, ewayActiveId, noIrnId, timeoutCnlId, timeoutActId, rejectedId, notSavedId,
    lockedInvoiceId, irnCancelledId, irnInvoiceId, b2cInvoiceId, irnCancelledEwayId, irnTimeoutEwayId, otherDocId] = ids;
  // Fix round 1: start date moved later, 25-hour rechecks, inter-branch invoice of a stock transfer.
  const [movedStartId, lateCnlId, lateActId, transferInvoiceId] = Array.from({ length: 4 }, () => randomUUID());
  const [warehouse1, warehouse2, transferId] = Array.from({ length: 3 }, () => randomUUID());

  /** Today in India, YYYY-MM-DD. */
  const todayIso = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const docNo = (n: number) => `EC${n}-${tag}`;
  const irnOf = (n: number) => (n.toString(16) + tag).padEnd(64, 'c');
  const irn = irnOf(1);
  const creds = { username: 'u', password: 'p' };

  /** A by-document answer for invoice n of this run: the IRN issued for this very document. */
  const found = (n: number, over: Partial<MiIrnResult> = {}): MiIrnResult => ({
    irn: irnOf(n), ackNo: `14231001593438${n % 10}`, ackDate: new Date(), signedQr: `QR${n}`, signedInvoice: `SI${n}`,
    status: 'CNL', ewb: null, ewbError: null, pdfUrl: null, requestId: null,
    duplicate: false, alert: null, docNumber: docNo(n), docDate: todayIso, sellerGstin,
    ...over,
  });
  const deps = (o: Partial<EinvoiceDeps> = {}): EinvoiceDeps => ({
    loadCredentials: async () => creds,
    cancel: jest.fn(async () => ({ cancelledAt: new Date() })),
    getByDocument: jest.fn(async () => null),
    ...o,
  });
  const reason = { reason: 'data_entry' as const, remarks: 'Wrong rate' };
  const rowOf = async (id: string) =>
    (await pool.query('SELECT irn, irn_status, irn_cancelled_at, irn_cancel_reason, status FROM invoices WHERE id = $1', [id])).rows[0];

  const ewayOk: MiEwayResult = {
    ewbNumber: '301009218809', generatedAt: new Date(), validUntil: new Date(Date.now() + 864e5),
    printUrl: null, alert: null, duplicate: false, requestId: 'R1',
  };
  const held = (n: number, over: Partial<MiEwayDetails> = {}): MiEwayDetails => ({
    status: 'active', documentNumber: docNo(n), documentDate: dmy(todayIso), validUntil: null, vehicleNumber: 'KA01AB1234', distanceKm: 256,
    ...over,
  });
  const ewayDeps: EwayGenerateDeps = {
    loadCredentials: async () => creds,
    findByDocument: jest.fn(async () => null),
    getDetails: jest.fn(async () => held(0)),
  };

  async function seedInvoice(id: string, n: number, o: { supplyType?: string; irn?: 'active' | 'cancelled'; ackHoursAgo?: number } = {}) {
    await pool.query(
      `INSERT INTO invoices (id, business_id, branch_id, customer_id, invoice_number, invoice_date, status, document_type, supply_type,
                             place_of_supply_state_code, subtotal, grand_total, is_editable)
       VALUES ($1, $2, $3, $4, $5, $6::date, 'final', 'tax_invoice', $7, '27', 1000, 1180, false)`,
      [id, businessId, branchId, customerId, docNo(n), todayIso, o.supplyType ?? 'b2b'],
    );
    await pool.query(
      `INSERT INTO invoice_items (invoice_id, item_id, item_name, hsn_sac, quantity, unit, unit_price, tax_rate, tax_amount,
                                  taxable_value, igst_amount, line_total, sort_order)
       VALUES ($1, $2, 'Steel bar', '721410', 2, 'NOS', 500, 18, 180, 1000, 180, 1180, 0)`,
      [id, itemId],
    );
    if (o.irn) {
      await pool.query(
        `UPDATE invoices SET irn = $2, irn_ack_no = '1', irn_ack_date = NOW() - make_interval(hours => $3), irn_signed_qr = 'Q',
                             irn_status = $4::varchar, irn_cancelled_at = CASE WHEN $4::varchar = 'cancelled' THEN NOW() END
          WHERE id = $1`,
        [id, irnOf(n), o.ackHoursAgo ?? 0, o.irn],
      );
    }
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
       VALUES ($1, $1, 'E-invoice cancel test plan', '{}'::jsonb, 'billing', false)`,
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
      [businessId, `Einv cancel ${tag}`, sellerGstin, todayIso],
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
      [userId, businessId, `8${Date.now().toString().slice(-9)}`],
    );
    await pool.query(
      `INSERT INTO customers (id, business_id, name, gstin, billing_address, city, pincode, state, state_code)
       VALUES ($1, $2, 'Mehta Traders', '27ABCDE1234F2Z5', '4 Link Road, Andheri', 'Mumbai', '400053', 'Maharashtra', '27')`,
      [customerId, businessId],
    );
    await pool.query(`INSERT INTO items (id, business_id, name, hsn_sac, unit, uqc) VALUES ($1, $2, 'Steel bar', '721410', 'NOS', 'NOS')`, [itemId, businessId]);

    await seedInvoice(invoiceId, 1, { irn: 'active' });
    await seedInvoice(oldAckId, 2, { irn: 'active', ackHoursAgo: 25 });
    await seedInvoice(ewayActiveId, 3, { irn: 'active' });
    await seedInvoice(noIrnId, 4);
    await seedInvoice(timeoutCnlId, 5, { irn: 'active' });
    await seedInvoice(timeoutActId, 6, { irn: 'active' });
    await seedInvoice(rejectedId, 7, { irn: 'active' });
    await seedInvoice(notSavedId, 8, { irn: 'active' });
    await seedInvoice(lockedInvoiceId, 9, { irn: 'active' });
    await seedInvoice(irnCancelledId, 10, { irn: 'cancelled' });
    await seedInvoice(irnInvoiceId, 11, { irn: 'active' });
    await seedInvoice(b2cInvoiceId, 12, { supplyType: 'b2c_large' });
    await seedInvoice(irnCancelledEwayId, 13, { irn: 'cancelled' });
    await seedInvoice(irnTimeoutEwayId, 14, { irn: 'active' });
    await seedInvoice(otherDocId, 15, { irn: 'active' });
    await seedInvoice(movedStartId, 16, { irn: 'active' });
    await seedInvoice(lateCnlId, 17, { irn: 'active', ackHoursAgo: 25 });
    await seedInvoice(lateActId, 18, { irn: 'active', ackHoursAgo: 25 });
    await seedInvoice(transferInvoiceId, 19, { irn: 'active' });
    await pool.query(
      `INSERT INTO warehouses (id, business_id, branch_id, name, warehouse_type, is_active)
       VALUES ($1, $3, $4, 'Bengaluru godown', 'physical', true), ($2, $3, $4, 'Mysuru godown', 'physical', true)`,
      [warehouse1, warehouse2, businessId, branchId],
    );
    await pool.query(
      `INSERT INTO stock_transfers (id, business_id, transfer_number, transfer_date, status, from_location_id, to_location_id, inter_branch_invoice_id)
       VALUES ($1, $2, $3, $4::date, 'pending', $5, $6, $7)`,
      [transferId, businessId, `TR-${tag}`, todayIso, warehouse1, warehouse2, transferInvoiceId],
    );
    await pool.query(
      `INSERT INTO eway_bills (business_id, source_type, source_id, ewb_number, distance_km, generated_at)
       VALUES ($1, 'invoice', $2, '301009218801', 120, NOW())`,
      [businessId, ewayActiveId],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'tenant_purge', userId, async () => {
        await client.query(`DELETE FROM eway_bills WHERE business_id = $1`, [businessId]);
        await client.query(`DELETE FROM stock_transfers WHERE business_id = $1`, [businessId]);
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

  describe('cancelIrn', () => {
    it('cancels at the portal, keeps the IRN on the row and marks it cancelled', async () => {
      const cancel = jest.fn(async () => ({ cancelledAt: new Date() }));
      const v = await cancelIrn(businessId, userId, invoiceId, reason, deps({ cancel }));
      expect(cancel).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ irn, reason: '2', remarks: 'Wrong rate' }), undefined);
      expect(cancel).toHaveBeenCalledWith(creds, { gstin: sellerGstin, irn, reason: '2', remarks: 'Wrong rate' }, undefined);
      expect([v.status, v.irn, v.can_cancel]).toEqual(['cancelled', irn, false]);
      const row = await rowOf(invoiceId);
      expect(row).toMatchObject({ irn, irn_status: 'cancelled', status: 'final' });
      expect(row.irn_cancelled_at).toBeInstanceOf(Date);
      expect(row.irn_cancel_reason).toContain('Wrong rate');
      // The view carries the cancel date and reason for the Cancelled badge.
      expect(v.cancelled_at).toBe(row.irn_cancelled_at.toISOString());
      expect(v.cancel_reason).toBe(row.irn_cancel_reason);
      expect((await getEinvoiceView(businessId, invoiceId))).toMatchObject({ cancelled_at: v.cancelled_at, cancel_reason: 'data_entry: Wrong rate' });
      const rev = await pool.query(
        `SELECT action, actor_user_id FROM invoice_revisions WHERE invoice_id = $1 ORDER BY revision_no DESC LIMIT 1`,
        [invoiceId],
      );
      expect(rev.rows[0]).toEqual({ action: 'einvoice_cancelled', actor_user_id: userId });
    });

    it('maps each reason to the portal code', async () => {
      const codes: Array<[Parameters<typeof cancelIrn>[3]['reason'], string]> = [['duplicate', '1'], ['order_cancelled', '3'], ['others', '4']];
      for (const [r, code] of codes) {
        const cancel = jest.fn(async () => { throw new GspError('auth', 'stop here'); });
        await expect(cancelIrn(businessId, userId, otherDocId, { reason: r, remarks: 'x' }, deps({ cancel }))).rejects.toMatchObject({ code: 'GSP_AUTH' });
        expect(cancel).toHaveBeenCalledWith(creds, expect.objectContaining({ reason: code }), undefined);
      }
      expect((await rowOf(otherDocId)).irn_status).toBe('active');
    });

    it('refuses an invoice without an active e-invoice', async () => {
      const d1 = deps();
      await expect(cancelIrn(businessId, userId, noIrnId, reason, d1)).rejects.toMatchObject({
        code: 'NO_IRN', status: 409, message: 'This invoice has no active e-invoice',
      });
      await expect(cancelIrn(businessId, userId, irnCancelledId, reason, d1)).rejects.toMatchObject({ code: 'NO_IRN' });
      await expect(cancelIrn(randomUUID(), userId, lockedInvoiceId, reason, d1)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      expect(d1.cancel).not.toHaveBeenCalled();
    });

    it('refuses after 24 hours without calling the portal', async () => {
      const d1 = deps();
      await expect(cancelIrn(businessId, userId, oldAckId, reason, d1)).rejects.toMatchObject({
        code: 'CANCEL_WINDOW_CLOSED', status: 409,
        message: 'An e-invoice can be cancelled only within 24 hours. Issue a credit note instead.',
      });
      expect(d1.cancel).not.toHaveBeenCalled();
    });

    it('past 24 hours, stores a cancellation the portal already shows, without calling cancel or needing a reason', async () => {
      const d1 = deps({ getByDocument: jest.fn(async () => found(17)) });
      const v = await cancelIrn(businessId, userId, lateCnlId, { reason: '' as any, remarks: '' }, d1);
      expect(d1.cancel).not.toHaveBeenCalled();
      expect(d1.getByDocument).toHaveBeenCalledWith(creds, { gstin: sellerGstin, docNumber: docNo(17), docDate: dmy(todayIso) });
      expect([v.status, v.can_cancel, v.can_recheck]).toEqual(['cancelled', false, false]);
      expect(await rowOf(lateCnlId)).toMatchObject({ irn: irnOf(17), irn_status: 'cancelled', irn_cancel_reason: null });
    });

    it('past 24 hours, refuses when the portal shows the IRN still active, without calling cancel', async () => {
      const d1 = deps({ getByDocument: jest.fn(async () => found(18, { status: 'ACT' })) });
      await expect(cancelIrn(businessId, userId, lateActId, reason, d1)).rejects.toMatchObject({ code: 'CANCEL_WINDOW_CLOSED', status: 409 });
      expect(d1.getByDocument).toHaveBeenCalledTimes(1);
      expect(d1.cancel).not.toHaveBeenCalled();
      // A failed lookup or no saved login gives the same answer.
      const d2 = deps({ getByDocument: jest.fn(async () => { throw new GspError('timeout', 'slow'); }) });
      await expect(cancelIrn(businessId, userId, lateActId, reason, d2)).rejects.toMatchObject({ code: 'CANCEL_WINDOW_CLOSED' });
      const d3 = deps({ loadCredentials: async () => null });
      await expect(cancelIrn(businessId, userId, lateActId, reason, d3)).rejects.toMatchObject({ code: 'CANCEL_WINDOW_CLOSED' });
      expect(d2.cancel).not.toHaveBeenCalled();
      expect(d3.getByDocument).not.toHaveBeenCalled();
      expect((await rowOf(lateActId)).irn_status).toBe('active');
    });

    it('offers a status check only for an active IRN past the window', async () => {
      expect(await getEinvoiceView(businessId, lateActId)).toMatchObject({ status: 'active', can_cancel: false, can_recheck: true });
      expect(await getEinvoiceView(businessId, otherDocId)).toMatchObject({ status: 'active', can_cancel: true, can_recheck: false, cancelled_at: null, cancel_reason: null });
      expect(await getEinvoiceView(businessId, noIrnId)).toMatchObject({ status: 'none', can_recheck: false });
    });

    it('refuses while the invoice has an active e-way bill', async () => {
      const d1 = deps();
      await expect(cancelIrn(businessId, userId, ewayActiveId, reason, d1)).rejects.toMatchObject({
        code: 'EWAY_ACTIVE', status: 409, message: 'Cancel the e-way bill first',
      });
      expect(d1.cancel).not.toHaveBeenCalled();
      expect((await rowOf(ewayActiveId)).irn_status).toBe('active');
    });

    it('asks for the reason and a valid reason code before calling the portal', async () => {
      const d1 = deps();
      await expect(cancelIrn(businessId, userId, timeoutActId, { reason: 'data_entry', remarks: '   ' }, d1)).rejects.toMatchObject({
        code: 'REMARKS_REQUIRED', status: 400, message: 'Enter the reason for cancelling',
      });
      await expect(cancelIrn(businessId, userId, timeoutActId, { reason: 'bogus' as any, remarks: 'x' }, d1)).rejects.toMatchObject({ status: 400 });
      expect(d1.cancel).not.toHaveBeenCalled();
    });

    it('after a timeout, stores the cancellation when the portal shows the IRN cancelled', async () => {
      const d1 = deps({ cancel: jest.fn(async () => { throw new GspError('timeout', 'slow'); }), getByDocument: jest.fn(async () => found(5)) });
      const v = await cancelIrn(businessId, userId, timeoutCnlId, reason, d1);
      expect(v.status).toBe('cancelled');
      expect(d1.getByDocument).toHaveBeenCalledTimes(1);
      expect(d1.getByDocument).toHaveBeenCalledWith(creds, { gstin: sellerGstin, docNumber: docNo(5), docDate: dmy(todayIso) });
      expect(await rowOf(timeoutCnlId)).toMatchObject({ irn: irnOf(5), irn_status: 'cancelled' });
    });

    it('after a timeout, says no answer and stores nothing when the portal shows the IRN still active', async () => {
      const d1 = deps({
        cancel: jest.fn(async () => { throw new GspError('unreachable', 'down'); }),
        getByDocument: jest.fn(async () => found(6, { status: 'ACT' })),
      });
      await expect(cancelIrn(businessId, userId, timeoutActId, reason, d1)).rejects.toMatchObject({
        code: 'GSP_NO_ANSWER', status: 502,
        message: 'The e-invoice portal did not answer. Wait a minute and check again before retrying.',
      });
      expect(d1.getByDocument).toHaveBeenCalledTimes(1);
      expect((await rowOf(timeoutActId)).irn_status).toBe('active');
    });

    it('after a timeout, does not store a cancelled IRN of another document', async () => {
      const d1 = deps({
        cancel: jest.fn(async () => { throw new GspError('timeout', 'slow'); }),
        getByDocument: jest.fn(async () => found(6, { docDate: '2025-04-01' })),
      });
      await expect(cancelIrn(businessId, userId, timeoutActId, reason, d1)).rejects.toMatchObject({ code: 'GSP_NO_ANSWER' });
      expect((await rowOf(timeoutActId)).irn_status).toBe('active');
    });

    it('passes on a portal refusal and stores nothing', async () => {
      const d1 = deps({
        cancel: jest.fn(async () => { throw new GspError('rejected', '2270: The allowed cancellation time limit is crossed', '2270'); }),
        getByDocument: jest.fn(async () => found(7, { status: 'ACT' })),
      });
      await expect(cancelIrn(businessId, userId, rejectedId, reason, d1)).rejects.toMatchObject({
        code: 'GSP_REJECTED', status: 422, message: 'E-invoice portal: 2270: The allowed cancellation time limit is crossed',
      });
      expect((await rowOf(rejectedId)).irn_status).toBe('active');
    });

    it('says the cancellation was not saved, and the next click picks it up from the portal', async () => {
      const spy = jest.spyOn(auditContext, 'runWithInvoiceAudit').mockRejectedValueOnce(Object.assign(new Error('db down'), { code: '57P01' }));
      const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        await expect(cancelIrn(businessId, userId, notSavedId, reason, deps())).rejects.toMatchObject({
          code: 'IRN_NOT_SAVED', status: 500,
          message: 'The e-invoice was cancelled on the portal but that could not be saved here. Click Cancel again and Khatario will pick it up.',
        });
        expect(log).toHaveBeenCalledWith('[einvoice] IRN cancelled but not saved', { invoiceId: notSavedId, error: '57P01' });
      } finally {
        spy.mockRestore();
        log.mockRestore();
      }
      expect((await rowOf(notSavedId)).irn_status).toBe('active');

      // The portal now refuses: the IRN is already cancelled there.
      const d2 = deps({
        cancel: jest.fn(async () => { throw new GspError('rejected', '9999: Invoice is not active', '9999'); }),
        getByDocument: jest.fn(async () => found(8)),
      });
      const v = await cancelIrn(businessId, userId, notSavedId, reason, d2);
      expect(v.status).toBe('cancelled');
      expect(await rowOf(notSavedId)).toMatchObject({ irn: irnOf(8), irn_status: 'cancelled' });
    });
  });

  describe('lock', () => {
    const headers = {
      'content-type': 'application/json',
      'x-authenticated-user-id': userId,
      'x-authenticated-business-id': businessId,
      'x-authenticated-session-version': '1',
    };
    const req = (p: string, method: string, body: unknown) =>
      new NextRequest(`http://localhost${p}`, { method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

    /** The bodies the invoice editor and the cancel dialog send. */
    async function callRoute(route: string, id: string): Promise<Response> {
      const params = { params: { id } };
      if (route === 'amend') {
        const { PATCH } = await import('@/app/api/invoices/[id]/amend/route');
        return PATCH(req(`/api/invoices/${id}/amend`, 'PATCH', {
          invoice_date: todayIso, due_date: null, billing_address: '4 Link Road, Andheri', billing_name: 'Mehta Traders',
          shipping_address: '', notes: 'Changed', payment_terms: '', purchase_order_number: '', purchase_order_date: null,
          reference_number: '', delivery_note: '', other_references: '', dispatched_through: '', destination: '',
          terms_of_delivery: '', eway_bill_number: '', eway_bill_date: null, reason: undefined,
        }), params);
      }
      if (route === 'save') {
        // The editor saves an existing invoice with POST /api/invoices and its id.
        const { POST } = await import('@/app/api/invoices/route');
        return POST(req('/api/invoices', 'POST', {
          id, branch_id: branchId, customer_id: customerId, invoice_date: todayIso, status: 'final', document_type: 'tax_invoice',
          supply_type: 'b2b', place_of_supply_state_code: '27', notes: 'Changed', created_by: userId,
          items: [{ item_id: itemId, variant_id: null, item_name: 'Steel bar', quantity: 3, unit_price: 500, unit: 'NOS', discount_percent: 0, tax_rate: 18, hsn_sac: '721410', location_id: null }],
          subtotal: 1500, tax_total: 270, round_off: 0, grand_total: 1770,
        }));
      }
      const { PATCH } = await import('@/app/api/invoices/[id]/cancel/route');
      return PATCH(req(`/api/invoices/${id}/cancel`, 'PATCH', { reason: 'Wrong customer', cancelled_by: userId }), params);
    }

    it('irnLock answers only for an active IRN in this business', async () => {
      expect(await irnLock(pool, businessId, lockedInvoiceId)).toEqual({ error: IRN_LOCK_MESSAGE, code: 'IRN_LOCKED' });
      expect(await irnLock(pool, randomUUID(), lockedInvoiceId)).toBeNull();
      expect(await irnLock(pool, businessId, noIrnId)).toBeNull();
      expect(await irnLock(pool, businessId, irnCancelledId)).toBeNull();
    });

    it.each(['amend', 'save', 'cancel'])('the %s route refuses an invoice with an active IRN', async (route) => {
      const res = await callRoute(route, lockedInvoiceId);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: IRN_LOCK_MESSAGE, code: 'IRN_LOCKED' });
      expect(await rowOf(lockedInvoiceId)).toMatchObject({ status: 'final', irn_status: 'active' });
    });

    it('the invoice cancel itself refuses an active IRN under its row lock, whatever path calls it', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await expect(
          cancelPostedInvoiceInTransaction(client, { invoiceId: lockedInvoiceId, businessId, userId, reason: 'Wrong customer' }),
        ).rejects.toMatchObject({ code: 'IRN_LOCKED', statusCode: 409, message: IRN_LOCK_MESSAGE });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      expect(await rowOf(lockedInvoiceId)).toMatchObject({ status: 'final', irn_status: 'active' });
    });

    it('the cancel route shows the lock message, not a server error, when the IRN arrives after its first check', async () => {
      // The route's own check sees no IRN (as if the IRN was stored a moment later); the locked re-check refuses.
      const spy = jest.spyOn(einvoiceLock, 'irnLock').mockResolvedValueOnce(null);
      try {
        const res = await callRoute('cancel', lockedInvoiceId);
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: IRN_LOCK_MESSAGE, code: 'IRN_LOCKED' });
      } finally {
        spy.mockRestore();
      }
      expect(await rowOf(lockedInvoiceId)).toMatchObject({ status: 'final', irn_status: 'active' });
    });

    it('the cancel route works again once the IRN is cancelled', async () => {
      const res = await callRoute('cancel', irnCancelledId);
      expect(res.status).toBe(200);
      expect((await res.json()).invoice.status).toBe('cancelled');
      expect(await rowOf(irnCancelledId)).toMatchObject({ status: 'cancelled', irn: irnOf(10), irn_status: 'cancelled' });
    });

    it('the stock transfer cancel refuses when its inter-branch invoice has an active IRN, and writes nothing', async () => {
      const { PATCH } = await import('@/app/api/stock-transfers/[id]/cancel/route');
      const res = await PATCH(req(`/api/stock-transfers/${transferId}/cancel`, 'PATCH', { cancellation_reason: 'Wrong godown' }), { params: { id: transferId } });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: IRN_LOCK_MESSAGE, code: 'IRN_LOCKED' });
      expect((await pool.query(`SELECT status FROM stock_transfers WHERE id = $1`, [transferId])).rows[0].status).toBe('pending');
      expect(await rowOf(transferInvoiceId)).toMatchObject({ status: 'final', irn_status: 'active' });
    });

    it('still records an e-way bill number on an IRN invoice', async () => {
      const { PATCH } = await import('@/app/api/invoices/[id]/eway/route');
      const res = await PATCH(req(`/api/invoices/${lockedInvoiceId}/eway`, 'PATCH', { eway_bill_number: '331234567890', eway_bill_date: todayIso }), {
        params: { id: lockedInvoiceId },
      });
      expect(res.status).toBe(200);
    });

    describe('DELETE /api/invoices/[id]/einvoice', () => {
      const del = async (id: string, body: string) => {
        const { DELETE } = await import('@/app/api/invoices/[id]/einvoice/route');
        const r = await DELETE(req(`/api/invoices/${id}/einvoice`, 'DELETE', body), { params: { id } });
        return { status: r.status, json: await r.json() };
      };

      it('refuses a body that is not JSON', async () => {
        expect(await del(lockedInvoiceId, '{"reason": ')).toEqual({ status: 400, json: { error: 'The request could not be read.', code: 'BAD_REQUEST' } });
      });

      it('says not found for an invoice of another business', async () => {
        expect((await del(randomUUID(), JSON.stringify(reason))).status).toBe(404);
      });

      it('takes an empty reason as a status check past the window', async () => {
        // No saved Masters India login for this business, so the check answers that the window has closed.
        for (const body of ['', JSON.stringify({ reason: '', remarks: '' })]) {
          const r = await del(lateActId, body);
          expect([r.status, r.json.code]).toEqual([409, 'CANCEL_WINDOW_CLOSED']);
        }
        const r2 = await del(lockedInvoiceId, '');
        expect([r2.status, r2.json.code]).toEqual([400, 'REMARKS_REQUIRED']);
      });

      it('passes the body to the cancel and returns its refusal', async () => {
        const r1 = await del(noIrnId, JSON.stringify(reason));
        expect([r1.status, r1.json.code]).toEqual([409, 'NO_IRN']);
        const r2 = await del(lockedInvoiceId, JSON.stringify({ reason: 'data_entry', remarks: '' }));
        expect([r2.status, r2.json.code]).toEqual([400, 'REMARKS_REQUIRED']);
        // No saved Masters India login for this business: stops before any portal call.
        const r3 = await del(lockedInvoiceId, JSON.stringify(reason));
        expect([r3.status, r3.json.code]).toEqual([409, 'GSP_NOT_CONNECTED']);
        expect((await rowOf(lockedInvoiceId)).irn_status).toBe('active');
      });
    });
  });

  describe('e-way bill routing', () => {
    it('sends the e-way bill of an IRN invoice through the IRN', async () => {
      const ewbByIrn = jest.fn(async () => ({ number: '401008880911', generatedAt: new Date(), validUntil: new Date(Date.now() + 864e5), printUrl: null }));
      const generate = jest.fn();
      const v = await generateEwayBillViaGsp(businessId, userId, { source_type: 'invoice', source_id: irnInvoiceId, distance_km: 256, vehicle_number: 'KA01AB1234' }, { ...ewayDeps, generate, ewbByIrn });
      expect(generate).not.toHaveBeenCalled();
      expect(v.generated_via).toBe('irn');
      expect(ewbByIrn).toHaveBeenCalledWith(creds, {
        gstin: sellerGstin, irn: irnOf(11), distanceKm: 256, transport: expect.objectContaining({ mode: 'road', vehicleNumber: 'KA01AB1234' }),
      });
      const rows = (await pool.query(`SELECT generated_via, ewb_number, distance_km, status FROM eway_bills WHERE source_id = $1`, [irnInvoiceId])).rows;
      expect(rows).toEqual([{ generated_via: 'irn', ewb_number: '401008880911', distance_km: 256, status: 'active' }]);
    });

    it('still refuses a second e-way bill and stops at the limit before calling the portal', async () => {
      const ewbByIrn = jest.fn();
      await expect(generateEwayBillViaGsp(businessId, userId, { source_type: 'invoice', source_id: irnInvoiceId, distance_km: 256 }, { ...ewayDeps, ewbByIrn }))
        .rejects.toMatchObject({ code: 'EWAY_EXISTS' });
      await pool.query(`UPDATE subscription_plan_limits SET limit_value = 1 WHERE plan_id = $1 AND limit_key = 'max_eway_bills_per_month'`, [planId]);
      try {
        await expect(generateEwayBillViaGsp(businessId, userId, { source_type: 'invoice', source_id: irnTimeoutEwayId, distance_km: 256, vehicle_number: 'KA01AB1234' }, { ...ewayDeps, ewbByIrn }))
          .rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
      } finally {
        await pool.query(`UPDATE subscription_plan_limits SET limit_value = 100 WHERE plan_id = $1 AND limit_key = 'max_eway_bills_per_month'`, [planId]);
      }
      expect(ewbByIrn).not.toHaveBeenCalled();
    });

    it('after a timeout through the IRN, records the bill it finds for this document as made through the IRN', async () => {
      const found14: MiEwayResult = { ...ewayOk, ewbNumber: '401008880914' };
      const d1: EwayGenerateDeps = {
        ...ewayDeps,
        generate: jest.fn(),
        ewbByIrn: jest.fn(async () => { throw new GspError('timeout', 'slow'); }),
        findByDocument: jest.fn(async () => found14),
        getDetails: jest.fn(async () => held(14)),
      };
      const v = await generateEwayBillViaGsp(businessId, userId, { source_type: 'invoice', source_id: irnTimeoutEwayId, distance_km: 256, vehicle_number: 'KA01AB1234' }, d1);
      expect([v.generated_via, v.ewb_number]).toEqual(['irn', '401008880914']);
      expect(d1.generate).not.toHaveBeenCalled();
      expect(d1.findByDocument).toHaveBeenCalledTimes(1);
    });

    it('an invoice with an active IRN goes through the IRN even after the start date was moved later', async () => {
      const ewbByIrn = jest.fn(async () => ({ number: '401008880916', generatedAt: new Date(), validUntil: null, printUrl: null }));
      const generate = jest.fn();
      await pool.query(`UPDATE businesses SET einvoice_from = $2::date + 30 WHERE id = $1`, [businessId, todayIso]);
      try {
        const v = await generateEwayBillViaGsp(businessId, userId, { source_type: 'invoice', source_id: movedStartId, distance_km: 256, vehicle_number: 'KA01AB1234' }, { ...ewayDeps, generate, ewbByIrn });
        expect(v.generated_via).toBe('irn');
      } finally {
        await pool.query(`UPDATE businesses SET einvoice_from = $2::date - 10 WHERE id = $1`, [businessId, todayIso]);
      }
      expect(ewbByIrn).toHaveBeenCalledTimes(1);
      expect(generate).not.toHaveBeenCalled();
    });

    it('asks for the e-invoice first when the invoice is covered but has no IRN', async () => {
      const d1 = { ...ewayDeps, generate: jest.fn(), ewbByIrn: jest.fn() };
      await expect(generateEwayBillViaGsp(businessId, userId, { source_type: 'invoice', source_id: noIrnId, distance_km: 256 }, d1)).rejects.toMatchObject({
        code: 'IRN_REQUIRED', status: 409,
        message: 'Generate the e-invoice for this invoice first. Its e-way bill comes through the e-invoice.',
      });
      expect(d1.generate).not.toHaveBeenCalled();
      expect(d1.ewbByIrn).not.toHaveBeenCalled();
    });

    it('refuses an invoice whose e-invoice was cancelled', async () => {
      const d1 = { ...ewayDeps, generate: jest.fn(), ewbByIrn: jest.fn() };
      await expect(generateEwayBillViaGsp(businessId, userId, { source_type: 'invoice', source_id: irnCancelledEwayId, distance_km: 256 }, d1)).rejects.toMatchObject({
        code: 'IRN_CANCELLED', status: 409,
        message: 'The e-invoice for this invoice was cancelled, so an e-way bill cannot be made for it.',
      });
      expect(d1.generate).not.toHaveBeenCalled();
      expect(d1.ewbByIrn).not.toHaveBeenCalled();
    });

    it('a B2C invoice of the same business still uses the plain e-way bill call', async () => {
      const generate = jest.fn(async () => ewayOk);
      const ewbByIrn = jest.fn();
      const v = await generateEwayBillViaGsp(businessId, userId, { source_type: 'invoice', source_id: b2cInvoiceId, distance_km: 256, vehicle_number: 'KA01AB1234' }, { ...ewayDeps, generate, ewbByIrn });
      expect(generate).toHaveBeenCalledTimes(1);
      expect(ewbByIrn).not.toHaveBeenCalled();
      expect(v.generated_via).toBe('api');
    });
  });
});
