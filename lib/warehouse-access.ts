import { queryOne, queryRows, getPool } from './db';

export interface WarehouseAccess {
  warehouse_id: string;
  can_view: boolean;
  can_edit: boolean;
  can_create_transactions: boolean;
}

/**
 * Check if user has access to a warehouse
 */
export async function checkUserWarehouseAccess(
  userId: string,
  warehouseId: string
): Promise<WarehouseAccess | null> {
  try {
    const user = await queryOne<{ business_id: string; is_primary_admin: boolean }>(`
      SELECT business_id, is_primary_admin FROM users WHERE id = $1
    `, [userId]);

    if (!user) {
      return null;
    }

    // Primary admin bypass: Check if warehouse belongs to user's business
    if (user.is_primary_admin) {
      const warehouse = await queryOne<{ id: string; business_id: string; is_active: boolean }>(`
        SELECT id, business_id, is_active FROM warehouses WHERE id = $1
      `, [warehouseId]);

      if (warehouse && warehouse.business_id === user.business_id) {
        // Primary admin has full access to all warehouses in their business
        return {
          warehouse_id: warehouseId,
          can_view: true,
          can_edit: true,
          can_create_transactions: true,
        };
      }
    }

    // Check explicit warehouse access
    // Handle both old schema (can_transfer, can_adjust) and new schema (can_create_transactions)
    let access: any = null;
    try {
      // Try new schema first
      access = await queryOne<any>(`
        SELECT warehouse_id, can_view, can_edit, can_create_transactions
        FROM user_warehouses
        WHERE user_id = $1 AND warehouse_id = $2
      `, [userId, warehouseId]);
    } catch (error: any) {
      // If column doesn't exist, try old schema
      if (error.code === '42703' || error.message?.includes('can_create_transactions')) {
        try {
          access = await queryOne<any>(`
            SELECT 
              warehouse_id, 
              can_view, 
              can_edit,
              (COALESCE(can_transfer, false) OR COALESCE(can_adjust, false)) as can_create_transactions
            FROM user_warehouses
            WHERE user_id = $1 AND warehouse_id = $2
          `, [userId, warehouseId]);
        } catch (fallbackError: any) {
          // If old columns don't exist either, use minimal query
          if (fallbackError.code === '42703') {
            access = await queryOne<any>(`
              SELECT warehouse_id, can_view, can_edit, false as can_create_transactions
              FROM user_warehouses
              WHERE user_id = $1 AND warehouse_id = $2
            `, [userId, warehouseId]).catch(() => null);
          } else {
            throw fallbackError;
          }
        }
      } else {
        throw error;
      }
    }

    if (access) {
      return access;
    }

    // Check if auto-assignment from branches is enabled
    let autoAssignEnabled = true; // Default to true for backward compatibility
    try {
      const setting = await queryOne<{ auto_assign_branch_warehouses: boolean }>(`
        SELECT auto_assign_branch_warehouses
        FROM business_settings
        WHERE business_id = $1
      `, [user.business_id]);
      autoAssignEnabled = setting?.auto_assign_branch_warehouses ?? true;
    } catch (error) {
      // If column doesn't exist yet, default to true (backward compatibility)
      console.warn('auto_assign_branch_warehouses setting not found, defaulting to true');
    }

    // Only check branch-based access if auto-assignment is enabled
    if (autoAssignEnabled) {
      // Check if user has branch access, and warehouse is linked to that branch
      const branchWarehouseAccess = await queryOne<{ warehouse_id: string }>(`
        SELECT bw.warehouse_id
        FROM branch_warehouses bw
        JOIN user_branches ub ON bw.branch_id = ub.branch_id
        WHERE ub.user_id = $1
          AND bw.warehouse_id = $2
          AND ub.can_create_transactions = true
      `, [userId, warehouseId]);

      if (branchWarehouseAccess) {
        // User has branch access, grant warehouse access
        return {
          warehouse_id: warehouseId,
          can_view: true,
          can_edit: false, // Edit requires explicit warehouse permission
          can_create_transactions: true
        };
      }
    }

    return null;
  } catch (error) {
    console.error('Error checking user warehouse access:', error);
    return null;
  }
}

/**
 * Check if user has specific permission for a warehouse
 */
