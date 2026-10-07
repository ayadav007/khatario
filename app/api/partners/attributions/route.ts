import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { requirePartnerRequest } from '@/lib/partners/request-auth';

export const dynamic = 'force-dynamic';

/** Trial + paid businesses attributed to this partner. */
export async function GET(request: NextRequest) {
  const auth = await requirePartnerRequest(request);
  if (!auth.ok) return auth.response;

  const rows = await queryRows<{
    business_id: string;
    business_name: string | null;
    source: string;
    referral_code: string | null;
    attributed_at: string;
    plan_id: string | null;
    subscription_status: string | null;
    has_commission: boolean;
  }>(
    `SELECT a.business_id, b.name AS business_name, a.source, a.referral_code, a.attributed_at,
            ms.plan_id, ms.status AS subscription_status,
            EXISTS (
              SELECT 1 FROM partner_commissions c
              WHERE c.business_id = a.business_id AND c.partner_id = a.partner_id
                AND c.status != 'cancelled'
            ) AS has_commission
     FROM business_partner_attributions a
     LEFT JOIN businesses b ON b.id = a.business_id
     LEFT JOIN LATERAL (
       SELECT plan_id, status
       FROM business_module_subscriptions
       WHERE business_id = a.business_id
       ORDER BY CASE WHEN status IN ('active', 'trial') THEN 0 ELSE 1 END,
                updated_at DESC NULLS LAST
       LIMIT 1
     ) ms ON true
     WHERE a.partner_id = $1
     ORDER BY a.attributed_at DESC
     LIMIT 200`,
    [auth.session.partner_id],
  );

  return NextResponse.json({ attributions: rows });
}
