import { NextRequest, NextResponse } from 'next/server';
import { query, getPool } from '@/lib/db';
import { clearSubscriptionCache } from '@/lib/subscription';
import bcrypt from 'bcryptjs';
import { signAccessToken, signRefreshToken, setSessionCookies } from '@/lib/jwt';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { notifyAdminsNewSignup, sendWelcomeEmail } from '@/lib/platform-email';
import { normalizeProductLine } from '@/lib/product-lines';
import { normalizePhoneOrNull } from '@/lib/utils/phone';
import { provisionBusiness } from '@/lib/businesses/provision-business';
import { attachUserAsOwner, grantOwnerBranchAccess } from '@/lib/businesses/owner-membership';

export const dynamic = 'force-dynamic';

// 3 signup attempts per IP per hour (production). Dev + Playwright bypass below.
const SIGNUP_LIMIT = 3;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

// Rate limit is skipped when:
//   1. Explicitly disabled via E2E_DISABLE_RATE_LIMIT=true (Playwright)
//   2. Running in local dev (NODE_ENV !== 'production') — localhost iteration
//      should not get throttled by an anti-abuse control meant for real traffic.
// Production (NODE_ENV='production') always enforces.
function shouldSkipSignupRateLimit(): boolean {
  if (process.env.E2E_DISABLE_RATE_LIMIT === 'true') return true;
  if (process.env.NODE_ENV !== 'production') return true;
  return false;
}

