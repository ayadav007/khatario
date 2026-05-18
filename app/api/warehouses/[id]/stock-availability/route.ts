import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * GET /api/warehouses/[id]/stock-availability
 * Get stock availability for items in a specific warehouse
 * Used to validate stock before sales
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const itemId = searchParams.get('item_id'); // Optional: filter by item

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(businessId, 'multi_branch');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Verify warehouse exists and belongs to business
    const warehouse = await queryOne(`
      SELECT * FROM business_locations 
      WHERE id = $1 AND business_id = $2 AND is_active = true
    `, [params.id, businessId]);

    if (!warehouse) {
      return NextResponse.json(
        { error: 'Warehouse not found or inactive' },
        { status: 404 }
      );
    }

    let query = `
      SELECT 
        i.id as item_id,
        i.name as item_name,
        i.code as item_code,
        i.unit,
        COALESCE(ls.current_stock_qty, 0) as available_stock,
        COALESCE(ls.min_stock_qty, 0) as min_stock,
        CASE 
          WHEN COALESCE(ls.current_stock_qty, 0) <= 0 THEN 'out_of_stock'
          WHEN COALESCE(ls.current_stock_qty, 0) <= COALESCE(ls.min_stock_qty, 0) THEN 'low_stock'
          ELSE 'in_stock'
        END as stock_status
      FROM items i
      LEFT JOIN location_stock ls ON i.id = ls.item_id AND ls.location_id = $1
      WHERE i.business_id = $2 
        AND i.is_active = true
        AND i.item_type = 'goods'
    `;

    const queryParams: any[] = [params.id, businessId];

    if (itemId) {
      query += ` AND i.id = $3`;
      queryParams.push(itemId);
    }

    query += ` ORDER BY i.name ASC`;

    const items = await queryRows(query, queryParams);

    return NextResponse.json({
      warehouse_id: params.id,
      warehouse_name: warehouse.name,
      items: items.map(item => ({
        item_id: item.item_id,
        item_name: item.item_name,
        item_code: item.item_code,
        unit: item.unit,
        available_stock: parseFloat(item.available_stock?.toString() || '0'),
        min_stock: parseFloat(item.min_stock?.toString() || '0'),
        stock_status: item.stock_status
      }))
    });
  } catch (error: any) {
    console.error('Error fetching warehouse stock availability:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stock availability', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/warehouses/[id]/stock-availability
 * Validate stock availability for multiple items before sale
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { business_id, items } = body; // items: [{ item_id, quantity }]

    if (!business_id || !items || !Array.isArray(items)) {
      return NextResponse.json(
        { error: 'business_id and items array are required' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(business_id, 'multi_branch');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Verify warehouse exists
    const warehouse = await queryOne(`
      SELECT * FROM business_locations 
      WHERE id = $1 AND business_id = $2 AND is_active = true
    `, [params.id, business_id]);

    if (!warehouse) {
      return NextResponse.json(
        { error: 'Warehouse not found or inactive' },
        { status: 404 }
      );
    }

    const validationResults = [];
    const insufficientStockItems = [];

    for (const item of items) {
      const stockInfo = await queryOne(`
        SELECT 
          COALESCE(ls.current_stock_qty, 0) as available_stock,
          i.name as item_name
        FROM items i
        LEFT JOIN location_stock ls ON i.id = ls.item_id AND ls.location_id = $1
        WHERE i.id = $2 AND i.business_id = $3
      `, [params.id, item.item_id, business_id]);

      const availableStock = parseFloat(stockInfo?.available_stock?.toString() || '0');
      const requestedQty = parseFloat(item.quantity || '0');

      const isValid = availableStock >= requestedQty;

      validationResults.push({
        item_id: item.item_id,
        item_name: stockInfo?.item_name || 'Unknown',
        requested_quantity: requestedQty,
        available_stock: availableStock,
        is_available: isValid
      });

      if (!isValid) {
        insufficientStockItems.push({
          item_id: item.item_id,
          item_name: stockInfo?.item_name || 'Unknown',
          requested: requestedQty,
          available: availableStock,
          shortfall: requestedQty - availableStock
        });
      }
    }

    return NextResponse.json({
      warehouse_id: params.id,
      warehouse_name: warehouse.name,
      all_available: insufficientStockItems.length === 0,
      validation_results: validationResults,
      insufficient_stock: insufficientStockItems
    });
  } catch (error: any) {
    console.error('Error validating stock availability:', error);
    return NextResponse.json(
      { error: 'Failed to validate stock availability', details: error.message },
      { status: 500 }
    );
  }
}
