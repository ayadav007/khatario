/**
 * Warehouse Mode Helper
 * Determines if warehouses are enabled for a business and controls stock update behavior
 *
 * Inventory model (canonical):
 * - **Branch** — accounting / business unit; every sale, purchase, and non-warehouse stock
 *   movement is tied to a `branch_id`. Without warehouses, stock lives in `branch_item_stock`.
 * - **Warehouse (location)** — optional physical layer under a branch; when enabled, stock is
 *   tracked in `location_stock` and locations belong to a branch. Never fall back to
 *   `items.current_stock` for branch-scoped operations; use branch stock or warehouse stock only.
 * - **business_locations** — legacy naming in some areas; prefer `branches` + optional warehouse
 *   locations for new code.
 */

import { queryOne } from './db';

/**
 * Check if warehouses are enabled for a business
 * @param businessId - Business ID to check
 * @returns true if warehouses are enabled, false otherwise
 */
export async function isWarehouseModeEnabled(businessId: string): Promise<boolean> {
  if (!businessId) return false;

  try {
    // Check if column exists
    const columnExists = await queryOne(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'business_settings' 
        AND column_name = 'warehouses_enabled'
      ) as exists
    `);

    if (!columnExists || !columnExists.exists) {
      return false; // Column doesn't exist, warehouses not enabled
    }

    // Fetch setting
    const settings = await queryOne(
      'SELECT warehouses_enabled FROM business_settings WHERE business_id = $1',
      [businessId]
    );

    return settings?.warehouses_enabled === true;
  } catch (error) {
    console.error('Error checking warehouse mode:', error);
    return false; // Default to disabled on error
  }
}
