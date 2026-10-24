import { describe, expect, it } from '@jest/globals';
import { pathAfterBusinessSwitch } from '@/lib/business-switch-path';

const id = 'ab2a5fd1-a82b-45f1-9008-8db73dcc2702';

describe('pathAfterBusinessSwitch', () => {
  it('sends a record page to its list', () => {
    expect(pathAfterBusinessSwitch(`/suppliers/${id}`)).toBe('/suppliers');
    expect(pathAfterBusinessSwitch(`/suppliers/${id}/items`)).toBe('/suppliers');
    expect(pathAfterBusinessSwitch(`/supply-orders/${id}`)).toBe('/supply-orders');
    expect(pathAfterBusinessSwitch(`/invoices/${id}/view`, '?from=generate')).toBe('/invoices');
    expect(pathAfterBusinessSwitch(`/purchases/incoming/${id}`)).toBe('/purchases/incoming');
  });

  it('keeps list pages and their filters', () => {
    expect(pathAfterBusinessSwitch('/purchases', '?status=unpaid')).toBe('/purchases?status=unpaid');
    expect(pathAfterBusinessSwitch('/supply-orders')).toBe('/supply-orders');
  });

  it('drops query values that point at a record of the old business', () => {
    expect(pathAfterBusinessSwitch('/supply-orders/new', `?supplier_id=${id}`)).toBe('/supply-orders/new');
  });

  it('falls back to the dashboard', () => {
    expect(pathAfterBusinessSwitch('')).toBe('/dashboard');
    expect(pathAfterBusinessSwitch(`/${id}`)).toBe('/dashboard');
  });
});
