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

  it('gates the matching API', () => {
    expect(featureIdForPath('/api/credit-notes')).toBe('sales_credit_notes');
    expect(featureIdForPath('/api/accounts/groups')).toBe('accounting_chart');
    expect(featureIdForPath('/api/whatsapp/send')).toBe('settings_whatsapp');
    expect(featureIdForPath('/api/whatsapp/status')).toBeNull();
  });
});
