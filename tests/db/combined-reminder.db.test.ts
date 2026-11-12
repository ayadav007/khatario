/**
 * The daily reminder run on a real database groups by customer: Asha has four unpaid bills (two
 * overdue, one due in two days, one due later) and gets ONE WhatsApp with her statement PDF and a
 * bills link; Vijay has one overdue bill and gets the single-invoice reminder. A second run the
 * same day sends nothing. WhatsApp, the PDF renderer and plan checks are stubbed; SQL is real.
 * Opt-in, disposable DB only:
 *   INVOICE_PAY_DB_TEST=1 npx jest tests/db/combined-reminder.db.test.ts --runInBand
 * (or set PHASE2_TEST_DATABASE_URL). The test applies migrations 474 and 475 itself.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { config as loadEnv } from 'dotenv';

const TEST_DB = 'kh_phase2_test';
const enabled = !!process.env.PHASE2_TEST_DATABASE_URL || process.env.INVOICE_PAY_DB_TEST === '1';
if (process.env.PHASE2_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PHASE2_TEST_DATABASE_URL;
} else if (enabled) {
  const env: Record<string, string> = {};
  loadEnv({ path: '.env', processEnv: env });
  const auth = `${encodeURIComponent(env.DB_USER || 'postgres')}:${encodeURIComponent(env.DB_PASSWORD || '')}`;
  process.env.DATABASE_URL = `postgresql://${auth}@localhost:${env.DB_PORT || '5432'}/${TEST_DB}`;
  process.env.DB_SSL = 'false';
}
process.env.PAYMENT_REMINDER_QUEUE_DISABLED = '1';
const d = enabled ? describe : describe.skip;

const rendered: string[] = [];
jest.mock('puppeteer', () => ({
  __esModule: true,
  default: {
    launch: jest.fn(async () => ({
      newPage: async () => ({
        setContent: async (html: string) => {
          rendered.push(html);
        },
        pdf: async () => Buffer.from('%PDF-1.4 statement'),
      }),
      close: async () => undefined,
    })),
  },
}));
jest.mock('@/lib/whatsapp', () => ({ sendWhatsAppMessage: jest.fn(async () => 'wa-msg-1') }));
jest.mock('@/lib/whatsapp/business-transport', () => ({ businessTransport: jest.fn(async () => 'baileys') }));
jest.mock('@/lib/whatsapp/outbound-ready', () => ({ whatsAppOutboundReady: jest.fn(async () => ({ ready: true })) }));
jest.mock('@/lib/whatsapp/baileys-pacing', () => ({
  ...jest.requireActual('@/lib/whatsapp/baileys-pacing'),
  sleep: jest.fn(async () => undefined),
}));
jest.mock('@/lib/email-reminder', () => ({ sendEmailReminder: jest.fn(async () => ({ success: false })) }));
jest.mock('@/lib/pdf-generator', () => ({ generateInvoicePdf: jest.fn(async () => Buffer.from('%PDF invoice')) }));
jest.mock('@/lib/subscription', () => ({
  ...jest.requireActual('@/lib/subscription'),
  hasFeature: jest.fn(async () => true),
  checkLimit: jest.fn(async () => ({ allowed: true, limit: -1, current: 0 })),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { createInvoiceLedgerEntries } from '@/lib/ledger-utils';
import { checkAndSendReminders } from '@/lib/payment-reminder-checker';
import { getReminderRecoveryReport } from '@/lib/payment-reminders/recovery';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

d('combined payment reminder per customer (real DB)', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const ASHA = randomUUID();
  const VIJAY = randomUUID();
  const tag = B.slice(0, 8);
  const inv: Record<string, string> = {};
  const day = (offset: number) => new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);

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

  async function invoice(key: string, customer: string, total: number, invoiceDate: string, due: string) {
    const id = randomUUID();
    const number = `${key}-${tag}`;
    await tx(async (c) => {
      await c.query(
        `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, due_date, status, document_type,
            place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
            paid_amount, balance_amount, payment_status, branch_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'final', 'tax_invoice', '27', $7, 0, 0, 0, 0, $7, 0, $7, 'unpaid', $8)`,
        [id, B, customer, number, invoiceDate, due, total, BR],
      );
      await createInvoiceLedgerEntries({
        businessId: B, invoiceId: id, invoiceNumber: number, invoiceDate, grandTotal: total,
        customerId: customer, isCashSale: false, branchId: BR, taxableValue: total, poolClient: c,
      });
      await c.query(`UPDATE customers SET current_balance = current_balance + $1 WHERE id = $2`, [total, customer]);
    });
    inv[key] = id;
  }

  beforeAll(async () => {
    pool = getPool();
    for (const f of ['474_invoice_online_payments.sql', '475_customer_bills_statement.sql']) {
      await pool.query(readFileSync(path.join(process.cwd(), 'database/migrations', f), 'utf8'));
    }
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, $3, '27', 'regular')`,
      [B, `Combined ${tag}`, `27AABCC${tag.slice(0, 4).toUpperCase()}B1Z5`],
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
      [A, B, `91${String(Date.now()).slice(-10)}`],
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO customers (id, business_id, name, phone, state_code, current_balance)
       VALUES ($1, $2, 'Asha', '9822222222', '27', 0), ($3, $2, 'Vijay', '9833333333', '27', 0)`,
      [ASHA, B, VIJAY],
    );
    await pool.query(
      `INSERT INTO whatsapp_reminder_settings (business_id, reminder_type, enabled, days_before, interval_days, message_template, include_pdf)
       VALUES ($1, 'payment_due', true, 3, NULL, 'Hi {customer_name}, {invoice_no} is due', false),
              ($1, 'overdue', true, NULL, 7, 'Hi {customer_name}, {invoice_no} is overdue', false)`,
      [B],
    );
    await invoice('A1', ASHA, 3000, day(-45), day(-30));
    await invoice('A2', ASHA, 5000, day(-25), day(-10));
    await invoice('A3', ASHA, 2000, day(-5), day(2));
    await invoice('A4', ASHA, 1500, day(-1), day(20));
    await invoice('V1', VIJAY, 800, day(-20), day(-5));
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', A, async () => {
          await c.query(`DELETE FROM whatsapp_messages WHERE business_id = $1`, [B]);
          await c.query(`DELETE FROM businesses WHERE id = $1`, [B]);
        });
      });
    } finally {
      await closePool();
    }
  });

  test('one combined message for Asha, the single reminder for Vijay, nothing on a second run', async () => {
    const run = await checkAndSendReminders(B, 'Asia/Kolkata');
    expect(run.overdue.sent + run.payment_due.sent).toBe(2);

    const calls = (sendWhatsAppMessage as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    const asha = calls.find((c) => String(c[2]).includes('Hi Asha'))!;
    expect(String(asha[2])).toContain('You have 4 unpaid bills');
    expect(String(asha[2])).toContain('To pay: ₹11,500.00');
    expect(String(asha[2])).toMatch(/\/b\/[A-Za-z0-9_-]+/);
    expect(Buffer.isBuffer(asha[3])).toBe(true);
    expect(asha[7]).toMatchObject({ mimeType: 'application/pdf' });
    const vijay = calls.find((c) => String(c[2]).includes('Vijay'))!;
    expect(String(vijay[2])).toContain(`V1-${tag} is overdue`);

    // The statement PDF lists every unpaid bill above the ledger.
    const html = rendered.join('\n');
    expect(html).toContain('Unpaid bills');
    for (const k of ['A1', 'A2', 'A3', 'A4']) expect(html).toContain(`${k}-${tag}`);

    const rows = await pool.query<{ reference_id: string; reminder_source: string; batch_id: string | null; amount_due: string }>(
      `SELECT reference_id, reminder_source, batch_id, amount_due FROM whatsapp_messages
        WHERE business_id = $1 AND message_type = 'reminder' AND status = 'sent' ORDER BY sent_at`,
      [B],
    );
    const ashaRows = rows.rows.filter((r) => r.batch_id);
    expect(new Set(ashaRows.map((r) => r.batch_id)).size).toBe(1);
    const byInvoice = Object.fromEntries(ashaRows.map((r) => [r.reference_id, r.reminder_source]));
    expect(byInvoice).toEqual({ [inv.A1]: 'auto_overdue', [inv.A2]: 'auto_overdue', [inv.A3]: 'auto_payment_due' });
    expect(Number(ashaRows.find((r) => r.reference_id === inv.A2)!.amount_due)).toBe(5000);

    const again = await checkAndSendReminders(B, 'Asia/Kolkata');
    expect(again.overdue.sent + again.payment_due.sent).toBe(0);
    expect((sendWhatsAppMessage as jest.Mock).mock.calls).toHaveLength(2);

    const today = day(0);
    const report = await getReminderRecoveryReport(B, today, today);
    expect(report.totals.reminders_sent).toBe(2);
    expect(report.totals.invoices_reminded).toBe(4);
  });
});
