import { NextRequest, NextResponse } from 'next/server';
import { requirePartnerRequest } from '@/lib/partners/request-auth';
import { listPartnerPayouts } from '@/lib/partners/payouts';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePartnerRequest(request);
  if (!auth.ok) return auth.response;

  const rows = await listPartnerPayouts(auth.session.partner_id);
  return NextResponse.json({
    payouts: rows.map((p) => ({
      ...p,
      gross_amount: Number((p as { gross_amount: string }).gross_amount),
      tds_amount: Number((p as { tds_amount: string }).tds_amount),
      net_amount: Number((p as { net_amount: string }).net_amount),
      tds_rate_percent:
        (p as { tds_rate_percent: string | null }).tds_rate_percent != null
          ? Number((p as { tds_rate_percent: string }).tds_rate_percent)
          : null,
    })),
  });
}
