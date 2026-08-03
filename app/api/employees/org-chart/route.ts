import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  buildOrgChartTree,
  fetchOrgChartEmployees,
  filterTreeToRoot,
} from '@/lib/hr/org-chart';
import { getEmployeeIdForUser } from '@/lib/hr/manager-scope';

export const dynamic = 'force-dynamic';

/**
 * GET /api/employees/org-chart
 */
export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const { searchParams } = new URL(request.url);
    const department = searchParams.get('department') || undefined;
    const rootEmployeeId = searchParams.get('root_employee_id') || undefined;
    const scope = searchParams.get('scope');

    if (!businessId || !userId) {
      return NextResponse.json({ error: 'business_id and user_id are required' }, { status: 400 });
    }

    try {
      await authorize(userId, 'employees', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    let effectiveRoot = rootEmployeeId;
    if (scope === 'my_subtree') {
      const actorEmployeeId = await getEmployeeIdForUser(userId, businessId);
      if (actorEmployeeId) effectiveRoot = actorEmployeeId;
    }

    const employees = await fetchOrgChartEmployees(businessId, {
      department,
      rootEmployeeId: effectiveRoot,
      activeOnly: true,
    });

    let tree = buildOrgChartTree(employees);
    if (effectiveRoot && !rootEmployeeId) {
      tree = filterTreeToRoot(tree, effectiveRoot);
    } else if (effectiveRoot) {
      tree = filterTreeToRoot(tree, effectiveRoot);
    }

    const departments = [...new Set(employees.map((e) => e.department).filter(Boolean))].sort();

    return NextResponse.json({
      ...tree,
      departments,
      employee_count: employees.length,
    });
  } catch (error: unknown) {
    console.error('Error fetching org chart:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
