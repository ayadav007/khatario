import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { createPartner, listPartners } from '@/lib/partners/auth';
import { normalizeReferralCode } from '@/lib/partners/codes';
import type { CommissionBasis, CommissionType, PartnerType } from '@/lib/partners/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_businesses');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') as 'pending' | 'active' | 'suspended' | null;
  const q = searchParams.get('q') || undefined;
  const partners = await listPartners({
    status: status || undefined,
    q,
  });
  return NextResponse.json({ partners });
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_businesses');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const partnerType: PartnerType =
      body.partner_type === 'agency' ? 'agency' : 'freelancer';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const referralCode =
      normalizeReferralCode(body.referral_code) ||
      normalizeReferralCode(name.replace(/\s+/g, '').slice(0, 12));

    if (!name || !email || !password || !referralCode) {
      return NextResponse.json(
        { error: 'name, email, password, and referral_code are required' },
        { status: 400 },
      );
    }

    const partner = await createPartner({
      partnerType,
      name,
      email,
      phone: body.phone ?? null,
      password,
      referralCode,
      status: body.status === 'pending' || body.status === 'suspended' ? body.status : 'active',
      commissionType:
        body.commission_type === 'fixed' ? 'fixed' : ('percentage' as CommissionType),
      commissionValue:
        body.commission_value != null ? Number(body.commission_value) : 20,
      commissionBasis:
        body.commission_basis === 'recurring'
          ? 'recurring'
          : ('first_payment' as CommissionBasis),
      holdDays: body.hold_days != null && body.hold_days !== '' ? Number(body.hold_days) : null,
      pan: body.pan ?? null,
      gstin: body.gstin ?? null,
      notes: body.notes ?? null,
      createdByAdminId: auth.admin.id,
    });

    return NextResponse.json({ success: true, partner }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('unique') || message.includes('duplicate')) {
      return NextResponse.json(
        { error: 'Email or referral code already exists' },
        { status: 409 },
      );
    }
    console.error('[admin/partners POST]', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
