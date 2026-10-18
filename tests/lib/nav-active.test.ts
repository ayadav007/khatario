import { pickActiveNavHref } from '@/lib/navigation/nav-active';

const HREFS = [
  '/dashboard',
  '/suppliers',
  '/suppliers/hub',
  '/invoices',
  '/invoices/new?type=proforma_invoice',
  '/items',
  '/items/barcodes',
  '/reports',
  '/reports/profit-loss',
  '/reports/sales/summary',
  '/whatsapp/contacts',
  '/whatsapp/contacts/groups',
  '/settings',
  '/settings/business',
  '/settings/business#bp-features',
  '/settings/integrations',
  '/settings/integrations?category=sms',
  '/settings/whatsapp',
  '/settings/whatsapp/templates',
];

function active(pathname: string, search = '', hash = '') {
  return pickActiveNavHref(HREFS, pathname, search, hash);
}

describe('pickActiveNavHref', () => {
  it('highlights the longer report, not Overview', () => {
    expect(active('/reports/profit-loss')).toBe('/reports/profit-loss');
    expect(active('/reports')).toBe('/reports');
    expect(active('/reports/sales/summary')).toBe('/reports/sales/summary');
  });

  it('highlights Print Labels instead of Items, and Supplier Hub instead of Suppliers', () => {
    expect(active('/items/barcodes')).toBe('/items/barcodes');
    expect(active('/items')).toBe('/items');
    expect(active('/items/abc')).toBe('/items');
    expect(active('/suppliers/hub')).toBe('/suppliers/hub');
  });

  it('keeps a list link current when the page has filter params', () => {
    expect(active('/invoices', 'status=unpaid')).toBe('/invoices');
  });

  it('prefers a query link when those params match', () => {
    expect(active('/invoices/new', 'type=proforma_invoice')).toBe(
      '/invoices/new?type=proforma_invoice',
    );
    expect(active('/settings/integrations', 'category=sms')).toBe(
      '/settings/integrations?category=sms',
    );
    expect(active('/settings/integrations')).toBe('/settings/integrations');
  });

  it('prefers a hash link on the same path, and a longer settings path over All settings', () => {
    expect(active('/settings/business', '', 'bp-features')).toBe('/settings/business#bp-features');
    expect(active('/settings/business')).toBe('/settings/business');
    expect(active('/settings/whatsapp/templates')).toBe('/settings/whatsapp/templates');
    expect(active('/whatsapp/contacts/groups')).toBe('/whatsapp/contacts/groups');
  });
});
