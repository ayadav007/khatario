import type { OrgChartEmployee } from '@/lib/hr/org-chart';

/**
 * Highest person in a department on the org chart: no manager within the same department.
 * When multiple roots exist, pick the one with the most direct reports in the department.
 */
export function resolveDepartmentHeadEmployeeId(
  employees: OrgChartEmployee[],
  department: string | null | undefined,
  excludeEmployeeId?: string,
): string | null {
  if (!department?.trim()) return null;

  const dept = department.trim();
  const inDept = employees.filter(
    (e) => e.is_active && e.department?.trim() === dept && e.id !== excludeEmployeeId,
  );
  if (inDept.length === 0) return null;

  const deptIds = new Set(inDept.map((e) => e.id));
  const candidates = inDept.filter((e) => {
    const mgrId = e.reporting_manager_id;
    return !mgrId || !deptIds.has(mgrId);
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;

  let best = candidates[0];
  let bestCount = -1;
  for (const c of candidates) {
    const count = inDept.filter((e) => e.reporting_manager_id === c.id).length;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best.id;
}
