import { query, queryOne, queryRows } from '@/lib/db';

// ── Types ──────────────────────────────────────────────────────────────

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  type: 'percentage' | 'flat' | 'free_months';
  value: number;
  currency: string;
  max_redemptions: number | null;
  current_redemptions: number;
  max_per_business: number;
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;
  applicable_plans: string[] | null;
}

export interface CouponValidationResult {
  valid: boolean;
  coupon?: Coupon;
  error?: string;
  message?: string;
  discount?: { amount: number; type: string; freeMonths?: number };
}

interface DiscountResult {
  amount: number;
  type: string;
  freeMonths?: number;
  discountPerMonth?: number;
}

interface CouponRedemption {
  id: string;
  coupon_id: string;
  business_id: string;
  billing_transaction_id: string | null;
  plan_id: string;
  discount_amount: number;
  redeemed_at: string;
}

interface ListCouponsFilters {
  is_active?: boolean;
  type?: Coupon['type'];
  limit?: number;
  offset?: number;
}

interface CreateCouponData {
  code: string;
  description?: string;
  type: 'percentage' | 'flat' | 'free_months';
  value: number;
  currency?: string;
  min_plan_id?: string;
  applicable_plans?: string[];
  max_redemptions?: number;
  max_per_business?: number;
  valid_from?: string;
  valid_until?: string;
  created_by?: string;
  metadata?: Record<string, unknown>;
}

// ── Public Functions ───────────────────────────────────────────────────

