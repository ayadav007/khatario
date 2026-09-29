import { getApiErrorMessage } from '@/lib/api-utils';

type ModulePermissions = Record<string, { can_modify?: boolean } | undefined>;

/** Which screen raised the error; picks the correction hint for filed GST periods. */
export type AccountingErrorContext = 'purchase' | 'expense' | 'journal';

export interface AccountingErrorAction {
  label: string;
  href: string;
}

export interface AccountingErrorView {
  message: string;
  action?: AccountingErrorAction;
}

export interface DescribeAccountingErrorOptions {
  context: AccountingErrorContext;
  /** Verb used in document-blocker messages ("cannot be cancelled" / "cannot be deleted"). */
  verb?: 'cancelled' | 'deleted' | 'reversed';
  /** Only users who can manage period locks see the settings action. */
  canManagePeriods?: boolean;
  /** Path to return to after logging in again. */
  currentPath?: string;
  fallback?: string;
}

export const PERIOD_LOCKS_HREF = '/settings/period-locks';

const GST_FILED_HINT: Record<AccountingErrorContext, string> = {
  purchase: 'Record a purchase return in the current open period instead.',
  expense: 'Record the correction as a new entry in the current open period instead.',
  journal: 'Record a correcting journal entry in the current open period instead.',
};

/** Mirrors the server rule: period locks need settings.update (primary admins always pass). */
export function canManagePeriodLocks(
  isPrimaryAdmin: boolean,
  permissions: ModulePermissions | null | undefined
): boolean {
  return isPrimaryAdmin || permissions?.settings?.can_modify === true;
}

function loginAction(currentPath?: string): AccountingErrorAction {
  const redirect = currentPath && currentPath.startsWith('/') ? currentPath : '/';
  return { label: 'Log in again', href: `/login?redirect=${encodeURIComponent(redirect)}` };
}

/**
 * Maps accounting API errors to readable UI messages using the HTTP status and the
 * structured `code`; the server's `error` text is only used for codes not handled here.
 */
export function describeAccountingError(
  status: number,
  data: Record<string, unknown> | null | undefined,
  opts: DescribeAccountingErrorOptions
): AccountingErrorView {
  const code = typeof data?.code === 'string' ? data.code : undefined;
  const verb = opts.verb ?? 'cancelled';

  if (status === 401 || code === 'UNAUTHENTICATED' || code === 'SESSION_REVOKED') {
    return {
      message: 'Your session has expired. Log in again to continue.',
      action: loginAction(opts.currentPath),
    };
  }

  switch (code) {
    case 'PERIOD_LOCKED':
      return {
        message: 'This accounting period is locked, so this correction cannot be made.',
        action: opts.canManagePeriods ? { label: 'Manage period locks', href: PERIOD_LOCKS_HREF } : undefined,
      };
    case 'GST_PERIOD_FILED':
      return {
        message: `This GST period has already been filed, so this correction cannot be made directly. ${GST_FILED_HINT[opts.context]}`,
      };
    case 'PURCHASE_HAS_PAYMENTS':
      return {
        message:
          `This bill cannot be ${verb} because a payment has already been recorded. ` +
          'To send goods back or reduce the bill, record a purchase return.',
      };
    case 'PURCHASE_HAS_RETURNS':
      return {
        message:
          `This bill cannot be ${verb} because a purchase return has already been recorded. ` +
          'If the return was recorded by mistake, cancel the return first.',
      };
    case 'BILL_TDS_DEPOSITED':
      return { message: `This bill cannot be ${verb} because its TDS has already been deposited.` };
    case 'PURCHASE_STOCK_CONSUMED':
      return {
        message: `This bill cannot be ${verb} because the purchased stock has already been consumed or sold.`,
      };
    case 'PURCHASE_ALREADY_CANCELLED':
      return { message: 'This bill is already cancelled.' };
    case 'PURCHASE_CANCELLED':
      return { message: 'Cancelled bills are kept as a record and cannot be deleted.' };
    case 'PURCHASE_NOT_FINAL':
      return { message: 'Only final bills can be cancelled. Delete the draft instead.' };
    case 'PURCHASE_STATE_CHANGED':
      return { message: 'This bill changed while you were working on it. Refresh the list and try again.' };
    case 'JOURNAL_LOCKED':
      return { message: `This journal entry is locked. Unlock it before it can be ${verb}.` };
    default:
      break;
  }

  if (status === 403) {
    return { message: getApiErrorMessage(data ?? null, 'You do not have permission to perform this action.') };
  }
  return { message: getApiErrorMessage(data ?? null, opts.fallback) };
}
