import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';

/**
 * GET /api/suppliers/dashboard/analytics?supplier_business_id=xxx
 * Get location-based analytics for supplier
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const supplierBusinessId = searchParams.get('supplier_business_id');

    if (!supplierBusinessId) {
      return NextResponse.json(
        { error: 'supplier_business_id is required' },
        { status: 400 }
      );
    }

    // Analytics by State
    const byState = await queryRows(`
      SELECT 
        cb.state,
        COUNT(DISTINCT cb.id) as customer_count,
        COUNT(DISTINCT t.item_id) as item_count,
        COALESCE(SUM(
          CASE 
            WHEN a.alert_status = 'resolved' 
            THEN (t.low_stock_threshold - a.current_stock) * 0 -- Estimate, would need actual sale price
            ELSE 0 
          END
        ), 0) as total_sales
      FROM supplier_item_thresholds t
      JOIN businesses cb ON t.customer_business_id = cb.id
      LEFT JOIN low_stock_alerts a ON a.threshold_id = t.id
      WHERE t.supplier_business_id = $1
      AND cb.state IS NOT NULL AND cb.state != ''
      GROUP BY cb.state
      ORDER BY customer_count DESC, cb.state
    `, [supplierBusinessId]);

    // Analytics by City
    const byCity = await queryRows(`
      SELECT 
        cb.city,
        cb.state,
        COUNT(DISTINCT cb.id) as customer_count,
        COUNT(DISTINCT t.item_id) as item_count,
        0 as total_sales
      FROM supplier_item_thresholds t
      JOIN businesses cb ON t.customer_business_id = cb.id
      WHERE t.supplier_business_id = $1
      AND cb.city IS NOT NULL AND cb.city != ''
      GROUP BY cb.city, cb.state
      ORDER BY customer_count DESC, cb.city
      LIMIT 50
    `, [supplierBusinessId]);

    // Analytics by Pincode
    const byPincode = await queryRows(`
      SELECT 
        cb.pincode,
        cb.city,
        cb.state,
        COUNT(DISTINCT cb.id) as customer_count,
        COUNT(DISTINCT t.item_id) as item_count,
        0 as total_sales
      FROM supplier_item_thresholds t
      JOIN businesses cb ON t.customer_business_id = cb.id
      WHERE t.supplier_business_id = $1
      AND cb.pincode IS NOT NULL AND cb.pincode != ''
      GROUP BY cb.pincode, cb.city, cb.state
      ORDER BY customer_count DESC, cb.pincode
      LIMIT 100
    `, [supplierBusinessId]);

    return NextResponse.json({
      success: true,
      by_state: byState,
      by_city: byCity,
      by_pincode: byPincode
    });

  } catch (error: any) {
    console.error('Error fetching analytics:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}

