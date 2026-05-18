import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import {
  assertReportAccess,
  FeatureAccessDeniedError,
  resolveRegistryFeatureId,
  getAllFeatureAccessForBusiness,
} from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { FeatureKeys } from '@/lib/featureKeys';

type EntityType = 'invoice' | 'purchase' | 'payment' | 'supplier';

interface DeletedRow {
  id: string;
  entity_type: EntityType;
  doc_number: string;
  party_name: string;
  amount: string;
  deleted_at: string;
}

function deletedAtClause(
  alias: string,
  params: unknown[],
  fromDate: string | null,
  toDate: string | null
) {
  let clause = '';
  if (fromDate) {
    const i = params.length + 1;
    clause += ` AND ${alias}.deleted_at >= $${i}::date`;
    params.push(fromDate);
  }
  if (toDate) {
    const i = params.length + 1;
    clause += ` AND ${alias}.deleted_at < ($${i}::date + INTERVAL '1 day')`;
    params.push(toDate);
  }
  return clause;
}

/**
 * GET /api/reports/deleted-items
 * Lists soft-deleted invoices, purchases, and payments with optional filters.
 *
 * Query: business_id (required), user_id (authorization), branch_id (optional),
 *        type=all|invoice|purchase|payment, date_from, date_to (filter on deleted_at)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    const typeParam = (searchParams.get('type') || 'all').toLowerCase();
    const fromDate = searchParams.get('date_from');
    const toDate = searchParams.get('date_to');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    try {
      await assertReportAccess(businessId, 'basic');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
      throw error;
    }

    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchIdParam,
        businessId,
      });
    } catch (error: any) {
      if (
        error.code === 'BRANCH_NOT_FOUND' ||
        error.code === 'BRANCH_BUSINESS_MISMATCH' ||
        error.code === 'BRANCH_INACTIVE'
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      throw error;
    }

    try {
      await authorize(userId, 'report', 'read', {
        businessId,
        branchId: finalBranchId,
        resource: {
          business_id: businessId,
          branch_id: finalBranchId,
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const wantInv =
      typeParam === 'all' || typeParam === 'invoice' || typeParam === 'invoices';
    const wantPur =
      typeParam === 'all' || typeParam === 'purchase' || typeParam === 'purchases';
    const wantPay =
      typeParam === 'all' || typeParam === 'payment' || typeParam === 'payments';
    const wantSup =
      typeParam === 'all' || typeParam === 'supplier' || typeParam === 'suppliers';

    const merged: DeletedRow[] = [];

    if (wantInv) {
      const params: unknown[] = [businessId];
      const clause = deletedAtClause('i', params, fromDate, toDate);
      const rs = await db.queryRows<DeletedRow>(
        `
        SELECT 
          i.id,
          'invoice'::text AS entity_type,
          i.invoice_number AS doc_number,
          COALESCE(NULLIF(TRIM(c.name), ''), '—') AS party_name,
          i.grand_total::text AS amount,
          i.deleted_at::text AS deleted_at
        FROM invoices i
        LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.business_id = $1 AND i.deleted_at IS NOT NULL
        ${clause}
        `,
        params as unknown[]
      );
      merged.push(...rs);
    }

    if (wantPur) {
      const params: unknown[] = [businessId];
      const clause = deletedAtClause('p', params, fromDate, toDate);
      const rs = await db.queryRows<DeletedRow>(
        `
        SELECT 
          p.id,
          'purchase'::text AS entity_type,
          COALESCE(NULLIF(TRIM(p.bill_number), ''), '#' || SUBSTRING(REPLACE(p.id::text, '-', ''), 1, 12)) AS doc_number,
          COALESCE(NULLIF(TRIM(s.name), ''), '—') AS party_name,
          p.grand_total::text AS amount,
          p.deleted_at::text AS deleted_at
        FROM purchases p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.business_id = $1 AND p.deleted_at IS NOT NULL
        ${clause}
        `,
        params as unknown[]
      );
      merged.push(...rs);
    }

    if (wantPay) {
      const params: unknown[] = [businessId];
      const clause = deletedAtClause('py', params, fromDate, toDate);
      const rs = await db.queryRows<DeletedRow>(
        `
        SELECT 
          py.id,
          'payment'::text AS entity_type,
          (CASE WHEN py.type = 'receivable' THEN 'Payment in' ELSE 'Payment out' END || ' · ' ||
            COALESCE(to_char(py.payment_date, 'YYYY-MM-DD'), '?')) AS doc_number,
          COALESCE(NULLIF(TRIM(cm.name), ''), NULLIF(TRIM(sp.name), ''), '—') AS party_name,
          py.amount::text AS amount,
          py.deleted_at::text AS deleted_at
        FROM payments py
        LEFT JOIN customers cm ON cm.id = py.customer_id
        LEFT JOIN suppliers sp ON sp.id = py.supplier_id
        WHERE py.business_id = $1 AND py.deleted_at IS NOT NULL
        ${clause}
        `,
        params as unknown[]
      );
      merged.push(...rs);
    }

    if (wantSup) {
      const params: unknown[] = [businessId];
      const clause = deletedAtClause('s', params, fromDate, toDate);
      const rs = await db.queryRows<DeletedRow>(
        `
        SELECT
          s.id,
          'supplier'::text AS entity_type,
          COALESCE(NULLIF(TRIM(s.name), ''), '#' || SUBSTRING(REPLACE(s.id::text, '-', ''), 1, 12)) AS doc_number,
          COALESCE(NULLIF(TRIM(s.phone), ''), NULLIF(TRIM(s.gstin), ''), '—') AS party_name,
          0::text AS amount,
          s.deleted_at::text AS deleted_at
        FROM suppliers s
        WHERE s.business_id = $1 AND s.deleted_at IS NOT NULL
        ${clause}
        `,
        params as unknown[]
      );
      merged.push(...rs);
    }

    merged.sort(
      (a, b) =>
        new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime()
    );

    const softDeleteRegistryId = resolveRegistryFeatureId(FeatureKeys.SOFT_DELETE);
    const caps = await getAllFeatureAccessForBusiness(businessId);
    const canRestore = caps.has(softDeleteRegistryId);

    return NextResponse.json({
      items: merged.slice(0, 400).map((r) => ({
        id: r.id,
        type: r.entity_type,
        number: r.doc_number,
        party: r.party_name,
        amount: parseFloat(r.amount || '0') || 0,
        deleted_at: r.deleted_at,
      })),
      can_restore: canRestore,
    });
  } catch (error: any) {
    console.error('[deleted-items]', error);
    return NextResponse.json(
      {
        error: 'Failed to list deleted items',
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
