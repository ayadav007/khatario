import { query, queryOne } from '@/lib/db';
import { getBusinessAttribution } from '@/lib/partners/attribution';
import { getPartnerProgramSettings } from '@/lib/partners/settings';
import type { CommissionBasis, CommissionType, PlatformPartner } from '@/lib/partners/types';

export function computeCommissionAmount(params: {
  saleAmount: number;
  commissionType: CommissionType;
  commissionValue: number;
}): number {
  const sale = Math.max(0, Math.round(params.saleAmount * 100) / 100);
  if (params.commissionType === 'fixed') {
    return Math.round(Math.min(sale, Math.max(0, params.commissionValue)) * 100) / 100;
  }
  const pct = Math.max(0, Math.min(100, params.commissionValue));
  return Math.round(((sale * pct) / 100) * 100) / 100;
}

function addDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Create a partner commission when a subscription payment settles.
 * Safe to call multiple times (idempotent on billing_transaction_id).
 * No-op when: no attribution, partner inactive, amount <= 0, or first_payment already earned.
 */
export async function maybeCreatePartnerCommissionOnPayment(params: {
  businessId: string;
  billingTransactionId: string;
  saleAmount: number;
}): Promise<{ created: boolean; reason?: string; commissionId?: string }> {
  const saleAmount = Math.round((Number(params.saleAmount) || 0) * 100) / 100;
  if (saleAmount <= 0) {
    return { created: false, reason: 'zero_amount' };
  }

  const attribution = await getBusinessAttribution(params.businessId);
  if (!attribution) {
    return { created: false, reason: 'no_attribution' };
  }

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM partner_commissions WHERE billing_transaction_id = $1`,
    [params.billingTransactionId],
  );
  if (existing) {
    return { created: false, reason: 'already_exists', commissionId: existing.id };
  }

  const partner = await queryOne<
    Pick<
      PlatformPartner,
      | 'id'
      | 'status'
      | 'commission_type'
      | 'commission_value'
      | 'commission_basis'
      | 'hold_days'
      | 'referral_code'
      | 'name'
    >
  >(
    `SELECT id, status, commission_type, commission_value, commission_basis, hold_days,
            referral_code, name
     FROM platform_partners WHERE id = $1`,
    [attribution.partner_id],
  );

  if (!partner || partner.status !== 'active') {
    return { created: false, reason: 'partner_inactive' };
  }

  const settings = await getPartnerProgramSettings();
  const basis = (partner.commission_basis || settings.default_commission_basis) as CommissionBasis;

  if (basis === 'first_payment') {
    const prior = await queryOne<{ id: string }>(
      `SELECT id FROM partner_commissions
       WHERE partner_id = $1 AND business_id = $2 AND status != 'cancelled'
       LIMIT 1`,
      [partner.id, params.businessId],
    );
    if (prior) {
      return { created: false, reason: 'first_payment_already_earned', commissionId: prior.id };
    }
  }

  const commissionType = (partner.commission_type ||
    settings.default_commission_type) as CommissionType;
  const commissionValue = Number(
    partner.commission_value ?? settings.default_commission_value,
  );
  const commissionAmount = computeCommissionAmount({
    saleAmount,
    commissionType,
    commissionValue,
  });

  if (commissionAmount <= 0) {
    return { created: false, reason: 'zero_commission' };
  }

  const holdDays =
    partner.hold_days != null && Number.isFinite(Number(partner.hold_days))
      ? Math.max(0, Number(partner.hold_days))
      : settings.default_hold_days;
  const now = new Date();
  const eligibleAt = addDays(now, holdDays);

  const row = await queryOne<{ id: string }>(
    `INSERT INTO partner_commissions (
       partner_id, business_id, billing_transaction_id,
       sale_amount, commission_type, commission_rate, commission_amount,
       status, eligible_at, rule_snapshot
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9::jsonb)
     ON CONFLICT (billing_transaction_id) DO NOTHING
     RETURNING id`,
    [
      partner.id,
      params.businessId,
      params.billingTransactionId,
      saleAmount,
      commissionType,
      commissionValue,
      commissionAmount,
      eligibleAt.toISOString(),
      JSON.stringify({
        basis,
        holdDays,
        referralCode: partner.referral_code,
        partnerName: partner.name,
        attributionSource: attribution.source,
      }),
    ],
  );

  if (!row) {
    const again = await queryOne<{ id: string }>(
      `SELECT id FROM partner_commissions WHERE billing_transaction_id = $1`,
      [params.billingTransactionId],
    );
    return { created: false, reason: 'race_duplicate', commissionId: again?.id };
  }

  // Mark linked deals as won when first commission lands.
  await query(
    `UPDATE partner_deals
     SET stage = 'won', business_id = COALESCE(business_id, $1), updated_at = CURRENT_TIMESTAMP
     WHERE partner_id = $2 AND (business_id = $1 OR business_id IS NULL)
       AND stage NOT IN ('lost')`,
    [params.businessId, partner.id],
  ).catch(() => undefined);

  return { created: true, commissionId: row.id };
}

/** Approve pending commissions whose hold window has passed. */
export async function approveEligiblePartnerCommissions(limit = 200): Promise<number> {
  const result = await query(
    `UPDATE partner_commissions
     SET status = 'approved', approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id IN (
       SELECT id FROM partner_commissions
       WHERE status = 'pending' AND eligible_at <= CURRENT_TIMESTAMP
       ORDER BY eligible_at ASC
       LIMIT $1
     )`,
    [limit],
  );
  return result.rowCount ?? 0;
}

export async function cancelPartnerCommissionForRefund(params: {
  billingTransactionId: string;
  reason?: string;
}): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE partner_commissions
     SET status = 'cancelled',
         cancelled_at = CURRENT_TIMESTAMP,
         cancel_reason = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE billing_transaction_id = $1
       AND status IN ('pending', 'approved', 'paid')
     RETURNING id`,
    [params.billingTransactionId, params.reason ?? 'payment_refunded'],
  );
  return Boolean(row);
}