export async function checkUserWarehousePermission(
  userId: string,
  warehouseId: string,
  permission: 'view' | 'edit' | 'create_transactions'
): Promise<boolean> {
  try {
    const access = await checkUserWarehouseAccess(userId, warehouseId);
    if (!access) {
      return false;
    }

    switch (permission) {
      case 'view':
        return access.can_view;
      case 'edit':
        return access.can_edit;
      case 'create_transactions':
        return access.can_create_transactions;
      default:
        return false;
    }
  } catch (error) {
    console.error('Error checking user warehouse permission:', error);
    return false;
  }
}

/**
 * Check if warehouse is accessible by branch
 */
export async function isWarehouseAccessibleByBranch(
  warehouseId: string,
  branchId: string
): Promise<boolean> {
  try {
    const result = await queryOne<{ is_warehouse_accessible_by_branch: boolean }>(`
      SELECT is_warehouse_accessible_by_branch($1, $2) as is_warehouse_accessible_by_branch
    `, [warehouseId, branchId]);

    return result?.is_warehouse_accessible_by_branch || false;
  } catch (error) {
    console.error('Error checking warehouse-branch accessibility:', error);
    // Fallback: check manually
    const check = await queryOne<{ accessible: boolean }>(`
      SELECT EXISTS(
        SELECT 1
        FROM warehouses w
        JOIN branches b ON w.business_id = b.business_id
        WHERE w.id = $1
          AND b.id = $2
          AND (
            EXISTS (
              SELECT 1 FROM branch_warehouses bw
              WHERE bw.warehouse_id = $1 AND bw.branch_id = $2
            )
            OR w.branch_id = $2
            OR w.branch_id IS NULL
          )
      ) as accessible
    `, [warehouseId, branchId]);

    return check?.accessible || false;
  }
}

/**
 * Get default warehouse for a branch
 */
export async function getDefaultWarehouseForBranch(
  branchId: string
): Promise<string | null> {
  try {
    const result = await queryOne<{ get_default_warehouse_for_branch: string }>(`
      SELECT get_default_warehouse_for_branch($1) as get_default_warehouse_for_branch
    `, [branchId]);

    return result?.get_default_warehouse_for_branch || null;
  } catch (error) {
    console.error('Error getting default warehouse for branch:', error);
    // Fallback: manual query
    const warehouse = await queryOne<{ id: string }>(`
      SELECT w.id
      FROM warehouses w
      JOIN branch_warehouses bw ON w.id = bw.warehouse_id
      WHERE bw.branch_id = $1
        AND bw.is_primary = true
        AND w.is_active = true
      LIMIT 1
    `, [branchId]);

    return warehouse?.id || null;
  }
}

/**
 * Assert user has permission for a warehouse (throws error if not)
 */
export async function assertUserWarehousePermission(
  userId: string,
  warehouseId: string,
  permission: 'view' | 'edit' | 'create_transactions'
): Promise<void> {
  const hasPermission = await checkUserWarehousePermission(userId, warehouseId, permission);
  
  if (!hasPermission) {
    throw new Error(`User does not have ${permission} permission for this warehouse`);
  }
}

/**
 * Get all warehouses a user can access
 */