function isStagingSignupDebug(): boolean {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  return (
    process.env.SIGNUP_DEBUG === 'true' ||
    appUrl.includes('staging.') ||
    process.env.NODE_ENV !== 'production'
  );
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!shouldSkipSignupRateLimit()) {
    const rl = checkRateLimit(`signup:${ip}`, SIGNUP_LIMIT, SIGNUP_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many signup attempts. Please try again later.', retryAfterMs: rl.retryAfterMs },
        { status: 429 }
      );
    }
  }

  // Fail fast with a clear message instead of creating a business then 500ing on cookies.
  if (!process.env.JWT_SECRET) {
    console.error('Signup error: JWT_SECRET is not set');
    return NextResponse.json(
      {
        error: 'Server misconfiguration: JWT_SECRET is not set',
        ...(isStagingSignupDebug() ? { details: 'JWT_SECRET environment variable is not set' } : {}),
      },
      { status: 500 },
    );
  }

  const pool = getPool();
  const client = await pool.connect();
  let committed = false;

  try {
    const body = await request.json();
    
    const {
      businessName,
      businessEmail,
      businessPhone,
      businessType,
      industry,
      businessModel,
      userName,
      userPhone,
      password,
      productLine: productLineRaw,
      leadToken,
      ref: referralRef,
    } = body;

    const productLine = normalizeProductLine(productLineRaw);

    if (!businessName || !userName || !userPhone || !password || !businessType || !industry) {
      return NextResponse.json(
        { error: 'Required fields: Business Name, Business Type, Industry, Your Name, Phone, Password' },
        { status: 400 }
      );
    }

    const phoneNorm = normalizePhoneOrNull(userPhone);
    if (!phoneNorm) {
      return NextResponse.json(
        { error: 'Enter a valid 10-digit mobile number' },
        { status: 400 }
      );
    }

    const { nationalPhone10, requestHasVerifiedPlatformOtp } = await import('@/lib/platform-public-otp');
    const phone10 = nationalPhone10(phoneNorm);
    // A WhatsApp sales-funnel signup link proves this number messaged us, like the OTP does.
    const { signupTokenVerifiesPhone, linkSignupToLead } = await import('@/lib/sales-funnel/signup');
    const funnelLeadId =
      typeof leadToken === 'string' ? await signupTokenVerifiesPhone(leadToken, phone10).catch(() => null) : null;
    const skipOtp =
      process.env.E2E_DISABLE_RATE_LIMIT === 'true' || process.env.PLATFORM_SKIP_OTP === '1' || Boolean(funnelLeadId);
    if (!skipOtp && (!phone10 || !(await requestHasVerifiedPlatformOtp(request, 'signup', phone10)))) {
      return NextResponse.json(
        { error: 'Verify your mobile number with the WhatsApp code first', code: 'OTP_REQUIRED' },
        { status: 403 },
      );
    }

    await client.query('BEGIN');

    const provisioned = await provisionBusiness(client, {
      businessName,
      businessEmail: businessEmail || null,
      businessPhone: businessPhone || null,
      businessType,
      industry,
      businessModel: businessModel || null,
      productLine,
    });
    const { businessId, defaultBranchId, primaryAdminRoleId } = provisioned;
    if (provisioned.softFailures.length > 0) {
      console.warn('Signup soft failures (non-fatal):', provisioned.softFailures);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userRes = await client.query(
      `INSERT INTO users (business_id, name, phone, password_hash, role_id, is_primary_admin)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id`,
      [businessId, userName, phoneNorm, passwordHash, primaryAdminRoleId]
    );
    const primaryAdminUserId = userRes.rows[0].id;

    await grantOwnerBranchAccess(client, primaryAdminUserId, defaultBranchId);
    await attachUserAsOwner(client, primaryAdminUserId, businessId);

    await client.query('COMMIT');
    committed = true;
    clearSubscriptionCache(businessId);
    await linkSignupToLead({ businessId, phone10, leadId: funnelLeadId });

    // Partner attribution from ?ref= (trial signup — commission only after paid conversion).
    if (referralRef) {
      try {
        const { attributeBusinessFromReferralCode } = await import('@/lib/partners/attribution');
        await attributeBusinessFromReferralCode({
          businessId,
          ref: referralRef,
          source: 'ref_link',
        });
      } catch (attrErr) {
        console.error('Signup partner attribution failed:', attrErr);
      }
    }

    const tokenPayload = { userId: primaryAdminUserId, businessId, sessionVersion: 1 };
    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(tokenPayload),
      signRefreshToken(tokenPayload),
    ]);

    const response = NextResponse.json({ 
      success: true, 
      message: 'Account created successfully',
      businessId,
      userId: primaryAdminUserId,
    }, { status: 201 });

    setSessionCookies(response, accessToken, refreshToken);

    const planLabel = provisioned.planLabel;

    void (async () => {
      try {
        await sendWelcomeEmail({
          businessId,
          businessName,
          recipientEmail: businessEmail?.trim() || '',
          userName,
          trialDays: provisioned.trialDays ?? undefined,
        });
        await notifyAdminsNewSignup({
          businessId,
          businessName,
          businessEmail: businessEmail?.trim() || null,
          userName,
          userPhone: phoneNorm,
          planLabel,
        });
      } catch (emailErr) {
        console.error('Signup notification emails failed:', emailErr);
      }
    })();

    return response;

  } catch (error: any) {
    if (!committed) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Signup rollback failed:', rollbackErr);
      }
    }
    console.error('Signup error:', error);
    
    if (error.code === '23505') {
      const constraint = String(error.constraint || '');
      const detail = String(error.detail || '');
      const isPhone =
        constraint === 'users_phone_key' ||
        constraint === 'uq_users_business_phone' ||
        detail.includes('(phone)');
      return NextResponse.json(
        {
          error: isPhone
            ? 'This mobile number is already registered for this business. Log in to access your account.'
            : 'Phone number or email already registered for this business',
          code: isPhone ? 'PHONE_ALREADY_REGISTERED' : 'DUPLICATE_REGISTRATION',
        },
        { status: 409 }
      );
    }

    const details =
      error instanceof Error
        ? error.message
        : typeof error?.message === 'string'
          ? error.message
          : String(error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        ...(isStagingSignupDebug()
          ? {
              details,
              code: error?.code || undefined,
              constraint: error?.constraint || undefined,
            }
          : {}),
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
