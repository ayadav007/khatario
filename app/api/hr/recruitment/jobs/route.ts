import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryRows, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'recruitment', 'read', { businessId });

    const status = new URL(request.url).searchParams.get('status');
    const params: unknown[] = [businessId];
    let sql = `SELECT j.*,
      (SELECT COUNT(*)::int FROM recruitment_candidates c WHERE c.job_id = j.id) AS candidate_count
      FROM recruitment_jobs j WHERE j.business_id = $1`;
    if (status) {
      params.push(status);
      sql += ` AND j.status = $${params.length}`;
    }
    sql += ' ORDER BY j.updated_at DESC';

    const jobs = await queryRows(sql, params);
    return NextResponse.json({ jobs });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[recruitment/jobs GET]', error);
    return NextResponse.json({ error: 'Failed to list jobs' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'recruitment', 'create', { businessId });

    const body = await request.json();
    const title = String(body?.title ?? '').trim();
    if (!title) {
      return NextResponse.json({ error: 'Job title is required' }, { status: 400 });
    }

    const job = await queryOne(
      `INSERT INTO recruitment_jobs (business_id, title, department, description, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        businessId,
        title,
        body?.department?.trim() || null,
        body?.description?.trim() || null,
        body?.status === 'draft' ? 'draft' : 'open',
        userId,
      ],
    );

    const stages: { stage_name: string; sort_order?: number }[] = Array.isArray(body?.stages)
      ? body.stages
      : [];
    const defaultStages =
      stages.length > 0
        ? stages
        : [
            { stage_name: 'HR Round', sort_order: 0 },
            { stage_name: 'Manager Round', sort_order: 1 },
            { stage_name: 'Final Round', sort_order: 2 },
          ];

    for (let i = 0; i < defaultStages.length; i++) {
      const s = defaultStages[i];
      const name = String(s.stage_name ?? '').trim();
      if (!name) continue;
      await queryOne(
        `INSERT INTO recruitment_job_interview_stages (job_id, business_id, stage_name, sort_order)
         VALUES ($1, $2, $3, $4)`,
        [job!.id, businessId, name, s.sort_order ?? i],
      );
    }

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[recruitment/jobs POST]', error);
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
  }
}
