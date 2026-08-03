import { NextRequest, NextResponse } from 'next/server';
import { getCandidatePortalSessionFromRequest } from '@/lib/hr/recruitment/candidate-portal-session';
import {
  loadTaskBundle,
  markTaskInProgress,
} from '@/lib/hr/recruitment/onboarding/task-service';
import { isTaskEditable } from '@/lib/hr/recruitment/onboarding/validation';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];

type RouteParams = { params: { taskId: string } };

async function recomputeEntryComplete(taskId: string, entryId: string, taskType: string) {
  const entry = await queryOne<{ fields_json: Record<string, unknown> }>(
    `SELECT fields_json FROM candidate_task_entries WHERE id = $1`,
    [entryId],
  );
  const hasFile = await queryOne(
    `SELECT id FROM candidate_task_files WHERE task_id = $1 AND entry_id = $2 LIMIT 1`,
    [taskId, entryId],
  );

  let isComplete = false;
  const f = entry?.fields_json ?? {};
  if (taskType === 'repeating_file_slots') {
    isComplete = Boolean(
      String(f.company_name ?? '').trim() &&
        String(f.month_label ?? '').trim() &&
        hasFile,
    );
  } else if (taskType === 'employment_record') {
    isComplete = Boolean(
      String(f.company_name ?? '').trim() &&
        String(f.job_title ?? '').trim() &&
        String(f.date_of_joining ?? '').trim() &&
        String(f.date_of_relieving ?? '').trim() &&
        hasFile,
    );
  }

  await query(`UPDATE candidate_task_entries SET is_complete = $1 WHERE id = $2`, [isComplete, entryId]);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await getCandidatePortalSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const bundle = await loadTaskBundle(params.taskId, session.candidate_id, session.business_id);
  if (!bundle) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  if (!isTaskEditable(bundle.task.status)) {
    return NextResponse.json({ error: 'Task is locked for editing' }, { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const entryKey = String(formData.get('entry_key') ?? '').trim() || null;
  const sortOrder = Number(formData.get('sort_order') ?? 0);

  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Only JPEG, PNG, WebP, and PDF allowed' }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'File must be under 5MB' }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const fileUrl = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`;

  let entryId: string | null = null;
  if (entryKey) {
    const entry = await queryOne<{ id: string }>(
      `INSERT INTO candidate_task_entries (
        task_id, business_id, candidate_id, entry_key, fields_json, sort_order, is_complete
      ) VALUES ($1,$2,$3,$4,'{}',$5,false)
      ON CONFLICT (task_id, entry_key) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING id`,
      [params.taskId, session.business_id, session.candidate_id, entryKey, sortOrder],
    );
    entryId = entry?.id ?? null;
  }

  const row = await queryOne(
    `INSERT INTO candidate_task_files (
      task_id, entry_id, business_id, candidate_id, file_name, file_url, mime_type, file_size
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      params.taskId,
      entryId,
      session.business_id,
      session.candidate_id,
      file.name,
      fileUrl,
      file.type,
      file.size,
    ],
  );

  if (entryId) {
    await recomputeEntryComplete(params.taskId, entryId, bundle.task.task_type);
  }

  await markTaskInProgress(params.taskId);
  return NextResponse.json({ file: row }, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const session = await getCandidatePortalSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const bundle = await loadTaskBundle(params.taskId, session.candidate_id, session.business_id);
  if (!bundle) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  if (!isTaskEditable(bundle.task.status)) {
    return NextResponse.json({ error: 'Task is locked for editing' }, { status: 400 });
  }

  const body = await request.json();
  const entryKey = String(body.entry_key ?? '').trim();
  const fields = (body.fields ?? {}) as Record<string, unknown>;
  const sortOrder = Number(body.sort_order ?? 0);

  if (!entryKey) return NextResponse.json({ error: 'entry_key is required' }, { status: 400 });

  const entry = await queryOne<{ id: string }>(
    `INSERT INTO candidate_task_entries (
      task_id, business_id, candidate_id, entry_key, fields_json, sort_order, is_complete
    ) VALUES ($1,$2,$3,$4,$5,$6,false)
    ON CONFLICT (task_id, entry_key) DO UPDATE SET
      fields_json = EXCLUDED.fields_json,
      sort_order = EXCLUDED.sort_order,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id`,
    [params.taskId, session.business_id, session.candidate_id, entryKey, JSON.stringify(fields), sortOrder],
  );

  if (entry?.id) {
    await recomputeEntryComplete(params.taskId, entry.id, bundle.task.task_type);
  }

  await markTaskInProgress(params.taskId);
  return NextResponse.json({ ok: true });
}
