import { queryOne } from '@/lib/db';
import {
  parseHrExitSettings,
  validateExitApprovalChain,
  type HrExitSettings,
} from '@/lib/hr/exit-settings-shared';

export type {
  ExitApproverRoleType,
  ExitApprovalChainLevel,
  HrExitSettings,
} from '@/lib/hr/exit-settings-shared';
export {
  DEFAULT_EXIT_APPROVAL_CHAIN,
  DEFAULT_HR_EXIT_SETTINGS,
  parseHrExitSettings,
  validateExitApprovalChain,
  resolveNoticePeriodDays,
  EXIT_APPROVER_ROLE_LABELS,
} from '@/lib/hr/exit-settings-shared';

export async function getHrExitSettings(businessId: string): Promise<HrExitSettings> {
  const row = await queryOne<{ hr_exit_settings: unknown }>(
    `SELECT hr_exit_settings FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  return parseHrExitSettings(row?.hr_exit_settings);
}

export async function saveHrExitSettings(
  businessId: string,
  settings: HrExitSettings,
): Promise<HrExitSettings> {
  const parsed = parseHrExitSettings(settings);
  const validationError = validateExitApprovalChain(parsed);
  if (validationError) throw new Error(validationError);

  await queryOne(
    `UPDATE business_settings SET hr_exit_settings = $2::jsonb, updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 RETURNING business_id`,
    [businessId, JSON.stringify(parsed)],
  );
  return parsed;
}
