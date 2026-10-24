import { NextRequest, NextResponse } from 'next/server';
import { requirePartnerRequest } from '@/lib/partners/request-auth';
import { getPartnerById, updatePartner } from '@/lib/partners/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePartnerRequest(request);
  if (!auth.ok) return auth.response;
  const partner = await getPartnerById(auth.session.partner_id);
  if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    partner: {
      id: partner.id,
      name: partner.name,
      email: partner.email,
      phone: partner.phone,
      pan: partner.pan,
      gstin: partner.gstin,
      bank_account_name: partner.bank_account_name,
      bank_account_number: partner.bank_account_number,
      bank_ifsc: partner.bank_ifsc,
      upi_id: partner.upi_id,
    },
    canEdit: auth.session.role === 'owner',
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePartnerRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.session.role !== 'owner') {
    return NextResponse.json({ error: 'Only the owner can update payout profile' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const partner = await updatePartner(auth.session.partner_id, {
      phone: body.phone,
      pan: body.pan,
      gstin: body.gstin,
      bankAccountName: body.bank_account_name,
      bankAccountNumber: body.bank_account_number,
      bankIfsc: body.bank_ifsc,
      upiId: body.upi_id,
    });
    return NextResponse.json({ success: true, partner });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
