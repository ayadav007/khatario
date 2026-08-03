import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getDirectReportIds,
  getEmployeeIdForUser,
  isReportingManager,
} from '@/lib/hr/manager-scope';

export async function assertCanMarkEmployeeAttendance(
  actorUserId: string,
  businessId: string,
  targetEmployeeId: string,
): Promise<void> {
  const actorEmployeeId = await getEmployeeIdForUser(actorUserId, businessId);

  if (actorEmployeeId) {
    const directReports = await getDirectReportIds(businessId, actorEmployeeId);
    if (directReports.includes(targetEmployeeId)) {
      return;
    }
  }

  try {
    await authorize(actorUserId, 'attendance', 'create', { businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      throw new Error('You can only mark attendance for your direct reports.');
    }
    throw error;
  }
}

export async function getManagerAttendanceScope(
  actorUserId: string,
  businessId: string,
): Promise<{ employeeIds: string[]; isReportingManager: boolean }> {
  const actorEmployeeId = await getEmployeeIdForUser(actorUserId, businessId);
  if (!actorEmployeeId) {
    return { employeeIds: [], isReportingManager: false };
  }

  const isManager = await isReportingManager(actorEmployeeId);
  if (!isManager) {
    return { employeeIds: [], isReportingManager: false };
  }

  const employeeIds = await getDirectReportIds(businessId, actorEmployeeId);
  return { employeeIds, isReportingManager: true };
}
