import { NextRequest, NextResponse } from 'next/server';

import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';

import { authorize, AuthorizationError } from '@/lib/authorization';

import { queryOne, query } from '@/lib/db';

import { sendBusinessEmail } from '@/lib/business-email';

import { getBusinessPortalContext } from '@/lib/customer-surface/portal-business';

import { assertPreOfferTasksApproved } from '@/lib/hr/recruitment/onboarding/task-service';

import {

  submitOfferForApproval,

  decideOfferApproval,

  resetOfferToDraft,

  listOfferApprovals,

} from '@/lib/hr/recruitment/offer-approval';

import type { OfferApproverInput } from '@/lib/hr/recruitment/offer-approval';



export const dynamic = 'force-dynamic';



const ACTIVE_OFFER_STATUSES = [

  'draft', 'pending_approval', 'approved', 'approval_rejected', 'sent', 'viewed',

];



function num(v: unknown, fallback = 0): number {

  const n = Number(v);

  return Number.isFinite(n) ? n : fallback;

}



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



    const offer = await queryOne(

      `SELECT * FROM recruitment_offer_letters

       WHERE candidate_id = $1 AND business_id = $2

       ORDER BY created_at DESC LIMIT 1`,

      [params.id, businessId],

    );



    const approvals = offer ? await listOfferApprovals(String(offer.id)) : [];



    return NextResponse.json({ offer, approvals });

  } catch (error) {

    if (error instanceof AuthorizationError) return error.toNextResponse();

    return NextResponse.json({ error: 'Failed to fetch offer' }, { status: 500 });

  }

}



export async function POST(

  request: NextRequest,

  { params }: { params: { id: string } },

) {

  try {

    const businessId = getBusinessIdFromRequest(request);

    const userId = getUserIdFromRequest(request);

    if (!businessId || !userId) {

      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

    }

    await authorize(userId, 'recruitment', 'create', { businessId, resourceId: params.id });



    const body = await request.json();

    const designation = String(body?.designation ?? '').trim();

    const joiningDate = String(body?.joining_date ?? '').slice(0, 10);

    const basicSalary = num(body?.basic_salary);

    if (!designation || !joiningDate || basicSalary <= 0) {

      return NextResponse.json(

        { error: 'designation, joining_date, and basic_salary are required' },

        { status: 400 },

      );

    }



    const candidate = await queryOne<{ id: string; status: string }>(

      `SELECT id, status FROM recruitment_candidates WHERE id = $1 AND business_id = $2`,

      [params.id, businessId],

    );

    if (!candidate) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });



    const preOffer = await assertPreOfferTasksApproved(businessId, params.id);

    if (!preOffer.ok) {

      return NextResponse.json({ error: preOffer.message, code: 'ONBOARDING_INCOMPLETE' }, { status: 400 });

    }



    const existing = await queryOne(

      `SELECT id FROM recruitment_offer_letters

       WHERE candidate_id = $1 AND business_id = $2 AND status = ANY($3::text[])`,

      [params.id, businessId, ACTIVE_OFFER_STATUSES],

    );

    if (existing) {

      return NextResponse.json({ error: 'An active offer already exists for this candidate' }, { status: 409 });

    }



    const offer = await queryOne(

      `INSERT INTO recruitment_offer_letters (

        business_id, candidate_id, designation, department, joining_date, probation_months,

        work_location, annual_bonus, notice_period_days, signatory_name, signatory_title,

        status, basic_salary, hra, transport_allowance, medical_allowance, special_allowance,

        other_allowances, pf_percentage, pf_fixed_amount, professional_tax, tds_percentage,

        other_deductions, terms_text, created_by

      ) VALUES (

        $1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,'draft',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24

      ) RETURNING *`,

      [

        businessId,

        params.id,

        designation,

        body?.department?.trim() || null,

        joiningDate,

        num(body?.probation_months),

        body?.work_location?.trim() || null,

        num(body?.annual_bonus),

        body?.notice_period_days != null ? num(body.notice_period_days) : null,

        body?.signatory_name?.trim() || null,

        body?.signatory_title?.trim() || null,

        basicSalary,

        num(body?.hra),

        num(body?.transport_allowance),

        num(body?.medical_allowance),

        num(body?.special_allowance),

        num(body?.other_allowances),

        num(body?.pf_percentage, 12),

        body?.pf_fixed_amount != null ? num(body.pf_fixed_amount) : null,

        num(body?.professional_tax),

        num(body?.tds_percentage),

        num(body?.other_deductions),

        body?.terms_text?.trim() || null,

        userId,

      ],

    );



    await query(

      `UPDATE recruitment_candidates SET status = 'offer_draft', updated_at = CURRENT_TIMESTAMP

       WHERE id = $1 AND business_id = $2`,

      [params.id, businessId],

    );



    return NextResponse.json({ offer }, { status: 201 });

  } catch (error) {

    if (error instanceof AuthorizationError) return error.toNextResponse();

    console.error('[recruitment/offer POST]', error);

    return NextResponse.json({ error: 'Failed to create offer' }, { status: 500 });

  }

}



