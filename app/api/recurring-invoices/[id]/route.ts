import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne, queryRows } from '@/lib/db';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { runRecurringInvoices } from '@/lib/invoices/recurring';

export const dynamic = 'force-dynamic';

async function guard(request: NextRequest, claimed: string | null | undefined, action: 'read' | 'update' | 'create') {
  const userId = getUserIdFromRequest(request);
  if (!userId) return { ok: false as const, response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  const tenant = requireTenantBusinessId(request, claimed);
  if (!tenant.ok) return tenant;
  try {
    await authorize(userId, 'invoices', action, { businessId: tenant.businessId });
  } catch (e) {
    if (e instanceof AuthorizationError) return { ok: false as const, response: e.toNextResponse() };
    throw e;
  }
  return { ok: true as const, businessId: tenant.businessId, userId };
}

/** GET /api/recurring-invoices/[id] — schedule plus run history. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(request, new URL(request.url).searchParams.get('business_id'), 'read');
  if (!g.ok) return g.response;
  const rec = await queryOne(`SELECT * FROM recurring_invoices WHERE id = $1 AND business_id = $2`, [params.id, g.businessId]);
  if (!rec) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const history = await queryRows(
    `SELECT h.run_date::text, h.status, h.error_message, h.invoice_id, i.invoice_number, i.status AS invoice_status
       FROM recurring_invoice_history h
       LEFT JOIN invoices i ON i.id = h.invoice_id
      WHERE h.recurring_invoice_id = $1
      ORDER BY h.run_date DESC LIMIT 100`,
    [params.id]
  );
  return NextResponse.json({ recurringInvoice: rec, history });
}

/**
 * PATCH /api/recurring-invoices/[id] — { is_active?, auto_finalize?, end_date? }
 * POST  /api/recurring-invoices/[id] — { action: 'run_now' } raises whatever is due today.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const g = await guard(request, body.business_id, 'update');
  if (!g.ok) return g.response;
  const sets: string[] = [];
  const vals: unknown[] = [params.id, g.businessId];
  if (typeof body.is_active === 'boolean') {
    vals.push(body.is_active);
    sets.push(`is_active = $${vals.length}`);
  }
  if (typeof body.auto_finalize === 'boolean') {
    vals.push(body.auto_finalize);
    sets.push(`auto_finalize = $${vals.length}`);
  }
  if (body.end_date === null || (typeof body.end_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.end_date))) {
    vals.push(body.end_date);
    sets.push(`end_date = $${vals.length}`);
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  const rec = await queryOne(
    `UPDATE recurring_invoices SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND business_id = $2 RETURNING *`,
    vals
  );
  if (!rec) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ recurringInvoice: rec });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  if (body.action !== 'run_now') return NextResponse.json({ error: "action must be 'run_now'" }, { status: 400 });
  const g = await guard(request, body.business_id, 'create');
  if (!g.ok) return g.response;
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const [result] = await runRecurringInvoices(getPool(), {
    today,
    businessId: g.businessId,
    recurringId: params.id,
    actorUserId: g.userId,
  });
  if (!result) return NextResponse.json({ message: 'Nothing due today', created: [] });
  return NextResponse.json(result, { status: result.error && !result.created.length ? 400 : 200 });
}
