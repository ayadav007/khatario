import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryRows, queryOne } from '@/lib/db';
import { normalizePhoneOrNull } from '@/lib/utils/phone';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'recruitment', 'read', { businessId });

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('job_id');
    const status = searchParams.get('status');
    const params: unknown[] = [businessId];
    let sql = `SELECT c.*, j.title AS job_title
      FROM recruitment_candidates c
      INNER JOIN recruitment_jobs j ON j.id = c.job_id
      WHERE c.business_id = $1`;

    if (jobId) {
      params.push(jobId);
      sql += ` AND c.job_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND c.status = $${params.length}`;
    }
    sql += ' ORDER BY c.updated_at DESC LIMIT 200';

    const candidates = await queryRows(sql, params);
    return NextResponse.json({ candidates });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[recruitment/candidates GET]', error);
    return NextResponse.json({ error: 'Failed to list candidates' }, { status: 500 });
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
    const jobId = String(body?.job_id ?? '').trim();
    const fullName = String(body?.full_name ?? '').trim();
    const email = String(body?.email ?? '').trim().toLowerCase();
    if (!jobId || !fullName || !email || !email.includes('@')) {
      return NextResponse.json({ error: 'job_id, full_name, and valid email are required' }, { status: 400 });
    }

    const job = await queryOne(
      `SELECT id FROM recruitment_jobs WHERE id = $1 AND business_id = $2`,
      [jobId, businessId],
    );
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

    const phone = normalizePhoneOrNull(String(body?.phone ?? '')) ?? null;

    const candidate = await queryOne(
      `INSERT INTO recruitment_candidates (business_id, job_id, full_name, email, phone, source, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'applied')
       RETURNING *`,
      [
        businessId,
        jobId,
        fullName,
        email,
        phone,
        body?.source?.trim() || null,
        body?.notes?.trim() || null,
      ],
    );

    return NextResponse.json({ candidate }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json({ error: 'A candidate with this email already exists for this job' }, { status: 409 });
    }
    console.error('[recruitment/candidates POST]', error);
    return NextResponse.json({ error: 'Failed to add candidate' }, { status: 500 });
  }
}
