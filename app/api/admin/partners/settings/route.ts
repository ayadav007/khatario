import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import {
  getPartnerProgramSettings,
  updatePartnerProgramSettings,
} from '@/lib/partners/settings';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_businesses');
  if (!auth.ok) return auth.response;
  return NextResponse.json({ settings: await getPartnerProgramSettings() });
}

export async function PUT(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_businesses');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const settings = await updatePartnerProgramSettings({
      default_hold_days:
        body.default_hold_days != null ? Number(body.default_hold_days) : undefined,
      default_commission_type:
        body.default_commission_type === 'fixed' ? 'fixed' : 'percentage',
      default_commission_value:
        body.default_commission_value != null
          ? Number(body.default_commission_value)
          : undefined,
      default_commission_basis:
        body.default_commission_basis === 'recurring' ? 'recurring' : 'first_payment',
      tds_enabled: body.tds_enabled != null ? Boolean(body.tds_enabled) : undefined,
      tds_section: typeof body.tds_section === 'string' ? body.tds_section : undefined,
      tds_rate_percent:
        body.tds_rate_percent != null ? Number(body.tds_rate_percent) : undefined,
      tds_annual_threshold:
        body.tds_annual_threshold != null ? Number(body.tds_annual_threshold) : undefined,
    });
    return NextResponse.json({ success: true, settings });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
