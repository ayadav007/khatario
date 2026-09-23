import { lineAmounts, applyCouponDiscount, roundMoney } from '@/lib/store/pricing';
import { quoteSelfDelivery, haversineKm } from '@/lib/store/delivery/self';

describe('lineAmounts', () => {
  it('extracts tax from GST-inclusive prices', () => {
    const a = lineAmounts({ unitPrice: 118, quantity: 1, taxRate: 18, gstIncluded: true });
    expect(a.lineTotal).toBe(118);
    expect(a.tax).toBe(18);
  });

  it('adds tax on exclusive prices', () => {
    const a = lineAmounts({ unitPrice: 100, quantity: 1, taxRate: 18, gstIncluded: false });
    expect(a.tax).toBe(18);
    expect(a.lineTotal).toBe(118);
  });
});

describe('applyCouponDiscount', () => {
  it('applies percent off', () => {
    expect(applyCouponDiscount({
      subtotal: 200,
      discountType: 'percent',
      discountValue: 10,
      minOrderAmount: 0,
    }).discount).toBe(20);
  });

  it('rejects below min order', () => {
    expect(applyCouponDiscount({
      subtotal: 50,
      discountType: 'flat',
      discountValue: 10,
      minOrderAmount: 100,
    }).ok).toBe(false);
  });
});

describe('quoteSelfDelivery', () => {
  const branch = {
    id: 'b1',
    location_lat: 12.97,
    location_lng: 77.59,
    delivery_mode: 'radius' as const,
    delivery_radius_km: 10,
    serviceable_pincodes: [] as string[],
    allow_pickup: true,
  };
  const charges = [
    { min_distance_km: 0, max_distance_km: 5, charge: 0, free_above_amount: null },
    { min_distance_km: 5, max_distance_km: 10, charge: 40, free_above_amount: 500 },
  ];

  it('allows pickup for free', () => {
    const q = quoteSelfDelivery({
      mode: 'pickup',
      subtotal: 100,
      branch,
      charges,
    });
    expect(q.serviceable).toBe(true);
    expect(q.charge).toBe(0);
  });

  it('rejects pincode outside the list', () => {
    const q = quoteSelfDelivery({
      mode: 'delivery',
      subtotal: 100,
      pincode: '560001',
      branch: { ...branch, delivery_mode: 'pincode', serviceable_pincodes: ['560078'] },
      charges,
    });
    expect(q.serviceable).toBe(false);
  });

  it('charges the distance slab', () => {
    const km = haversineKm(12.97, 77.59, 12.97, 77.66);
    expect(km).toBeGreaterThan(5);
    const q = quoteSelfDelivery({
      mode: 'delivery',
      subtotal: 100,
      customerLat: 12.97,
      customerLng: 77.66,
      branch,
      charges,
    });
    expect(q.serviceable).toBe(true);
    expect(q.charge).toBe(40);
  });

  it('makes delivery free above the slab threshold', () => {
    const q = quoteSelfDelivery({
      mode: 'delivery',
      subtotal: 600,
      customerLat: 12.97,
      customerLng: 77.66,
      branch,
      charges,
    });
    expect(q.charge).toBe(0);
  });

  it('rejects radius beyond the zone', () => {
    const q = quoteSelfDelivery({
      mode: 'delivery',
      subtotal: 100,
      customerLat: 13.2,
      customerLng: 77.59,
      branch,
      charges,
    });
    expect(q.serviceable).toBe(false);
  });

  it('quotes all-india from the first slab', () => {
    const q = quoteSelfDelivery({
      mode: 'delivery',
      subtotal: 100,
      pincode: '110001',
      branch: { ...branch, delivery_mode: 'all_india' },
      charges,
    });
    expect(q.serviceable).toBe(true);
    expect(q.charge).toBe(0);
  });
});

describe('roundMoney', () => {
  it('rounds to paise', () => {
    expect(roundMoney(10.126)).toBe(10.13);
  });
});
