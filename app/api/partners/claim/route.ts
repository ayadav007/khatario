import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { claimBusinessForPartner } from '@/lib/partners/attribution';
import { requirePartnerRequest } from '@/lib/partners/request-auth';
import { normalizePhoneOrNull } from '@/lib/utils/phone';

export const dynamic = 'force-dynamic';

/**
 * Partner claims an unattributed business (assisted close) before payment.
 * Look up by business_id or owner phone.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePartnerRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    let businessId = typeof body.business_id === 'string' ? body.business_id.trim() : '';

    if (!businessId && typeof body.phone === 'string') {
      const phone = normalizePhoneOrNull(body.phone);
      if (!phone) {
        return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 });
      }
      const user = await queryOne<{ business_id: string }>(
        `SELECT business_id FROM users WHERE phone = $1 AND is_primary_admin = true LIMIT 1`,
        [phone],
      );
      if (!user) {
        return NextResponse.json({ error: 'No business found for that phone' }, { status: 404 });
      }
      businessId = user.business_id;
    }

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id or phone is required' },
        { status: 400 },
      );
    }

    const result = await claimBusinessForPartner({
      businessId,
      partnerId: auth.session.partner_id,
      by: 'partner',
      notes: typeof body.notes === 'string' ? body.notes : null,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      created: result.created,
      attribution: result.attribution,
    });
  } catch (error) {
    console.error('[partners/claim]', error);
    return NextResponse.json({ error: 'Claim failed' }, { status: 500 });
  }
}
