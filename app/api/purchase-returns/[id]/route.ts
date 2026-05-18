import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';

/**
 * GET /api/purchase-returns/[id]
 * Fetch a single purchase return with line items.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const returnId = params.id;

  try {
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const businessId = getBusinessIdFromRequest(request);
    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const pool = getPool();

    const returnResult = await pool.query(
      `SELECT
        pr.*,
        s.name AS supplier_name,
        s.phone AS supplier_phone,
        s.gstin AS supplier_gstin,
        p.bill_number AS purchase_bill_number,
        p.bill_date AS purchase_bill_date
      FROM purchase_returns pr
      LEFT JOIN suppliers s ON pr.supplier_id = s.id
      LEFT JOIN purchases p ON pr.purchase_id = p.id
      WHERE pr.id = $1 AND pr.business_id = $2`,
      [returnId, businessId]
    );

    if (returnResult.rows.length === 0) {
      return NextResponse.json({ error: 'Purchase return not found' }, { status: 404 });
    }

    const purchaseReturn = returnResult.rows[0];

    try {
      await authorize(userId, 'purchases', 'read', {
        branchId: purchaseReturn.branch_id,
        businessId: purchaseReturn.business_id,
        resourceId: returnId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const itemsResult = await pool.query(
      `SELECT
        pri.*,
        i.name AS catalog_item_name,
        i.code AS catalog_item_code
      FROM purchase_return_items pri
      LEFT JOIN items i ON pri.item_id = i.id
      WHERE pri.return_id = $1
      ORDER BY pri.sort_order ASC, pri.id ASC`,
      [returnId]
    );

    purchaseReturn.items = itemsResult.rows;

    return NextResponse.json({ purchaseReturn });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching purchase return:', error);
    return NextResponse.json(
      { error: 'Failed to fetch purchase return', details: message },
      { status: 500 }
    );
  }
}

const REFUND_STATUSES = ['pending', 'refunded', 'adjusted'] as const;
type RefundStatus = (typeof REFUND_STATUSES)[number];

/**
 * PATCH /api/purchase-returns/[id]
 * Update refund settlement (status, mode, date, amount).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const returnId = params.id;

  try {
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const businessId = getBusinessIdFromRequest(request);
    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const body = await request.json();
    const {
      refund_status: refundStatusInput,
      refund_mode,
      refund_date,
      refund_amount,
    } = body as {
      refund_status?: string;
      refund_mode?: string | null;
      refund_date?: string | null;
      refund_amount?: number | null;
    };

    if (!refundStatusInput || !REFUND_STATUSES.includes(refundStatusInput as RefundStatus)) {
      return NextResponse.json(
        { error: 'refund_status must be pending, refunded, or adjusted' },
        { status: 400 }
      );
    }

    const refundStatus = refundStatusInput as RefundStatus;
    const pool = getPool();

    const existing = await pool.query(
      `SELECT id, business_id, branch_id, grand_total, refund_status
       FROM purchase_returns
       WHERE id = $1 AND business_id = $2`,
      [returnId, businessId]
    );

    if (existing.rows.length === 0) {
      return NextResponse.json({ error: 'Purchase return not found' }, { status: 404 });
    }

    const row = existing.rows[0];

    try {
      await authorize(userId, 'purchases', 'update', {
        branchId: row.branch_id,
        businessId: row.business_id,
        resourceId: returnId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    let resolvedMode: string | null =
      refund_mode != null && String(refund_mode).trim() !== ''
        ? String(refund_mode).trim()
        : null;
    let resolvedDate: string | null =
      refund_date != null && String(refund_date).trim() !== ''
        ? String(refund_date).split('T')[0]
        : null;
    let resolvedAmount: number | null =
      refund_amount != null && !Number.isNaN(Number(refund_amount))
        ? Number(refund_amount)
        : null;

    if (refundStatus === 'pending') {
      resolvedMode = null;
      resolvedDate = null;
      resolvedAmount = null;
    } else if (refundStatus === 'adjusted') {
      resolvedMode = resolvedMode || 'adjusted_to_purchase';
      if (!resolvedDate) {
        resolvedDate = new Date().toISOString().split('T')[0];
      }
      if (resolvedAmount == null || Number.isNaN(resolvedAmount)) {
        resolvedAmount = Number(row.grand_total);
      }
    } else if (refundStatus === 'refunded') {
      if (!resolvedMode) {
        return NextResponse.json(
          { error: 'refund_mode is required when status is refunded (e.g. cash, bank, upi)' },
          { status: 400 }
        );
      }
      if (!resolvedDate) {
        return NextResponse.json(
          { error: 'refund_date is required when status is refunded' },
          { status: 400 }
        );
      }
      if (resolvedAmount == null || Number.isNaN(resolvedAmount) || resolvedAmount <= 0) {
        resolvedAmount = Number(row.grand_total);
      }
    }

    const updateResult = await pool.query(
      `UPDATE purchase_returns
       SET refund_status = $1,
           refund_mode = $2,
           refund_date = $3,
           refund_amount = $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND business_id = $6
       RETURNING *`,
      [refundStatus, resolvedMode, resolvedDate, resolvedAmount, returnId, businessId]
    );

    return NextResponse.json({ purchaseReturn: updateResult.rows[0] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error updating purchase return refund:', error);
    return NextResponse.json(
      { error: 'Failed to update refund settlement', details: message },
      { status: 500 }
    );
  }
}
