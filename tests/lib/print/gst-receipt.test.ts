import { buildInvoiceReceiptEscPos, hsnSummary, type ReceiptData } from '@/lib/bluetooth/invoice-to-escpos';
import { invoicePayloadToReceipt } from '@/lib/bluetooth/invoice-payload-to-receipt';
import { withServerTextRaster } from '@/lib/print/text-raster-server';

const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

const bill: ReceiptData = {
  business: { name: 'Sharma Kirana', gstin: '27ABCDE1234F1Z5' },
  invoiceNumber: 'INV-101',
  invoiceDate: new Date(2026, 9, 16, 10, 30),
  items: [
    { name: 'Toor Dal 1kg', hsn: '0713', quantity: 2, unitPrice: 165, amount: 346.5, taxRate: 5, taxableValue: 330, taxAmount: 16.5 },
    { name: 'Soap', hsn: '3401', quantity: 3, unitPrice: 40, amount: 141.6, taxRate: 18, taxableValue: 120, taxAmount: 21.6 },
    { name: 'Chana Dal', hsn: '0713', quantity: 1, unitPrice: 120, amount: 126, taxRate: 5, taxableValue: 120, taxAmount: 6 },
  ],
  subtotal: 570,
  cgstTotal: 22.05,
  sgstTotal: 22.05,
  grandTotal: 614.1,
  paymentMode: 'Cash',
  placeOfSupplyStateCode: '27',
  placeOfSupplyName: 'Maharashtra',
};

describe('GST thermal bill', () => {
  it('groups tax by HSN and rate', () => {
    expect(hsnSummary(bill.items)).toEqual([
      { hsn: '0713', rate: 5, taxable: 450, tax: 22.5 },
      { hsn: '3401', rate: 18, taxable: 120, tax: 21.6 },
    ]);
  });

  it('prints title, place of supply, quantity, amount in words and HSN summary', () => {
    const out = text(buildInvoiceReceiptEscPos(bill, { paperWidthMm: 80 }));
    expect(out).toContain('TAX INVOICE');
    expect(out).toContain('Place of supply: Maharashtra (27)');
    expect(out).toContain('Items: 3  Qty: 6');
    expect(out).toMatch(/Six Hundred Fourteen Rupees and Ten Paise\s+Only/);
    expect(out).toContain('HSN/SAC');
    expect(out).toMatch(/0713\s+450\.00\s+5\s+22\.50/);
  });

  it('marks bills of supply and leaves out the tax summary', () => {
    const out = text(buildInvoiceReceiptEscPos({ ...bill, documentType: 'bill_of_supply' }));
    expect(out).toContain('BILL OF SUPPLY');
    expect(out).toContain("eligible to collect tax");
    expect(out).not.toContain('HSN/SAC');
  });

  it('prints extra copies as DUPLICATE and opens the drawer once', () => {
    const bytes = buildInvoiceReceiptEscPos(bill, { copies: 2, openDrawer: true });
    const out = text(bytes);
    expect(out.match(/TAX INVOICE - DUPLICATE/g)).toHaveLength(1);
    expect(out.match(/INV-101/g)).toHaveLength(2);
    expect(out.split('\x1bp\x00\x19\xfa')).toHaveLength(2);
  });

  it('keeps unregistered shop bills plain', () => {
    const out = text(buildInvoiceReceiptEscPos({ ...bill, business: { name: 'Corner Shop' } }));
    expect(out).not.toContain('TAX INVOICE');
    expect(out).not.toContain('HSN/SAC');
  });

  it('maps invoice API rows to tax fields and place of supply', () => {
    const r = invoicePayloadToReceipt(
      {
        invoice_number: 'INV-9',
        invoice_date: '2026-10-16',
        place_of_supply_state_code: '24',
        document_type: 'regular',
        items: [{ item_name: 'Rice', hsn_sac: '1006', quantity: '2', unit_price: '50', line_total: '105', tax_rate: '5', taxable_value: '100', tax_amount: '5' }],
      },
      { name: 'Shop', gstin: '24AAAAA0000A1Z5' }
    );
    expect(r.placeOfSupplyName).toBe('Gujarat');
    expect(r.items[0]).toMatchObject({ hsn: '1006', taxRate: 5, taxableValue: 100, taxAmount: 5 });
  });
});

describe('server text raster (phone app bytes)', () => {
  it('draws Hindi item names into the bill with sharp', async () => {
    const hindi: ReceiptData = { ...bill, items: [{ ...bill.items[0], name: 'तूर दाल' }] };
    const bytes = await withServerTextRaster((rasterize) => buildInvoiceReceiptEscPos(hindi, { paperWidthMm: 58, rasterize }));
    const at = bytes.findIndex((_, i) => bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30);
    expect(at).toBeGreaterThan(0);
    const rowBytes = bytes[at + 4] | (bytes[at + 5] << 8);
    const height = bytes[at + 6] | (bytes[at + 7] << 8);
    expect(rowBytes).toBe(48);
    const image = bytes.subarray(at + 8, at + 8 + rowBytes * height);
    // Real glyphs, not a blank placeholder.
    expect(image.some((b) => b !== 0)).toBe(true);
  });
});
