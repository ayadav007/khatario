/**
 * Low Stock Checker Utility
 * Checks if items have crossed their threshold after stock movements
 */

import { query, queryRows } from './db';

export async function checkLowStockForItem(itemId: string, businessId: string) {
  try {
    // Find all thresholds for this item where the business is the customer
    const thresholds = await queryRows(`
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
        cb.address_line1 as customer_address,
        cb.city as customer_city,
        cb.state as customer_state,
        cb.pincode as customer_pincode,
        sb.name as supplier_name
      FROM supplier_item_thresholds t
      JOIN items i ON t.item_id = i.id
      JOIN businesses cb ON t.customer_business_id = cb.id
      JOIN businesses sb ON t.supplier_business_id = sb.id
      WHERE t.item_id = $1 
      AND t.customer_business_id = $2
      AND i.current_stock <= t.low_stock_threshold
    `, [itemId, businessId]);

    // Process each threshold
    for (const threshold of thresholds) {
      // Check if an active alert already exists
      const existingAlert = await queryRows(
        `SELECT id FROM low_stock_alerts
        WHERE supplier_business_id = $1 
        AND customer_business_id = $2 
        AND item_id = $3 
        AND alert_status = 'active'`,
        [threshold.supplier_business_id, threshold.customer_business_id, threshold.item_id]
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
          threshold.supplier_business_id,
          threshold.customer_business_id,
          threshold.item_id,
          threshold.threshold_id,
          threshold.current_stock,
          threshold.low_stock_threshold,
          new Date()
        ]);

        // Create notification for supplier
        await query(`
          INSERT INTO notifications (
            business_id, type, title, message, reference_type, reference_id, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          threshold.supplier_business_id,
          'low_stock_alert',
          `📦 Low Stock Alert: ${threshold.item_name}`,
          `${threshold.customer_name} (${threshold.customer_city}, ${threshold.customer_state}) has low stock of ${threshold.item_name}. Current stock: ${threshold.current_stock}, Threshold: ${threshold.low_stock_threshold}. Contact: ${threshold.customer_phone || threshold.customer_email || 'N/A'}. Address: ${threshold.customer_address || 'N/A'}`,
          'item',
          threshold.item_id,
          new Date()
        ]);

        console.log(`Low stock alert created for item ${threshold.item_name} (${threshold.item_id}) - Supplier: ${threshold.supplier_name}`);
      }
    }

    // Also check if stock went above threshold (resolve alerts)
    await query(`
      UPDATE low_stock_alerts a
      SET alert_status = 'resolved', resolved_at = $1
      FROM items i, supplier_item_thresholds t
      WHERE a.item_id = i.id
      AND a.threshold_id = t.id
      AND i.current_stock > t.low_stock_threshold
      AND a.alert_status = 'active'
      AND i.id = $2
      AND a.customer_business_id = $3
    `, [new Date(), itemId, businessId]);

  } catch (error) {
    console.error('Error checking low stock for item:', error);
    // Don't throw - just log the error so it doesn't break the main flow
  }
}

export async function checkLowStockForMultipleItems(items: Array<{ item_id: string; business_id: string }>) {
  for (const item of items) {
    await checkLowStockForItem(item.item_id, item.business_id);
  }
}

