/**
 * HR Policies
 * 
 * PBAC policies for HR-related operations (employees, attendance, payroll, leaves).
 */

import { Policy } from '../types';
import {
  resourceBelongsToBusiness,
  customCondition,
} from '../conditions';
import { canAccessEmployeeRecord } from '@/lib/hr/employee-access-scope';

import {
  isSalaryPaymentLocked,
  isSalaryPaymentResource,
} from '@/lib/hr/payroll-lock';

function salaryPaymentIsEditable(): ReturnType<typeof customCondition> {
  return customCondition(
    'salary_payment_is_editable',
    'Processed or paid salary payments cannot be modified',
    async (_user, resource) => {
      if (!isSalaryPaymentResource(resource)) return true;
      return !isSalaryPaymentLocked(resource.status as string);
    },
    'Cannot modify a processed or paid salary payment',
    'SALARY_PAYMENT_LOCKED'
  );
}

function actorCanAccessEmployeeRecord(): ReturnType<typeof customCondition> {
  return customCondition(
    'actor_can_access_employee_record',
    'Actor must have roster access to this employee (full HR, payroll, team manager, or self)',
    async (user, resource, context) => {
      const employeeId = resource?.id || context.resourceId;
      if (!employeeId) return true;
      return canAccessEmployeeRecord(user.id, user.business_id, employeeId);
    },
    'You do not have access to this employee record',
    'EMPLOYEE_ACCESS_DENIED'
  );
}

/**
 * Get all HR policies
 */
export function getHrPolicies(): Policy[] {
  return [
    // EMPLOYEE policies
    {
      resource: 'employee',
      action: 'read',
      requiresPermission: 'employees.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        actorCanAccessEmployeeRecord(),
      ],
    },
    {
      resource: 'employee',
      action: 'create',
      requiresPermission: 'employees.create',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'employee',
      action: 'update',
      requiresPermission: 'employees.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        actorCanAccessEmployeeRecord(),
      ],
    },
    {
      resource: 'employee',
      action: 'delete',
      requiresPermission: 'employees.delete',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'employees',
      action: 'read',
      requiresPermission: 'employees.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        actorCanAccessEmployeeRecord(),
      ],
    },
    {
      resource: 'employees',
      action: 'create',
      requiresPermission: 'employees.create',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'employees',
      action: 'update',
      requiresPermission: 'employees.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        actorCanAccessEmployeeRecord(),
      ],
    },
    {
      resource: 'employees',
      action: 'delete',
      requiresPermission: 'employees.delete',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },

    // ATTENDANCE policies
    {
      resource: 'attendance',
      action: 'read',
      requiresPermission: 'attendance.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'attendance',
      action: 'create',
      requiresPermission: 'attendance.create',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'attendance',
      action: 'update',
      requiresPermission: 'attendance.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'attendance',
      action: 'delete',
      requiresPermission: 'attendance.delete',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },

    // PAYROLL/SALARY policies
    {
      resource: 'payroll',
      action: 'read',
      requiresPermission: 'payroll.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'payroll',
      action: 'create',
      requiresPermission: 'payroll.create',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'payroll',
      action: 'update',
      requiresPermission: 'payroll.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        salaryPaymentIsEditable(),
      ],
    },
    {
      resource: 'payroll',
      action: 'delete',
      requiresPermission: 'payroll.delete',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        salaryPaymentIsEditable(),
      ],
    },
    {
      resource: 'salary',
      action: 'read',
      requiresPermission: 'payroll.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'salary',
      action: 'create',
      requiresPermission: 'payroll.create',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'salary',
      action: 'update',
      requiresPermission: 'payroll.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        salaryPaymentIsEditable(),
      ],
    },
    {
      resource: 'salary',
      action: 'delete',
      requiresPermission: 'payroll.delete',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        salaryPaymentIsEditable(),
      ],
    },

    // LEAVE REQUEST policies
    {
      resource: 'leave_request',
      action: 'read',
      requiresPermission: 'leaves.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'leave_request',
      action: 'create',
      requiresPermission: 'leaves.create',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'leave_request',
      action: 'update',
      requiresPermission: 'leaves.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'leave_requests',
      action: 'read',
      requiresPermission: 'leaves.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'leave_requests',
      action: 'create',
      requiresPermission: 'leaves.create',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'leave_requests',
      action: 'update',
      requiresPermission: 'leaves.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },

    // COMMISSIONS policies
    {
      resource: 'commissions',
      action: 'read',
      requiresPermission: 'commissions.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'commissions',
      action: 'update',
      requiresPermission: 'commissions.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },

    // RECRUITMENT policies
    {
      resource: 'recruitment',
      action: 'read',
      requiresPermission: 'recruitment.read',
      priority: 10,
      conditions: [resourceBelongsToBusiness()],
    },
    {
      resource: 'recruitment',
      action: 'create',
      requiresPermission: 'recruitment.create',
      priority: 10,
      conditions: [resourceBelongsToBusiness()],
    },
    {
      resource: 'recruitment',
      action: 'update',
      requiresPermission: 'recruitment.update',
      priority: 10,
      conditions: [resourceBelongsToBusiness()],
    },
    {
      resource: 'recruitment',
      action: 'delete',
      requiresPermission: 'recruitment.delete',
      priority: 10,
      conditions: [resourceBelongsToBusiness()],
    },
  ];
}
