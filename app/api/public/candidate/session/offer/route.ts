import { NextRequest, NextResponse } from 'next/server';

import { query, queryOne } from '@/lib/db';

import { getCandidatePortalSessionFromRequest } from '@/lib/hr/recruitment/candidate-portal-session';



export const dynamic = 'force-dynamic';



export async function GET(request: NextRequest) {

  const session = await getCandidatePortalSessionFromRequest(request);

  if (!session) {

    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  }



  const candidate = await queryOne<{ status: string }>(

    `SELECT status FROM recruitment_candidates WHERE id = $1 AND business_id = $2`,

    [session.candidate_id, session.business_id],

  );



  const canViewOffer = candidate && [

    'info_collection_complete',

    'offer_draft', 'offer_sent', 'offer_viewed', 'offer_accepted', 'offer_declined',

    'docs_submitted', 'docs_verified', 'ready_to_join', 'joined',

  ].includes(candidate.status);



  if (!canViewOffer) {

    return NextResponse.json({ offer: null, locked_reason: 'Complete and get all onboarding tasks approved first.' });

  }



  const offer = await queryOne(

    `SELECT id, designation, department, joining_date, basic_salary, status, terms_text,

            accepted_at, work_location, annual_bonus, notice_period_days

     FROM recruitment_offer_letters

     WHERE candidate_id = $1 AND business_id = $2 AND status IN ('sent','viewed','accepted','declined')

     ORDER BY created_at DESC LIMIT 1`,

    [session.candidate_id, session.business_id],

  );



  if (offer && offer.status === 'sent') {

    await query(

      `UPDATE recruitment_offer_letters SET status = 'viewed', viewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP

       WHERE id = $1`,

      [offer.id],

    );

    await query(

      `UPDATE recruitment_candidates SET status = 'offer_viewed', updated_at = CURRENT_TIMESTAMP

       WHERE id = $1 AND business_id = $2 AND status = 'offer_sent'`,

      [session.candidate_id, session.business_id],

    );

    offer.status = 'viewed';

  }



  const pdf_available = offer && ['sent', 'viewed', 'accepted'].includes(String(offer.status));



  return NextResponse.json({

    offer,

    pdf_url: pdf_available ? '/api/public/candidate/session/offer/pdf' : null,

  });

}



export async function PATCH(request: NextRequest) {

  const session = await getCandidatePortalSessionFromRequest(request);

  if (!session) {

    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  }



  const body = await request.json();

  if (body?.action !== 'accept') {

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });

  }



  const signatureUrl = String(body?.signature_url ?? '').trim();

  if (!signatureUrl || !signatureUrl.startsWith('data:image/')) {

    return NextResponse.json({ error: 'A drawn signature is required to accept the offer' }, { status: 400 });

  }



  const offer = await queryOne<{ id: string; status: string }>(

    `SELECT id, status FROM recruitment_offer_letters

     WHERE candidate_id = $1 AND business_id = $2 AND status IN ('sent','viewed')

     ORDER BY created_at DESC LIMIT 1`,

    [session.candidate_id, session.business_id],

  );



  if (!offer) {

    return NextResponse.json({ error: 'No offer available to accept' }, { status: 400 });

  }



  const ip =

    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||

    request.headers.get('x-real-ip') ||

    null;



  await query(

    `UPDATE recruitment_offer_letters

     SET status = 'accepted',

         accepted_at = CURRENT_TIMESTAMP,

         accepted_ip = $1,

         candidate_signature_url = $2,

         updated_at = CURRENT_TIMESTAMP

     WHERE id = $3`,

    [ip, signatureUrl, offer.id],

  );

  await query(

    `UPDATE recruitment_candidates SET status = 'offer_accepted', updated_at = CURRENT_TIMESTAMP

     WHERE id = $1 AND business_id = $2`,

    [session.candidate_id, session.business_id],

  );



  const { maybeAutoSendOnboardingInvite } = await import(
    '@/lib/hr/recruitment/onboarding/send-portal-invite'
  );
  void maybeAutoSendOnboardingInvite(session.business_id, session.candidate_id);



  return NextResponse.json({ ok: true, status: 'accepted' });

}


