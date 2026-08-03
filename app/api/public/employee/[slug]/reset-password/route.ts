import { NextRequest, NextResponse } from 'next/server';
import { resolveBusinessByPortalSlug } from '@/lib/employee-portal/resolve-business';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { resetEmployeePortalPasswordWithOtp } from '@/lib/employee-portal/forgot-password';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const RESET_LIMIT = 12;
const RESET_WINDOW_MS = 15 * 60 * 1000;

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const ip = getClientIp(request);
    const rl = checkRateLimit(`emp-portal-reset:${ip}`, RESET_LIMIT, RESET_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    }

    const business = await resolveBusinessByPortalSlug(params.slug);
    if (!business) {
      return NextResponse.json({ error: 'Invalid verification code' }, { status: 400 });
    }

    try {
      await assertFeatureAccess(business.id, 'hr_employee_portal');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
      throw error;
    }

    const body = await request.json();
    const phone = String(body.phone ?? '').trim();
    const otpCode = String(body.otp_code ?? '').trim();
    const newPassword = String(body.new_password ?? '');

    if (!phone || !otpCode || !newPassword) {
      return NextResponse.json(
        { error: 'Phone, verification code, and new password are required' },
        { status: 400 }
      );
    }

    await resetEmployeePortalPasswordWithOtp({
      businessId: business.id,
      rawPhone: phone,
      otpCode,
      newPassword,
    });

    return NextResponse.json({
      ok: true,
      message: 'Password updated. You can sign in with your new password.',
    });
  } catch (error: unknown) {
    console.error('[employee portal reset-password]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reset password' },
      { status: 400 }
    );
  }
}
