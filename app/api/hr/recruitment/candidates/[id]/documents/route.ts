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

    const documents = await queryRows(
      `SELECT * FROM candidate_documents
       WHERE candidate_id = $1 AND business_id = $2 ORDER BY uploaded_at DESC`,
      [params.id, businessId],
    );
    return NextResponse.json({ documents });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to list documents' }, { status: 500 });
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
    const documentId = String(body?.document_id ?? '').trim();
    const verificationStatus = String(body?.verification_status ?? '').trim();
    if (!documentId || !['approved', 'rejected', 'pending'].includes(verificationStatus)) {
      return NextResponse.json({ error: 'document_id and valid verification_status required' }, { status: 400 });
    }

    const doc = await queryOne(
      `UPDATE candidate_documents
       SET verification_status = $1,
           rejection_reason = $2,
           verified_by = $3,
           verified_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND candidate_id = $5 AND business_id = $6
       RETURNING *`,
      [
        verificationStatus,
        verificationStatus === 'rejected' ? body?.rejection_reason?.trim() || null : null,
        userId,
        documentId,
        params.id,
        businessId,
      ],
    );
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const pending = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM candidate_documents
       WHERE candidate_id = $1 AND business_id = $2 AND verification_status = 'pending'`,
      [params.id, businessId],
    );
    const total = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM candidate_documents
       WHERE candidate_id = $1 AND business_id = $2`,
      [params.id, businessId],
    );

    if (Number(total?.count ?? 0) > 0 && Number(pending?.count ?? 0) === 0) {
      const rejected = await queryOne<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM candidate_documents
         WHERE candidate_id = $1 AND business_id = $2 AND verification_status = 'rejected'`,
        [params.id, businessId],
      );
      const newStatus = Number(rejected?.count ?? 0) > 0 ? 'docs_submitted' : 'docs_verified';
      await query(
        `UPDATE recruitment_candidates SET status = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND business_id = $3`,
        [newStatus, params.id, businessId],
      );
    }

    return NextResponse.json({ document: doc });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to verify document' }, { status: 500 });
  }
}
