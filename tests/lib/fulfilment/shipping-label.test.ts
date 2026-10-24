import { buildShippingLabelHtml, paymentBanner, type ShippingLabelData } from '@/lib/fulfilment/shipping-label';

const base: ShippingLabelData = {
  orderNumber: 'SO-1042',
  invoiceNumber: 'INV-0091',
  orderDate: '3 Oct 2026',
  to: { name: 'Meena Shah', phone: '9811111111', address: 'Flat 2, Lake Road, Pune', pincode: '411001' },
  from: { name: 'Asha Stores', address: 'Shop 4, MG Road, Pune', pincode: '411002', phone: '9800000001', gstin: '27AAAPA1234A1Z5' },
  carrier: 'Delhivery',
  awb: 'DL12345',
  paid: false,
  codAmount: 1250,
  itemCount: 3,
  boxes: 1,
};
const bars: string[] = [];
const barcode = (t: string) => {
  bars.push(t);
  return `<svg data-code="${t}"></svg>`;
};

beforeEach(() => {
  bars.length = 0;
});

describe('shipping label', () => {
  it('puts the cash to collect in the banner, prepaid parcels say not to collect', () => {
    expect(paymentBanner({ paid: false, codAmount: 1250 })).toEqual({ text: 'CASH ON DELIVERY · COLLECT ₹1,250', tone: 'cod' });
    expect(paymentBanner({ paid: true, codAmount: 0 }).text).toBe('PREPAID · DO NOT COLLECT CASH');
    expect(paymentBanner({ paid: false, codAmount: 0 }).tone).toBe('unpaid');
  });

  it('shows the buyer, return address, courier barcodes and no prices', () => {
    const html = buildShippingLabelHtml(base, '4x6', barcode);
    expect(html).toContain('Meena Shah');
    expect(html).toContain('PIN 411001');
    expect(html).toContain('Flat 2, Lake Road, Pune');
    expect(html).toContain('FROM / RETURN TO');
    expect(html).toContain('GSTIN 27AAAPA1234A1Z5');
    expect(html).toContain('size:4in 6in');
    expect(bars).toEqual(['DL12345', 'SO-1042']);
    expect(html).toContain('3 items');
    expect(html.match(/₹/g)).toHaveLength(1);
    expect(buildShippingLabelHtml({ ...base, paid: true, codAmount: 0 }, '4x6', barcode)).not.toContain('₹');
  });

  it('prints one label per box', () => {
    const html = buildShippingLabelHtml({ ...base, boxes: 3 }, 'a4', barcode);
    expect(html.match(/<section class="label">/g)).toHaveLength(3);
    expect(html).toContain('BOX 1 / 3');
    expect(html).toContain('BOX 3 / 3');
    expect(html).toContain('size:A4');
    expect(buildShippingLabelHtml({ ...base, boxes: 500 }, '4x6', barcode).match(/<section class="label">/g)).toHaveLength(50);
  });

  it('escapes names and addresses typed by customers', () => {
    const html = buildShippingLabelHtml(
      { ...base, to: { ...base.to, name: '<img src=x onerror=alert(1)>', address: 'A "B" & C' } },
      '4x6',
      barcode,
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('A &quot;B&quot; &amp; C');
  });

  it('works without a courier tracking number or address', () => {
    const html = buildShippingLabelHtml({ ...base, awb: null, carrier: null, to: { ...base.to, address: null, pincode: null } }, '4x6', barcode);
    expect(html).toContain('Own delivery');
    expect(html).toContain('No address on file');
    expect(bars).toEqual(['SO-1042']);
  });
});
