import type { OnboardingTaskType, OnboardingTaskConfig } from './types';

export type DefaultTemplateDef = {
  task_key: string;
  name: string;
  task_type: OnboardingTaskType;
  phase: 'pre_offer' | 'post_offer';
  is_required: boolean;
  due_days_after_invite: number;
  instruction_text: string;
  config_json: OnboardingTaskConfig;
  sort_order: number;
};

/** Default pack — no standalone Aadhaar/PAN (covered by id_proof bundle). */
export const DEFAULT_ONBOARDING_TEMPLATES: DefaultTemplateDef[] = [
  {
    task_key: 'id_proof',
    name: 'ID Proof',
    task_type: 'id_proof_bundle',
    phase: 'pre_offer',
    is_required: true,
    due_days_after_invite: 7,
    instruction_text: 'Upload any 3 of the following identity documents.',
    config_json: {
      min_complete: 3,
      options: ['aadhaar', 'pan', 'voter_id', 'driving_license', 'passport'],
    },
    sort_order: 10,
  },
  {
    task_key: 'salary_slips_3m',
    name: "Last 3 Months' Salary Slip",
    task_type: 'repeating_file_slots',
    phase: 'pre_offer',
    is_required: true,
    due_days_after_invite: 7,
    instruction_text: 'Upload payslips for the last three months.',
    config_json: { slot_count: 3, fields: ['company_name', 'month_label'] },
    sort_order: 20,
  },
  {
    task_key: 'bank_proof',
    name: 'Bank Account Proof',
    task_type: 'attachments_checklist',
    phase: 'pre_offer',
    is_required: true,
    due_days_after_invite: 7,
    instruction_text: 'Upload cancelled cheque, bank passbook, or account statement.',
    config_json: {
      accepted_labels: ['Cancelled Cheque', 'Bank Passbook', 'Bank Statement'],
      min_files: 1,
    },
    sort_order: 30,
  },
  {
    task_key: 'previous_employment',
    name: 'Earlier employers (documents)',
    task_type: 'attachments_checklist',
    phase: 'pre_offer',
    is_required: true,
    due_days_after_invite: 7,
    instruction_text:
      'Upload documents from employers before your current or most recent job. No form to fill — attach PDF or clear photos only.',
    config_json: {
      section_title: 'Documents from earlier jobs',
      accepted_labels: [
        'Relieving or service certificate (earlier employer)',
        'Offer or appointment letter (earlier employer)',
      ],
      label_hints: {
        'Relieving or service certificate (earlier employer)':
          'Issued when you left a previous company — shows last working day and role.',
        'Offer or appointment letter (earlier employer)':
          'Joining letter from a company before your current/last employer (optional if you upload relieving letter).',
      },
      upload_hint:
        'Upload at least one file. If you had multiple earlier jobs, you may upload multiple files in one go.',
      min_files: 1,
    },
    sort_order: 40,
  },
  {
    task_key: 'last_employment',
    name: 'Current / last employer',
    task_type: 'employment_record',
    phase: 'pre_offer',
    is_required: true,
    due_days_after_invite: 7,
    instruction_text:
      'Share details of the company you most recently worked for — or where you are employed today. Fill the form and upload supporting documents.',
    config_json: {
      section_title: 'Current / last employer',
      checklist_labels: [
        'Offer or appointment letter (current / last company)',
        'Last appraisal or increment letter (if available)',
      ],
      label_hints: {
        'Offer or appointment letter (current / last company)':
          'Your joining letter from the employer you are leaving or currently work at.',
        'Last appraisal or increment letter (if available)':
          'Latest performance review or salary revision letter — upload if you have it.',
      },
      upload_hint:
        'Upload at least one document after saving your employment details. PDF or photo is fine.',
      field_hints: {
        company_name: 'Legal or brand name of your current or most recent employer',
        job_title: 'Designation at that company (e.g. Software Engineer)',
        date_of_joining: 'First day at this company',
        date_of_relieving: 'Last working day — leave blank if you are still employed here',
        location: 'City or office location',
        description: 'Brief summary of role, team, or reason for leaving (optional)',
      },
      min_files: 1,
    },
    sort_order: 50,
  },
];

export const IDENTITY_FIELD_LABELS: Record<string, Record<string, string>> = {
  aadhaar: {
    aadhaar_number: 'Aadhaar Number',
    enrollment_number: 'Enrollment Number',
    full_name: 'Name',
    date_of_birth: 'Date of Birth',
    gender: 'Gender',
    address: 'Address',
  },
  pan: {
    pan_number: 'Permanent Account Number',
    full_name: 'Name',
    date_of_birth: 'Date of Birth',
    parent_name: "Parent's Name",
  },
  voter_id: {
    voter_id_number: 'Voter ID Number',
    full_name: 'Name',
    date_of_birth: 'Date of Birth',
    address: 'Address',
  },
  driving_license: {
    license_number: 'License Number',
    full_name: 'Name',
    date_of_birth: 'Date of Birth',
    valid_until: 'Valid Until',
  },
  passport: {
    passport_number: 'Passport Number',
    full_name: 'Name',
    date_of_birth: 'Date of Birth',
    expiry_date: 'Expiry Date',
  },
};

export function identityDocTitle(key: string): string {
  const map: Record<string, string> = {
    aadhaar: 'Aadhaar Card',
    pan: 'Pan Card',
    voter_id: 'Voter Id Card',
    driving_license: 'Driving License',
    passport: 'Passport',
  };
  return map[key] ?? key;
}
