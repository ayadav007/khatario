import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

/**
 * GET /api/purchase-orders/[id]
 * Fetch a single purchase order with its items
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const purchaseOrderId = params.id;

  try {
    const pool = getPool();

    // Fetch purchase order details
    const orderResult = await pool.query(
      `SELECT 
        po.*,
        s.name as supplier_name,
        s.phone as supplier_phone,
        s.email as supplier_email,
        s.gstin as supplier_gstin,
        s.address as supplier_address
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      WHERE po.id = $1`,
      [purchaseOrderId]
    );

    if (orderResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      );
    }

    const purchaseOrder = orderResult.rows[0];

    // Fetch purchase order items
    const itemsResult = await pool.query(
      `SELECT *
      FROM purchase_order_items
      WHERE purchase_order_id = $1
      ORDER BY sort_order, id`,
      [purchaseOrderId]
    );

    purchaseOrder.items = itemsResult.rows;

    return NextResponse.json({ purchaseOrder });
  } catch (error: any) {
    console.error('Error fetching purchase order:', error);
    return NextResponse.json(
      { error: 'Failed to fetch purchase order', details: error.message },
      { status: 500 }
    );
  }
}

