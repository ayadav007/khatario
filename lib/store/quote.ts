import { queryRows, queryOne } from '@/lib/db';
import { applyCouponDiscount, lineAmounts, roundMoney } from './pricing';
import { getBranchDelivery, quoteDeliveryForBranch } from './delivery';
import type { DeliveryMode } from './delivery/self';

export interface QuoteCartItem {
  item_id: string;
  variant_id?: string | null;
  quantity: number;
}

export interface StoreQuote {
  serviceable: boolean;
  error?: string;
  subtotal: number;
  tax_total: number;
  delivery_charge: number;
  discount: number;
  grand_total: number;
  eta_text: string;
  lines: Array<{
    item_id: string;
    variant_id: string | null;
    item_name: string;
    variant_name: string | null;
    quantity: number;
    unit: string;
    unit_price: number;
    tax_rate: number;
    gst_included: boolean;
    line_total: number;
    tax: number;
  }>;
  coupon_code: string | null;
}

export async function buildStoreQuote(input: {
  businessId: string;
  minOrderAmount: number;
  branchId?: string | null;
  items: QuoteCartItem[];
  deliveryMode: DeliveryMode;
  pincode?: string | null;
  customerLat?: number | null;
  customerLng?: number | null;
  couponCode?: string | null;
}): Promise<StoreQuote> {
  if (!input.items.length) {
    return {
      serviceable: false,
      error: 'Cart is empty',
      subtotal: 0,
      tax_total: 0,
      delivery_charge: 0,
      discount: 0,
      grand_total: 0,
      eta_text: '',
      lines: [],
      coupon_code: null,
    };
  }

  const ids = [...new Set(input.items.map((i) => i.item_id))];
  const rows = await queryRows<{
    id: string;
    name: string;
    unit: string;
    selling_price: string;
    tax_rate: string;
    gst_included: boolean | null;
    show_in_store: boolean;
    is_active: boolean | null;
    deleted_at: Date | null;
  }>(
    `SELECT id, name, unit, selling_price::text, tax_rate::text,
            COALESCE(gst_included, false) AS gst_included,
            show_in_store, is_active, deleted_at
     FROM items
     WHERE business_id = $1 AND id = ANY($2::uuid[])`,
    [input.businessId, ids],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));

  const variantIds = input.items.map((i) => i.variant_id).filter(Boolean) as string[];
  const variants =
    variantIds.length > 0
      ? await queryRows<{
          id: string;
          item_id: string;
          variant_name: string;
          selling_price: string;
        }>(
          `SELECT id, item_id, variant_name, selling_price::text FROM item_variants WHERE id = ANY($1::uuid[])`,
          [variantIds],
        )
      : [];
  const varById = new Map(variants.map((v) => [v.id, v]));

  const lines: StoreQuote['lines'] = [];
  let subtotal = 0;
  let taxTotal = 0;

  for (const cart of input.items) {
    const item = byId.get(cart.item_id);
    if (!item || !item.show_in_store || item.deleted_at || item.is_active === false) {
      return emptyFail(`Item is not available in the store`);
    }
    let unitPrice = parseFloat(item.selling_price) || 0;
    let variantName: string | null = null;
    if (cart.variant_id) {
      const v = varById.get(cart.variant_id);
      if (!v || v.item_id !== cart.item_id) {
        return emptyFail('Invalid variant');
      }
      unitPrice = parseFloat(v.selling_price) || unitPrice;
      variantName = v.variant_name;
    }
    const taxRate = parseFloat(item.tax_rate) || 0;
    const gstIncluded = !!item.gst_included;
    const amt = lineAmounts({
      unitPrice,
      quantity: cart.quantity,
      taxRate,
      gstIncluded,
    });
    subtotal += gstIncluded ? amt.lineTotal : amt.taxable;
    taxTotal += amt.tax;
    lines.push({
      item_id: item.id,
      variant_id: cart.variant_id ?? null,
      item_name: item.name,
      variant_name: variantName,
      quantity: cart.quantity,
      unit: item.unit || 'PCS',
      unit_price: unitPrice,
      tax_rate: taxRate,
      gst_included: gstIncluded,
      line_total: amt.lineTotal,
      tax: amt.tax,
    });
  }

  subtotal = roundMoney(subtotal);
  taxTotal = roundMoney(taxTotal);

  if (input.minOrderAmount > 0 && subtotal < input.minOrderAmount) {
    return {
      serviceable: false,
      error: `Minimum order amount is ₹${input.minOrderAmount}`,
      subtotal,
      tax_total: taxTotal,
      delivery_charge: 0,
      discount: 0,
      grand_total: roundMoney(subtotal + (lines.some((l) => !l.gst_included) ? taxTotal : 0)),
      eta_text: '',
      lines,
      coupon_code: null,
    };
  }

  let discount = 0;
  let couponCode: string | null = null;
  const code = input.couponCode?.trim().toUpperCase();
  if (code) {
    const coupon = await queryOne<{
      id: string;
      discount_type: 'percent' | 'flat';
      discount_value: string;
      min_order_amount: string;
      usage_cap: number | null;
      used_count: number;
      expires_at: Date | null;
      is_active: boolean;
    }>(
      `SELECT id, discount_type, discount_value::text, min_order_amount::text,
              usage_cap, used_count, expires_at, is_active
       FROM store_coupons
       WHERE business_id = $1 AND upper(code) = $2`,
      [input.businessId, code],
    );
    if (!coupon || !coupon.is_active) {
      return { ...failQuote(subtotal, taxTotal, lines), error: 'Invalid coupon' };
    }
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return { ...failQuote(subtotal, taxTotal, lines), error: 'Coupon has expired' };
    }
    if (coupon.usage_cap != null && coupon.used_count >= coupon.usage_cap) {
      return { ...failQuote(subtotal, taxTotal, lines), error: 'Coupon usage limit reached' };
    }
    const applied = applyCouponDiscount({
      subtotal,
      discountType: coupon.discount_type,
      discountValue: parseFloat(coupon.discount_value) || 0,
      minOrderAmount: parseFloat(coupon.min_order_amount) || 0,
    });
    if (!applied.ok) {
      return { ...failQuote(subtotal, taxTotal, lines), error: applied.error };
    }
    discount = applied.discount;
    couponCode = code;
  }

  const exclusiveTax = lines.some((l) => !l.gst_included) ? taxTotal : 0;
  const goodsTotal = roundMoney(subtotal + exclusiveTax - discount);

  let deliveryCharge = 0;
  let eta = input.deliveryMode === 'pickup' ? 'Ready for pickup' : '';
  if (input.deliveryMode === 'delivery' || input.deliveryMode === 'pickup') {
    if (!input.branchId) {
      if (input.deliveryMode === 'delivery') {
        return {
          ...failQuote(subtotal, taxTotal, lines, discount, couponCode),
          error: 'Select a store location',
        };
      }
    } else {
      const zone = await getBranchDelivery(input.businessId, input.branchId);
      if (!zone) {
        return {
          ...failQuote(subtotal, taxTotal, lines, discount, couponCode),
          error: 'This location is not set up for store delivery',
        };
      }
      const dq = await quoteDeliveryForBranch({
        businessId: input.businessId,
        mode: input.deliveryMode,
        subtotal: goodsTotal,
        pincode: input.pincode,
        customerLat: input.customerLat,
        customerLng: input.customerLng,
        branch: zone.branch,
        charges: zone.charges,
        pickupPincode: zone.pickupPincode,
      });
      if (!dq.serviceable) {
        return {
          ...failQuote(subtotal, taxTotal, lines, discount, couponCode),
          error: dq.error || 'Not serviceable',
        };
      }
      deliveryCharge = dq.charge;
      eta = dq.etaText;
    }
  }

  const grand = roundMoney(goodsTotal + deliveryCharge);
  return {
    serviceable: true,
    subtotal,
    tax_total: taxTotal,
    delivery_charge: deliveryCharge,
    discount,
    grand_total: grand,
    eta_text: eta,
    lines,
    coupon_code: couponCode,
  };
}

function emptyFail(error: string): StoreQuote {
  return {
    serviceable: false,
    error,
    subtotal: 0,
    tax_total: 0,
    delivery_charge: 0,
    discount: 0,
    grand_total: 0,
    eta_text: '',
    lines: [],
    coupon_code: null,
  };
}

function failQuote(
  subtotal: number,
  taxTotal: number,
  lines: StoreQuote['lines'],
  discount = 0,
  coupon: string | null = null,
): StoreQuote {
  return {
    serviceable: false,
    subtotal,
    tax_total: taxTotal,
    delivery_charge: 0,
    discount,
    grand_total: roundMoney(subtotal - discount),
    eta_text: '',
    lines,
    coupon_code: coupon,
  };
}
