import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { queryRows } from '@/lib/db';
import { approveEligiblePartnerCommissions } from '@/lib/partners/commission';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_businesses');
  if (!auth.ok) return auth.response;

  await approveEligiblePartnerCommissions(100).catch(() => 0);

  const byPartner = await queryRows<{
    partner_id: string;
    name: string;
    referral_code: string;
    partner_type: string;
    attributions: string;
    pending_amount: string;
    approved_amount: string;
    paid_amount: string;
    cancelled_amount: string;
  }>(
    `SELECT p.id AS partner_id, p.name, p.referral_code, p.partner_type,
            (SELECT COUNT(*)::text FROM business_partner_attributions a WHERE a.partner_id = p.id) AS attributions,
            COALESCE((SELECT SUM(commission_amount) FROM partner_commissions c WHERE c.partner_id = p.id AND c.status = 'pending'), 0)::text AS pending_amount,
            COALESCE((SELECT SUM(commission_amount) FROM partner_commissions c WHERE c.partner_id = p.id AND c.status = 'approved'), 0)::text AS approved_amount,
            COALESCE((SELECT SUM(commission_amount) FROM partner_commissions c WHERE c.partner_id = p.id AND c.status = 'paid'), 0)::text AS paid_amount,
            COALESCE((SELECT SUM(commission_amount) FROM partner_commissions c WHERE c.partner_id = p.id AND c.status = 'cancelled'), 0)::text AS cancelled_amount
     FROM platform_partners p
     ORDER BY p.name ASC`,
  );

  const totals = byPartner.reduce(
    (acc, r) => {
      acc.attributions += Number(r.attributions) || 0;
      acc.pending += Number(r.pending_amount) || 0;
      acc.approved += Number(r.approved_amount) || 0;
      acc.paid += Number(r.paid_amount) || 0;
      acc.cancelled += Number(r.cancelled_amount) || 0;
      return acc;
    },
    { attributions: 0, pending: 0, approved: 0, paid: 0, cancelled: 0 },
  );

  return NextResponse.json({
    totals,
    partners: byPartner.map((r) => ({
      ...r,
      attributions: Number(r.attributions),
      pending_amount: Number(r.pending_amount),
      approved_amount: Number(r.approved_amount),
      paid_amount: Number(r.paid_amount),
      cancelled_amount: Number(r.cancelled_amount),
    })),
  });
}
