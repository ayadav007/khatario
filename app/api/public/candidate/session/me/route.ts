import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { getCandidatePortalSessionFromRequest } from '@/lib/hr/recruitment/candidate-portal-session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getCandidatePortalSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const candidate = await queryOne(
    `SELECT c.*, j.title AS job_title, b.name AS business_name, b.logo_url
     FROM recruitment_candidates c
     INNER JOIN recruitment_jobs j ON j.id = c.job_id
     INNER JOIN businesses b ON b.id = c.business_id
     WHERE c.id = $1 AND c.business_id = $2`,
    [session.candidate_id, session.business_id],
  );

  if (!candidate) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  return NextResponse.json({
    candidate: {
      id: candidate.id,
      name: candidate.full_name,
      email: candidate.email,
      status: candidate.status,
      job_title: candidate.job_title,
    },
    business: {
      id: session.business_id,
      name: candidate.business_name,
      logo_url: candidate.logo_url,
    },
  });
}
