import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';

/**
 * GET /api/stock-transfers/[id]/items
 * Fetch items for a specific transfer
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // Fetch transfer to get warehouse IDs for authorization
    const transfer = await db.queryOne(`
      SELECT * FROM stock_transfers WHERE id = $1 AND business_id = $2
    `, [params.id, businessId]);

    if (!transfer) {
      return NextResponse.json(
        { error: 'Transfer not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'warehouse_transfer', 'read', {
        businessId,
        sourceWarehouseId: transfer.from_location_id,
        destinationWarehouseId: transfer.to_location_id,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Fetch transfer items with item names
    const items = await db.queryRows(`
      SELECT 
        sti.*,
        i.name as item_name,
        i.unit as item_unit
      FROM stock_transfer_items sti
      LEFT JOIN items i ON sti.item_id = i.id
      WHERE sti.transfer_id = $1
      ORDER BY sti.id
    `, [params.id]);

    // Map items to include item_name and use item unit if not set
    const mappedItems = items.map((item: any) => ({
      ...item,
      item_name: item.item_name || 'Unknown Item',
      unit: item.unit || item.item_unit || 'PCS',
    }));

    return NextResponse.json({ items: mappedItems });
  } catch (error: any) {
    console.error('Error fetching transfer items:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transfer items', details: error.message },
      { status: 500 }
    );
  }
}
