import { NextRequest, NextResponse } from 'next/server';
import { authenticatePartner, getPartnerById } from '@/lib/partners/auth';
import {
  createPartnerSession,
  setPartnerSessionCookie,
} from '@/lib/partners/session';
import { authenticatePartnerUser, ensureOwnerUserForPartner } from '@/lib/partners/team';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

const LIMIT = 10;
const WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`partner-login:${ip}`, LIMIT, WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please try again later.', retryAfterMs: rl.retryAfterMs },
      { status: 429 },
    );
  }

  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    let partnerId: string | null = null;
    let partnerUserId: string | null = null;
    let displayName = '';
    let role: 'owner' | 'member' = 'owner';

    const teamUser = await authenticatePartnerUser(email, password);
    if (teamUser) {
      partnerId = teamUser.partnerId;
      partnerUserId = teamUser.userId;
      displayName = teamUser.name;
      role = teamUser.role;
    } else {
      const partner = await authenticatePartner(email, password);
      if (!partner) {
        return NextResponse.json(
          { error: 'Invalid credentials or account inactive' },
          { status: 401 },
        );
      }
      partnerId = partner.id;
      displayName = partner.name;
      const hashRow = await queryOne<{ password_hash: string }>(
        `SELECT password_hash FROM platform_partners WHERE id = $1`,
        [partner.id],
      );
      if (hashRow) {
        await ensureOwnerUserForPartner({
          partnerId: partner.id,
          name: partner.name,
          email: partner.email,
          phone: partner.phone,
          passwordHash: hashRow.password_hash,
        });
        const owner = await queryOne<{ id: string }>(
          `SELECT id FROM platform_partner_users
           WHERE partner_id = $1 AND role = 'owner' AND lower(email) = lower($2)
           LIMIT 1`,
          [partner.id, partner.email],
        );
        partnerUserId = owner?.id ?? null;
      }
    }

    const partner = await getPartnerById(partnerId!);
    if (!partner || partner.status !== 'active') {
      return NextResponse.json(
        { error: 'Invalid credentials or account inactive' },
        { status: 401 },
      );
    }

    const { token, expiresAt } = await createPartnerSession({
      partnerId: partner.id,
      partnerUserId,
    });
    const response = NextResponse.json({
      success: true,
      partner: {
        id: partner.id,
        name: partner.name,
        email: partner.email,
        partner_type: partner.partner_type,
        referral_code: partner.referral_code,
      },
      user: { name: displayName, role },
      redirect: '/partners',
    });
    setPartnerSessionCookie(response, token, expiresAt);
    return response;
  } catch (error) {
    console.error('[partners/auth/login]', error);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
