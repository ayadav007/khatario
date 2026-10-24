import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import {
  createPartnerPayout,
  listAllPayouts,
  listApprovedCommissionsForPayout,
} from '@/lib/partners/payouts';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_businesses');
  if (!auth.ok) return auth.response;

  const partnerId = new URL(request.url).searchParams.get('partner_id');
  if (partnerId) {
    const commissions = await listApprovedCommissionsForPayout(partnerId);
    return NextResponse.json({
      commissions: commissions.map((c) => ({
        ...c,
        sale_amount: Number(c.sale_amount),
        commission_amount: Number(c.commission_amount),
      })),
    });
  }

  const payouts = await listAllPayouts(100);
  return NextResponse.json({
    payouts: payouts.map((p) => ({
      ...p,
      gross_amount: Number((p as { gross_amount: string }).gross_amount),
      tds_amount: Number((p as { tds_amount: string }).tds_amount),
      net_amount: Number((p as { net_amount: string }).net_amount),
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_businesses');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const partnerId = typeof body.partner_id === 'string' ? body.partner_id : '';
    const commissionIds = Array.isArray(body.commission_ids)
      ? body.commission_ids.filter((id: unknown) => typeof id === 'string')
      : [];
    if (!partnerId || !commissionIds.length) {
      return NextResponse.json(
        { error: 'partner_id and commission_ids are required' },
        { status: 400 },
      );
    }

    const result = await createPartnerPayout({
      partnerId,
      commissionIds,
      paymentReference: body.payment_reference ?? null,
      paymentMethod: body.payment_method ?? null,
      notes: body.notes ?? null,
      adminId: auth.admin.id,
    });

    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[admin/partners/payouts POST]', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
