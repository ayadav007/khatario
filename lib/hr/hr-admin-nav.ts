/**
 * Single source of truth for admin HR navigation (desktop sidebar + More + mobile subnav).
 * Keep labels/hrefs in sync here — do not duplicate lists in Sidebar / more-navigation.
 */

import { isBeyondHrLite } from '@/lib/subscription/hr-lite';

export type HrAdminNavItem = {
  href: string;
  label: string;
  /** PBAC module key */
  module?: string;
  /** Plan feature (Admin › Plans) that owns this screen. Items whose feature is off are hidden. */
  featureKey: string;
};

/**
 * Ordered HR admin destinations — Khatario theme, one IA for all surfaces.
 * Ladder: HR Lite = employees, attendance, salary; HR Starter adds Staff app, shifts, payroll setup,
 * expenses & commissions; HR Pro adds leave, portal, hiring and the HR workspace.
 */
export const HR_ADMIN_NAV_ITEMS: HrAdminNavItem[] = [
  { href: '/hr/dashboard', label: 'HR Dashboard', module: 'employees', featureKey: 'hr_advanced' },
  { href: '/employees', label: 'All Employees', module: 'employees', featureKey: 'hr_employees' },
  { href: '/employees/org-chart', label: 'Org chart', module: 'employees', featureKey: 'hr_advanced' },
  { href: '/employees/manager', label: 'Manager', module: 'leave_requests', featureKey: 'hr_leaves' },
  { href: '/employees/new', label: 'Add Employee', module: 'employees', featureKey: 'hr_employees' },
  { href: '/employees/recruitment', label: 'Recruitment', module: 'recruitment', featureKey: 'hr_recruitment' },
  { href: '/employees/attendance', label: 'Attendance', module: 'attendance', featureKey: 'hr_attendance' },
  { href: '/hr/shifts/roster', label: 'Shift roster', module: 'attendance', featureKey: 'hr_shifts' },
  { href: '/hr/shifts/bulk-assign', label: 'Bulk assign shifts', module: 'attendance', featureKey: 'hr_shifts' },
  { href: '/employees/leaves', label: 'Leaves', module: 'leave_requests', featureKey: 'hr_leaves' },
  { href: '/employees/leaves/calendar', label: 'Leave calendar', module: 'leave_requests', featureKey: 'hr_leaves' },
  { href: '/hr/leaves/year-end', label: 'Leave year-end', module: 'leave_requests', featureKey: 'hr_leaves' },
  { href: '/hr/leaves/import-balances', label: 'Import leave balances', module: 'leave_requests', featureKey: 'hr_leaves' },
  { href: '/employees/salary/payments', label: 'Salary Payments', module: 'payroll', featureKey: 'hr_payroll' },
  { href: '/employees/salary/advances', label: 'Salary Advances', module: 'payroll', featureKey: 'hr_payroll' },
  { href: '/employees/expenses', label: 'Employee Expenses', module: 'employees', featureKey: 'hr_commissions' },
  { href: '/employees/commissions', label: 'Commissions', module: 'commissions', featureKey: 'hr_commissions' },
  { href: '/hr/engagement', label: 'Engagement', module: 'employees', featureKey: 'hr_advanced' },
  { href: '/hr/documents', label: 'HR Documents', module: 'employees', featureKey: 'hr_advanced' },
  { href: '/hr/exits', label: 'Exits', module: 'employees', featureKey: 'hr_advanced' },
  { href: '/hr/reports', label: 'HR Reports', module: 'employees', featureKey: 'hr_advanced' },
  { href: '/employees/performance', label: 'Performance', module: 'employees', featureKey: 'hr_advanced' },
  { href: '/employees/tasks', label: 'Tasks', module: 'employees', featureKey: 'hr_advanced' },
  { href: '/activity-logs', label: 'Activity Logs', module: 'settings', featureKey: 'hr_advanced' },
];

export const HR_NAV_SECTION_TITLE = 'HR & Employees';
export const HR_LITE_NAV_SECTION_TITLE = 'Staff';

export function getHrNavSectionTitle(hasFeature: (featureKey: string) => boolean): string {
  return isBeyondHrLite(hasFeature) ? HR_NAV_SECTION_TITLE : HR_LITE_NAV_SECTION_TITLE;
}

/** Nav items whose plan feature is on. Off features are hidden, not shown as locked teasers. */
export function getVisibleHrAdminNavItems(
  hasFeature: (featureKey: string) => boolean,
): HrAdminNavItem[] {
  return HR_ADMIN_NAV_ITEMS.filter((item) => hasFeature(item.featureKey));
}
