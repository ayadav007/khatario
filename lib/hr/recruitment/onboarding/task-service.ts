import { query, queryOne, queryRows } from '@/lib/db';
import { DEFAULT_ONBOARDING_TEMPLATES } from './templates';
import { computeTaskProgress } from './validation';
import type { IdentityDocKey, OnboardingTaskRow, TaskStatus } from './types';
import {
  notifyCandidateAllTasksApproved,
  notifyCandidateChangesRequested,
  notifyHrTaskSubmitted,
} from './notifications';

export async function ensureDefaultOnboardingTemplates(businessId: string): Promise<void> {
  for (const t of DEFAULT_ONBOARDING_TEMPLATES) {
    await query(
      `INSERT INTO candidate_onboarding_task_templates (
        business_id, task_key, name, task_type, phase, is_required,
        due_days_after_invite, instruction_text, config_json, sort_order
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (business_id, task_key) DO NOTHING`,
      [
        businessId,
        t.task_key,
        t.name,
        t.task_type,
        t.phase,
        t.is_required,
        t.due_days_after_invite,
        t.instruction_text,
        JSON.stringify(t.config_json),
        t.sort_order,
      ],
    );
  }
}

export async function assignOnboardingTasksToCandidate(
  businessId: string,
  candidateId: string,
  invitedAt: Date = new Date(),
  options?: { templateIds?: string[] },
): Promise<{ count: number; tasks: { name: string; due_at: string | null }[] }> {
  await ensureDefaultOnboardingTemplates(businessId);

  const templateIds = options?.templateIds?.filter(Boolean);
  if (templateIds && templateIds.length === 0) {
    return { count: 0, tasks: [] };
  }

  const templates = await queryRows<{
    id: string;
    task_key: string;
    name: string;
    task_type: string;
    phase: string;
    is_required: boolean;
    instruction_text: string | null;
    config_json: unknown;
    due_days_after_invite: number | null;
    sort_order: number;
  }>(
    templateIds && templateIds.length > 0
      ? `SELECT * FROM candidate_onboarding_task_templates
         WHERE business_id = $1 AND is_active = true AND phase = 'pre_offer'
           AND id = ANY($2::uuid[])
         ORDER BY sort_order`
      : `SELECT * FROM candidate_onboarding_task_templates
         WHERE business_id = $1 AND is_active = true AND phase = 'pre_offer'
         ORDER BY sort_order`,
    templateIds && templateIds.length > 0 ? [businessId, templateIds] : [businessId],
  );

  let assigned = 0;
  const assignedTasks: { name: string; due_at: string | null }[] = [];

  for (const tpl of templates) {
    const exists = await queryOne(
      `SELECT id FROM candidate_onboarding_tasks WHERE candidate_id = $1 AND task_key = $2`,
      [candidateId, tpl.task_key],
    );
    if (exists) continue;

    const dueAt =
      tpl.due_days_after_invite != null
        ? new Date(invitedAt.getTime() + tpl.due_days_after_invite * 86400000)
        : null;

    await query(
      `INSERT INTO candidate_onboarding_tasks (
        business_id, candidate_id, template_id, task_key, name, task_type, phase,
        is_required, instruction_text, config_json, due_at, sort_order
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        businessId,
        candidateId,
        tpl.id,
        tpl.task_key,
        tpl.name,
        tpl.task_type,
        tpl.phase,
        tpl.is_required,
        tpl.instruction_text,
        JSON.stringify(tpl.config_json),
        dueAt?.toISOString() ?? null,
        tpl.sort_order,
      ],
    );
    assigned += 1;
    assignedTasks.push({
      name: tpl.name,
      due_at: dueAt?.toISOString() ?? null,
    });
  }

  await syncSingleIdentityTasksFromStore(businessId, candidateId);
  return { count: assigned, tasks: assignedTasks };
}

/** If identity already complete (e.g. from id_proof), auto-approve single_identity tasks. */
async function syncSingleIdentityTasksFromStore(
  businessId: string,
  candidateId: string,
): Promise<void> {
  const tasks = await queryRows<{ id: string; config_json: { document_key?: string } }>(
    `SELECT id, config_json FROM candidate_onboarding_tasks
     WHERE candidate_id = $1 AND business_id = $2 AND task_type = 'single_identity_doc'`,
    [candidateId, businessId],
  );

  for (const task of tasks) {
    const key = task.config_json?.document_key;
    if (!key) continue;
    const identity = await queryOne<{ is_complete: boolean }>(
      `SELECT is_complete FROM candidate_identity_documents
       WHERE candidate_id = $1 AND document_key = $2`,
      [candidateId, key],
    );
    if (identity?.is_complete) {
      await query(
        `UPDATE candidate_onboarding_tasks
         SET status = 'approved', approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status NOT IN ('approved')`,
        [task.id],
      );
    }
  }
}

export async function loadTaskBundle(taskId: string, candidateId: string, businessId: string) {
  const task = await queryOne<OnboardingTaskRow>(
    `SELECT * FROM candidate_onboarding_tasks
     WHERE id = $1 AND candidate_id = $2 AND business_id = $3`,
    [taskId, candidateId, businessId],
  );
  if (!task) return null;

  const config =
    typeof task.config_json === 'string'
      ? (JSON.parse(task.config_json) as OnboardingTaskRow['config_json'])
      : task.config_json;

  const [identityDocs, entries, files] = await Promise.all([
    queryRows(
      `SELECT * FROM candidate_identity_documents WHERE candidate_id = $1 AND business_id = $2`,
      [candidateId, businessId],
    ),
    queryRows(
      `SELECT * FROM candidate_task_entries WHERE task_id = $1 ORDER BY sort_order`,
      [taskId],
    ),
    queryRows(
      `SELECT * FROM candidate_task_files WHERE task_id = $1 ORDER BY uploaded_at`,
      [taskId],
    ),
  ]);

  const progress = computeTaskProgress({
    task: { ...task, config_json: config },
    identityDocs: identityDocs as never[],
    entries: entries as never[],
    files: files as never[],
  });

  return { task: { ...task, config_json: config }, identityDocs, entries, files, progress };
}

export async function refreshCandidateInfoCollectionStatus(
  businessId: string,
  candidateId: string,
): Promise<void> {
  const required = await queryRows<{ id: string; status: string }>(
    `SELECT id, status FROM candidate_onboarding_tasks
     WHERE candidate_id = $1 AND business_id = $2 AND phase = 'pre_offer' AND is_required = true`,
    [candidateId, businessId],
  );

  if (required.length === 0) return;

  const allApproved = required.every((t) => t.status === 'approved');
  const anyStarted = required.some((t) => t.status !== 'not_started');

  if (allApproved) {
    await query(
      `UPDATE recruitment_candidates
       SET status = 'info_collection_complete',
           info_collection_completed_at = COALESCE(info_collection_completed_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND business_id = $2`,
      [candidateId, businessId],
    );
    return;
  }

  if (anyStarted) {
    await query(
      `UPDATE recruitment_candidates
       SET status = CASE WHEN status IN ('portal_invited', 'info_collection') THEN 'info_collection' ELSE status END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND business_id = $2`,
      [candidateId, businessId],
    );
  }
}

export async function assertPreOfferTasksApproved(
  businessId: string,
  candidateId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const pending = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM candidate_onboarding_tasks
     WHERE candidate_id = $1 AND business_id = $2 AND phase = 'pre_offer' AND is_required = true
       AND status != 'approved'`,
    [candidateId, businessId],
  );
  const n = Number(pending?.count ?? 0);
  if (n > 0) {
    return {
      ok: false,
      message: `${n} required onboarding task(s) must be approved before releasing an offer.`,
    };
  }
  return { ok: true };
}

export async function upsertIdentityDocument(input: {
  businessId: string;
  candidateId: string;
  documentKey: IdentityDocKey;
  fields: Record<string, unknown>;
  fileName?: string | null;
  fileUrl?: string | null;
  mimeType?: string | null;
  isComplete: boolean;
}) {
  const row = await queryOne(
    `INSERT INTO candidate_identity_documents (
      business_id, candidate_id, document_key, fields_json,
      file_name, file_url, mime_type, is_complete, saved_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_TIMESTAMP)
    ON CONFLICT (candidate_id, document_key) DO UPDATE SET
      fields_json = EXCLUDED.fields_json,
      file_name = COALESCE(EXCLUDED.file_name, candidate_identity_documents.file_name),
      file_url = COALESCE(EXCLUDED.file_url, candidate_identity_documents.file_url),
      mime_type = COALESCE(EXCLUDED.mime_type, candidate_identity_documents.mime_type),
      is_complete = EXCLUDED.is_complete,
      saved_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *`,
    [
      input.businessId,
      input.candidateId,
      input.documentKey,
      JSON.stringify(input.fields),
      input.fileName ?? null,
      input.fileUrl ?? null,
      input.mimeType ?? null,
      input.isComplete,
    ],
  );

  await syncSingleIdentityTasksFromStore(input.businessId, input.candidateId);
  return row;
}

export async function markTaskInProgress(taskId: string): Promise<void> {
  await query(
    `UPDATE candidate_onboarding_tasks
     SET status = CASE WHEN status = 'not_started' THEN 'in_progress' ELSE status END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [taskId],
  );
}

export async function submitTask(
  taskId: string,
  candidateId: string,
  businessId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const bundle = await loadTaskBundle(taskId, candidateId, businessId);
  if (!bundle) return { ok: false, error: 'Task not found' };
  if (!['not_started', 'in_progress', 'changes_requested'].includes(bundle.task.status)) {
    return { ok: false, error: 'Task is already submitted or approved' };
  }
  if (!bundle.progress.canSubmit) {
    return { ok: false, error: bundle.progress.error ?? 'Complete all required items before submitting' };
  }

  await query(
    `UPDATE candidate_onboarding_tasks
     SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [taskId],
  );

  await refreshCandidateInfoCollectionStatus(businessId, candidateId);

  void notifyHrTaskSubmitted({
    businessId,
    candidateId,
    taskId,
    taskName: String(bundle.task.name),
  }).catch(() => {});

  return { ok: true };
}

export async function reviewTask(input: {
  taskId: string;
  businessId: string;
  candidateId: string;
  reviewerId: string;
  action: 'approve' | 'request_changes';
  notes?: string;
}): Promise<void> {
  const taskRow = await queryOne<{ name: string; status: string }>(
    `SELECT name, status FROM candidate_onboarding_tasks WHERE id = $1`,
    [input.taskId],
  );

  const status: TaskStatus = input.action === 'approve' ? 'approved' : 'changes_requested';
  await query(
    `UPDATE candidate_onboarding_tasks
     SET status = $1,
         approved_at = CASE WHEN $1 = 'approved' THEN CURRENT_TIMESTAMP ELSE NULL END,
         reviewed_by = $2,
         reviewer_notes = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $4 AND business_id = $5 AND candidate_id = $6`,
    [status, input.reviewerId, input.notes ?? null, input.taskId, input.businessId, input.candidateId],
  );
  await refreshCandidateInfoCollectionStatus(input.businessId, input.candidateId);

  if (input.action === 'request_changes' && taskRow) {
    void notifyCandidateChangesRequested({
      businessId: input.businessId,
      candidateId: input.candidateId,
      taskName: taskRow.name,
      notes: input.notes,
    }).catch(() => {});
  }

  if (input.action === 'approve') {
    const candidate = await queryOne<{ status: string }>(
      `SELECT status FROM recruitment_candidates WHERE id = $1 AND business_id = $2`,
      [input.candidateId, input.businessId],
    );
    if (candidate?.status === 'info_collection_complete') {
      void notifyCandidateAllTasksApproved({
        businessId: input.businessId,
        candidateId: input.candidateId,
      }).catch(() => {});
    }
  }
}

export type EmployeePrefillFromOnboarding = {
  pan_number: string | null;
  aadhaar_number: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_name: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
};

export async function getEmployeePrefillFromOnboarding(
  businessId: string,
  candidateId: string,
): Promise<EmployeePrefillFromOnboarding> {
  const identities = await queryRows<{ document_key: string; fields_json: Record<string, unknown> }>(
    `SELECT document_key, fields_json FROM candidate_identity_documents
     WHERE candidate_id = $1 AND business_id = $2 AND is_complete = true`,
    [candidateId, businessId],
  );

  let pan_number: string | null = null;
  let aadhaar_number: string | null = null;

  for (const id of identities) {
    const f = id.fields_json ?? {};
    if (id.document_key === 'pan' && f.pan_number) {
      pan_number = String(f.pan_number).toUpperCase();
    }
    if (id.document_key === 'aadhaar' && f.aadhaar_number) {
      aadhaar_number = String(f.aadhaar_number);
    }
  }

  const bankEntry = await queryOne<{ fields_json: Record<string, unknown> }>(
    `SELECT e.fields_json FROM candidate_task_entries e
     INNER JOIN candidate_onboarding_tasks t ON t.id = e.task_id
     WHERE e.candidate_id = $1 AND e.business_id = $2 AND t.task_key = 'bank_proof'
     ORDER BY e.updated_at DESC LIMIT 1`,
    [candidateId, businessId],
  );

  return {
    pan_number,
    aadhaar_number,
    bank_account_number: bankEntry?.fields_json?.account_number
      ? String(bankEntry.fields_json.account_number)
      : null,
    bank_ifsc: bankEntry?.fields_json?.ifsc ? String(bankEntry.fields_json.ifsc) : null,
    bank_name: bankEntry?.fields_json?.bank_name ? String(bankEntry.fields_json.bank_name) : null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
  };
}
