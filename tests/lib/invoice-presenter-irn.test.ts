jest.mock('@/lib/db', () => ({ queryOne: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/custom-fields-render', () => ({
  enrichInvoiceRenderData: jest.fn(async (data: unknown) => data),
}));

import { prepareInvoiceForRendering } from '@/lib/invoice-presenter';
import { invoicePayloadToReceipt } from '@/lib/bluetooth/invoice-payload-to-receipt';
import QRCode from 'qrcode';

const base = { invoice_number: 'INV-142', invoice_date: '2026-11-27', document_type: 'tax_invoice' };
const presentInvoice = async (invoice: Record<string, unknown>) =>
  (await prepareInvoiceForRendering({ invoice, business: { name: 'Shree Traders' }, customer: { name: 'Mahalaxmi' }, items: [] })).invoice;

describe('prepareInvoiceForRendering: e-invoice (IRN) fields', () => {
  it('exposes the IRN and a QR image only for an active e-invoice', async () => {
    const active = await presentInvoice({ ...base, irn: 'a'.repeat(64), irn_ack_no: '1423', irn_ack_date: '2026-11-27T08:00:00Z', irn_signed_qr: 'eyJ.x.y', irn_status: 'active' });
    expect(active.irn).toHaveLength(64);
    expect(active.irn_ack_no).toBe('1423');
    expect(active.irn_ack_date).toBe('27/11/2026');
    expect(active.irn_qr_data_url).toMatch(/^data:image\/png;base64,/);
    const cancelled = await presentInvoice({ ...base, irn: 'a'.repeat(64), irn_signed_qr: 'q', irn_status: 'cancelled' });
    expect([cancelled.irn, cancelled.irn_qr_data_url]).toEqual([null, null]);
    expect([cancelled.irn_ack_no, cancelled.irn_ack_date]).toEqual([null, null]);
  });

  it('draws the QR from the full signed string, unchanged', async () => {
    const signed = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEifQ.' + 'x'.repeat(900) + '.sig+/=';
    const spy = jest.spyOn(QRCode, 'toDataURL');
    try {
      const active = await presentInvoice({ ...base, irn: 'd'.repeat(64), irn_signed_qr: signed, irn_status: 'active' });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe(signed);
      expect(active.irn_qr_data_url).toMatch(/^data:image\/png;base64,/);
      expect(active.irn_parts.join('')).toBe('d'.repeat(64));
    } finally {
      spy.mockRestore();
    }
  });

  it('dates the acknowledgement in Indian time', async () => {
    // 20:00 UTC on the 27th is 01:30 on the 28th in India.
    const late = await presentInvoice({ ...base, irn: 'b'.repeat(64), irn_ack_date: '2026-11-27T20:00:00Z', irn_signed_qr: 'x', irn_status: 'active' });
    expect(late.irn_ack_date).toBe('28/11/2026');
  });

  it('leaves the IRN fields empty on a document without one', async () => {
    const none = await presentInvoice({ ...base });
    expect([none.irn, none.irn_ack_no, none.irn_ack_date, none.irn_qr_data_url]).toEqual([null, null, null, null]);
  });
});

describe('invoicePayloadToReceipt: e-invoice lines on the Bluetooth receipt', () => {
  const inv = { invoice_number: 'INV-1', invoice_date: '2026-11-27', irn: 'c'.repeat(64), irn_ack_no: '99', irn_ack_date: '2026-11-27T08:00:00Z', irn_signed_qr: 'SIGNED' };

  it('reads the IRN columns of an active e-invoice', () => {
    const r = invoicePayloadToReceipt({ ...inv, irn_status: 'active' }, {});
    expect([r.irn, r.ackNo, r.ackDate, r.signedQr]).toEqual(['c'.repeat(64), '99', '27/11/2026', 'SIGNED']);
  });

  it('prints nothing for a cancelled e-invoice', () => {
    const r = invoicePayloadToReceipt({ ...inv, irn_status: 'cancelled' }, {});
    expect([r.irn, r.ackNo, r.ackDate, r.signedQr]).toEqual([null, null, null, null]);
  });
});
