import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { registerGlobalInvoiceHandlebarsHelpers } from '@/lib/handlebars-invoice-helpers';
import { registerInvoiceHandlebarsPartials } from '@/lib/handlebars-invoice-partials';

registerGlobalInvoiceHandlebarsHelpers();
registerInvoiceHandlebarsPartials();

const template = Handlebars.compile(
  fs.readFileSync(path.join(process.cwd(), 'templates/gst_standard/template.html'), 'utf8')
);

function render(invoice: Record<string, unknown>) {
  return template({
    invoice: {
      items: [],
      subtotal: '11000.00',
      tax_total: '1980.00',
      cgst_total: '990.00',
      sgst_total: '990.00',
      igst_total: '0.00',
      additional_charges: '1000.00',
      round_off: '0.00',
      grand_total: '12980.00',
      is_igst: false,
      discount_total: '0.00',
      paid_amount: '0.00',
      balance_amount: '12980.00',
      ...invoice,
    },
    settings: { show_additional_charges: true, show_subtotal: true, show_cgst: true, show_sgst: true, show_grand_total: true },
    business: { name: 'Test' },
    customer: { name: 'Asha' },
  });
}

describe('printed invoice shows a classified charge once', () => {
  it('hides the extra total row when the charge is already inside the subtotal', () => {
    const html = render({ charges_included: true });
    expect(html).not.toContain('Additional Charges');
    expect(html).toContain('11,000.00');
    expect(html).toContain('12,980.00');
  });

  it('keeps the extra total row for an old untaxed header charge', () => {
    const html = render({
      charges_included: false,
      subtotal: '10000.00',
      tax_total: '1800.00',
      cgst_total: '900.00',
      sgst_total: '900.00',
      grand_total: '12800.00',
      balance_amount: '12800.00',
    });
    expect(html).toContain('Additional Charges');
    expect(html).toContain('1,000.00');
    expect(html).toContain('12,800.00');
  });
});
