import { NextRequest, NextResponse } from 'next/server';
import { getCandidatePortalSessionFromRequest } from '@/lib/hr/recruitment/candidate-portal-session';
import {
  loadTaskBundle,
  markTaskInProgress,
  upsertIdentityDocument,
} from '@/lib/hr/recruitment/onboarding/task-service';
import { validateIdentityFields, isTaskEditable } from '@/lib/hr/recruitment/onboarding/validation';
import { IDENTITY_DOC_KEYS, type IdentityDocKey } from '@/lib/hr/recruitment/onboarding/types';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];

type RouteParams = { params: { taskId: string; docKey: string } };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await getCandidatePortalSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const docKey = params.docKey as IdentityDocKey;
  if (!IDENTITY_DOC_KEYS.includes(docKey)) {
    return NextResponse.json({ error: 'Invalid document type' }, { status: 400 });
  }

  const bundle = await loadTaskBundle(params.taskId, session.candidate_id, session.business_id);
  if (!bundle) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  if (!isTaskEditable(bundle.task.status)) {
    return NextResponse.json({ error: 'Task is locked for editing' }, { status: 400 });
  }

  const formData = await request.formData();
  const fieldsRaw = formData.get('fields');
  let fields: Record<string, unknown> = {};
  if (typeof fieldsRaw === 'string' && fieldsRaw.trim()) {
    try {
      fields = JSON.parse(fieldsRaw) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid fields JSON' }, { status: 400 });
    }
  }

  const file = formData.get('file') as File | null;
  let fileName: string | null = null;
  let fileUrl: string | null = null;
  let mimeType: string | null = null;

  const existing = await queryOne<{ file_url: string | null; file_name: string | null; mime_type: string | null }>(
    `SELECT file_url, file_name, mime_type FROM candidate_identity_documents
     WHERE candidate_id = $1 AND document_key = $2`,
    [session.candidate_id, docKey],
  );

  if (file && file.size > 0) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Only JPEG, PNG, WebP, and PDF allowed' }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File must be under 5MB' }, { status: 400 });
    }
    const bytes = await file.arrayBuffer();
    fileUrl = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`;
    fileName = file.name;
    mimeType = file.type;
  } else if (existing?.file_url) {
    fileUrl = existing.file_url;
    fileName = existing.file_name;
    mimeType = existing.mime_type;
  }

  const validationError = validateIdentityFields(docKey, fields, Boolean(fileUrl));
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const doc = await upsertIdentityDocument({
    businessId: session.business_id,
    candidateId: session.candidate_id,
    documentKey: docKey,
    fields,
    fileName,
    fileUrl,
    mimeType,
    isComplete: true,
  });

  await markTaskInProgress(params.taskId);

  return NextResponse.json({ document: doc });
}
