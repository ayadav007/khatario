/**
 * Single source of truth for admin HR navigation (desktop sidebar + More + mobile subnav).
 * Keep labels/hrefs in sync here — do not duplicate lists in Sidebar / more-navigation.
 */

export type HrAdminNavItem = {
  href: string;
  label: string;
  /** PBAC module key */
  module?: string;
  featureKey?: string;
};

/** Ordered HR admin destinations — Khatario theme, one IA for all surfaces. */
export const HR_ADMIN_NAV_ITEMS: HrAdminNavItem[] = [
  { href: '/hr/dashboard', label: 'HR Dashboard', module: 'employees', featureKey: 'hr_employees' },
  { href: '/employees', label: 'All Employees', module: 'employees', featureKey: 'hr_employees' },
  { href: '/employees/org-chart', label: 'Org chart', module: 'employees', featureKey: 'hr_employees' },
  { href: '/employees/manager', label: 'Manager', module: 'leave_requests', featureKey: 'hr_leaves' },
  { href: '/employees/new', label: 'Add Employee', module: 'employees', featureKey: 'hr_employees' },
  { href: '/employees/recruitment', label: 'Recruitment', module: 'recruitment', featureKey: 'hr_employees' },
  { href: '/employees/attendance', label: 'Attendance', module: 'attendance', featureKey: 'hr_attendance' },
  { href: '/hr/shifts/roster', label: 'Shift roster', module: 'attendance', featureKey: 'hr_attendance' },
  { href: '/hr/shifts/bulk-assign', label: 'Bulk assign shifts', module: 'attendance', featureKey: 'hr_attendance' },
  { href: '/employees/leaves', label: 'Leaves', module: 'leave_requests', featureKey: 'hr_leaves' },
  { href: '/employees/leaves/calendar', label: 'Leave calendar', module: 'leave_requests', featureKey: 'hr_leaves' },
  { href: '/hr/leaves/year-end', label: 'Leave year-end', module: 'leave_requests', featureKey: 'hr_leaves' },
  { href: '/hr/leaves/import-balances', label: 'Import leave balances', module: 'leave_requests', featureKey: 'hr_leaves' },
  { href: '/employees/salary/payments', label: 'Salary Payments', module: 'payroll', featureKey: 'hr_payroll' },
  { href: '/employees/salary/advances', label: 'Salary Advances', module: 'payroll', featureKey: 'hr_payroll' },
  { href: '/employees/expenses', label: 'Employee Expenses', module: 'employees', featureKey: 'hr_employees' },
  { href: '/employees/commissions', label: 'Commissions', module: 'commissions', featureKey: 'hr_employees' },
  { href: '/hr/engagement', label: 'Engagement', module: 'employees', featureKey: 'hr_employees' },
  { href: '/hr/documents', label: 'HR Documents', module: 'employees', featureKey: 'hr_employees' },
  { href: '/hr/exits', label: 'Exits', module: 'employees', featureKey: 'hr_employees' },
  { href: '/hr/reports', label: 'HR Reports', module: 'employees', featureKey: 'hr_employees' },
  { href: '/employees/performance', label: 'Performance', module: 'employees', featureKey: 'hr_employees' },
  { href: '/employees/tasks', label: 'Tasks', module: 'employees', featureKey: 'hr_employees' },
  { href: '/activity-logs', label: 'Activity Logs', module: 'settings' },
];

export const HR_NAV_SECTION_TITLE = 'HR & Employees';
