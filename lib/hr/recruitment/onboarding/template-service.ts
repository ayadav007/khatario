import { query, queryOne, queryRows } from '@/lib/db';
import { ensureDefaultOnboardingTemplates } from './task-service';
import { DEFAULT_ONBOARDING_TEMPLATES } from './templates';

export async function listOnboardingTemplates(businessId: string) {
  await ensureDefaultOnboardingTemplates(businessId);
  return queryRows(
    `SELECT id, task_key, name, task_type, phase, is_required, due_days_after_invite,
            instruction_text, config_json, sort_order, is_active, updated_at
     FROM candidate_onboarding_task_templates
     WHERE business_id = $1
     ORDER BY sort_order, name`,
    [businessId],
  );
}

export async function updateOnboardingTemplate(
  businessId: string,
  templateId: string,
  patch: {
    name?: string;
    instruction_text?: string;
    due_days_after_invite?: number | null;
    is_required?: boolean;
    is_active?: boolean;
    sort_order?: number;
    config_json?: unknown;
  },
) {
  const fields: string[] = [];
  const values: unknown[] = [templateId, businessId];

  const allowed = [
    'name',
    'instruction_text',
    'due_days_after_invite',
    'is_required',
    'is_active',
    'sort_order',
    'config_json',
  ] as const;

  for (const key of allowed) {
    if (patch[key] !== undefined) {
      values.push(key === 'config_json' ? JSON.stringify(patch[key]) : patch[key]);
      fields.push(`${key} = $${values.length}`);
    }
  }

  if (fields.length === 0) return null;

  fields.push('updated_at = CURRENT_TIMESTAMP');

  return queryOne(
    `UPDATE candidate_onboarding_task_templates SET ${fields.join(', ')}
     WHERE id = $1 AND business_id = $2 RETURNING *`,
    values,
  );
}

export async function resetOnboardingTemplatesToDefaults(businessId: string) {
  await query(
    `DELETE FROM candidate_onboarding_task_templates WHERE business_id = $1`,
    [businessId],
  );
  await ensureDefaultOnboardingTemplates(businessId);
  return listOnboardingTemplates(businessId);
}

export function getDefaultTemplateReference() {
  return DEFAULT_ONBOARDING_TEMPLATES;
}
