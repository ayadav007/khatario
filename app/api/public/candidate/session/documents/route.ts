import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows, query } from '@/lib/db';
import { getCandidatePortalSessionFromRequest } from '@/lib/hr/recruitment/candidate-portal-session';

export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf',
];

export async function GET(request: NextRequest) {
  const session = await getCandidatePortalSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const documents = await queryRows(
    `SELECT id, document_type, file_name, verification_status, rejection_reason, uploaded_at
     FROM candidate_documents
     WHERE candidate_id = $1 AND business_id = $2 ORDER BY uploaded_at DESC`,
    [session.candidate_id, session.business_id],
  );

  return NextResponse.json({ documents });
}

export async function POST(request: NextRequest) {
  const session = await getCandidatePortalSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const candidate = await queryOne<{ status: string }>(
    `SELECT status FROM recruitment_candidates WHERE id = $1 AND business_id = $2`,
    [session.candidate_id, session.business_id],
  );
  if (!candidate) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }
  if (!['offer_accepted', 'offer_viewed', 'docs_submitted', 'docs_verified', 'ready_to_join'].includes(candidate.status)) {
    return NextResponse.json({ error: 'Upload documents after accepting your offer' }, { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const documentType = String(formData.get('document_type') ?? 'other').trim();

  if (!file) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Only JPEG, PNG, WebP, and PDF files are allowed' }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'File must be under 5MB' }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const dataUrl = `data:${file.type};base64,${buffer.toString('base64')}`;

  const doc = await queryOne(
    `INSERT INTO candidate_documents (
      business_id, candidate_id, document_type, file_name, file_url, verification_status
    ) VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id, document_type, file_name, verification_status, uploaded_at`,
    [session.business_id, session.candidate_id, documentType, file.name, dataUrl],
  );

  await query(
    `UPDATE recruitment_candidates SET status = 'docs_submitted', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2 AND status IN ('offer_accepted', 'offer_viewed')`,
    [session.candidate_id, session.business_id],
  );

  return NextResponse.json({ document: doc }, { status: 201 });
}
