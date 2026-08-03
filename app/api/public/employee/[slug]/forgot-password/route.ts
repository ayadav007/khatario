import { NextRequest, NextResponse } from 'next/server';
import { resolveBusinessByPortalSlug } from '@/lib/employee-portal/resolve-business';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { sendEmployeePortalPasswordResetOtp } from '@/lib/employee-portal/forgot-password';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const OTP_SEND_LIMIT = 8;
const OTP_SEND_WINDOW_MS = 15 * 60 * 1000;

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const ip = getClientIp(request);
    const rl = checkRateLimit(`emp-portal-forgot:${ip}`, OTP_SEND_LIMIT, OTP_SEND_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    }

    const business = await resolveBusinessByPortalSlug(params.slug);
    if (!business) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    try {
      await assertFeatureAccess(business.id, 'hr_employee_portal');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
      throw error;
    }

    const body = await request.json();
    const phone = String(body.phone ?? '').trim();
    if (!phone) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }

    const result = await sendEmployeePortalPasswordResetOtp(
      business.id,
      business.name,
      phone
    );

    if (!result.sent && result.message === 'Invalid phone number') {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    if (!result.sent) {
      return NextResponse.json({ error: result.message }, { status: 503 });
    }

    return NextResponse.json({
      message: result.message,
      ...(result.devOtp ? { dev_otp: result.devOtp } : {}),
    });
  } catch (error: unknown) {
    console.error('[employee portal forgot-password]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send verification code' },
      { status: 500 }
    );
  }
}
