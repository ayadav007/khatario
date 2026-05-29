import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { Invoice } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { deriveInvoicePaymentStatus } from '@/lib/invoice-payment-status';
import { INVOICE_LIST_CACHE_MAX } from '@/lib/offline/invoices/invoice-list-cache';

/**
 * Latest invoice list rows for offline cache (max 100, no pagination).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchId = searchParams.get('branch_id');
    const limit = Math.min(
      parseInt(searchParams.get('limit') || String(INVOICE_LIST_CACHE_MAX), 10),
      INVOICE_LIST_CACHE_MAX
    );

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
      await authorize(userId, 'invoices', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    let accessibleBranchIds: string[] | null = null;
    let isAdmin = false;
    const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
    accessibleBranchIds = await getUserAccessibleBranchIds(userId);

    try {
      const { checkUserPermission } = await import('@/lib/permissions');
      isAdmin = await checkUserPermission(userId, 'settings', 'read');
    } catch {
      isAdmin = false;
    }

    if (!isAdmin) {
      try {
        const { queryOne } = await import('@/lib/db');
        const user = await queryOne<{ is_primary_admin: boolean }>(
          'SELECT is_primary_admin FROM users WHERE id = $1',
          [userId]
        );
        isAdmin = user?.is_primary_admin || false;
      } catch {
        isAdmin = false;
      }
    }

    let sql = `
      SELECT 
        i.id,
        i.business_id,
        i.branch_id,
        i.customer_id,
        i.invoice_number,
        i.invoice_date,
        i.due_date,
        i.grand_total,
        i.paid_amount,
        i.balance_amount,
        i.status,
        i.payment_status,
        i.document_type,
        i.created_at,
        i.updated_at,
        c.name as customer_name,
        c.phone as customer_phone,
        CASE 
          WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND (i.grand_total - COALESCE(i.paid_amount, 0)) > 0 
            THEN CURRENT_DATE - i.due_date
          WHEN i.due_date IS NULL AND i.invoice_date < CURRENT_DATE AND (i.grand_total - COALESCE(i.paid_amount, 0)) > 0
            THEN CURRENT_DATE - i.invoice_date
          ELSE 0
        END as days_overdue
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id AND c.deleted_at IS NULL
      WHERE i.business_id = $1
        AND i.deleted_at IS NULL
        AND i.status != 'cancelled'
        AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
    `;
    const params: unknown[] = [businessId];

    if (branchId && branchId !== 'ALL' && branchId !== 'all') {
      sql += ` AND i.branch_id = $${params.length + 1}`;
      params.push(branchId);
    } else if (accessibleBranchIds !== null && !isAdmin) {
      if (accessibleBranchIds.length === 0) {
        return NextResponse.json({ invoices: [] });
      }
      sql += ` AND i.branch_id = ANY($${params.length + 1})`;
      params.push(accessibleBranchIds);
    }

    sql += ` ORDER BY i.invoice_date DESC, i.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const invoices = await queryRows<
      Invoice & { customer_name?: string; customer_phone?: string; days_overdue?: number }
    >(sql, params);

    const normalizedInvoices = invoices.map((inv) => {
      const p = deriveInvoicePaymentStatus(
        inv.grand_total,
        inv.paid_amount,
        inv.balance_amount
      );
      return p !== inv.payment_status ? { ...inv, payment_status: p } : inv;
    });

    return NextResponse.json({ invoices: normalizedInvoices });
  } catch (error) {
    console.error('[offline-sync/invoices]', error);
    return NextResponse.json(
      { error: 'Failed to export invoices for offline cache' },
      { status: 500 }
    );
  }
}
