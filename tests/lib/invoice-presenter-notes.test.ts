jest.mock('@/lib/db', () => ({ queryOne: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/custom-fields-render', () => ({
  enrichInvoiceRenderData: jest.fn(async (data: unknown) => data),
}));

import { prepareInvoiceForRendering } from '@/lib/invoice-presenter';

const baseDoc = (invoice: Record<string, unknown>) => ({
  invoice: { invoice_number: 'INV-029', invoice_date: '2026-10-02', document_type: 'tax_invoice', ...invoice },
  business: { name: 'QA Trial Traders' },
  customer: { name: 'Walk-in' },
  items: [],
});

describe('prepareInvoiceForRendering: notes and terms typed on the invoice', () => {
  it('prints invoice notes even when the template switch for notes is off', async () => {
    const data = await prepareInvoiceForRendering(baseDoc({ notes: 'this is a test notes' }), {
      show_notes: false,
      notes: 'Template default note',
    });
    expect(data.settings.notes).toBe('this is a test notes');
    expect(data.settings.show_notes).toBe(true);
  });

  it('prints invoice terms even when the template switch for terms is off', async () => {
    const data = await prepareInvoiceForRendering(baseDoc({ terms: 'Goods once sold are not returnable' }), {
      show_terms: false,
    });
    expect(data.settings.terms).toBe('Goods once sold are not returnable');
    expect(data.settings.show_terms).toBe(true);
  });

  it('leaves the template switch alone when the invoice has no notes', async () => {
    const data = await prepareInvoiceForRendering(baseDoc({ notes: '   ' }), {
      show_notes: false,
      notes: 'Template default note',
    });
    expect(data.settings.notes).toBe('Template default note');
    expect(data.settings.show_notes).toBe(false);
  });
});
