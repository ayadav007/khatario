export type RegularizationRequestType =
  | 'missing_check_in'
  | 'missing_check_out'
  | 'missing_both'
  | 'override_check_in'
  | 'override_check_out'
  | 'delete_check_in'
  | 'delete_check_out'
  | 'partial_late_in'
  | 'partial_early_out';

export type RegularizationRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type RegularizationSettings = {
  enabled: boolean;
  allow_missing_punch: boolean;
  allow_override_existing: boolean;
  allow_delete_logs: boolean;
  max_requests_per_week: number | null;
  max_requests_per_month: number | null;
  max_backdate_days: number;
  min_minutes_for_partial: number;
  require_reason: boolean;
};

export const DEFAULT_REGULARIZATION_SETTINGS: RegularizationSettings = {
  enabled: false,
  allow_missing_punch: true,
  allow_override_existing: false,
  allow_delete_logs: false,
  max_requests_per_week: null,
  max_requests_per_month: null,
  max_backdate_days: 1,
  min_minutes_for_partial: 15,
  require_reason: true,
};

export const REGULARIZATION_REQUEST_TYPE_LABELS: Record<RegularizationRequestType, string> = {
  missing_check_in: 'Missing check-in',
  missing_check_out: 'Missing check-out',
  missing_both: 'Missing check-in & check-out',
  override_check_in: 'Override check-in time',
  override_check_out: 'Override check-out time',
  delete_check_in: 'Delete check-in log',
  delete_check_out: 'Delete check-out log',
  partial_late_in: 'Partial day — late arrival',
  partial_early_out: 'Partial day — early departure',
};

export type RegularizationRequestRow = {
  id: string;
  business_id: string;
  employee_id: string;
  attendance_id: string | null;
  attendance_date: string;
  request_type: RegularizationRequestType;
  original_check_in: string | null;
  original_check_out: string | null;
  requested_check_in: string | null;
  requested_check_out: string | null;
  reason: string;
  status: RegularizationRequestStatus;
  approver_user_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  created_at: string;
};

export type SubmitRegularizationInput = {
  attendance_date: string;
  request_type: RegularizationRequestType;
  requested_check_in?: string | null;
  requested_check_out?: string | null;
  reason: string;
};
