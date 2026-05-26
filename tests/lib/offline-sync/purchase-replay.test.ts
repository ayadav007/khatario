import { computePurchaseDocument } from '@/lib/purchase-gst-calculator';
import { hashReplayPayload } from '@/lib/offline-sync/types';

/** Mirrors validatePurchaseGstPayload tolerance logic for unit tests without DB/auth imports. */
function checkGstTotals(body: {
  items: Array<{
    quantity: number;
    unit_price: number;
    discount_percent?: number;
    discount_amount?: number;
    tax_rate: number;
  }>;
  subtotal?: number;
  tax_total?: number;
  grand_total?: number;
  supplier_state_code?: string;
  place_of_supply_state_code?: string;
  price_mode?: string;
  round_off?: number;
}): { ok: boolean; reason?: string } {
  const gstDoc = computePurchaseDocument(
    body.items.map((item) => ({
      quantity: Number(item.quantity) || 0,
      unit_price: Number(item.unit_price) || 0,
      discount_percent: Number(item.discount_percent) || 0,
      discount_amount: Number(item.discount_amount) || 0,
      tax_rate: Number(item.tax_rate) || 0,
    })),
    {
      supplierStateCode: String(body.supplier_state_code || '').slice(0, 2),
      companyStateCode: String(body.place_of_supply_state_code || '').slice(0, 2),
      headerPriceMode: body.price_mode === 'inclusive' ? 'inclusive' : 'exclusive',
    }
  );

  const roundOff = typeof body.round_off === 'number' ? body.round_off : 0;
  const serverGrand = gstDoc.subtotal + gstDoc.taxTotal + roundOff;
  const tolerance = 0.05;

  const mismatch =
    (body.subtotal !== undefined &&
      Math.abs(body.subtotal - gstDoc.subtotal) > tolerance) ||
    (body.tax_total !== undefined &&
      Math.abs(body.tax_total - gstDoc.taxTotal) > tolerance) ||
    (body.grand_total !== undefined &&
      Math.abs(body.grand_total - serverGrand) > tolerance);

  if (mismatch) {
    return { ok: false, reason: 'Client GST totals do not match server recomputation' };
  }
  return { ok: true };
}

describe('purchase finalize GST replay validation', () => {
  const baseItem = {
    quantity: 10,
    unit_price: 100,
    tax_rate: 5,
  };

  it('accepts matching client totals', () => {
    const body = {
      items: [baseItem],
      subtotal: 1000,
      tax_total: 50,
      grand_total: 1050,
      supplier_state_code: '29',
      place_of_supply_state_code: '29',
      price_mode: 'exclusive',
    };
    expect(checkGstTotals(body).ok).toBe(true);
  });

  it('flags GST mismatch for manual review path', () => {
    const body = {
      items: [baseItem],
      subtotal: 1000,
      tax_total: 40,
      grand_total: 1040,
      supplier_state_code: '29',
      place_of_supply_state_code: '29',
      price_mode: 'exclusive',
    };
    const result = checkGstTotals(body);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('GST');
  });
});

describe('hashReplayPayload', () => {
  it('is stable for same payload', () => {
    const payload = { a: 1, b: 'two' };
    expect(hashReplayPayload(payload)).toBe(hashReplayPayload(payload));
  });

  it('differs when payload changes', () => {
    expect(hashReplayPayload({ a: 1 })).not.toBe(hashReplayPayload({ a: 2 }));
  });
});
