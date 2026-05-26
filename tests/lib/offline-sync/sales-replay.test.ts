import {
  computeInvoiceTotals,
  validateInvoiceGstPayload,
} from '@/lib/invoices/validate-invoice-gst-payload';
import {
  isOfflineTempInvoiceNumber,
  OFFLINE_INVOICE_PREFIX,
} from '@/lib/offline/invoicing/offline-invoice-number';
import { compareOfflineActions } from '@/lib/offline/sync/action-order';

describe('offline invoice numbering', () => {
  it('recognizes TMP device references', () => {
    expect(isOfflineTempInvoiceNumber('TMP-ANDROID1-1001')).toBe(true);
    expect(isOfflineTempInvoiceNumber('INV-001')).toBe(false);
    expect(OFFLINE_INVOICE_PREFIX).toBe('TMP');
  });
});

describe('validateInvoiceGstPayload', () => {
  const base = {
    business_id: 'b1',
    created_by: 'u1',
    invoice_date: '2024-01-01',
    items: [
      {
        item_name: 'Widget',
        quantity: 2,
        unit_price: 100,
        tax_rate: 18,
      },
    ],
    place_of_supply_state_code: '29',
    subtotal: 200,
    tax_total: 36,
    grand_total: 236,
  };

  it('accepts matching totals', () => {
    const result = validateInvoiceGstPayload(base, '29');
    expect(result.ok).toBe(true);
  });

  it('flags GST mismatch for manual review', () => {
    const result = validateInvoiceGstPayload(
      { ...base, tax_total: 30, grand_total: 230 },
      '29'
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('GST');
    }
  });
});

describe('computeInvoiceTotals', () => {
  it('splits CGST/SGST for intra-state', () => {
    const totals = computeInvoiceTotals(
      {
        business_id: 'b',
        created_by: 'u',
        invoice_date: '2024-01-01',
        items: [{ item_name: 'A', quantity: 1, unit_price: 100, tax_rate: 18 }],
        place_of_supply_state_code: '29',
      },
      '29'
    );
    expect(totals.cgstTotal).toBeGreaterThan(0);
    expect(totals.sgstTotal).toBeGreaterThan(0);
    expect(totals.igstTotal).toBe(0);
  });
});

describe('compareOfflineActions', () => {
  it('orders sales.finalize after purchase.finalize at same sequence tie-break', () => {
    expect(
      compareOfflineActions(
        { type: 'purchase.finalize', sequence: 2 },
        { type: 'sales.finalize', sequence: 1 }
      )
    ).toBeLessThan(0);
  });

  it('orders payment.record after sales.finalize', () => {
    expect(
      compareOfflineActions(
        { type: 'sales.finalize', sequence: 1 },
        { type: 'payment.record', sequence: 2 }
      )
    ).toBeLessThan(0);
  });
});
