import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { resolveBusinessByPortalSlug } from '@/lib/customer-surface';
import {
  createCandidatePortalSession,
  setCandidatePortalCookie,
} from '@/lib/hr/recruitment/candidate-portal-session';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const VERIFY_LIMIT = 20;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } },
) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`candidate-otp-verify:${ip}`, VERIFY_LIMIT, VERIFY_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.', retryAfterMs: rl.retryAfterMs },
      { status: 429 },
    );
  }

  try {
    const business = await resolveBusinessByPortalSlug(params.slug);
    if (!business) return NextResponse.json({ error: 'Portal not found' }, { status: 404 });

    const body = await request.json();
    const email = String(body?.email ?? '').trim().toLowerCase();
    const otpCode = String(body?.otp ?? body?.otp_code ?? '').trim();
    if (!email || !otpCode) {
      return NextResponse.json({ error: 'Email and OTP are required' }, { status: 400 });
    }

    const otp = await queryOne<{ id: string; candidate_id: string }>(
      `SELECT id, candidate_id FROM candidate_portal_otps
       WHERE business_id = $1 AND lower(trim(email)) = $2 AND otp_code = $3
         AND expires_at > CURRENT_TIMESTAMP AND used_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [business.id, email, otpCode],
    );

    if (!otp) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 });
    }

    await query(`UPDATE candidate_portal_otps SET used_at = CURRENT_TIMESTAMP WHERE id = $1`, [otp.id]);

    const { token, expiresAt } = await createCandidatePortalSession(business.id, otp.candidate_id);

    const candidate = await queryOne<{ full_name: string; status: string }>(
      `SELECT full_name, status FROM recruitment_candidates WHERE id = $1`,
      [otp.candidate_id],
    );

    const res = NextResponse.json({
      ok: true,
      candidate: {
        id: otp.candidate_id,
        name: candidate?.full_name ?? 'Candidate',
        status: candidate?.status,
      },
    });

    setCandidatePortalCookie(res, token, expiresAt);
    return res;
  } catch (error) {
    console.error('[candidate/verify-otp]', error);
    return NextResponse.json({ error: 'Sign-in failed' }, { status: 500 });
  }
}
