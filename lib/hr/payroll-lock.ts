/**
 * Payroll immutability rules — processed/paid salary payments cannot be edited.
 * Mirrors billing invoice finalize lock pattern.
 */

export const LOCKED_SALARY_PAYMENT_STATUSES = ['processed', 'paid', 'cancelled'] as const;

export type SalaryPaymentStatus =
  | 'pending'
  | 'processed'
  | 'paid'
  | 'cancelled'
  | (string & {});

export function isSalaryPaymentResource(resource: Record<string, unknown> | null | undefined): boolean {
  if (!resource) return false;
  return typeof resource.salary_month === 'string' && resource.employee_id != null;
}

export function isSalaryPaymentLocked(status: string | null | undefined): boolean {
  if (!status) return false;
  return (LOCKED_SALARY_PAYMENT_STATUSES as readonly string[]).includes(status);
}

export function assertSalaryPaymentEditable(status: string | null | undefined): void {
  if (isSalaryPaymentLocked(status)) {
    throw new Error(
      `Cannot modify salary payment with status "${status}". Processed and paid records are locked.`
    );
  }
}
