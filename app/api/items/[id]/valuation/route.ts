import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import {
  getStockValue,
  ValuationMethod,
  calculateWeightedAverageValuation,
  resolveItemQuantityForValuation,
} from '@/lib/stock-valuation';

/**
 * GET /api/items/[id]/valuation
 * Get detailed valuation information for an item
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const itemId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const locationId = searchParams.get('location_id');
    const branchId = searchParams.get('branch_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Get item details
    const item = await queryOne<{
      current_stock: number;
      purchase_price: number;
      valuation_method: ValuationMethod;
      track_batch: boolean;
      track_serial: boolean;
      unit: string;
    }>(
      `SELECT current_stock, purchase_price, valuation_method, track_batch, track_serial, unit
       FROM items WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [itemId, businessId]
    );

    if (!item) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      );
    }

    const valuationMethod = (item.valuation_method || 'simple') as ValuationMethod;
    const currentStock = await resolveItemQuantityForValuation(
      itemId,
      businessId,
      locationId || undefined,
      branchId || undefined
    );
    const purchasePrice = parseFloat(item.purchase_price?.toString() || '0');

    // Calculate total stock value
    const totalValue = await getStockValue(
      itemId,
      valuationMethod,
      businessId,
      locationId || undefined,
      branchId || undefined
    );

    // Get batch details if batch tracking is enabled
    let batches: any[] = [];
    let averageCost = purchasePrice;
    let batchBreakdown: any[] = [];

    if (item.track_batch) {
      let batchSql = `
        SELECT 
          ib.id,
          ib.batch_number,
          ib.quantity,
          ib.purchase_price,
          ib.manufacturing_date,
          ib.expiry_date,
          ib.created_at,
          bl.name as location_name
        FROM item_batches ib
        LEFT JOIN business_locations bl ON ib.location_id = bl.id
        WHERE ib.item_id = $1 AND ib.business_id = $2 AND ib.quantity > 0
      `;
      const batchParams: any[] = [itemId, businessId];

      if (locationId) {
        batchSql += ` AND (ib.location_id = $${batchParams.length + 1} OR ib.location_id IS NULL)`;
        batchParams.push(locationId);
      }

      // Order by valuation method
      if (valuationMethod === 'fifo') {
        batchSql += ` ORDER BY ib.created_at ASC, ib.manufacturing_date ASC NULLS LAST`;
      } else if (valuationMethod === 'lifo') {
        batchSql += ` ORDER BY ib.created_at DESC, ib.manufacturing_date DESC NULLS LAST`;
      } else {
        batchSql += ` ORDER BY ib.created_at DESC`;
      }

      batches = await queryRows(batchSql, batchParams);

      // Calculate batch breakdown
      batchBreakdown = batches.map((batch) => {
        const qty = parseFloat(batch.quantity.toString());
        const cost = parseFloat(batch.purchase_price.toString());
        const batchValue = qty * cost;
        return {
          ...batch,
          quantity: qty,
          purchase_price: cost,
          batch_value: batchValue,
        };
      });

      // Calculate average cost
      if (valuationMethod === 'weighted_avg') {
        averageCost = await calculateWeightedAverageValuation(
          itemId,
          businessId,
          locationId || undefined
        );
      } else if (batches.length > 0) {
        // For FIFO/LIFO, calculate weighted average of all batches
        const totalCost = batchBreakdown.reduce((sum, b) => sum + b.batch_value, 0);
        const totalQty = batchBreakdown.reduce((sum, b) => sum + b.quantity, 0);
        averageCost = totalQty > 0 ? totalCost / totalQty : purchasePrice;
      }
    }

    // Get serial details if serial tracking is enabled
    let serials: any[] = [];
    if (item.track_serial) {
      let serialSql = `
        SELECT 
          is.id,
          is.serial_number,
          is.purchase_price,
          is.status,
          is.location_id,
          bl.name as location_name,
          c.name as customer_name,
          i.invoice_number
        FROM item_serials is
        LEFT JOIN business_locations bl ON is.location_id = bl.id
        LEFT JOIN customers c ON is.sold_to_customer_id = c.id
        LEFT JOIN invoices i ON is.sold_invoice_id = i.id
        WHERE is.item_id = $1 AND is.business_id = $2
      `;
      const serialParams: any[] = [itemId, businessId];

      if (locationId) {
        serialSql += ` AND (is.location_id = $${serialParams.length + 1} OR is.location_id IS NULL)`;
        serialParams.push(locationId);
      }

      serialSql += ` ORDER BY is.created_at DESC`;

      serials = await queryRows(serialSql, serialParams);

      // Calculate serial breakdown
      const availableSerials = serials.filter((s) => s.status === 'available');
      const soldSerials = serials.filter((s) => s.status === 'sold');
      const serialValue = availableSerials.reduce(
        (sum, s) => sum + parseFloat(s.purchase_price?.toString() || '0'),
        0
      );
    }

    // Calculate unit cost based on valuation method
    let unitCost = purchasePrice;
    if (currentStock > 0) {
      unitCost = totalValue / currentStock;
    } else if (item.track_batch && batches.length > 0) {
      unitCost = averageCost;
    }

    const stockQuantitySource = locationId
      ? 'warehouse'
      : branchId
        ? 'branch'
        : 'aggregate';

    return NextResponse.json({
      item: {
        id: itemId,
        current_stock: currentStock,
        stock_quantity_source: stockQuantitySource,
        unit: item.unit,
        purchase_price: purchasePrice,
        valuation_method: valuationMethod,
        track_batch: item.track_batch,
        track_serial: item.track_serial,
      },
      valuation: {
        method: valuationMethod,
        total_value: totalValue,
        unit_cost: unitCost,
        average_cost: averageCost,
        current_stock: currentStock,
      },
      batches: batchBreakdown,
      serials: item.track_serial ? serials : undefined,
    });
  } catch (error: any) {
    console.error('Error fetching valuation:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
