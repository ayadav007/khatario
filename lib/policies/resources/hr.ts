/**
 * HR Policies
 * 
 * PBAC policies for HR-related operations (employees, attendance, payroll, leaves).
 */

import { Policy } from '../types';
import {
  resourceBelongsToBusiness,
} from '../conditions';

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
      requiresPermission: 'employees.read', // Using employees.read for payroll viewing
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'payroll',
      action: 'create',
      requiresPermission: 'employees.update', // Using employees.update for payroll creation
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'payroll',
      action: 'update',
      requiresPermission: 'employees.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'salary',
      action: 'read',
      requiresPermission: 'employees.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'salary',
      action: 'create',
      requiresPermission: 'employees.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
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
  ];
}
