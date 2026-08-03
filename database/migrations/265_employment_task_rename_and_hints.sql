-- Rename employment onboarding templates and refresh candidate-facing hints
UPDATE candidate_onboarding_task_templates
SET
  name = 'Earlier employers (documents)',
  instruction_text = 'Upload documents from employers before your current or most recent job. No form to fill — attach PDF or clear photos only.',
  config_json = '{
    "section_title": "Documents from earlier jobs",
    "accepted_labels": [
      "Relieving or service certificate (earlier employer)",
      "Offer or appointment letter (earlier employer)"
    ],
    "label_hints": {
      "Relieving or service certificate (earlier employer)": "Issued when you left a previous company — shows last working day and role.",
      "Offer or appointment letter (earlier employer)": "Joining letter from a company before your current/last employer (optional if you upload relieving letter)."
    },
    "upload_hint": "Upload at least one file. If you had multiple earlier jobs, you may upload multiple files in one go.",
    "min_files": 1
  }'::jsonb,
  updated_at = CURRENT_TIMESTAMP
WHERE task_key = 'previous_employment';

UPDATE candidate_onboarding_task_templates
SET
  name = 'Current / last employer',
  instruction_text = 'Share details of the company you most recently worked for — or where you are employed today. Fill the form and upload supporting documents.',
  config_json = '{
    "section_title": "Current / last employer",
    "checklist_labels": [
      "Offer or appointment letter (current / last company)",
      "Last appraisal or increment letter (if available)"
    ],
    "label_hints": {
      "Offer or appointment letter (current / last company)": "Your joining letter from the employer you are leaving or currently work at.",
      "Last appraisal or increment letter (if available)": "Latest performance review or salary revision letter — upload if you have it."
    },
    "upload_hint": "Upload at least one document after saving your employment details. PDF or photo is fine.",
    "field_hints": {
      "company_name": "Legal or brand name of your current or most recent employer",
      "job_title": "Designation at that company (e.g. Software Engineer)",
      "date_of_joining": "First day at this company",
      "date_of_relieving": "Last working day — leave blank if you are still employed here",
      "location": "City or office location",
      "description": "Brief summary of role, team, or reason for leaving (optional)"
    },
    "min_files": 1
  }'::jsonb,
  updated_at = CURRENT_TIMESTAMP
WHERE task_key = 'last_employment';

-- Sync already-assigned candidate tasks (names + instructions; keep status/progress)
UPDATE candidate_onboarding_tasks t
SET
  name = tpl.name,
  instruction_text = tpl.instruction_text,
  config_json = tpl.config_json,
  updated_at = CURRENT_TIMESTAMP
FROM candidate_onboarding_task_templates tpl
WHERE t.task_key = tpl.task_key
  AND t.business_id = tpl.business_id
  AND t.task_key IN ('previous_employment', 'last_employment')
  AND t.status IN ('not_started', 'in_progress', 'changes_requested');
