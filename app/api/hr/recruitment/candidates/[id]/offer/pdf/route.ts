import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { generateOfferLetterPdf } from '@/lib/offer-letter-generator';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'recruitment', 'read', { businessId, resourceId: params.id });

    const offer = await queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM recruitment_offer_letters
       WHERE candidate_id = $1 AND business_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [params.id, businessId],
    );
    if (!offer) {
      return NextResponse.json({ error: 'No offer found' }, { status: 404 });
    }

    const viewable = [
      'pending_approval', 'approved', 'sent', 'viewed', 'accepted', 'declined',
    ];
    if (!viewable.includes(offer.status)) {
      return NextResponse.json({ error: 'Offer PDF is not available yet' }, { status: 400 });
    }

    const pdf = await generateOfferLetterPdf(offer.id);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="offer-letter-${params.id}.pdf"`,
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[offer/pdf GET]', error);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
