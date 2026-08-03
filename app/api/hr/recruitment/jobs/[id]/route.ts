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

    const job = await queryOne(
      `SELECT * FROM recruitment_jobs WHERE id = $1 AND business_id = $2`,
      [params.id, businessId],
    );
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

    const stages = await queryRows(
      `SELECT * FROM recruitment_job_interview_stages
       WHERE job_id = $1 AND business_id = $2 ORDER BY sort_order ASC`,
      [params.id, businessId],
    );

    const candidates = await queryRows(
      `SELECT c.*, j.title AS job_title
       FROM recruitment_candidates c
       INNER JOIN recruitment_jobs j ON j.id = c.job_id
       WHERE c.job_id = $1 AND c.business_id = $2
       ORDER BY c.updated_at DESC`,
      [params.id, businessId],
    );

    return NextResponse.json({ job, stages, candidates });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[recruitment/jobs/[id] GET]', error);
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 });
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
    const allowed = ['title', 'department', 'description', 'status'] as const;

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
    const job = await queryOne(
      `UPDATE recruitment_jobs SET ${fields.join(', ')}
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      values,
    );
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

    if (Array.isArray(body.stages)) {
      await query(
        `DELETE FROM recruitment_job_interview_stages WHERE job_id = $1 AND business_id = $2`,
        [params.id, businessId],
      );
      for (let i = 0; i < body.stages.length; i++) {
        const s = body.stages[i];
        const name = String(s?.stage_name ?? '').trim();
        if (!name) continue;
        await query(
          `INSERT INTO recruitment_job_interview_stages (job_id, business_id, stage_name, sort_order, description)
           VALUES ($1, $2, $3, $4, $5)`,
          [params.id, businessId, name, s.sort_order ?? i, s.description?.trim() || null],
        );
      }
    }

    return NextResponse.json({ job });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[recruitment/jobs/[id] PATCH]', error);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}
