/**
 * Payment reminders carry the bill's view-and-pay link, and the customer is thanked when a
 * payment comes in (lib/reminder-message-processor.ts, lib/invoices/payment-received-notify.ts).
 */
jest.mock('@/lib/db', () => ({ queryOne: jest.fn(), query: jest.fn(), queryRows: jest.fn() }));
jest.mock('@/lib/whatsapp', () => ({ sendWhatsAppMessage: jest.fn() }));
jest.mock('@/lib/pdf-generator', () => ({ generateInvoicePdf: jest.fn() }));
jest.mock('@/lib/meta-whatsapp', () => ({}));
jest.mock('puppeteer', () => ({ __esModule: true, default: { launch: jest.fn() } }));
jest.mock('@/lib/whatsapp/tenant-send', () => ({ notifyBusinessEvent: jest.fn(), sendEventTemplate: jest.fn(), eventTemplateFailureMessage: jest.fn() }));

import { processTemplate, templateHasLink, withPaymentLink } from '@/lib/reminder-message-processor';
import { billsPaymentReceivedText, paymentReceivedText } from '@/lib/invoices/payment-received-notify';
import { statementReminderText, type CustomerDues } from '@/lib/payment-reminders/statement';
import { buildCustomerStatementHtml } from '@/lib/party-statement-print';
import { buildEasebuzzTxnId, easebuzzTxnContext } from '@/lib/payments/providers/easebuzz-payment-provider';
import { getTenantWaEvent, isTenantWaEventKey } from '@/lib/whatsapp/tenant-events';

const invoice = { invoice_number: 'INV-7', grand_total: 1200, balance_amount: 700, due_date: '2026-11-20' };
const LINK = 'https://khatario.com/i/tok123';

describe('reminder pay link', () => {
  test('{payment_link} and {invoice_link} are filled with the bill link', () => {
    const out = processTemplate('Pay {balance_amount}: {payment_link} / {invoice_link}', invoice, { name: 'Ravi' }, { name: 'Shop' }, LINK);
    expect(out).toBe(`Pay ₹700.00: ${LINK} / ${LINK}`);
  });

  test('without a link the placeholder is blanked, never sent raw', () => {
    expect(processTemplate('Pay here {payment_link}', invoice, {}, {})).toBe('Pay here ');
  });

  test('a saved template without a link placeholder gets the link appended once', () => {
    const tpl = 'Hi {customer_name}, invoice {invoice_no} is due.';
    const msg = processTemplate(tpl, invoice, { name: 'Ravi' }, {}, LINK);
    expect(withPaymentLink(msg, tpl, LINK)).toBe(`Hi Ravi, invoice INV-7 is due.\n\nView and pay: ${LINK}`);
  });

  test('a template that already has the link is left alone; no link means nothing appended', () => {
    const tpl = 'Pay: {payment_link}';
    expect(templateHasLink(tpl)).toBe(true);
    expect(withPaymentLink(`Pay: ${LINK}`, tpl, LINK)).toBe(`Pay: ${LINK}`);
    expect(withPaymentLink('Hi', 'Hi', '')).toBe('Hi');
  });
});

describe('payment received message', () => {
  const base = { customerName: 'Ravi', businessName: 'Sharma Traders', invoiceNumber: 'INV-7', amountPaid: '500.00', link: LINK };

  test('part payment states the balance still due', () => {
    const text = paymentReceivedText({ ...base, amountDue: 700 });
    expect(text).toContain('received ₹500.00 for invoice INV-7');
    expect(text).toContain('Balance still due: ₹700.00.');
    expect(text).toContain(LINK);
  });

  test('full payment says the invoice is paid', () => {
    const text = paymentReceivedText({ ...base, amountDue: 0, link: '' });
    expect(text).toContain('This invoice is now fully paid.');
    expect(text).not.toContain('View your bill');
  });

  test('the event is registered with an amount paid field', () => {
    expect(isTenantWaEventKey('invoice_payment_received')).toBe(true);
    const ev = getTenantWaEvent('invoice_payment_received');
    expect(ev.fields).toContain('amount_paid');
    expect(ev.suggested.variableMap.every((k) => ev.fields.includes(k))).toBe(true);
  });
});

describe('easebuzz invoice txn ids', () => {
  test('IN prefix round-trips', () => {
    const id = buildEasebuzzTxnId('IN', '8f1c2d3e-aaaa-bbbb-cccc-111122223333', 1700000000000);
    expect(id.startsWith('IN-')).toBe(true);
    expect(id.length).toBeLessThanOrEqual(40);
    expect(easebuzzTxnContext(id)).toBe('IN');
  });
});

describe('combined reminder', () => {
  const bill = (n: number, balance: number, days: number) => ({
    id: `id-${n}`,
    invoice_number: `INV-${n}`,
    invoice_date: '2026-10-01',
    due_date: '2026-10-15',
    grand_total: balance,
    balance,
    days_overdue: days,
  });
  const dues: CustomerDues = {
    bills: [bill(1, 3000, 30), bill(2, 5000, 0)],
    billsDue: 8000,
    advance: 1000,
    toPay: 7000,
    overdue: 3000,
  };

  test('lists each bill, the advance and what to pay, with the bills link', () => {
    const text = statementReminderText({ customerName: 'Asha', businessName: 'Sharma Traders', dues, link: 'https://k.com/b/x' });
    expect(text).toContain('You have 2 unpaid bills with Sharma Traders');
    expect(text).toContain('• INV-1: ₹3,000.00 (overdue 30 days)');
    expect(text).toContain('Less advance with us: ₹1,000.00');
    expect(text).toContain('*To pay: ₹7,000.00*');
    expect(text).toContain('https://k.com/b/x');
  });

  test('more than ten bills are summarised in the text', () => {
    const many = { ...dues, bills: Array.from({ length: 13 }, (_, i) => bill(i + 1, 100, 1)), advance: 0 };
    const text = statementReminderText({ customerName: 'A', businessName: 'B', dues: many, link: '' });
    expect(text).toContain('• and 3 more');
    expect(text).not.toContain('Less advance');
  });

  test('the statement PDF puts unpaid bills and "to pay" above the ledger', () => {
    const html = buildCustomerStatementHtml({
      businessName: 'Sharma Traders',
      partyName: 'Asha',
      fromDate: '2026-10-01',
      toDate: '2026-11-12',
      openingBalance: 0,
      closingBalance: 8000,
      transactions: [],
      dues: { ...dues, payLink: 'https://k.com/b/x' },
    });
    expect(html.indexOf('Unpaid bills')).toBeLessThan(html.indexOf('<h2 class="sec">Ledger</h2>'));
    expect(html).toContain('Less advance with us');
    expect(html).toContain('To pay');
    expect(html).toContain('https://k.com/b/x');
  });

  test('payment received for several bills lists what was cleared', () => {
    const text = billsPaymentReceivedText({
      customerName: 'Asha',
      businessName: 'Sharma Traders',
      amountPaid: 7000,
      cleared: [
        { invoiceNumber: 'INV-1', amount: 3000, fullyPaid: true },
        { invoiceNumber: 'INV-2', amount: 4000, fullyPaid: false },
      ],
      stillDue: 1000,
      openBills: 1,
      link: '',
    });
    expect(text).toContain('received ₹7,000.00');
    expect(text).toContain('• INV-1: ₹3,000.00 (paid)');
    expect(text).toContain('• INV-2: ₹4,000.00 (part paid)');
    expect(text).toContain('Still due: ₹1,000.00 on 1 bill.');
  });
});
