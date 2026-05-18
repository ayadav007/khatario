import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';

/**
 * GET /api/suppliers/dashboard?supplier_business_id=xxx
 * Get supplier dashboard data
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

    // Check if there are any customers who granted access
    const hasAccess = await queryOne(`
      SELECT COUNT(*) as count
      FROM suppliers s
      WHERE s.linked_business_id = $1
      AND s.allow_low_stock_access = true
    `, [supplierBusinessId]);

    if (parseInt(hasAccess?.count || '0') === 0) {
      // No customers granted access - return empty results
      return NextResponse.json({
        success: true,
        low_stock_alerts: [],
        stats: {
          active_customers: 0,
          low_stock_alerts: 0,
          total_thresholds: 0,
          pending_requests: 0
        }
      });
    }

    // Get low stock alerts - only for items that this supplier actually supplies
    // Filter by: default_supplier_id, purchase history, or supplier_item_thresholds
    const lowStockAlerts = await queryRows(`
      SELECT DISTINCT
        a.id,
        a.item_id,
        a.customer_business_id,
        a.current_stock,
        a.threshold,
        a.first_alerted_at,
        a.alert_status,
        i.name as item_name,
        i.code as item_code,
        cb.name as customer_name,
        cb.phone as customer_phone,
        cb.email as customer_email,
        COALESCE(cb.address_line1 || 
          CASE WHEN cb.address_line2 IS NOT NULL AND cb.address_line2 != '' THEN '\n' || cb.address_line2 ELSE '' END, 
          '') as customer_address,
        cb.city as customer_city,
        cb.state as customer_state,
        cb.pincode as customer_pincode
      FROM low_stock_alerts a
      JOIN items i ON a.item_id = i.id
      JOIN businesses cb ON a.customer_business_id = cb.id
      JOIN suppliers s ON s.business_id = a.customer_business_id 
        AND s.linked_business_id = $1
      WHERE a.supplier_business_id = $1
      AND a.alert_status = 'active'
      AND s.allow_low_stock_access = true
      AND (
        -- Item has this supplier as default supplier
        -- Check if the item's default_supplier_id matches a supplier record where linked_business_id = supplierBusinessId
        EXISTS (
          SELECT 1 FROM suppliers s2
          WHERE s2.id = i.default_supplier_id
          AND s2.linked_business_id = $1
          AND s2.business_id = cb.id
        )
        OR
        -- Item has been purchased from this supplier
        EXISTS (
          SELECT 1 FROM purchases p
          JOIN purchase_items pi ON p.id = pi.purchase_id
          JOIN suppliers s3 ON p.supplier_id = s3.id
          WHERE s3.linked_business_id = $1
          AND s3.business_id = cb.id
          AND pi.item_id = i.id
          AND p.business_id = cb.id
          AND p.status != 'cancelled'
        )
        OR
        -- Item has a supplier threshold set for this supplier
        EXISTS (
          SELECT 1 FROM supplier_item_thresholds t
          WHERE t.item_id = i.id
          AND t.customer_business_id = cb.id
          AND t.supplier_business_id = $1
        )
      )
      ORDER BY a.first_alerted_at DESC
    `, [supplierBusinessId]);

    // Also get items that are below their min_stock threshold for customers who granted access
    // Only show items that this supplier actually supplies
    const lowStockItems = await queryRows(`
      SELECT 
        i.id as item_id,
        cb.id as customer_business_id,
        i.current_stock,
        COALESCE(i.min_stock, 0) as threshold,
        i.updated_at as first_alerted_at,
        i.name as item_name,
        i.code as item_code,
        cb.name as customer_name,
        cb.phone as customer_phone,
        cb.email as customer_email,
        COALESCE(cb.address_line1 || 
          CASE WHEN cb.address_line2 IS NOT NULL AND cb.address_line2 != '' THEN '\n' || cb.address_line2 ELSE '' END, 
          '') as customer_address,
        cb.city as customer_city,
        cb.state as customer_state,
        cb.pincode as customer_pincode
      FROM items i
      JOIN businesses cb ON i.business_id = cb.id
      JOIN suppliers s ON s.business_id = cb.id
        AND s.linked_business_id = $1
        AND s.allow_low_stock_access = true
      WHERE i.current_stock <= COALESCE(i.min_stock, 0)
        AND i.min_stock > 0
        AND i.is_active = true
        AND (
          -- Item has this supplier as default supplier
          -- Check if the item's default_supplier_id matches a supplier record where linked_business_id = supplierBusinessId
          EXISTS (
            SELECT 1 FROM suppliers s2
            WHERE s2.id = i.default_supplier_id
            AND s2.linked_business_id = $1
            AND s2.business_id = cb.id
          )
          OR
          -- Item has been purchased from this supplier
          EXISTS (
            SELECT 1 FROM purchases p
            JOIN purchase_items pi ON p.id = pi.purchase_id
            JOIN suppliers s3 ON p.supplier_id = s3.id
            WHERE s3.linked_business_id = $1
            AND s3.business_id = cb.id
            AND pi.item_id = i.id
            AND p.business_id = cb.id
            AND p.status != 'cancelled'
          )
        )
        AND NOT EXISTS (
          -- Exclude items that already have an active alert
          SELECT 1 FROM low_stock_alerts a2
          WHERE a2.item_id = i.id
          AND a2.customer_business_id = cb.id
          AND a2.supplier_business_id = $1
          AND a2.alert_status = 'active'
        )
        AND NOT EXISTS (
          -- Exclude items that have a supplier threshold (those are handled by alerts)
          SELECT 1 FROM supplier_item_thresholds t
          WHERE t.item_id = i.id
          AND t.customer_business_id = cb.id
          AND t.supplier_business_id = $1
        )
      ORDER BY i.updated_at DESC
    `, [supplierBusinessId]);

    // Get stats - only customers who granted access
    const activeCustomers = await queryOne(`
      SELECT COUNT(DISTINCT s.business_id) as count
      FROM suppliers s
      WHERE s.linked_business_id = $1
      AND s.allow_low_stock_access = true
    `, [supplierBusinessId]);

    const totalThresholds = await queryOne(`
      SELECT COUNT(*) as count
      FROM supplier_item_thresholds
      WHERE supplier_business_id = $1
    `, [supplierBusinessId]);

    const pendingRequests = await queryOne(`
      SELECT COUNT(*) as count
      FROM suppliers
      WHERE linked_business_id = $1
      AND approval_status = 'pending'
    `, [supplierBusinessId]);

    // Combine alerts and low stock items
    const allAlerts = [
      ...lowStockAlerts.map((a: any) => ({
        ...a,
        id: a.id || `item-${a.item_id || Math.random()}`, // Ensure id exists
      })),
      ...lowStockItems.map((item: any) => ({
        id: `item-${item.item_id}`,
        item_id: item.item_id,
        customer_business_id: item.customer_business_id,
        current_stock: item.current_stock,
        threshold: item.threshold,
        first_alerted_at: item.first_alerted_at,
        alert_status: 'active',
        item_name: item.item_name,
        item_code: item.item_code,
        customer_name: item.customer_name,
        customer_phone: item.customer_phone,
        customer_email: item.customer_email,
        customer_address: item.customer_address,
        customer_city: item.customer_city,
        customer_state: item.customer_state,
        customer_pincode: item.customer_pincode,
      }))
    ].sort((a: any, b: any) => 
      new Date(b.first_alerted_at).getTime() - new Date(a.first_alerted_at).getTime()
    );

    const stats = {
      active_customers: parseInt(activeCustomers?.count || '0'),
      low_stock_alerts: allAlerts.length,
      total_thresholds: parseInt(totalThresholds?.count || '0'),
      pending_requests: parseInt(pendingRequests?.count || '0')
    };

    return NextResponse.json({
      success: true,
      low_stock_alerts: allAlerts,
      stats
      , customer_groups: await (async (): Promise<any[]> => {
        const groups = new Map<string, any>();
        
        // If any alerts are missing customer_business_id, look it up from supplier relationship
        const missingBusinessIds = new Set<string>();
        for (const alert of allAlerts) {
          if (!alert.customer_business_id && alert.customer_name) {
            missingBusinessIds.add(alert.customer_name);
          }
        }
        
        // Look up missing business IDs from supplier relationships
        // The supplier table has: business_id (customer's business) and linked_business_id (supplier's business)
        // So we need to find suppliers where linked_business_id = supplierBusinessId and business_id matches the customer
        const businessIdMap = new Map<string, string>();
        if (missingBusinessIds.size > 0) {
          const lookupResults = await queryRows(`
            SELECT DISTINCT s.business_id, b.name
            FROM suppliers s
            JOIN businesses b ON s.business_id = b.id
            WHERE s.linked_business_id = $1
            AND s.allow_low_stock_access = true
            AND b.name = ANY($2::text[])
          `, [supplierBusinessId, Array.from(missingBusinessIds)]);
          
          for (const row of lookupResults) {
            businessIdMap.set(row.name, row.business_id);
          }
        }
        
        for (const alert of allAlerts) {
          // Use customer_business_id if available, otherwise look it up or use customer_name as fallback key
          let customerBusinessId = alert.customer_business_id;
          if (!customerBusinessId && alert.customer_name) {
            customerBusinessId = businessIdMap.get(alert.customer_name) || null;
          }
          
          // If still missing, try to get it from the alert's customer_business_id field directly
          // (it should be in the SELECT statement)
          if (!customerBusinessId && (alert as any).customer_business_id) {
            customerBusinessId = (alert as any).customer_business_id;
          }
          
          const key = customerBusinessId || alert.customer_name;
          const shortage = Math.max(Number(alert.threshold || 0) - Number(alert.current_stock || 0), 0);
          
          if (!groups.has(key)) {
            groups.set(key, {
              customer_business_id: customerBusinessId,
              customer_name: alert.customer_name,
              customer_phone: alert.customer_phone,
              customer_email: alert.customer_email,
              customer_address: alert.customer_address,
              customer_city: alert.customer_city,
              customer_state: alert.customer_state,
              customer_pincode: alert.customer_pincode,
              items: [],
              items_count: 0,
              total_shortage: 0
            });
          }
          const g = groups.get(key);
          // Ensure customer_business_id is set if we found it
          if (!g.customer_business_id && customerBusinessId) {
            g.customer_business_id = customerBusinessId;
          }
          g.items.push({
            item_id: alert.item_id,
            item_name: alert.item_name,
            item_code: alert.item_code,
            current_stock: alert.current_stock,
            threshold: alert.threshold,
            first_alerted_at: alert.first_alerted_at
          });
          g.items_count += 1;
          g.total_shortage += shortage;
        }
        return Array.from(groups.values()).sort((a, b) => (b.total_shortage || 0) - (a.total_shortage || 0));
      })()
    });

  } catch (error: any) {
    console.error('Error fetching supplier dashboard data:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch dashboard data' },
      { status: 500 }
    );
  }
}

