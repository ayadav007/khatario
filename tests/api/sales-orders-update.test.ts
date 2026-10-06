import { isSalesOrderEditable } from '@/lib/sales-orders/editability';

describe('sales order editability', () => {
  test('allows draft and confirmed without invoice', () => {
    expect(isSalesOrderEditable({ status: 'draft', converted_invoice_id: null })).toBe(true);
    expect(isSalesOrderEditable({ status: 'confirmed', converted_invoice_id: null })).toBe(true);
  });

  test('blocks fulfilled, cancelled, and converted', () => {
    expect(isSalesOrderEditable({ status: 'fulfilled', converted_invoice_id: null })).toBe(false);
    expect(isSalesOrderEditable({ status: 'cancelled', converted_invoice_id: null })).toBe(false);
    expect(
      isSalesOrderEditable({
        status: 'draft',
        converted_invoice_id: '00000000-0000-0000-0000-000000000001',
      })
    ).toBe(false);
  });
});
