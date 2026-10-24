import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { periodGuardResponse } from '@/lib/http/period-guards';
import { listRule37Exposure, syncRule37ForBill } from '@/lib/gst/rule37';
import { todayIst } from '@/lib/gst/time-limits';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

const isIsoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * GET /api/gst/rule37?as_on=YYYY-MM-DD&branch_id=&include_within=true
 * Supplier bills approaching / past 180 days unpaid, ITC at stake, reversal already posted.
 */
export const GET = withPremiumSubscriptionApi({}, async (ctx) => {
  const { searchParams } = new URL(ctx.request.url);
  const asOn = searchParams.get('as_on') || todayIst();
  if (!isIsoDate(asOn)) return NextResponse.json({ error: 'as_on must be YYYY-MM-DD' }, { status: 400 });
  try {
    await authorize(ctx.userId, 'reports', 'read', { businessId: ctx.businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }
  const client = await getPool().connect();
  try {
    const rows = await listRule37Exposure(client, {
      businessId: ctx.businessId,
      asOn,
      branchId: searchParams.get('branch_id') || null,
      includeWithin: searchParams.get('include_within') === 'true',
    });
    return NextResponse.json({ as_on: asOn, bills: rows });
  } finally {
    client.release();
  }
});

/**
 * POST /api/gst/rule37  body: { as_on?: YYYY-MM-DD, dry_run?: boolean }
 * Posts Rule 37 reversals for overdue unpaid bills and re-availment for bills paid since.
 */
export const POST = withPremiumSubscriptionApi({ parseJsonBody: true }, async ({ body, businessId, userId }) => {
  const parsed = (body ?? {}) as { as_on?: string; dry_run?: boolean };
  const asOn = parsed.as_on || todayIst();
  if (!isIsoDate(asOn)) return NextResponse.json({ error: 'as_on must be YYYY-MM-DD' }, { status: 400 });
  try {
    await authorize(userId, 'journal', 'create', { businessId, entry_date: asOn });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  const client = await getPool().connect();
  try {
    const rows = await listRule37Exposure(client, { businessId, asOn });
    const pending = rows.filter((r) =>
      (['igst', 'cgst', 'sgst', 'cess'] as const).some((h) => Math.abs(r.target_reversal[h] - r.already_reversed[h]) >= 0.005)
    );
    if (parsed.dry_run) return NextResponse.json({ as_on: asOn, dry_run: true, bills: pending });

    for (const branchId of new Set(pending.map((r) => r.branch_id))) {
      const guard = await periodGuardResponse({
        businessId,
        branchId,
        dates: [asOn],
        action: 'post Rule 37 ITC reversal',
        checkGstFiled: true,
      });
      if (guard) return guard;
    }

    await client.query('BEGIN');
    const results = [];
    for (const row of pending) {
      const r = await syncRule37ForBill(client, { businessId, row, entryDate: asOn });
      results.push({ purchase_id: row.purchase_id, bill_number: row.bill_number, ...r });
    }
    await client.query('COMMIT');
    return NextResponse.json({ as_on: asOn, posted: results });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Rule 37 sync failed:', error);
    return NextResponse.json({ error: error?.message || 'Rule 37 sync failed' }, { status: 500 });
  } finally {
    client.release();
  }
});
