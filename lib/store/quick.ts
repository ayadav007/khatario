/** Pure helpers for the Quick theme's cart bar and cart sheet. */
import { applyCouponDiscount } from './pricing';

export interface FreeDeliveryProgress {
  /** Rupees still to add; 0 once delivery is free. */
  remaining: number;
  /** 0..1 for the progress bar. */
  ratio: number;
}

/** Null when the store has no single free-delivery threshold to promise. */
export function freeDeliveryProgress(subtotal: number, freeAbove: number | null | undefined): FreeDeliveryProgress | null {
  if (freeAbove == null || !Number.isFinite(freeAbove) || freeAbove <= 0) return null;
  const remaining = Math.max(0, Math.ceil(freeAbove - subtotal));
  return { remaining, ratio: Math.min(1, Math.max(0, subtotal / freeAbove)) };
}

/** The free-delivery amount a demo store promises (its Bazaar Bright announcement says "above ₹299"). */
export const DEMO_FREE_DELIVERY_ABOVE = 299;

/** A demo store has no branches, so it borrows the demo amount; a branch amount wins, and real stores are untouched. */
export function demoFreeAbove(isDemo: boolean, branchAmount: number | null | undefined): number | null {
  if (branchAmount != null) return branchAmount;
  return isDemo ? DEMO_FREE_DELIVERY_ABOVE : null;
}

/** The cart drawer's free-delivery line (theme setting `cart_free_ship_bar`). */
export function freeShipText(progress: FreeDeliveryProgress): string {
  return progress.remaining > 0
    ? `Add ₹${progress.remaining.toLocaleString('en-IN')} more for free delivery`
    : 'You have free delivery';
}

/** What the shopper saves against MRP across the cart. Lines without an MRP add nothing. */
export function cartSavings(lines: Array<{ price: number; mrp?: number | null; quantity: number }>): number {
  return Math.round(
    lines.reduce((sum, l) => (l.mrp != null && l.mrp > l.price ? sum + (l.mrp - l.price) * l.quantity : sum), 0),
  );
}

export interface StoreOfferCoupon {
  code: string;
  discount_type: 'percent' | 'flat';
  discount_value: number;
  min_order_amount: number;
}

export interface CouponOutlook {
  coupon: StoreOfferCoupon;
  /** Rupees off this cart; 0 when it does not apply yet. */
  saving: number;
  /** Rupees still to add before it applies. */
  shortBy: number;
}

/** Each listed coupon's effect on this subtotal, best saving first, then the closest to unlocking. */
export function couponOutlook(subtotal: number, coupons: StoreOfferCoupon[]): CouponOutlook[] {
  return coupons
    .map((coupon) => {
      // Same rule checkout uses, so the sheet never promises more than the order gets.
      const applied = applyCouponDiscount({
        subtotal,
        discountType: coupon.discount_type,
        discountValue: coupon.discount_value,
        minOrderAmount: coupon.min_order_amount,
      });
      const shortBy = applied.ok ? 0 : Math.max(0, Math.ceil(coupon.min_order_amount - subtotal));
      return { coupon, saving: applied.ok ? Math.round(applied.discount) : 0, shortBy };
    })
    .sort((a, b) => b.saving - a.saving || a.shortBy - b.shortBy);
}

/** Short label for a coupon, e.g. "20% off" or "₹50 off". */
export function couponLabel(c: StoreOfferCoupon): string {
  return c.discount_type === 'percent' ? `${c.discount_value}% off` : `₹${Math.round(c.discount_value)} off`;
}
