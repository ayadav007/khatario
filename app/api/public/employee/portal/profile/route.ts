import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { requirePortalSession, requirePortalFeature } from '@/lib/employee-portal/portal-route-guard';
import { filterFieldsByPermission } from '@/lib/field-permission-filter';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePortalSession(request);
    if ('error' in auth) return auth.error;

    const denied = await requirePortalFeature(auth.session.businessId, 'profile');
    if (denied) return denied;

    const { businessId, employeeId } = auth.session;

    const employee = await queryRows(
      `SELECT e.*, u.name AS user_name, u.email AS user_email, u.phone AS user_phone,
              rm_user.name AS reporting_manager_name, rm.employee_code AS reporting_manager_code
       FROM employees e
       INNER JOIN users u ON u.id = e.id
       LEFT JOIN employees rm ON rm.id = e.reporting_manager_id
       LEFT JOIN users rm_user ON rm_user.id = rm.id
       WHERE e.id = $1 AND e.business_id = $2`,
      [employeeId, businessId],
    );

    const documents = await queryRows(
      `SELECT id, document_type, document_name, file_url, uploaded_at
       FROM employee_documents WHERE employee_id = $1 ORDER BY uploaded_at DESC`,
      [employeeId],
    );

    const row = employee[0] ?? null;
    const filtered = row
      ? await filterFieldsByPermission(row, employeeId, 'employees')
      : null;

    return NextResponse.json({ employee: filtered, documents });
  } catch (error) {
    console.error('[portal/profile GET]', error);
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
  }
}
