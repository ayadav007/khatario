export const ONBOARDING_TASK_TYPES = [
  'id_proof_bundle',
  'single_identity_doc',
  'repeating_file_slots',
  'attachments_checklist',
  'employment_record',
] as const;

export type OnboardingTaskType = (typeof ONBOARDING_TASK_TYPES)[number];

export const TASK_STATUSES = [
  'not_started',
  'in_progress',
  'submitted',
  'changes_requested',
  'approved',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const CANDIDATE_SELF_STATUSES = ['not_started', 'in_progress', 'completed'] as const;
export type CandidateSelfStatus = (typeof CANDIDATE_SELF_STATUSES)[number];

export const IDENTITY_DOC_KEYS = [
  'aadhaar',
  'pan',
  'voter_id',
  'driving_license',
  'passport',
] as const;

export type IdentityDocKey = (typeof IDENTITY_DOC_KEYS)[number];

export type IdProofBundleConfig = {
  min_complete: number;
  options: IdentityDocKey[];
};

export type SingleIdentityConfig = {
  document_key: IdentityDocKey;
};

export type RepeatingSlotsConfig = {
  slot_count: number;
  fields: Array<'company_name' | 'month_label'>;
};

export type AttachmentsChecklistConfig = {
  accepted_labels: string[];
  min_files: number;
  /** Per-checklist-item helper text shown to candidates */
  label_hints?: Record<string, string>;
  /** Shown above the upload control */
  upload_hint?: string;
  section_title?: string;
};

export type EmploymentRecordConfig = {
  checklist_labels: string[];
  min_files: number;
  label_hints?: Record<string, string>;
  upload_hint?: string;
  section_title?: string;
  field_hints?: Record<string, string>;
};

export type OnboardingTaskConfig =
  | IdProofBundleConfig
  | SingleIdentityConfig
  | RepeatingSlotsConfig
  | AttachmentsChecklistConfig
  | EmploymentRecordConfig;

export type OnboardingTaskRow = {
  id: string;
  business_id: string;
  candidate_id: string;
  task_key: string;
  name: string;
  task_type: OnboardingTaskType;
  phase: string;
  is_required: boolean;
  instruction_text: string | null;
  config_json: OnboardingTaskConfig;
  status: TaskStatus;
  candidate_self_status: CandidateSelfStatus;
  due_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  reviewer_notes: string | null;
  sort_order: number;
};

export type IdentityDocumentRow = {
  id: string;
  document_key: IdentityDocKey;
  fields_json: Record<string, unknown>;
  file_name: string | null;
  file_url: string | null;
  mime_type: string | null;
  is_complete: boolean;
  saved_at: string | null;
};

export type TaskEntryRow = {
  id: string;
  entry_key: string;
  fields_json: Record<string, unknown>;
  sort_order: number;
  is_complete: boolean;
};

export type TaskFileRow = {
  id: string;
  task_id: string;
  entry_id: string | null;
  identity_document_id: string | null;
  file_name: string;
  file_url: string;
  mime_type: string | null;
  uploaded_at: string;
};
