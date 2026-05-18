/**
 * Access Boundary Enforcement
 * 
 * Enforces strict boundaries between:
 * - Portal APIs (business operations: sales, purchases, reports, settings)
 * - Employee Self-Service APIs (attendance, leave, salary, profile)
 * 
 * Rules:
 * - Attendance-only employees: CANNOT access portal APIs
 * - Full-access employees: CAN access portal APIs (if role/permission allows)
 * - Portal users (non-employees): Normal portal access
 * - All users: CAN access employee self-service APIs (if employee or has permission)
 */

import { queryOne } from './db';

export type APIContext = 'portal' | 'employee' | 'admin';

export interface AccessBoundaryResult {
  allowed: boolean;
  reason?: string;
  isEmployee?: boolean;
  accessType?: 'full' | 'attendance_only';
}

/**
 * Check if user can access API based on employee access type
 * 
 * @param userId - User ID to check
 * @param apiContext - Context of the API ('portal' | 'employee' | 'admin')
 * @returns AccessBoundaryResult
 * 
 * @example
 * // Portal API - reject attendance-only employees
 * const check = await checkEmployeeAccessBoundary(userId, 'portal');
 * if (!check.allowed) {
 *   return NextResponse.json({ error: check.reason }, { status: 403 });
 * }
 * 
 * @example
 * // Employee API - allow all employees
 * const check = await checkEmployeeAccessBoundary(userId, 'employee');
 * // Employee APIs should check if user is employee or has permission separately
 */
export async function checkEmployeeAccessBoundary(
  userId: string,
  apiContext: APIContext
): Promise<AccessBoundaryResult> {
  try {
    // Check if user is an employee
    const employee = await queryOne<{
      access_type: 'full' | 'attendance_only';
      is_active: boolean;
    }>(
      `SELECT e.access_type, e.is_active
       FROM employees e
       WHERE e.id = $1 AND e.is_active = true`,
      [userId]
    );

    // If not an employee, allow access (portal user)
    if (!employee) {
      return {
        allowed: true,
        isEmployee: false,
      };
    }

    // Employee exists - check access type
    const accessType = employee.access_type;

    // RULE A: Attendance-only employees
    if (accessType === 'attendance_only') {
      // CANNOT access portal APIs
      if (apiContext === 'portal') {
        return {
          allowed: false,
          reason: 'This account is for attendance only. Portal access is not available. Please use the attendance login.',
          isEmployee: true,
          accessType: 'attendance_only',
        };
      }
      // CANNOT access admin APIs
      if (apiContext === 'admin') {
        return {
          allowed: false,
          reason: 'This account is for attendance only. Admin access is not available.',
          isEmployee: true,
          accessType: 'attendance_only',
        };
      }
      // CAN access employee APIs
      return {
        allowed: true,
        isEmployee: true,
        accessType: 'attendance_only',
      };
    }

    // RULE B: Full-access employees
    if (accessType === 'full') {
      // Portal access allowed (subject to role/permission checks)
      // Employee access allowed
      return {
        allowed: true,
        isEmployee: true,
        accessType: 'full',
      };
    }

    // Unknown access type - deny by default
    return {
      allowed: false,
      reason: 'Invalid employee access type',
      isEmployee: true,
      accessType: accessType as any,
    };
  } catch (error) {
    console.error('Error checking employee access boundary:', error);
    if (apiContext === 'portal' || apiContext === 'admin') {
      return {
        allowed: false,
        reason: 'Unable to verify access. Please try again.',
        isEmployee: false,
      };
    }
    return {
      allowed: true,
      isEmployee: false,
    };
  }
}

/**
 * Check if user is an employee (for employee self-service APIs)
 * 
 * @param userId - User ID to check
 * @returns true if user is an active employee
 */
export async function isEmployee(userId: string): Promise<boolean> {
  try {
    const employee = await queryOne<{ id: string }>(
      `SELECT id FROM employees WHERE id = $1 AND is_active = true`,
      [userId]
    );
    return !!employee;
  } catch (error) {
    console.error('Error checking if user is employee:', error);
    return false;
  }
}

/**
 * Check if user can access employee resource (self or has permission)
 * 
 * @param userId - User ID requesting access
 * @param employeeId - Employee ID being accessed
 * @param hasPermission - Whether user has portal permission (e.g., from authorize())
 * @returns true if user can access (is self OR has permission)
 */
export async function canAccessEmployeeResource(
  userId: string,
  employeeId: string,
  hasPermission: boolean
): Promise<boolean> {
  // If user has portal permission, allow
  if (hasPermission) {
    return true;
  }

  // If user is accessing own employee record, allow
  if (userId === employeeId) {
    const isEmp = await isEmployee(userId);
    if (isEmp) {
      return true;
    }
  }

  return false;
}
