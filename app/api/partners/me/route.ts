import { NextRequest, NextResponse } from 'next/server';
import { buildPartnerSignupUrl } from '@/lib/partners/codes';
import { requirePartnerRequest } from '@/lib/partners/request-auth';
import { resolvePublicRequestOrigin } from '@/lib/http/public-request-origin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePartnerRequest(request);
  if (!auth.ok) return auth.response;

  const origin = resolvePublicRequestOrigin(request);
  const p = auth.session.partner;
  return NextResponse.json({
    partner: p,
    user: {
      id: auth.session.partner_user_id,
      name: auth.session.user_name,
      role: auth.session.role,
    },
    signupUrl: buildPartnerSignupUrl(origin, p.referral_code),
  });
}
