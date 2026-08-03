import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { listCandidateTasks } from '@/lib/hr/recruitment/onboarding/journey';
import { listOfferApprovals } from '@/lib/hr/recruitment/offer-approval';
import { queryOne, queryRows } from '@/lib/db';

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

    const candidate = await queryOne(
      `SELECT c.*, j.title AS job_title, j.id AS job_id_ref
       FROM recruitment_candidates c
       INNER JOIN recruitment_jobs j ON j.id = c.job_id
       WHERE c.id = $1 AND c.business_id = $2`,
      [params.id, businessId],
    );
    if (!candidate) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });

    const stages = await queryRows(
      `SELECT * FROM recruitment_job_interview_stages
       WHERE job_id = $1 AND business_id = $2 ORDER BY sort_order ASC`,
      [candidate.job_id, businessId],
    );

    const interviews = await queryRows(
      `SELECT i.*, s.stage_name, u.name AS interviewer_name
       FROM recruitment_interviews i
       INNER JOIN recruitment_job_interview_stages s ON s.id = i.stage_id
       LEFT JOIN users u ON u.id = i.interviewer_user_id
       WHERE i.candidate_id = $1 AND i.business_id = $2
       ORDER BY s.sort_order ASC, i.scheduled_at ASC NULLS LAST`,
      [params.id, businessId],
    );

    const offer = await queryOne(
      `SELECT * FROM recruitment_offer_letters
       WHERE candidate_id = $1 AND business_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [params.id, businessId],
    );

    const documents = await queryRows(
      `SELECT * FROM candidate_documents
       WHERE candidate_id = $1 AND business_id = $2 ORDER BY uploaded_at DESC`,
      [params.id, businessId],
    );

    const onboarding_tasks = await listCandidateTasks(params.id, businessId);
    const offer_approvals = offer ? await listOfferApprovals(String(offer.id)) : [];

    return NextResponse.json({
      candidate,
      stages,
      interviews,
      offer,
      offer_approvals,
      documents,
      onboarding_tasks,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[recruitment/candidates/[id] GET]', error);
    return NextResponse.json({ error: 'Failed to fetch candidate' }, { status: 500 });
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
    await authorize(userId, 'recruitment', 'update', { businessId, resourceId: params.id });

    const body = await request.json();
    const fields: string[] = [];
    const values: unknown[] = [params.id, businessId];
    const allowed = ['full_name', 'email', 'phone', 'source', 'notes', 'status'] as const;

    for (const key of allowed) {
      if (body[key] !== undefined) {
        values.push(key === 'email' ? String(body[key]).trim().toLowerCase() : body[key]);
        fields.push(`${key} = $${values.length}`);
      }
    }
    if (fields.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    const candidate = await queryOne(
      `UPDATE recruitment_candidates SET ${fields.join(', ')}
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      values,
    );
    if (!candidate) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });

    return NextResponse.json({ candidate });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[recruitment/candidates/[id] PATCH]', error);
    return NextResponse.json({ error: 'Failed to update candidate' }, { status: 500 });
  }
}
