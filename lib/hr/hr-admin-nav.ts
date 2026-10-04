/**
 * Single source of truth for admin HR navigation (desktop sidebar + More + mobile subnav).
 * Keep labels/hrefs in sync here — do not duplicate lists in Sidebar / more-navigation.
 */

import { hasFullHrFeatures } from '@/lib/subscription/hr-lite';

export type HrAdminNavItem = {
  href: string;
  label: string;
  /** PBAC module key */
  module?: string;
  featureKey?: string;
  /**
   * Full HR only (leave plans, shifts, portal, recruitment, etc.).
   * Hidden on Billing-bundled HR Lite — not shown as locked teasers.
   */
  requiresFullHr?: boolean;
};

/** Ordered HR admin destinations — Khatario theme, one IA for all surfaces. */
export const HR_ADMIN_NAV_ITEMS: HrAdminNavItem[] = [
  { href: '/hr/dashboard', label: 'HR Dashboard', module: 'employees', featureKey: 'hr_employees', requiresFullHr: true },
  { href: '/employees', label: 'All Employees', module: 'employees', featureKey: 'hr_employees' },
  { href: '/employees/org-chart', label: 'Org chart', module: 'employees', featureKey: 'hr_employees', requiresFullHr: true },
  { href: '/employees/manager', label: 'Manager', module: 'leave_requests', featureKey: 'hr_leaves', requiresFullHr: true },
  { href: '/employees/new', label: 'Add Employee', module: 'employees', featureKey: 'hr_employees' },
  { href: '/employees/recruitment', label: 'Recruitment', module: 'recruitment', featureKey: 'hr_employees', requiresFullHr: true },
  { href: '/employees/attendance', label: 'Attendance', module: 'attendance', featureKey: 'hr_attendance' },
  { href: '/hr/shifts/roster', label: 'Shift roster', module: 'attendance', featureKey: 'hr_attendance', requiresFullHr: true },
  { href: '/hr/shifts/bulk-assign', label: 'Bulk assign shifts', module: 'attendance', featureKey: 'hr_attendance', requiresFullHr: true },
  { href: '/employees/leaves', label: 'Leaves', module: 'leave_requests', featureKey: 'hr_leaves', requiresFullHr: true },
  { href: '/employees/leaves/calendar', label: 'Leave calendar', module: 'leave_requests', featureKey: 'hr_leaves', requiresFullHr: true },
  { href: '/hr/leaves/year-end', label: 'Leave year-end', module: 'leave_requests', featureKey: 'hr_leaves', requiresFullHr: true },
  { href: '/hr/leaves/import-balances', label: 'Import leave balances', module: 'leave_requests', featureKey: 'hr_leaves', requiresFullHr: true },
  { href: '/employees/salary/payments', label: 'Salary Payments', module: 'payroll', featureKey: 'hr_payroll' },
  { href: '/employees/salary/advances', label: 'Salary Advances', module: 'payroll', featureKey: 'hr_payroll' },
  { href: '/employees/expenses', label: 'Employee Expenses', module: 'employees', featureKey: 'hr_employees' },
  { href: '/employees/commissions', label: 'Commissions', module: 'commissions', featureKey: 'hr_employees' },
  { href: '/hr/engagement', label: 'Engagement', module: 'employees', featureKey: 'hr_employees', requiresFullHr: true },
  { href: '/hr/documents', label: 'HR Documents', module: 'employees', featureKey: 'hr_employees', requiresFullHr: true },
  { href: '/hr/exits', label: 'Exits', module: 'employees', featureKey: 'hr_employees', requiresFullHr: true },
  { href: '/hr/reports', label: 'HR Reports', module: 'employees', featureKey: 'hr_employees', requiresFullHr: true },
  { href: '/employees/performance', label: 'Performance', module: 'employees', featureKey: 'hr_employees', requiresFullHr: true },
  { href: '/employees/tasks', label: 'Tasks', module: 'employees', featureKey: 'hr_employees', requiresFullHr: true },
  { href: '/activity-logs', label: 'Activity Logs', module: 'settings' },
];

export const HR_NAV_SECTION_TITLE = 'HR & Employees';
export const HR_LITE_NAV_SECTION_TITLE = 'Staff';

export function getHrNavSectionTitle(hasFeature: (featureKey: string) => boolean): string {
  return hasFullHrFeatures(hasFeature) ? HR_NAV_SECTION_TITLE : HR_LITE_NAV_SECTION_TITLE;
}

/** Nav items visible for the current HR tier (Lite vs Full). */
export function getVisibleHrAdminNavItems(
  hasFeature: (featureKey: string) => boolean,
): HrAdminNavItem[] {
  const fullHr = hasFullHrFeatures(hasFeature);
  return HR_ADMIN_NAV_ITEMS.filter((item) => fullHr || !item.requiresFullHr);
}
