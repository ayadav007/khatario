import { featureIdForPath } from '@/lib/subscription/plan-path-gate';

describe('featureIdForPath', () => {
  it('uses the longest prefix', () => {
    expect(featureIdForPath('/reports/gst/gstr1')).toBe('reports_gst');
    expect(featureIdForPath('/reports/sales/summary')).toBe('reports_basic');
    expect(featureIdForPath('/invoices/recurring')).toBe('sales_recurring_invoices');
    expect(featureIdForPath('/invoices/new')).toBe('sales_invoices');
  });

  it('does not gate core screens', () => {
    expect(featureIdForPath('/customers')).toBeNull();
    expect(featureIdForPath('/items')).toBeNull();
    expect(featureIdForPath('/dashboard')).toBeNull();
    expect(featureIdForPath('/settings/subscription')).toBeNull();
    expect(featureIdForPath('/api/customers')).toBeNull();
  });

  it('gates Supplier Hub separately from the supplier list', () => {
    expect(featureIdForPath('/suppliers')).toBe('purchase_suppliers');
    expect(featureIdForPath('/suppliers/new')).toBe('purchase_suppliers');
    expect(featureIdForPath('/suppliers/abc')).toBe('purchase_suppliers');
    expect(featureIdForPath('/api/suppliers')).toBe('purchase_suppliers');
    expect(featureIdForPath('/api/suppliers/search-business')).toBe('purchase_suppliers');

    expect(featureIdForPath('/suppliers/hub')).toBe('purchase_supplier_hub');
    expect(featureIdForPath('/suppliers/hub/find')).toBe('purchase_supplier_hub');
    expect(featureIdForPath('/suppliers/dashboard')).toBe('purchase_supplier_hub');
    expect(featureIdForPath('/suppliers/catalog')).toBe('purchase_supplier_hub');
    expect(featureIdForPath('/suppliers/requests')).toBe('purchase_supplier_hub');
    expect(featureIdForPath('/suppliers/abc/item-links')).toBe('purchase_supplier_hub');
    expect(featureIdForPath('/purchases/incoming')).toBe('purchase_supplier_hub');
    expect(featureIdForPath('/purchases/requests')).toBe('purchase_supplier_hub');
    expect(featureIdForPath('/purchases')).toBe('purchase_management');
    expect(featureIdForPath('/supply-orders')).toBe('purchase_supplier_hub');
    expect(featureIdForPath('/api/suppliers/hub/home')).toBe('purchase_supplier_hub');
    expect(featureIdForPath('/api/suppliers/abc/approve')).toBe('purchase_supplier_hub');
    expect(featureIdForPath('/api/stock-requests')).toBe('purchase_supplier_hub');
  });

  it('gates the matching API', () => {
    expect(featureIdForPath('/api/credit-notes')).toBe('sales_credit_notes');
    expect(featureIdForPath('/api/accounts/groups')).toBe('accounting_chart');
    expect(featureIdForPath('/api/whatsapp/send')).toBe('integration_whatsapp_manual');
    expect(featureIdForPath('/whatsapp/send-message')).toBe('integration_whatsapp_manual');
    expect(featureIdForPath('/api/whatsapp/status')).toBeNull();
  });
});
