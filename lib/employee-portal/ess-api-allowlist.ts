/**
 * API paths allowed for employee portal sessions (cookie + injected headers).
 * Middleware should allow these when x-employee-portal-session is set.
 */

export const ESS_API_ALLOWLIST: { method: string; pathPrefix: string }[] = [
  { method: 'GET', pathPrefix: '/api/public/employee/' },
  { method: 'POST', pathPrefix: '/api/public/employee/' },
  { method: 'GET', pathPrefix: '/api/public/employee/portal/' },
  { method: 'POST', pathPrefix: '/api/public/employee/portal/' },
  { method: 'PATCH', pathPrefix: '/api/public/employee/portal/' },
  { method: 'DELETE', pathPrefix: '/api/public/employee/portal/' },
  { method: 'GET', pathPrefix: '/api/employees/attendance-regularization' },
  { method: 'POST', pathPrefix: '/api/employees/attendance-regularization' },
  { method: 'PATCH', pathPrefix: '/api/employees/manager/attendance-regularization/' },
  { method: 'GET', pathPrefix: '/api/employees/attendance' },
  { method: 'POST', pathPrefix: '/api/employees/attendance/' },
  { method: 'GET', pathPrefix: '/api/employees/leave-requests' },
  { method: 'POST', pathPrefix: '/api/employees/leave-requests' },
  { method: 'PATCH', pathPrefix: '/api/employees/leave-requests/' },
  { method: 'DELETE', pathPrefix: '/api/employees/leave-requests/' },
  { method: 'GET', pathPrefix: '/api/employees/leave-balances' },
  { method: 'GET', pathPrefix: '/api/leave-types' },
  { method: 'GET', pathPrefix: '/api/employees/salary/payslips' },
  { method: 'GET', pathPrefix: '/api/employees/salary/payslips/' },
  { method: 'GET', pathPrefix: '/api/employees/expenses' },
  { method: 'POST', pathPrefix: '/api/employees/expenses' },
  { method: 'GET', pathPrefix: '/api/employees/' },
  // Manager "My team" (narrow approve scope enforced in route handlers)
  { method: 'GET', pathPrefix: '/api/employees/manager/team' },
  { method: 'GET', pathPrefix: '/api/employees/manager/pending-approvals' },
  { method: 'PATCH', pathPrefix: '/api/employees/manager/exit-approvals/' },
  { method: 'PATCH', pathPrefix: '/api/employees/expenses/' },
  { method: 'GET', pathPrefix: '/api/employees/overtime-requests' },
  { method: 'POST', pathPrefix: '/api/employees/overtime-requests' },
  { method: 'PATCH', pathPrefix: '/api/employees/overtime-requests/' },
  { method: 'PATCH', pathPrefix: '/api/employees/manager/leave-approvals/' },
  { method: 'PATCH', pathPrefix: '/api/employees/manager/ot-approvals/' },
  { method: 'PATCH', pathPrefix: '/api/employees/manager/shift-assign' },
  { method: 'GET', pathPrefix: '/api/hr/leave/preview-days' },
];

export function isEssApiAllowed(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  return ESS_API_ALLOWLIST.some(
    (entry) =>
      entry.method === m &&
      (pathname === entry.pathPrefix || pathname.startsWith(entry.pathPrefix))
  );
}

export const EMPLOYEE_PORTAL_SESSION_HEADER = 'x-employee-portal-session';
