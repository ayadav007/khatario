import { NextRequest, NextResponse } from 'next/server';
import { query, queryRows } from '@/lib/db';
import { getBusinessSubscription, isSubscriptionOperationalStatus } from '@/lib/subscription';

/**
 * POST /api/cron/check-low-stock
 * Periodic check for items below threshold
 * Can be triggered by cron job or manually
 */
export async function POST(request: NextRequest) {
  try {
    // Find all items that are below their thresholds
    const lowStockItems = await queryRows(`
      SELECT 
        t.id as threshold_id,
        t.supplier_business_id,
        t.customer_business_id,
        t.item_id,
        t.low_stock_threshold,
        i.current_stock,
        i.name as item_name,
        i.code as item_code,
        cb.name as customer_name,
        cb.phone as customer_phone,
        cb.email as customer_email,
        cb.address as customer_address,
        cb.city as customer_city,
        cb.state as customer_state,
        cb.pincode as customer_pincode,
        sb.name as supplier_name
      FROM supplier_item_thresholds t
      JOIN items i ON t.item_id = i.id
      JOIN businesses cb ON t.customer_business_id = cb.id
      JOIN businesses sb ON t.supplier_business_id = sb.id
      WHERE i.current_stock <= t.low_stock_threshold
    `);

    let alertsCreated = 0;
    let notificationsCreated = 0;

    for (const item of lowStockItems) {
      // CRITICAL: Check if supplier business has active subscription
      // Skip processing if subscription is inactive or expired
      const subscription = await getBusinessSubscription(item.supplier_business_id);
      if (!subscription || !isSubscriptionOperationalStatus(subscription.status)) {
        console.log(`Skipping low stock alert for item ${item.item_id}: supplier business ${item.supplier_business_id} subscription inactive or expired`);
        continue;
      }

      // Check if subscription has expired (if end_date is set)
      if (subscription.end_date) {
        const endDate = new Date(subscription.end_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (endDate < today) {
          console.log(`Skipping low stock alert for item ${item.item_id}: supplier business ${item.supplier_business_id} subscription expired on ${subscription.end_date}`);
          continue;
        }
      }

      // Check if an active alert already exists
      const existingAlert = await queryRows(
        `SELECT id FROM low_stock_alerts
        WHERE supplier_business_id = $1 
        AND customer_business_id = $2 
        AND item_id = $3 
        AND alert_status = 'active'`,
        [item.supplier_business_id, item.customer_business_id, item.item_id]
      );

      if (existingAlert.length === 0) {
        // Create new alert
        await query(`
          INSERT INTO low_stock_alerts (
            supplier_business_id, customer_business_id, item_id, threshold_id,
            current_stock, threshold, alert_status, first_alerted_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)
        `, [
          item.supplier_business_id,
          item.customer_business_id,
          item.item_id,
          item.threshold_id,
          item.current_stock,
          item.low_stock_threshold,
          new Date()
        ]);
        alertsCreated++;

        // Create notification for supplier
        await query(`
          INSERT INTO notifications (
            business_id, type, title, message, reference_type, reference_id, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          item.supplier_business_id,
          'low_stock_alert',
          `📦 Low Stock Alert: ${item.item_name}`,
          `${item.customer_name} (${item.customer_city}, ${item.customer_state}) has low stock of ${item.item_name}. Current stock: ${item.current_stock}, Threshold: ${item.low_stock_threshold}. Contact: ${item.customer_phone || item.customer_email || 'N/A'}`,
          'item',
          item.item_id,
          new Date()
        ]);
        notificationsCreated++;
      }
    }

    // Resolve alerts for items that are back above threshold
    const resolvedCount = await query(`
      UPDATE low_stock_alerts a
      SET alert_status = 'resolved', resolved_at = $1
      FROM items i, supplier_item_thresholds t
      WHERE a.item_id = i.id
      AND a.threshold_id = t.id
      AND i.current_stock > t.low_stock_threshold
      AND a.alert_status = 'active'
    `, [new Date()]);

    return NextResponse.json({
      success: true,
      message: 'Low stock check completed',
      stats: {
        items_checked: lowStockItems.length,
        alerts_created: alertsCreated,
        notifications_created: notificationsCreated,
        alerts_resolved: resolvedCount.rowCount || 0
      }
    });

  } catch (error: any) {
    console.error('Error checking low stock:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to check low stock' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/cron/check-low-stock
 * Test endpoint to manually trigger check
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

