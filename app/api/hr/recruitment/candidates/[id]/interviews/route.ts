import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryOne, queryRows, query } from '@/lib/db';

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

    const interviews = await queryRows(
      `SELECT i.*, s.stage_name FROM recruitment_interviews i
       INNER JOIN recruitment_job_interview_stages s ON s.id = i.stage_id
       WHERE i.candidate_id = $1 AND i.business_id = $2
       ORDER BY s.sort_order ASC`,
      [params.id, businessId],
    );
    return NextResponse.json({ interviews });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to list interviews' }, { status: 500 });
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
    const stageId = String(body?.stage_id ?? '').trim();
    if (!stageId) {
      return NextResponse.json({ error: 'stage_id is required' }, { status: 400 });
    }

    const candidate = await queryOne(
      `SELECT id, job_id FROM recruitment_candidates WHERE id = $1 AND business_id = $2`,
      [params.id, businessId],
    );
    if (!candidate) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });

    const stage = await queryOne(
      `SELECT id FROM recruitment_job_interview_stages
       WHERE id = $1 AND job_id = $2 AND business_id = $3`,
      [stageId, candidate.job_id, businessId],
    );
    if (!stage) return NextResponse.json({ error: 'Invalid interview stage' }, { status: 400 });

    const interview = await queryOne(
      `INSERT INTO recruitment_interviews (
        business_id, candidate_id, stage_id, scheduled_at, location_or_link,
        interviewer_user_id, status, feedback
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        businessId,
        params.id,
        stageId,
        body?.scheduled_at || null,
        body?.location_or_link?.trim() || null,
        body?.interviewer_user_id || null,
        body?.status || 'scheduled',
        body?.feedback?.trim() || null,
      ],
    );

    await query(
      `UPDATE recruitment_candidates SET status = 'interviewing', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND business_id = $2 AND status NOT IN ('offer_sent','offer_accepted','joined','rejected','withdrawn')`,
      [params.id, businessId],
    );

    return NextResponse.json({ interview }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[recruitment/interviews POST]', error);
    return NextResponse.json({ error: 'Failed to schedule interview' }, { status: 500 });
  }
}