export async function validateCoupon(
  code: string,
  businessId: string,
  planId: string,
  billingCycle: 'monthly' | 'yearly' = 'monthly',
): Promise<CouponValidationResult> {
  const coupon = await queryOne<Coupon>(
    `SELECT id, code, description, type, value, currency,
            max_redemptions, current_redemptions, max_per_business,
            valid_from, valid_until, is_active, applicable_plans
     FROM coupons
     WHERE UPPER(code) = UPPER($1)`,
    [code]
  );

  if (!coupon) {
    return { valid: false, error: 'Coupon code not found' };
  }

  if (!coupon.is_active) {
    return { valid: false, error: 'Coupon is no longer active' };
  }

  // Date validity
  const now = new Date();
  const validFrom = new Date(coupon.valid_from);
  if (validFrom > now) {
    return { valid: false, error: 'Coupon is not yet valid' };
  }

  if (coupon.valid_until) {
    const validUntil = new Date(coupon.valid_until);
    if (validUntil < now) {
      return { valid: false, error: 'Coupon has expired' };
    }
  }

  // Global redemption limit
  if (
    coupon.max_redemptions !== null &&
    coupon.current_redemptions >= coupon.max_redemptions
  ) {
    return { valid: false, error: 'Coupon has reached its maximum redemptions' };
  }

  // Per-business redemption limit
  const businessRedemptions = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM coupon_redemptions
     WHERE coupon_id = $1 AND business_id = $2`,
    [coupon.id, businessId]
  );

  if (
    businessRedemptions &&
    parseInt(businessRedemptions.count, 10) >= coupon.max_per_business
  ) {
    return {
      valid: false,
      error: 'You have already used this coupon the maximum number of times',
    };
  }

  // Plan applicability
  if (coupon.applicable_plans && coupon.applicable_plans.length > 0) {
    if (!coupon.applicable_plans.includes(planId)) {
      return { valid: false, error: 'Coupon is not applicable to the selected plan' };
    }
  }

  const plan = await queryOne<{ price_monthly: string; price_yearly: string }>(
    `SELECT price_monthly, price_yearly FROM subscription_plans WHERE id = $1`,
    [planId],
  );

  const planPrice = plan
    ? billingCycle === 'yearly'
      ? parseFloat(plan.price_yearly) || 0
      : parseFloat(plan.price_monthly) || 0
    : 0;
  const discount = calculateDiscount(coupon, planPrice);

  return {
    valid: true,
    coupon,
    discount,
    message:
      coupon.type === 'free_months'
        ? `${coupon.value} month(s) free on this plan`
        : discount.amount > 0
          ? `Save ₹${Math.round(discount.amount).toLocaleString('en-IN')} on checkout`
          : 'Coupon is valid for this plan',
  };
}

export async function redeemCoupon(
  couponId: string,
  businessId: string,
  planId: string,
  billingTransactionId?: string
): Promise<CouponRedemption> {
  // Fetch the coupon to calculate the discount amount stored on the redemption
  const coupon = await queryOne<Coupon>(
    `SELECT id, type, value FROM coupons WHERE id = $1`,
    [couponId]
  );

  if (!coupon) {
    throw new Error(`Coupon ${couponId} not found`);
  }

  const plan = await queryOne<{ price_monthly: string; price_yearly: string }>(
    `SELECT price_monthly, price_yearly FROM subscription_plans WHERE id = $1`,
    [planId],
  );

  const planPrice = plan ? parseFloat(plan.price_monthly) : 0;
  const discount = calculateDiscount(coupon, planPrice);

  // Increment global redemption counter
  await query(
    `UPDATE coupons
     SET current_redemptions = current_redemptions + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [couponId]
  );

  // Insert redemption record
  const redemption = await queryOne<CouponRedemption>(
    `INSERT INTO coupon_redemptions
       (coupon_id, business_id, plan_id, discount_amount, billing_transaction_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [couponId, businessId, planId, discount.amount, billingTransactionId ?? null]
  );

  if (!redemption) {
    throw new Error('Failed to create coupon redemption record');
  }

  return redemption;
}

export function calculateDiscount(
  coupon: Pick<Coupon, 'type' | 'value'>,
  planPrice: number
): DiscountResult {
  switch (coupon.type) {
    case 'percentage': {
      const raw = planPrice * (coupon.value / 100);
      return {
        amount: Math.min(raw, planPrice),
        type: 'percentage',
      };
    }
    case 'flat': {
      return {
        amount: Math.min(coupon.value, planPrice),
        type: 'flat',
      };
    }
    case 'free_months': {
      return {
        amount: 0,
        type: 'free_months',
        freeMonths: coupon.value,
        discountPerMonth: planPrice,
      };
    }
    default:
      return { amount: 0, type: coupon.type };
  }
}

export async function listCoupons(
  filters?: ListCouponsFilters
): Promise<{ coupons: Coupon[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters?.is_active !== undefined) {
    conditions.push(`is_active = $${idx++}`);
    params.push(filters.is_active);
  }

  if (filters?.type) {
    conditions.push(`type = $${idx++}`);
    params.push(filters.type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;

  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM coupons ${where}`,
    params
  );

  const coupons = await queryRows<Coupon>(
    `SELECT id, code, description, type, value, currency,
            max_redemptions, current_redemptions, max_per_business,
            valid_from, valid_until, is_active, applicable_plans
     FROM coupons
     ${where}
     ORDER BY created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );

  return {
    coupons,
    total: parseInt(countResult?.count ?? '0', 10),
  };
}

export async function createCoupon(data: CreateCouponData): Promise<Coupon> {
  const coupon = await queryOne<Coupon>(
    `INSERT INTO coupons
       (code, description, type, value, currency, min_plan_id,
        applicable_plans, max_redemptions, max_per_business,
        valid_from, valid_until, created_by, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, code, description, type, value, currency,
               max_redemptions, current_redemptions, max_per_business,
               valid_from, valid_until, is_active, applicable_plans`,
    [
      data.code.toUpperCase(),
      data.description ?? null,
      data.type,
      data.value,
      data.currency ?? 'INR',
      data.min_plan_id ?? null,
      data.applicable_plans ?? null,
      data.max_redemptions ?? null,
      data.max_per_business ?? 1,
      data.valid_from ?? new Date().toISOString().split('T')[0],
      data.valid_until ?? null,
      data.created_by ?? null,
      JSON.stringify(data.metadata ?? {}),
    ]
  );

  if (!coupon) {
    throw new Error('Failed to create coupon');
  }

  return coupon;
}

export async function deactivateCoupon(couponId: string): Promise<Coupon | null> {
  return queryOne<Coupon>(
    `UPDATE coupons
     SET is_active = false, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING id, code, description, type, value, currency,
               max_redemptions, current_redemptions, max_per_business,
               valid_from, valid_until, is_active, applicable_plans`,
    [couponId]
  );
}
