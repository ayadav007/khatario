import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { getPartnerById, updatePartner } from '@/lib/partners/auth';
import { claimBusinessForPartner } from '@/lib/partners/attribution';
import { queryRows } from '@/lib/db';
import { buildPartnerSignupUrl } from '@/lib/partners/codes';
import { resolvePublicRequestOrigin } from '@/lib/http/public-request-origin';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_businesses');
  if (!auth.ok) return auth.response;

  const partner = await getPartnerById(params.id);
  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 });

  const commissions = await queryRows(
    `SELECT id, business_id, sale_amount, commission_amount, status, created_at, eligible_at
     FROM partner_commissions WHERE partner_id = $1
     ORDER BY created_at DESC LIMIT 50`,
    [params.id],
  );
  const attributions = await queryRows(
    `SELECT a.business_id, b.name AS business_name, a.source, a.attributed_at
     FROM business_partner_attributions a
     LEFT JOIN businesses b ON b.id = a.business_id
     WHERE a.partner_id = $1
     ORDER BY a.attributed_at DESC LIMIT 50`,
    [params.id],
  );

  const origin = resolvePublicRequestOrigin(request);
  return NextResponse.json({
    partner,
    signupUrl: buildPartnerSignupUrl(origin, partner.referral_code),
    commissions,
    attributions,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_businesses');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();

    if (body.action === 'claim_business' && typeof body.business_id === 'string') {
      const result = await claimBusinessForPartner({
        businessId: body.business_id,
        partnerId: params.id,
        by: 'admin',
        adminId: auth.admin.id,
        notes: typeof body.notes === 'string' ? body.notes : null,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 409 });
      }
      return NextResponse.json({ success: true, attribution: result.attribution });
    }

    const partner = await updatePartner(params.id, {
      partnerType: body.partner_type,
      name: body.name,
      email: body.email,
      phone: body.phone,
      status: body.status,
      referralCode: body.referral_code,
      commissionType: body.commission_type,
      commissionValue:
        body.commission_value != null ? Number(body.commission_value) : undefined,
      commissionBasis: body.commission_basis,
      holdDays:
        body.hold_days === null || body.hold_days === ''
          ? null
          : body.hold_days != null
            ? Number(body.hold_days)
            : undefined,
      pan: body.pan,
      gstin: body.gstin,
      bankAccountName: body.bank_account_name,
      bankAccountNumber: body.bank_account_number,
      bankIfsc: body.bank_ifsc,
      upiId: body.upi_id,
      notes: body.notes,
      password: body.password,
    });

    if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 });
    return NextResponse.json({ success: true, partner });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[admin/partners PATCH]', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
