import Handlebars from 'handlebars';
import { registerGlobalInvoiceHandlebarsHelpers } from '@/lib/handlebars-invoice-helpers';

describe('invoice handlebars block helpers', () => {
  beforeAll(() => {
    registerGlobalInvoiceHandlebarsHelpers();
  });

  it('returns a boolean from (and) inside {{#or}} when the condition is false', () => {
    const html = Handlebars.compile(
      '{{#or (and settings.show_bank_details business.bank_name) (and settings.show_payment_terms settings.payment_terms)}}BANK{{else}}NONE{{/or}}',
    )({ settings: {}, business: {} });
    expect(html).toBe('NONE');
  });

  it('renders the block when a nested (and) is true', () => {
    const html = Handlebars.compile(
      '{{#or (and settings.show_bank_details business.bank_name) (and settings.show_terms settings.terms)}}SHOWN{{else}}NONE{{/or}}',
    )({
      settings: { show_terms: true, terms: 'Pay in 7 days' },
      business: {},
    });
    expect(html).toBe('SHOWN');
  });
});
