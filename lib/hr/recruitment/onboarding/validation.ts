import type {
  AttachmentsChecklistConfig,
  EmploymentRecordConfig,
  IdProofBundleConfig,
  IdentityDocKey,
  OnboardingTaskRow,
  OnboardingTaskType,
  RepeatingSlotsConfig,
  SingleIdentityConfig,
  TaskEntryRow,
  IdentityDocumentRow,
  TaskFileRow,
} from './types';
import { IDENTITY_FORM_SPECS } from './identity-fields';

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_RE = /^\d{12}$/;

function requiredField(
  fields: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  if (!String(fields[key] ?? '').trim()) return `${label} is required`;
  return null;
}

export function validateIdentityFields(
  documentKey: IdentityDocKey,
  fields: Record<string, unknown>,
  hasFile: boolean,
): string | null {
  const s = (k: string) => String(fields[k] ?? '').trim();
  const specs = IDENTITY_FORM_SPECS[documentKey];

  for (const spec of specs) {
    if (!spec.required) continue;
    const err = requiredField(fields, spec.key, spec.label);
    if (err) return err;
  }

  if (documentKey === 'aadhaar' && !AADHAAR_RE.test(s('aadhaar_number'))) {
    return 'Valid 12-digit Aadhaar number is required';
  }
  if (documentKey === 'pan' && !PAN_RE.test(s('pan_number').toUpperCase())) {
    return 'Valid PAN is required';
  }
  if (documentKey === 'passport' && s('passport_number').length < 6) {
    return 'Valid passport number is required';
  }
  if (documentKey === 'voter_id' && s('voter_id_number').length < 5) {
    return 'Valid voter ID number is required';
  }
  if (documentKey === 'driving_license' && s('license_number').length < 5) {
    return 'Valid license number is required';
  }

  if (!hasFile) return 'Document file is required';
  return null;
}

export function computeTaskProgress(input: {
  task: OnboardingTaskRow;
  identityDocs: IdentityDocumentRow[];
  entries: TaskEntryRow[];
  files: TaskFileRow[];
}): { complete: number; required: number; canSubmit: boolean; error?: string } {
  const { task, identityDocs, entries, files } = input;
  const config = task.config_json;

  switch (task.task_type as OnboardingTaskType) {
    case 'id_proof_bundle': {
      const cfg = config as IdProofBundleConfig;
      const complete = identityDocs.filter(
        (d) => d.is_complete && cfg.options.includes(d.document_key),
      ).length;
      const required = cfg.min_complete;
      return {
        complete,
        required,
        canSubmit: complete >= required,
        error: complete < required ? `Complete at least ${required} identity documents` : undefined,
      };
    }
    case 'single_identity_doc': {
      const cfg = config as SingleIdentityConfig;
      const doc = identityDocs.find((d) => d.document_key === cfg.document_key);
      const complete = doc?.is_complete ? 1 : 0;
      return { complete, required: 1, canSubmit: complete >= 1 };
    }
    case 'repeating_file_slots': {
      const cfg = config as RepeatingSlotsConfig;
      const complete = entries.filter((e) => e.is_complete).length;
      return {
        complete,
        required: cfg.slot_count,
        canSubmit: complete >= cfg.slot_count,
      };
    }
    case 'attachments_checklist': {
      const cfg = config as AttachmentsChecklistConfig;
      const count = files.length;
      return {
        complete: count,
        required: cfg.min_files,
        canSubmit: count >= cfg.min_files,
      };
    }
    case 'employment_record': {
      const cfg = config as EmploymentRecordConfig;
      const entryOk = entries.some((e) => e.is_complete);
      const fileCount = files.length;
      return {
        complete: entryOk && fileCount >= cfg.min_files ? 1 : 0,
        required: 1,
        canSubmit: entryOk && fileCount >= cfg.min_files,
      };
    }
    default:
      return { complete: 0, required: 1, canSubmit: false, error: 'Unknown task type' };
  }
}

export function isTaskEditable(status: string): boolean {
  return ['not_started', 'in_progress', 'changes_requested'].includes(status);
}

export function taskStatusLabel(status: string): string {
  const map: Record<string, string> = {
    not_started: 'Not started',
    in_progress: 'In progress',
    submitted: 'Pending for approval',
    changes_requested: 'Changes requested',
    approved: 'Approved',
  };
  return map[status] ?? status;
}

export function dueLabel(dueAt: string | null): string {
  if (!dueAt) return '—';
  const due = new Date(dueAt);
  const now = new Date();
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `Overdue by ${Math.abs(diffDays)}d`;
  if (diffDays === 0) return 'Due today';
  return `Due in ${diffDays}d`;
}