export async function getUserWarehouses(userId: string): Promise<WarehouseAccess[]> {
  try {
    const user = await queryOne<{ business_id: string; is_primary_admin: boolean }>(`
      SELECT business_id, is_primary_admin FROM users WHERE id = $1
    `, [userId]);

    if (!user) {
      return [];
    }

    // Primary admin bypass: Return all warehouses for the business
    if (user.is_primary_admin) {
      const allWarehouses = await queryRows<{ id: string }>(`
        SELECT id FROM warehouses 
        WHERE business_id = $1 AND is_active = true
      `, [user.business_id]);

      return allWarehouses.map(w => ({
        warehouse_id: w.id,
        can_view: true,
        can_edit: true,
        can_create_transactions: true,
      }));
    }

    // Get explicit warehouse access
    // Handle both old schema (can_transfer, can_adjust) and new schema (can_create_transactions)
    let explicitAccess: any[] = [];
    try {
      // Try new schema first
      explicitAccess = await queryRows<any>(`
        SELECT uw.warehouse_id, uw.can_view, uw.can_edit, uw.can_create_transactions
        FROM user_warehouses uw
        JOIN warehouses w ON uw.warehouse_id = w.id
        WHERE uw.user_id = $1
          AND w.business_id = $2
      `, [userId, user.business_id]);
    } catch (error: any) {
      // If column doesn't exist, try old schema
      if (error.code === '42703' || error.message?.includes('can_create_transactions')) {
        try {
          explicitAccess = await queryRows<any>(`
            SELECT 
              warehouse_id, 
              can_view, 
              can_edit,
              (COALESCE(can_transfer, false) OR COALESCE(can_adjust, false)) as can_create_transactions
            FROM user_warehouses
            WHERE user_id = $1
          `, [userId]);
        } catch (fallbackError: any) {
          // If old columns don't exist either, use minimal query
          if (fallbackError.code === '42703') {
            explicitAccess = await queryRows<any>(`
              SELECT warehouse_id, can_view, can_edit, false as can_create_transactions
              FROM user_warehouses
              WHERE user_id = $1
            `, [userId]).catch(() => []);
          } else {
            console.error('Error fetching explicit warehouse access:', fallbackError);
            explicitAccess = [];
          }
        }
      } else {
        console.error('Error fetching explicit warehouse access:', error);
        explicitAccess = [];
      }
    }

    // Check if auto-assignment from branches is enabled
    let autoAssignEnabled = true; // Default to true for backward compatibility
    try {
      const setting = await queryOne<{ auto_assign_branch_warehouses: boolean }>(`
        SELECT auto_assign_branch_warehouses
        FROM business_settings
        WHERE business_id = $1
      `, [user.business_id]);
      autoAssignEnabled = setting?.auto_assign_branch_warehouses ?? true;
    } catch (error) {
      // If column doesn't exist yet, default to true (backward compatibility)
      console.warn('auto_assign_branch_warehouses setting not found, defaulting to true');
    }

    // Get warehouse access via branch access (only if auto-assignment is enabled)
    let branchWarehouses: WarehouseAccess[] = [];
    if (autoAssignEnabled) {
      branchWarehouses = await queryRows<WarehouseAccess>(`
        SELECT DISTINCT
          bw.warehouse_id,
          true as can_view,
          false as can_edit,
          CASE WHEN ub.can_create_transactions THEN true ELSE false END as can_create_transactions
        FROM branch_warehouses bw
        JOIN user_branches ub ON bw.branch_id = ub.branch_id
        JOIN warehouses w ON bw.warehouse_id = w.id
        WHERE ub.user_id = $1
          AND w.is_active = true
      `, [userId]);
    }

    // Merge and deduplicate (explicit access takes precedence)
    const accessMap = new Map<string, WarehouseAccess>();
    
    // Add branch-based access
    branchWarehouses.forEach(wa => {
      accessMap.set(wa.warehouse_id, wa);
    });

    // Override with explicit access
    explicitAccess.forEach(wa => {
      accessMap.set(wa.warehouse_id, wa);
    });

    return Array.from(accessMap.values());
  } catch (error) {
    console.error('Error getting user warehouses:', error);
    return [];
  }
}

/**
 * Stock information for a warehouse
 */
export interface WarehouseStockInfo {
  warehouse_id: string;
  warehouse_name: string;
  warehouse_code?: string;
  available_stock: number;
  is_active: boolean;
}

/**
 * Get stock across all warehouses for an item
 * Used to show users where stock is available when it's insufficient in selected warehouse
 */
export async function getItemStockAcrossWarehouses(
  itemId: string,
  businessId: string,
  variantId?: string
): Promise<WarehouseStockInfo[]> {
  try {
    let sql = `
      SELECT 
        w.id as warehouse_id,
        w.name as warehouse_name,
        w.warehouse_code,
        w.is_active,
        COALESCE(ls.current_stock_qty, 0) as available_stock
      FROM warehouses w
      LEFT JOIN location_stock ls ON w.id = ls.location_id AND ls.item_id = $1
      WHERE w.business_id = $2
        AND w.is_active = true
    `;
    
    const params: any[] = [itemId, businessId];
    
    if (variantId) {
      sql += ` AND ls.variant_id = $3`;
      params.push(variantId);
    } else {
      sql += ` AND (ls.variant_id IS NULL OR ls.variant_id IS NULL)`;
    }
    
    sql += ` ORDER BY ls.current_stock_qty DESC NULLS LAST, w.name ASC`;
    
    const warehouses = await queryRows<WarehouseStockInfo>(sql, params);
    return warehouses;
  } catch (error) {
    console.error('Error getting item stock across warehouses:', error);
    return [];
  }
}