export async function PATCH(

  request: NextRequest,

  { params }: { params: { id: string } },

) {

  try {

    const businessId = getBusinessIdFromRequest(request);

    const userId = getUserIdFromRequest(request);

    if (!businessId || !userId) {

      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

    }



    const body = await request.json();

    const action = String(body?.action ?? 'update');



    const offer = await queryOne<Record<string, unknown>>(

      `SELECT o.*, c.email, c.full_name

       FROM recruitment_offer_letters o

       INNER JOIN recruitment_candidates c ON c.id = o.candidate_id

       WHERE o.candidate_id = $1 AND o.business_id = $2

       ORDER BY o.created_at DESC LIMIT 1`,

      [params.id, businessId],

    );

    if (!offer) return NextResponse.json({ error: 'No offer found' }, { status: 404 });



    if (action === 'submit_for_approval') {

      await authorize(userId, 'recruitment', 'update', { businessId, resourceId: params.id });



      const preOffer = await assertPreOfferTasksApproved(businessId, params.id);

      if (!preOffer.ok) {

        return NextResponse.json({ error: preOffer.message, code: 'ONBOARDING_INCOMPLETE' }, { status: 400 });

      }



      const approvers = (body?.approvers ?? []) as OfferApproverInput[];

      const result = await submitOfferForApproval({

        businessId,

        offerId: String(offer.id),

        candidateId: params.id,

        submittedByUserId: userId,

        approvers,

      });

      if (!result.ok) {

        return NextResponse.json({ error: result.message }, { status: 400 });

      }



      const updated = await queryOne(`SELECT * FROM recruitment_offer_letters WHERE id = $1`, [offer.id]);

      const approvals = await listOfferApprovals(String(offer.id));

      return NextResponse.json({ offer: updated, approvals });

    }



    if (action === 'approve' || action === 'reject') {

      const result = await decideOfferApproval({

        businessId,

        offerId: String(offer.id),

        candidateId: params.id,

        approverUserId: userId,

        action: action === 'approve' ? 'approve' : 'reject',

        comments: body?.comments,

      });

      if (!result.ok) {

        return NextResponse.json({ error: result.message }, { status: 400 });

      }

      const updated = await queryOne(`SELECT * FROM recruitment_offer_letters WHERE id = $1`, [offer.id]);

      const approvals = await listOfferApprovals(String(offer.id));

      return NextResponse.json({ offer: updated, approvals, offer_status: result.offer_status });

    }



    if (action === 'reset_to_draft') {

      await authorize(userId, 'recruitment', 'update', { businessId, resourceId: params.id });

      await resetOfferToDraft(String(offer.id), businessId);

      const updated = await queryOne(`SELECT * FROM recruitment_offer_letters WHERE id = $1`, [offer.id]);

      return NextResponse.json({ offer: updated, approvals: [] });

    }



    if (action === 'send') {

      await authorize(userId, 'recruitment', 'update', { businessId, resourceId: params.id });



      if (offer.status !== 'approved') {

        return NextResponse.json(

          { error: 'Offer must be fully approved before sending to the candidate' },

          { status: 400 },

        );

      }



      const preOffer = await assertPreOfferTasksApproved(businessId, params.id);

      if (!preOffer.ok) {

        return NextResponse.json({ error: preOffer.message, code: 'ONBOARDING_INCOMPLETE' }, { status: 400 });

      }



      const business = await getBusinessPortalContext(businessId);

      const slug = business?.portal_slug;

      if (!slug) {

        return NextResponse.json({ error: 'Business portal slug is not configured' }, { status: 400 });

      }



      const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://staging.khatario.com'}/${slug}/candidates`;



      await query(

        `UPDATE recruitment_offer_letters

         SET status = 'sent', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP

         WHERE id = $1`,

        [offer.id],

      );

      await query(

        `UPDATE recruitment_candidates SET status = 'offer_sent', updated_at = CURRENT_TIMESTAMP

         WHERE id = $1 AND business_id = $2`,

        [params.id, businessId],

      );



      await sendBusinessEmail(businessId, {

        to: String(offer.email),

        subject: `Offer letter from ${business?.name ?? 'your employer'}`,

        html: `<p>Hello ${offer.full_name},</p>

          <p>Your offer letter is ready. Sign in to the candidate portal to review and accept:</p>

          <p><a href="${portalUrl}">${portalUrl}</a></p>`,

        text: `Your offer letter is ready. Sign in at ${portalUrl}`,

      });



      const updated = await queryOne(`SELECT * FROM recruitment_offer_letters WHERE id = $1`, [offer.id]);

      return NextResponse.json({ offer: updated, portal_url: portalUrl });

    }



    await authorize(userId, 'recruitment', 'update', { businessId, resourceId: params.id });



    if (!['draft', 'approval_rejected'].includes(String(offer.status))) {

      return NextResponse.json({ error: 'Only draft or rejected offers can be edited' }, { status: 400 });

    }



    const fields: string[] = [];

    const values: unknown[] = [offer.id];

    const allowed = [

      'designation', 'department', 'joining_date', 'probation_months', 'work_location',

      'annual_bonus', 'notice_period_days', 'signatory_name', 'signatory_title',

      'basic_salary', 'hra', 'transport_allowance', 'medical_allowance', 'special_allowance',

      'other_allowances', 'pf_percentage', 'pf_fixed_amount', 'professional_tax',

      'tds_percentage', 'other_deductions', 'terms_text',

    ] as const;



    for (const key of allowed) {

      if (body[key] !== undefined) {

        values.push(body[key]);

        fields.push(`${key} = $${values.length}`);

      }

    }

    if (fields.length === 0) {

      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

    }

    fields.push('updated_at = CURRENT_TIMESTAMP');



    const updated = await queryOne(

      `UPDATE recruitment_offer_letters SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,

      values,

    );

    return NextResponse.json({ offer: updated });

  } catch (error) {

    if (error instanceof AuthorizationError) return error.toNextResponse();

    console.error('[recruitment/offer PATCH]', error);

    return NextResponse.json({ error: 'Failed to update offer' }, { status: 500 });

  }

}


