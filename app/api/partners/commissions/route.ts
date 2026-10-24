import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { requirePartnerRequest } from '@/lib/partners/request-auth';
import { approveEligiblePartnerCommissions } from '@/lib/partners/commission';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePartnerRequest(request);
  if (!auth.ok) return auth.response;

  // Best-effort: flip pending → approved when hold has passed.
  await approveEligiblePartnerCommissions(50).catch(() => 0);

  const rows = await queryRows<{
    id: string;
    business_id: string;
    business_name: string | null;
    sale_amount: string;
    commission_amount: string;
    commission_type: string;
    commission_rate: string;
    status: string;
    eligible_at: string;
    created_at: string;
    paid_at: string | null;
  }>(
    `SELECT c.id, c.business_id, b.name AS business_name,
            c.sale_amount, c.commission_amount, c.commission_type, c.commission_rate,
            c.status, c.eligible_at, c.created_at, c.paid_at
     FROM partner_commissions c
     LEFT JOIN businesses b ON b.id = c.business_id
     WHERE c.partner_id = $1
     ORDER BY c.created_at DESC
     LIMIT 200`,
    [auth.session.partner_id],
  );

  const summary = rows.reduce(
    (acc, r) => {
      const amt = Number(r.commission_amount) || 0;
      if (r.status === 'pending') acc.pending += amt;
      else if (r.status === 'approved') acc.approved += amt;
      else if (r.status === 'paid') acc.paid += amt;
      return acc;
    },
    { pending: 0, approved: 0, paid: 0 },
  );

  return NextResponse.json({
    summary,
    commissions: rows.map((r) => ({
      ...r,
      sale_amount: Number(r.sale_amount),
      commission_amount: Number(r.commission_amount),
      commission_rate: Number(r.commission_rate),
    })),
  });
}
