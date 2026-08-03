import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryOne, query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; interviewId: string } },
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
    const values: unknown[] = [params.interviewId, params.id, businessId];
    const allowed = [
      'scheduled_at',
      'location_or_link',
      'interviewer_user_id',
      'status',
      'feedback',
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
    const interview = await queryOne(
      `UPDATE recruitment_interviews SET ${fields.join(', ')}
       WHERE id = $1 AND candidate_id = $2 AND business_id = $3 RETURNING *`,
      values,
    );
    if (!interview) return NextResponse.json({ error: 'Interview not found' }, { status: 404 });

    if (body.status === 'passed') {
      await query(
        `UPDATE recruitment_candidates SET status = 'selected', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND business_id = $2`,
        [params.id, businessId],
      );
    } else if (body.status === 'failed') {
      await query(
        `UPDATE recruitment_candidates SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND business_id = $2`,
        [params.id, businessId],
      );
    }

    return NextResponse.json({ interview });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to update interview' }, { status: 500 });
  }
}
