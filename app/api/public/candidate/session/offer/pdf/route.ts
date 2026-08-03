import { NextRequest, NextResponse } from 'next/server';
import { getCandidatePortalSessionFromRequest } from '@/lib/hr/recruitment/candidate-portal-session';
import { generateOfferLetterPdf, getOfferIdForCandidate } from '@/lib/offer-letter-generator';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getCandidatePortalSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const offerId = await getOfferIdForCandidate(session.candidate_id, session.business_id);
  if (!offerId) {
    return NextResponse.json({ error: 'No offer available' }, { status: 404 });
  }

  const offer = await queryOne<{ status: string }>(
    `SELECT status FROM recruitment_offer_letters WHERE id = $1`,
    [offerId],
  );
  if (!offer || !['sent', 'viewed', 'accepted'].includes(offer.status)) {
    return NextResponse.json({ error: 'Offer letter is not available yet' }, { status: 400 });
  }

  try {
    const pdf = await generateOfferLetterPdf(offerId);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="offer-letter.pdf"',
      },
    });
  } catch (error) {
    console.error('[candidate offer/pdf]', error);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
