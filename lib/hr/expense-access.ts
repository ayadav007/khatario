import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { resolveActorContext, type ActorContext } from '@/lib/employee-portal/portal-api-guard';

export type AccessibleExpense = {
  id: string;
  employee_id: string;
  business_id: string;
  [column: string]: unknown;
};

export type ExpenseAccess =
  | { ok: true; actor: ActorContext; expense: AccessibleExpense }
  | { ok: false; response: NextResponse };

/**
 * Loads one employee expense for the caller and decides whether they may act on it.
 *
 * The caller is either a business session (middleware headers) or a database-validated
 * employee-portal session. The ESS allowlist lets portal cookies through middleware unverified,
 * so a request with neither is refused here. The expense is looked up through `employees`, which
 * carries the tenant, so a row from another business is never loaded. A portal employee may only
 * reach their own expense; a business user needs the `expenses` permission for `action`.
 */
export async function loadAccessibleExpense(
  request: NextRequest,
  expenseId: string,
  action: 'read' | 'update' | 'create',
  select = 'e.*',
): Promise<ExpenseAccess> {
  const actor = await resolveActorContext(request);
  if (!actor) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }),
    };
  }

  const expense = await queryOne<AccessibleExpense>(
    `SELECT ${select},
            emp.business_id,
            u.name AS employee_name,
            b.name AS business_name,
            b.address_line1 AS business_address,
            b.city AS business_city
       FROM employee_expenses e
       INNER JOIN employees emp ON emp.id = e.employee_id
       INNER JOIN businesses b ON b.id = emp.business_id
       LEFT JOIN users u ON u.id = emp.user_id
      WHERE e.id = $1 AND emp.business_id = $2`,
    [expenseId, actor.businessId],
  );
  if (!expense) {
    return { ok: false, response: NextResponse.json({ error: 'Expense not found' }, { status: 404 }) };
  }

  if (actor.isPortal) {
    if (expense.employee_id !== actor.userId) {
      return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    return { ok: true, actor, expense };
  }

  try {
    await authorize(actor.userId, 'expenses', action, { businessId: actor.businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, response: error.toNextResponse() };
    throw error;
  }
  return { ok: true, actor, expense };
}
