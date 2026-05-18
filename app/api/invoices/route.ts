import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, getPool } from '@/lib/db';
import { Invoice } from '@/types/database';
import { checkLowStockForMultipleItems } from '@/lib/low-stock-checker';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { adjustBranchVariantStock, refreshVariantGlobalStockFromBranches, getBranchVariantQuantityDb } from '@/lib/branch-variant-stock';
import { createInvoiceLedgerEntries } from '@/lib/ledger-utils';
import { allocateStockOnSale } from '@/lib/stock-valuation';
import {
  deductBundleChildrenOnInvoice,
  getFirstBundleStockPreflightFailure,
  InvoiceBundleStockError,
  type BundleDeductionContext,
} from '@/lib/invoice-bundle-stock';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { calculateCreditMetrics, calculateProjectedCreditMetrics, getCreditWarningMessage } from '@/lib/credit-utils';
import { checkAndSendCreditAlerts } from '@/lib/credit-alerts';
import { FeatureKeys } from '@/lib/featureKeys';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import {
  getClosingStockLockedCutoffDate,
  assertDocumentDateNotBeforeLockedClosingStock,
  ClosingStockPeriodLockedError,
} from '@/lib/closing-stock-period-lock';
import { deriveInvoicePaymentStatus } from '@/lib/invoice-payment-status';
import { shouldUseSoftDelete } from '@/lib/soft-delete-entitlements';
import {
  applyOffers,
  type AppliedOfferLine,
  type OfferInvoiceItem,
  type OfferRecord,
} from '@/lib/offer-engine';
import {
  isOfferTypeAllowedForBusiness,
  loadKnownPromotionRegistryIds,
} from '@/lib/offer-feature-gate';
import { getEnabledFeatures } from '@/lib/subscription/feature-access';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }
    
    // AUTHORIZATION: Check read permission (PBAC will check branch access)
    try {
      await authorize(userId, 'invoices', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }
    
    const branchId = searchParams.get('branch_id'); // Optional: filter by specific branch
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || 'all';
    const agingDaysMin = searchParams.get('aging_days_min');
    const agingDaysMax = searchParams.get('aging_days_max');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Get user's accessible branch IDs if userId provided
    let accessibleBranchIds: string[] | null = null;
    let isAdmin = false;
    if (userId) {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
      
      // Check if user is admin (has settings.read permission or is primary admin)
      try {
        const { checkUserPermission } = await import('@/lib/permissions');
        isAdmin = await checkUserPermission(userId, 'settings', 'read');
      } catch (error) {
        // If permission check fails, assume not admin
        isAdmin = false;
      }
      
      // If admin check fails, try checking is_primary_admin
      if (!isAdmin) {
        try {
          const user = await queryOne<{ is_primary_admin: boolean }>(
            'SELECT is_primary_admin FROM users WHERE id = $1',
            [userId]
          );
          isAdmin = user?.is_primary_admin || false;
        } catch (error) {
          // Ignore error
        }
      }
    }

    let sql = `
      SELECT 
        i.*,
        c.name as customer_name,
        c.phone as customer_phone,
        CASE 
          WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND (i.grand_total - COALESCE(i.paid_amount, 0)) > 0 
            THEN CURRENT_DATE - i.due_date
          WHEN i.due_date IS NULL AND i.invoice_date < CURRENT_DATE AND (i.grand_total - COALESCE(i.paid_amount, 0)) > 0
            THEN CURRENT_DATE - i.invoice_date
          ELSE 0
        END as days_overdue
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id AND c.deleted_at IS NULL
      WHERE i.business_id = $1
        AND i.deleted_at IS NULL
        AND i.status != 'cancelled'
        AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
    `;
    const params: any[] = [businessId];

    // Filter by branch if specified
    if (branchId && branchId !== 'ALL' && branchId !== 'all') {
      sql += ` AND i.branch_id = $${params.length + 1}`;
      params.push(branchId);
    } else if (accessibleBranchIds !== null && !isAdmin) {
      // Non-admin users: Filter by user's accessible branches
      if (accessibleBranchIds.length === 0) {
        // User has no branch access - return empty result
        return NextResponse.json({ 
          invoices: [],
          pagination: { page: 1, limit: 25, total: 0, totalPages: 0 }
        });
      }
      sql += ` AND i.branch_id = ANY($${params.length + 1})`;
      params.push(accessibleBranchIds);
    }
    // Admin users with no branchId filter: Show all branches (no additional WHERE clause)

    // Add search filter
    if (search) {
      sql += ` AND (i.invoice_number ILIKE $${params.length + 1} OR c.name ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }

    // Add status filter
    if (status !== 'all') {
      if (status === 'unpaid') {
        // For receivables (unpaid invoices), only show finalized invoices and exclude proforma
        sql += ` AND i.payment_status IN ('unpaid', 'partially_paid')`;
        sql += ` AND i.status = 'final'`;
        sql += ` AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')`;
      } else if (status === 'paid') {
        sql += ` AND i.payment_status = 'paid'`;
      } else {
        sql += ` AND i.status = $${params.length + 1}`;
        params.push(status);
      }
    }

    // Add date filter
    // When filtering by date (e.g., from sales chart), only show finalized invoices and exclude proforma
    let hasDateFilter = false;
    if (dateFrom) {
      sql += ` AND DATE(i.invoice_date) >= DATE($${params.length + 1})`;
      params.push(dateFrom);
      hasDateFilter = true;
    }
    if (dateTo) {
      sql += ` AND DATE(i.invoice_date) <= DATE($${params.length + 1})`;
      params.push(dateTo);
      hasDateFilter = true;
    }
    
    // For sales queries (date-based from chart clicks), exclude proforma and only show finalized
    // Only add this if we haven't already added it for unpaid status
    if (hasDateFilter && status !== 'unpaid') {
      sql += ` AND i.status = 'final'`;
      sql += ` AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')`;
    }

    // Add aging filter (only show invoices with outstanding balance when aging is requested)
    // When aging filter is present, this is a receivables query - exclude proforma and only show finalized
    if (agingDaysMin !== null && agingDaysMax !== null) {
      sql += ` AND i.status = 'final'`;
      sql += ` AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')`;
      sql += ` AND (i.grand_total - COALESCE(i.paid_amount, 0)) > 0 AND (
        CASE 
          WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE 
            THEN CURRENT_DATE - i.due_date
          WHEN i.due_date IS NULL AND i.invoice_date < CURRENT_DATE
            THEN CURRENT_DATE - i.invoice_date
          ELSE 0
        END
      ) >= $${params.length + 1} AND (
        CASE 
          WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE 
            THEN CURRENT_DATE - i.due_date
          WHEN i.due_date IS NULL AND i.invoice_date < CURRENT_DATE
            THEN CURRENT_DATE - i.invoice_date
          ELSE 0
        END
      ) <= $${params.length + 2}`;
      params.push(parseInt(agingDaysMin), parseInt(agingDaysMax));
    }

    // Add pagination
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '25'); // Set to 25 per page for better performance
    const offset = (page - 1) * limit;

    // Get total count for pagination
    const countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
    const countResult = await queryOne<{ total: number }>(countSql, params);
    const total = countResult?.total || 0;

    sql += ` ORDER BY i.invoice_date DESC, i.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const invoices = await queryRows<Invoice & { customer_name?: string; customer_phone?: string }>(sql, params);

    const normalizedInvoices = invoices.map((inv) => {
      if (inv.status === 'cancelled') return inv;
      const p = deriveInvoicePaymentStatus(inv.grand_total, inv.paid_amount, inv.balance_amount);
      return p !== inv.payment_status ? { ...inv, payment_status: p } : inv;
    });

    return NextResponse.json({ 
      invoices: normalizedInvoices,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching invoices:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Reuse the same column list and parameter order as INSERT for UPDATE ... WHERE id, business_id.
 */
function buildInvoiceUpdateSql(insertSql: string): string {
  const colMatch = insertSql.match(/INSERT INTO invoices\s*\(\s*([\s\S]*?)\s*\)\s*VALUES/i);
  if (!colMatch) {
    throw new Error('[InvoiceAPI] Could not parse INSERT INTO invoices for UPDATE conversion');
  }
  const cols = colMatch[1]
    .split(',')
    .map((c) => c.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const n = cols.length;
  const setClause = cols.map((col, i) => `${col} = $${i + 1}`).join(', ');
  return `UPDATE invoices SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $${n + 1} AND business_id = $${n + 2} RETURNING *`;
}

export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();
  
  // Check if batch/serial tracking columns exist (migration 077)
  let hasBatchTrackingColumns = false;
  try {
    const colCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'items' 
      AND column_name IN ('track_batch', 'track_serial', 'valuation_method')
      LIMIT 1
    `);
    hasBatchTrackingColumns = colCheck.rows.length > 0;
    // Batch tracking columns check completed
  } catch (err) {
    // If check fails, assume columns don't exist
    hasBatchTrackingColumns = false;
    // Batch tracking check failed, assuming false
  }
  
  // Check if export compliance columns exist (migration 087)
  let hasExportColumns = false;
  try {
    const exportColCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'invoices' 
      AND column_name IN ('invoice_currency', 'exchange_rate', 'country_of_origin')
      LIMIT 1
    `);
    hasExportColumns = exportColCheck.rows.length > 0;
    // Export columns check completed
  } catch (err) {
    // If check fails, assume columns don't exist
    hasExportColumns = false;
    // Export columns check failed, assuming false
  }
  
  try {
    const body = await request.json();
    const invoiceId = (body as { id?: string }).id;
    const business_id = getSessionScopedBusinessId(request);

    const {
      branch_id, // MANDATORY: Branch (accounting entity) that issues this invoice
      customer_id,
      invoice_date,
      due_date,
      items,
      discount_total = 0,
      additional_charges = 0,
      notes,
      terms,
      template_id,
      template_settings,
      status = 'draft',
      payment, // Optional single payment object (deprecated, use payments array)
      payments, // Optional array of payment objects
      billing_address,
      shipping_address,
      place_of_supply_state_code,
      document_type = 'tax_invoice',
      is_export = false, // New field for export invoices
      supply_type,
      export_type,
      shipping_bill_number,
      shipping_bill_date,
      port_code,
      ecommerce_operator_gstin,
      is_ecommerce_supply,
      created_by, // User ID who created the invoice
      // Additional export compliance fields
      invoice_currency,
      exchange_rate,
      country_of_origin,
      port_of_loading,
      port_of_discharge,
      place_of_delivery,
      incoterms,
      transport_mode,
      awb_number,
      bl_number,
      buyer_tax_id,
      lut_declaration,
      // Additional fields
      eway_bill_number,
      eway_bill_date,
      purchase_order_number,
      purchase_order_date,
      reference_number,
      delivery_note,
      payment_terms,
      other_references,
      dispatched_through,
      destination,
      terms_of_delivery,
      enable_round_off,
      attachments,
      round_off,
      request_id,
      // Estimates/Quotations fields for proforma invoices
      expiry_date,
      estimate_status
    } = body;

    const actorUserId = getUserIdFromRequest(request, body);
    if (!actorUserId) {
      return NextResponse.json(
        { error: 'Authentication required for invoice actions' },
        { status: 400 }
      );
    }
    if (
      created_by != null &&
      String(created_by).trim() !== '' &&
      String(created_by).trim() !== actorUserId
    ) {
      return NextResponse.json(
        { error: 'created_by must match the signed-in user', code: 'ACTOR_MISMATCH' },
        { status: 403 }
      );
    }

    if (!business_id || !items || items.length === 0) {
      return NextResponse.json(
        { error: 'Active business scope and items are required' },
        { status: 400 }
      );
    }

    if (invoice_date) {
      try {
        const cutoff = await getClosingStockLockedCutoffDate(business_id);
        assertDocumentDateNotBeforeLockedClosingStock(String(invoice_date).slice(0, 10), cutoff);
      } catch (e) {
        if (e instanceof ClosingStockPeriodLockedError) {
          return NextResponse.json(
            { error: e.message, code: 'CLOSING_STOCK_PERIOD_LOCKED', cutoff: e.cutoffDate },
            { status: 409 }
          );
        }
        throw e;
      }
    }

    // CRITICAL: Enforce access boundary - reject attendance-only employees
    const { checkEmployeeAccessBoundary } = await import('@/lib/access-boundary');
    const accessCheck = await checkEmployeeAccessBoundary(actorUserId, 'portal');
    if (!accessCheck.allowed) {
      return NextResponse.json(
        { error: accessCheck.reason, code: 'ACCESS_DENIED' },
        { status: 403 }
      );
    }

    try {
      if (invoiceId) {
        await authorize(actorUserId, 'invoices', 'update', {
          branchId: branch_id,
          businessId: business_id,
          resourceId: invoiceId,
          invoice_date: invoice_date,
        });
      } else {
        await authorize(actorUserId, 'invoices', 'create', { 
          branchId: branch_id,
          businessId: business_id,
          invoice_date: invoice_date,
        });
      }
    } catch (error) {
      console.error('[InvoiceAPI] Authorization check failed:', error);
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // CRITICAL: Resolve branch_id using helper (handles default branch fallback)
    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branch_id,
        businessId: business_id,
      });
    } catch (error: any) {
      console.error('[InvoiceAPI] Branch ID resolution failed:', error);
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }
      throw error;
    }

    // PBAC: Check warehouse access for each item (if warehouse mode enabled)
    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(business_id);
    
    if (warehouseModeEnabled && actorUserId) {
      const { checkUserWarehouseAccess } = await import('@/lib/warehouse-access');
      
      for (const item of items) {
        if (!item.item_id || !item.location_id) continue;
        
        const warehouseAccess = await checkUserWarehouseAccess(actorUserId, item.location_id);
        
        if (!warehouseAccess?.can_create_transactions) {
          return NextResponse.json(
            { 
              error: `No access to warehouse. You do not have permission to create transactions in warehouse for item "${item.item_name || item.item_id}".`,
              item_id: item.item_id,
              item_name: item.item_name,
              warehouse_id: item.location_id,
              code: 'WAREHOUSE_ACCESS_DENIED'
            },
            { status: 403 }
          );
        }
      }
    }

    // CRITICAL: Validate warehouse-branch relationships and check stock availability
    // This must happen BEFORE transaction starts to avoid partial commits
    // For proforma invoices, stock warnings are collected but don't block creation
    // Check stock for both 'final' and 'draft' status to warn users early
    const stockWarnings: Array<{
      item_name: string;
      item_id: string;
      warehouse_id?: string;
      warehouse_name?: string;
      available_stock: number;
      requested_quantity: number;
      other_warehouses?: Array<{ warehouse_name: string; available_stock: number }>;
      total_available?: number;
    }> = [];
    
    // Check stock for final status (blocks regular invoices) or draft status (warns proforma invoices)
    const shouldCheckStock = status === 'final' || (status === 'draft' && document_type === 'proforma_invoice');

    if (shouldCheckStock) {
      if (warehouseModeEnabled) {
        const { isWarehouseAccessibleByBranch, getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
        const { getEffectiveAllowSaleWhenOutOfStock } = await import('@/lib/inventory-sales-policy');

        for (const item of items) {
          if (!item.item_id) continue;

          let warehouseId: string | null | undefined = item.location_id as string | undefined;
          if (!warehouseId) {
            warehouseId = await getDefaultWarehouseForBranch(finalBranchId);
          }

          const itemHeadRes = await client.query(
            `SELECT item_type, COALESCE(is_bundle, false) AS is_bundle FROM items WHERE id = $1 AND business_id = $2`,
            [item.item_id, business_id]
          );
          const itemHead = itemHeadRes.rows[0];
          if (itemHead?.item_type === 'goods' && itemHead.is_bundle) {
            if (!warehouseId) {
              return NextResponse.json(
                {
                  error: `location_id (warehouse) is required for bundle "${item.item_name || item.item_id}". Warehouse mode is enabled.`,
                  item_id: item.item_id,
                  code: 'WAREHOUSE_REQUIRED',
                },
                { status: 400 }
              );
            }
            const isAccessibleBundle = await isWarehouseAccessibleByBranch(warehouseId, finalBranchId);
            if (!isAccessibleBundle) {
              return NextResponse.json(
                {
                  error: `Warehouse ${warehouseId} is not accessible by branch ${finalBranchId}. Please select a warehouse linked to this branch.`,
                  item_name: item.item_name || 'Unknown item',
                  warehouse_id: warehouseId,
                },
                { status: 400 }
              );
            }

            if (actorUserId) {
              const { checkUserWarehousePermission } = await import('@/lib/warehouse-access');
              const hasWarehouseAccessBundle = await checkUserWarehousePermission(
                actorUserId,
                warehouseId,
                'create_transactions'
              );
              if (!hasWarehouseAccessBundle) {
                return NextResponse.json(
                  {
                    error: `User does not have permission to create transactions for warehouse ${warehouseId}.`,
                    item_name: item.item_name || 'Unknown item',
                    warehouse_id: warehouseId,
                  },
                  { status: 403 }
                );
              }
            }

            const bundleFail = await getFirstBundleStockPreflightFailure({
              businessId: business_id,
              branchId: finalBranchId,
              bundleItemId: item.item_id,
              lineQuantity: parseFloat(String(item.quantity || '0')),
              warehouseModeEnabled: true,
              warehouseId,
            });
            if (bundleFail) {
              if (document_type === 'proforma_invoice') {
                stockWarnings.push({
                  item_name: bundleFail.name,
                  item_id: bundleFail.itemId,
                  warehouse_id: warehouseId,
                  warehouse_name: undefined,
                  available_stock: bundleFail.available,
                  requested_quantity: bundleFail.need,
                });
              } else {
                return NextResponse.json(
                  {
                    error: `Insufficient stock for component: ${bundleFail.name}`,
                    item_name: bundleFail.name,
                    item_id: bundleFail.itemId,
                    available_stock: bundleFail.available,
                    requested_quantity: bundleFail.need,
                    warehouse_id: warehouseId,
                  },
                  { status: 400 }
                );
              }
            }
            continue;
          }

          if (warehouseId) {
            const isAccessible = await isWarehouseAccessibleByBranch(warehouseId, finalBranchId);
            if (!isAccessible) {
              return NextResponse.json(
                {
                  error: `Warehouse ${warehouseId} is not accessible by branch ${finalBranchId}. Please select a warehouse linked to this branch.`,
                  item_name: item.item_name || 'Unknown item',
                  warehouse_id: warehouseId,
                },
                { status: 400 }
              );
            }

            if (actorUserId) {
              const { checkUserWarehousePermission } = await import('@/lib/warehouse-access');
              const hasWarehouseAccess = await checkUserWarehousePermission(
                actorUserId,
                warehouseId,
                'create_transactions'
              );
              if (!hasWarehouseAccess) {
                return NextResponse.json(
                  {
                    error: `User does not have permission to create transactions for warehouse ${warehouseId}.`,
                    item_name: item.item_name || 'Unknown item',
                    warehouse_id: warehouseId,
                  },
                  { status: 403 }
                );
              }
            }

            const itemTypeRes = await client.query(
              `SELECT item_type FROM items WHERE id = $1 AND business_id = $2`,
              [item.item_id, business_id]
            );

            if (itemTypeRes.rows.length > 0 && itemTypeRes.rows[0].item_type === 'goods') {
              const allowOversell = await getEffectiveAllowSaleWhenOutOfStock(business_id, item.item_id);
              if (allowOversell) {
                continue;
              }
              const stockCheck = await client.query(
                `SELECT current_stock_qty FROM location_stock WHERE location_id = $1 AND item_id = $2`,
                [warehouseId, item.item_id]
              );
              const availableStock = parseFloat(stockCheck.rows[0]?.current_stock_qty || '0');
              const requestedQuantity = parseFloat(String(item.quantity || '0'));

              if (availableStock < requestedQuantity) {
                const { getItemStockAcrossWarehouses } = await import('@/lib/warehouse-access');
                const allWarehouseStock = await getItemStockAcrossWarehouses(
                  item.item_id,
                  business_id,
                  item.variant_id
                );
                const currentWarehouse = allWarehouseStock.find((w) => w.warehouse_id === warehouseId);
                const otherWarehouses = allWarehouseStock
                  .filter((w) => w.warehouse_id !== warehouseId && w.available_stock > 0)
                  .map((w) => ({
                    warehouse_id: w.warehouse_id,
                    warehouse_name: w.warehouse_name,
                    warehouse_code: w.warehouse_code,
                    available_stock: w.available_stock,
                  }));
                const totalAvailableStock = allWarehouseStock.reduce((sum, w) => sum + w.available_stock, 0);

                if (document_type === 'proforma_invoice') {
                  stockWarnings.push({
                    item_name: item.item_name || 'Unknown item',
                    item_id: item.item_id,
                    warehouse_id: warehouseId,
                    warehouse_name: currentWarehouse?.warehouse_name || 'Unknown',
                    available_stock: availableStock,
                    requested_quantity: requestedQuantity,
                    other_warehouses: otherWarehouses,
                    total_available: totalAvailableStock,
                  });
                } else {
                  const errorMessage =
                    otherWarehouses.length > 0
                      ? `Insufficient stock in ${currentWarehouse?.warehouse_name || 'selected warehouse'}. Available: ${availableStock}, Requested: ${requestedQuantity}. Stock available in other warehouses: ${otherWarehouses.map((w) => `${w.warehouse_name} (${w.available_stock})`).join(', ')}`
                      : `Insufficient stock for item "${item.item_name || 'Unknown'}". Available: ${availableStock}, Requested: ${requestedQuantity}`;
                  return NextResponse.json(
                    {
                      error: errorMessage,
                      item_name: item.item_name || 'Unknown item',
                      item_id: item.item_id,
                      warehouse_id: warehouseId,
                      warehouse_name: currentWarehouse?.warehouse_name || 'Unknown',
                      available_stock: availableStock,
                      requested_quantity: requestedQuantity,
                      other_warehouses: otherWarehouses,
                      total_available: totalAvailableStock,
                    },
                    { status: 400 }
                  );
                }
              }
            }
          }
        }
      } else {
        const { getBranchItemQuantityDb } = await import('@/lib/branch-stock');
        const {
          tryReconcileBaseItemBranchStock,
          tryReconcileVariantBranchStock,
        } = await import('@/lib/reconcile-legacy-branch-stock');
        const { getEffectiveAllowSaleWhenOutOfStock } = await import('@/lib/inventory-sales-policy');
        for (const item of items) {
          if (!item.item_id) continue;
          const itemTypeRes = await client.query(
            `SELECT item_type, COALESCE(is_bundle, false) AS is_bundle FROM items WHERE id = $1 AND business_id = $2`,
            [item.item_id, business_id]
          );
          if (!itemTypeRes.rows[0] || itemTypeRes.rows[0].item_type !== 'goods') continue;

          if (itemTypeRes.rows[0].is_bundle) {
            const bundleFailBr = await getFirstBundleStockPreflightFailure({
              businessId: business_id,
              branchId: finalBranchId,
              bundleItemId: item.item_id,
              lineQuantity: parseFloat(String(item.quantity || '0')),
              warehouseModeEnabled: false,
              warehouseId: null,
            });
            if (bundleFailBr) {
              if (document_type === 'proforma_invoice') {
                stockWarnings.push({
                  item_name: bundleFailBr.name,
                  item_id: bundleFailBr.itemId,
                  available_stock: bundleFailBr.available,
                  requested_quantity: bundleFailBr.need,
                });
              } else {
                return NextResponse.json(
                  {
                    error: `Insufficient stock for component: ${bundleFailBr.name}`,
                    item_name: bundleFailBr.name,
                    item_id: bundleFailBr.itemId,
                    available_stock: bundleFailBr.available,
                    requested_quantity: bundleFailBr.need,
                    branch_id: finalBranchId,
                  },
                  { status: 400 }
                );
              }
            }
            continue;
          }

          const allowOversell = await getEffectiveAllowSaleWhenOutOfStock(business_id, item.item_id);
          if (allowOversell) {
            continue;
          }

          let availableStock = 0;
          if (item.variant_id) {
            availableStock = await getBranchVariantQuantityDb(business_id, finalBranchId, item.variant_id);
          } else {
            availableStock = await getBranchItemQuantityDb(business_id, finalBranchId, item.item_id);
          }
          const requestedQuantity = parseFloat(String(item.quantity || '0'));
          if (availableStock < requestedQuantity) {
            const healed = item.variant_id
              ? await tryReconcileVariantBranchStock(
                  business_id,
                  item.variant_id,
                  finalBranchId
                )
              : await tryReconcileBaseItemBranchStock(business_id, item.item_id, finalBranchId);
            if (healed) {
              if (item.variant_id) {
                availableStock = await getBranchVariantQuantityDb(
                  business_id,
                  finalBranchId,
                  item.variant_id
                );
              } else {
                availableStock = await getBranchItemQuantityDb(
                  business_id,
                  finalBranchId,
                  item.item_id
                );
              }
            }
          }
          if (availableStock < requestedQuantity) {
            if (document_type === 'proforma_invoice') {
              stockWarnings.push({
                item_name: item.item_name || 'Unknown item',
                item_id: item.item_id,
                available_stock: availableStock,
                requested_quantity: requestedQuantity,
              });
            } else {
              return NextResponse.json(
                {
                  error:
                    `Insufficient stock for item "${item.item_name || 'Unknown'}". ` +
                    `Available on this branch: ${availableStock}, requested: ${requestedQuantity}. ` +
                    `Invoices use stock for the selected branch only; the item list may show a business-wide total if branch rows are out of sync.`,
                  item_name: item.item_name || 'Unknown item',
                  item_id: item.item_id,
                  available_stock: availableStock,
                  requested_quantity: requestedQuantity,
                  branch_id: finalBranchId,
                },
                { status: 400 }
              );
            }
          }
        }
      }
    }

    // Determine template_id:
    // 1. If is_export = true, always use 'export_invoice' template
    // 2. Otherwise, use provided template_id or fetch from default settings
    let finalTemplateId = template_id;
    
    if (is_export) {
      // Export invoices must use export_invoice template
      finalTemplateId = 'export_invoice';
      // Export invoice detected, using export_invoice template
    } else if (!finalTemplateId) {
      // For non-export invoices, fetch from default settings
      try {
        const settingsRes = await client.query(
          `SELECT template_id FROM business_template_assignments 
           WHERE business_id = $1 AND document_type = 'tax_invoice'
           LIMIT 1`,
          [business_id]
        );
        if (settingsRes.rows.length > 0) {
          finalTemplateId = settingsRes.rows[0].template_id;
        }
      } catch (err) {
        console.error('Error fetching template assignment:', err);
      }
    }

    // Check if this is an update (has id) and if invoice is locked
    if (invoiceId) {
      const existingInvoice = await client.query(
        'SELECT is_editable FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
        [invoiceId, business_id]
      );
      
      if (existingInvoice.rows.length > 0 && existingInvoice.rows[0].is_editable === false) {
        // Get GSTR-1 filing info for better error message (scoped to this business)
        const filingInfo = await client.query(
          `SELECT f.filing_period 
           FROM gstr1_filings f
           JOIN gstr1_filing_invoices fi ON f.id = fi.gstr1_filing_id
           JOIN invoices inv ON inv.id = fi.invoice_id AND inv.business_id = $2 AND inv.deleted_at IS NULL
           WHERE fi.invoice_id = $1 AND f.status = 'filed'
           ORDER BY f.created_at DESC
           LIMIT 1`,
          [invoiceId, business_id]
        );
        
        const period = filingInfo.rows[0]?.filing_period;
        const errorMsg = period 
          ? `This invoice is locked because it was included in GSTR-1 filing for ${period}. It cannot be edited.`
          : 'This invoice is locked and cannot be edited.';
        
        return NextResponse.json({ error: errorMsg }, { status: 403 });
      }
    }

    const allowedStatus = ['draft', 'final', 'cancelled'];
    if (!allowedStatus.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
    try {
      await assertGstPeriodNotFiledForDocumentDate(business_id, finalBranchId, invoice_date, 'save invoice');
    } catch (error: any) {
      return NextResponse.json(
        {
          error: error.message || 'GST period is filed',
          code: 'GST_PERIOD_FILED',
        },
        { status: 403 }
      );
    }

    // CRITICAL: Check period lock BEFORE creating invoice
    const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
    try {
      await assertPeriodNotLocked(business_id, finalBranchId, invoice_date, 'invoice');
    } catch (error: any) {
      return NextResponse.json(
        { 
          error: error.message || 'Period is locked',
          code: 'PERIOD_LOCKED'
        },
        { status: 403 }
      );
    }

    // CRITICAL: Validate backdated entry
    const { validateBackdate, hasBackdateApprovalPermission } = await import('@/lib/backdate-controls');
    const backdateValidation = validateBackdate(invoice_date, 365, 30);
    
    if (backdateValidation.isBackdated) {
      if (backdateValidation.error) {
        return NextResponse.json(
          { 
            error: backdateValidation.error,
            code: 'BACKDATE_EXCEEDS_LIMIT',
            days_backdated: backdateValidation.daysBackdated
          },
          { status: 400 }
        );
      }
      
      if (backdateValidation.requiresApproval && actorUserId) {
        const hasApproval = await hasBackdateApprovalPermission(actorUserId, backdateValidation.daysBackdated);
        
        if (!hasApproval) {
          return NextResponse.json(
            { 
              error: `Backdated invoices > 30 days require approval. Invoice date is ${backdateValidation.daysBackdated} days old.`,
              code: 'BACKDATE_APPROVAL_REQUIRED',
              days_backdated: backdateValidation.daysBackdated
            },
            { status: 403 }
          );
        }
      }
    }

    const useSoftDeleteInvoicePayments = await shouldUseSoftDelete(business_id);

    // Start transaction FIRST, then check limit inside transaction with locking
    // This prevents race conditions where parallel requests bypass limits
    
    await client.query('BEGIN');

    let existingInvoiceRow: { invoice_number?: string; is_editable?: boolean; branch_id?: string } | null = null;
    if (invoiceId) {
      const lockRes = await client.query(
        `SELECT * FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [invoiceId, business_id]
      );
      const row = lockRes.rows[0] as
        | { invoice_number?: string; is_editable?: boolean; branch_id?: string }
        | undefined;
      if (!row) {
        await client.query('ROLLBACK').catch(() => {});
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      }
      existingInvoiceRow = row;
      if (row.is_editable === false) {
        await client.query('ROLLBACK').catch(() => {});
        return NextResponse.json(
          { error: 'This invoice is locked and cannot be edited.' },
          { status: 403 }
        );
      }
      if (row.branch_id !== finalBranchId) {
        await client.query('ROLLBACK').catch(() => {});
        return NextResponse.json(
          { error: 'Invoice branch does not match the selected branch.' },
          { status: 400 }
        );
      }
    }

    // Check subscription limits INSIDE transaction with advisory lock
    // This ensures atomic check-and-insert, preventing race conditions
    // Updates to an existing draft do not consume a new invoice slot.
    if (!invoiceId) {
      try {
        await enforceAccess({
          businessId: business_id,
          userId: actorUserId,
          branchId: finalBranchId,
          feature: FeatureKeys.INVOICE_CREATION,
          limitType: 'invoices',
          poolClient: client,
        });
      } catch (e) {
        const res = enforceAccessErrorResponse(e);
        if (res) {
          await client.query('ROLLBACK').catch(() => {});
          return res;
        }
        throw e;
      }
    }

    // Mapping of document types to prefixes and counter columns
    const DOCUMENT_TYPE_CONFIG: Record<string, { prefix: string; counterColumn: string }> = {
        'tax_invoice': { prefix: 'INV', counterColumn: 'next_tax_invoice_number' },
        'regular': { prefix: 'INV', counterColumn: 'next_tax_invoice_number' },
        'proforma_invoice': { prefix: 'PI', counterColumn: 'next_proforma_invoice_number' },
        'bill_of_supply': { prefix: 'BOS', counterColumn: 'next_tax_invoice_number' },
      };
      
      const finalDocumentType = document_type || 'tax_invoice';
      const config = DOCUMENT_TYPE_CONFIG[finalDocumentType] || DOCUMENT_TYPE_CONFIG['tax_invoice'];
    
    let invoiceNumber = '';

    if (!invoiceId) {
    // Check if invoice_number is provided in the body (pre-reserved)
    const providedInvoiceNumber = (body as any).invoice_number;
    
    // Fetch branch info for invoice numbering (branch-wise numbering)
    
    const branchRes = await client.query(
      `SELECT invoice_prefix, next_invoice_number, state_code 
       FROM branches WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [finalBranchId, business_id]
    );
    
    
    if (branchRes.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error('Branch not found');
    }
    
    const branch = branchRes.rows[0];
    
    // Determine the invoice number and increment counter atomically
    
    // Use branch-specific prefix for this document type if set, otherwise use document type prefix from config
    // This allows branches to have custom prefixes per document type (e.g., "INV-MUM" for Tax Invoice, "PI-MUM" for Proforma Invoice)
    let invoicePrefix = config.prefix;
    
    // Check for branch-specific prefix for this document type
    try {
      const branchPrefixResult = await client.query(
        `SELECT prefix FROM branch_document_prefixes 
         WHERE branch_id = $1 AND document_type = $2`,
        [finalBranchId, finalDocumentType]
      );
      
      if (branchPrefixResult.rows.length > 0) {
        invoicePrefix = branchPrefixResult.rows[0].prefix;
      }
    } catch (error: any) {
      // If table doesn't exist yet (migration not run), use document type default
      if (error.code !== '42P01') { // Only ignore "table does not exist" error
        throw error;
      }
      // Otherwise, continue with document type default prefix
    }
    
    // Get current counter value from branch (will be used for this invoice)
    const currentCounter = branch.next_invoice_number || 1;
    
    
    
    if (providedInvoiceNumber) {
      // Use provided number (from next-number API preview)
      // providedInvoiceNumber is just the numeric part (e.g., "001" or "1")
      let numStr = String(providedInvoiceNumber);
      // Remove leading zeros to get actual number, or parse as-is
      const numValue = parseInt(numStr, 10);
      // Format with branch prefix and minimum 3 digits padding
      invoiceNumber = `${invoicePrefix}-${String(numValue || currentCounter).padStart(3, '0')}`;
    } else {
      // Fallback: Use current counter value
      // Format with branch prefix and minimum 3 digits padding (but allows growth beyond 999)
      invoiceNumber = `${invoicePrefix}-${String(currentCounter).padStart(3, '0')}`;
    }
    
    
    
    // Check if invoice number already exists for this branch (matches database constraint)
    const existingInvoiceCheck = await client.query(
      'SELECT id FROM invoices WHERE invoice_number = $1 AND branch_id = $2 AND business_id = $3 AND deleted_at IS NULL',
      [invoiceNumber, finalBranchId, business_id]
    );
    
    // If duplicate exists for this branch, throw error before INSERT
    if (existingInvoiceCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { 
          error: `Invoice number ${invoiceNumber} already exists for this branch. Please try again.`,
          code: 'DUPLICATE_INVOICE_NUMBER'
        },
        { status: 409 }
      );
    }
    
    // NOW increment the branch counter atomically (only when actually saving the invoice)
    await client.query(`
      UPDATE branches 
      SET next_invoice_number = next_invoice_number + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND business_id = $2
    `, [finalBranchId, business_id]);
    } else {
      invoiceNumber = (existingInvoiceRow?.invoice_number as string) || '';
    }

    // Fetch business info (needed for state, etc)
    const businessRes = await client.query(
      `SELECT state_code, state FROM businesses WHERE id = $1`,
      [business_id]
    );
    
    
    if (businessRes.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error('Business not found');
    }
    
    const business = businessRes.rows[0];

    // Helper for state code (case-insensitive)
    const getStateCode = (stateName: string): string => {
      if (!stateName) return '';
      const name = stateName.trim().toLowerCase();
      const map: Record<string, string> = {
        'andhra pradesh': '37', 'karnataka': '29', 'tamil nadu': '33', 'maharashtra': '27',
        'gujarat': '24', 'rajasthan': '08', 'uttar pradesh': '09', 'west bengal': '19',
        'delhi': '07', 'telangana': '36', 'haryana': '06', 'punjab': '03', 'odisha': '21',
        'bihar': '10', 'madhya pradesh': '23', 'assam': '18', 'jharkhand': '20',
        'kerala': '32', 'chhattisgarh': '22', 'uttarakhand': '05', 'himachal pradesh': '02',
        'tripura': '16', 'manipur': '14', 'meghalaya': '17', 'mizoram': '15',
        'nagaland': '13', 'arunachal pradesh': '12', 'goa': '30', 'sikkim': '11',
        'andaman and nicobar islands': '35', 'chandigarh': '04',
        'dadra and nagar haveli and daman and diu': '26', 'jammu and kashmir': '01',
        'ladakh': '38', 'lakshadweep': '31', 'puducherry': '34'
      };
      return map[name] || '';
    };

    const businessStateCode = business.state_code || getStateCode(business.state || '');

    let invoiceItems: any[] = items;
    let appliedOffersPayload: AppliedOfferLine[] = [];
    try {
      const dateStr =
        invoice_date != null && String(invoice_date).trim() !== ''
          ? String(invoice_date).slice(0, 10)
          : new Date().toISOString().slice(0, 10);
      const stackingPolicy =
        process.env.OFFERS_STACKING_POLICY === 'single_best_priority'
          ? 'single_best_priority'
          : 'sequential';

      let offersRes;
      try {
        offersRes = await client.query(
          `SELECT id, type, condition_json, action_json, COALESCE(priority, 0) AS priority
           FROM offers
           WHERE business_id = $1
             AND is_active = true
             AND start_date <= $2::date
             AND end_date >= $2::date`,
          [business_id, dateStr]
        );
      } catch (inner: unknown) {
        const icode = (inner as { code?: string })?.code;
        if (icode !== '42703') throw inner;
        offersRes = await client.query(
          `SELECT id, type, condition_json, action_json
           FROM offers
           WHERE business_id = $1
             AND is_active = true
             AND start_date <= $2::date
             AND end_date >= $2::date`,
          [business_id, dateStr]
        );
      }

      const [enabledFeatureIds, knownRegistryIds] = await Promise.all([
        getEnabledFeatures(business_id),
        loadKnownPromotionRegistryIds(),
      ]);
      const gatedRows = (offersRes.rows as OfferRecord[]).filter((row) =>
        isOfferTypeAllowedForBusiness(row.type, enabledFeatureIds, knownRegistryIds)
      );
      const applied = applyOffers(items as OfferInvoiceItem[], gatedRows, { stackingPolicy });
      invoiceItems = applied.items as any[];
      appliedOffersPayload = applied.appliedOffers;
    } catch (offerErr: unknown) {
      const code = (offerErr as { code?: string })?.code;
      if (code === '42P01') {
        invoiceItems = items;
      } else {
        throw offerErr;
      }
    }

    // Calculate totals
    let subtotal = 0;
    let taxTotal = 0;
    let discountTotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    let igstTotal = 0;

    invoiceItems.forEach((item: any) => {
      const itemSubtotal = item.quantity * item.unit_price;
      const itemDiscount = (itemSubtotal * (item.discount_percent || 0)) / 100;
      const taxable = itemSubtotal - itemDiscount;

      let taxAmount = 0;
      let cgst = 0;
      let sgst = 0;
      let igst = 0;

      // Robust comparison
      if (place_of_supply_state_code && businessStateCode && place_of_supply_state_code === businessStateCode) {
        const half = (item.tax_rate || 0) / 2;
        cgst = taxable * half / 100;
        sgst = taxable * half / 100;
        taxAmount = cgst + sgst;
      } else {
        igst = (taxable * (item.tax_rate || 0)) / 100;
        taxAmount = igst;
      }

      subtotal += taxable;
      discountTotal += itemDiscount;
      taxTotal += taxAmount;
      cgstTotal += cgst;
      sgstTotal += sgst;
      igstTotal += igst;
    });

    const grandTotalRaw = subtotal + taxTotal + additional_charges;
    // Use provided round_off if available, otherwise calculate if enable_round_off is true
    let roundOff = round_off || 0;
    if (enable_round_off && !round_off) {
      roundOff = Math.round(grandTotalRaw) - grandTotalRaw;
    }
    const grandTotal = grandTotalRaw + roundOff;

    // Calculate payment status from payments array or single payment (for backward compatibility)
    let paidAmount = 0;
    let paymentEntries: Array<{ amount: number; mode?: string; date?: string; reference?: string }> = [];
    
    // Support both payments array (new) and single payment (legacy)
    if (payments && Array.isArray(payments) && payments.length > 0) {
      paymentEntries = payments;
    } else if (payment && payment.amount > 0) {
      // Legacy: single payment object
      paymentEntries = [payment];
    }

    if (status === 'cancelled' && paymentEntries.length > 0) {
      return NextResponse.json({ error: 'Cannot add payment to cancelled invoice' }, { status: 400 });
    }

    // Allow payments on draft or final (changed from only final)
    // Calculate total paid amount (existing draft saves may omit payments[] to avoid duplicate rows)
    if (paymentEntries.length > 0) {
      paidAmount = paymentEntries.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    } else if (invoiceId && (body as any).paid_amount != null) {
      paidAmount = Number((body as any).paid_amount) || 0;
    } else if (invoiceId && existingInvoiceRow) {
      paidAmount = Number((existingInvoiceRow as { paid_amount?: unknown }).paid_amount) || 0;
    }
    const balanceAmount = grandTotal - paidAmount;
    const paymentStatus = deriveInvoicePaymentStatus(grandTotal, paidAmount, balanceAmount);

    const isEditable = status === 'draft';

    // Auto-classify supply_type if not provided
    let finalSupplyType = supply_type;
    if (!finalSupplyType) {
      // Export/SEZ: Check place_of_supply_state_code or is_export flag (overrides other classifications)
      if (is_export || place_of_supply_state_code === '96') {
        finalSupplyType = 'export';
      } else if (place_of_supply_state_code === '97') {
        finalSupplyType = 'sez';
      }
      // For other types, check if customer has GSTIN (B2B)
      else if (customer_id) {
        const custRes = await client.query(
          'SELECT gstin FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
          [customer_id, business_id]
        );
        if (custRes.rows.length > 0 && custRes.rows[0].gstin) {
          finalSupplyType = 'b2b';
        } else {
          // B2C Large: Invoice value > ₹2.5 lakh
          if (grandTotal > 250000) {
            finalSupplyType = 'b2c_large';
          } else {
            // B2C Small: Invoice value <= ₹2.5 lakh
            finalSupplyType = 'b2c_small';
          }
        }
      } else {
        // No customer (cash sale) - default to B2C Small
        if (grandTotal > 250000) {
          finalSupplyType = 'b2c_large';
        } else {
          finalSupplyType = 'b2c_small';
        }
      }
    }

    // Check if estimate_status and expiry_date columns exist (from migration 139)
    let hasEstimateColumns = false;
    try {
      const colCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'invoices' 
        AND column_name IN ('estimate_status', 'expiry_date')
        LIMIT 1
      `);
      hasEstimateColumns = colCheck.rows.length > 0;
    } catch (err) {
      hasEstimateColumns = false;
    }

    // Set default estimate_status for proforma invoices
    const finalEstimateStatus = finalDocumentType === 'proforma_invoice' 
      ? (estimate_status || 'draft')
      : null;

    // Create invoice - conditionally include export fields and estimate fields based on column existence
    let invoiceSql: string;
    let invoiceParams: any[];
    
    if (hasExportColumns) {
      // Full INSERT with all export fields
      if (hasEstimateColumns) {
        // With export columns AND estimate columns
        invoiceSql = `
          INSERT INTO invoices (
            business_id, branch_id, customer_id, invoice_number, invoice_date, due_date,
            status, payment_status, subtotal, discount_total, additional_charges, tax_total,
            round_off, grand_total, paid_amount, balance_amount, notes, terms,
            template_id, template_settings, billing_address, shipping_address, place_of_supply_state_code,
            cgst_total, sgst_total, igst_total, is_editable, cancellation_details,
            document_type, supply_type, export_type, shipping_bill_number, shipping_bill_date, port_code,
            ecommerce_operator_gstin, is_ecommerce_supply, is_export, created_by,
            invoice_currency, exchange_rate, country_of_origin, port_of_loading, port_of_discharge,
            place_of_delivery, incoterms, transport_mode, awb_number, bl_number, buyer_tax_id, lut_declaration,
            eway_bill_number, eway_bill_date, purchase_order_number, purchase_order_date, reference_number,
            delivery_note, payment_terms, other_references, dispatched_through, destination, terms_of_delivery,
            enable_round_off, attachments, expiry_date, estimate_status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51, $52, $53, $54, $55, $56, $57, $58, $59, $60, $61, $62, $63, $64, $65)
          RETURNING *
        `;
      } else {
        // With export columns but NO estimate columns
      invoiceSql = `
        INSERT INTO invoices (
          business_id, branch_id, customer_id, invoice_number, invoice_date, due_date,
          status, payment_status, subtotal, discount_total, additional_charges, tax_total,
          round_off, grand_total, paid_amount, balance_amount, notes, terms,
          template_id, template_settings, billing_address, shipping_address, place_of_supply_state_code,
          cgst_total, sgst_total, igst_total, is_editable, cancellation_details,
          document_type, supply_type, export_type, shipping_bill_number, shipping_bill_date, port_code,
          ecommerce_operator_gstin, is_ecommerce_supply, is_export, created_by,
          invoice_currency, exchange_rate, country_of_origin, port_of_loading, port_of_discharge,
          place_of_delivery, incoterms, transport_mode, awb_number, bl_number, buyer_tax_id, lut_declaration,
          eway_bill_number, eway_bill_date, purchase_order_number, purchase_order_date, reference_number,
          delivery_note, payment_terms, other_references, dispatched_through, destination, terms_of_delivery,
          enable_round_off, attachments
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51, $52, $53, $54, $55, $56, $57, $58, $59, $60, $61, $62, $63)
        RETURNING *
      `;
      }
      invoiceParams = [
        business_id,
        finalBranchId,
        customer_id || null,
        invoiceNumber,
        invoice_date,
        due_date || null,
        status,
        paymentStatus,
        subtotal,
        discountTotal,
        additional_charges,
        taxTotal,
        roundOff,
        grandTotal,
        paidAmount,
        balanceAmount,
        notes || null,
        terms || null,
        finalTemplateId || null,
        template_settings ? JSON.stringify(template_settings) : null,
        billing_address || null,
        shipping_address || null,
        place_of_supply_state_code || null,
        cgstTotal,
        sgstTotal,
        igstTotal,
        isEditable,
        null,
        finalDocumentType,
        finalSupplyType || null,
        export_type || null,
        shipping_bill_number || null,
        shipping_bill_date || null,
        port_code || null,
        ecommerce_operator_gstin || null,
        is_ecommerce_supply || false,
        is_export || false,
        actorUserId || null,
        // Additional export compliance fields
        invoice_currency || 'INR',
        exchange_rate || null,
        country_of_origin || 'India',
        port_of_loading || null,
        port_of_discharge || null,
        place_of_delivery || null,
        incoterms || null,
        transport_mode || null,
        awb_number || null,
        bl_number || null,
        buyer_tax_id || null,
        lut_declaration || false,
        // Additional fields
        eway_bill_number || null,
        eway_bill_date || null,
        purchase_order_number || null,
        purchase_order_date || null,
        reference_number || null,
        delivery_note || null,
        payment_terms || null,
        other_references || null,
        dispatched_through || null,
        destination || null,
        terms_of_delivery || null,
        enable_round_off || false,
        attachments ? JSON.stringify(attachments) : null,
        ...(hasEstimateColumns ? [expiry_date || null, finalEstimateStatus] : [])
      ];
    } else {
      // INSERT without export fields (for databases without migration 087)
      if (hasEstimateColumns) {
        // Without export columns but WITH estimate columns
        invoiceSql = `
          INSERT INTO invoices (
            business_id, branch_id, customer_id, invoice_number, invoice_date, due_date,
            status, payment_status, subtotal, discount_total, additional_charges, tax_total,
            round_off, grand_total, paid_amount, balance_amount, notes, terms,
            template_id, template_settings, billing_address, shipping_address, place_of_supply_state_code,
            cgst_total, sgst_total, igst_total, is_editable, cancellation_details,
            document_type, supply_type, export_type, shipping_bill_number, shipping_bill_date, port_code,
            ecommerce_operator_gstin, is_ecommerce_supply, is_export, created_by,
            eway_bill_number, eway_bill_date, purchase_order_number, purchase_order_date, reference_number,
            delivery_note, payment_terms, other_references, dispatched_through, destination, terms_of_delivery,
            enable_round_off, attachments, expiry_date, estimate_status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51, $52, $53)
          RETURNING *
        `;
      } else {
        // Without export columns AND without estimate columns
      invoiceSql = `
        INSERT INTO invoices (
          business_id, branch_id, customer_id, invoice_number, invoice_date, due_date,
          status, payment_status, subtotal, discount_total, additional_charges, tax_total,
          round_off, grand_total, paid_amount, balance_amount, notes, terms,
          template_id, template_settings, billing_address, shipping_address, place_of_supply_state_code,
          cgst_total, sgst_total, igst_total, is_editable, cancellation_details,
          document_type, supply_type, export_type, shipping_bill_number, shipping_bill_date, port_code,
          ecommerce_operator_gstin, is_ecommerce_supply, is_export, created_by,
          eway_bill_number, eway_bill_date, purchase_order_number, purchase_order_date, reference_number,
          delivery_note, payment_terms, other_references, dispatched_through, destination, terms_of_delivery,
          enable_round_off, attachments
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51)
        RETURNING *
      `;
      }
      invoiceParams = [
        business_id,
        finalBranchId,
        customer_id || null,
        invoiceNumber,
        invoice_date,
        due_date || null,
        status,
        paymentStatus,
        subtotal,
        discountTotal,
        additional_charges,
        taxTotal,
        roundOff,
        grandTotal,
        paidAmount,
        balanceAmount,
        notes || null,
        terms || null,
        finalTemplateId || null,
        template_settings ? JSON.stringify(template_settings) : null,
        billing_address || null,
        shipping_address || null,
        place_of_supply_state_code || null,
        cgstTotal,
        sgstTotal,
        igstTotal,
        isEditable,
        null,
        finalDocumentType,
        finalSupplyType || null,
        export_type || null,
        shipping_bill_number || null,
        shipping_bill_date || null,
        port_code || null,
        ecommerce_operator_gstin || null,
        is_ecommerce_supply || false,
        is_export || false,
        actorUserId || null,
        // Additional fields
        eway_bill_number || null,
        eway_bill_date || null,
        purchase_order_number || null,
        purchase_order_date || null,
        reference_number || null,
        delivery_note || null,
        payment_terms || null,
        other_references || null,
        dispatched_through || null,
        destination || null,
        terms_of_delivery || null,
        enable_round_off || false,
        attachments ? JSON.stringify(attachments) : null,
        ...(hasEstimateColumns ? [expiry_date || null, finalEstimateStatus] : [])
      ];
    }

    const insertStartTime = Date.now();
    let invoiceRes;
    try {
      if (invoiceId) {
        await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [invoiceId]);
        const updateSql = buildInvoiceUpdateSql(invoiceSql);
        invoiceRes = await client.query(updateSql, [...invoiceParams, invoiceId, business_id]);
      } else {
        invoiceRes = await client.query(invoiceSql, invoiceParams);
      }
      if (!invoiceRes.rows || invoiceRes.rows.length === 0) {
        console.error('[InvoiceAPI] ❌ Invoice INSERT returned no rows');
        throw new Error('Invoice INSERT returned no rows - invoice was not created');
      }

      // INSERT successful
    } catch (insertError: any) {
      const insertDuration = Date.now() - insertStartTime;
      console.error('[InvoiceAPI] ❌ Invoice INSERT failed after', `${insertDuration}ms`);
      
      
      console.error('[Invoice Creation] INSERT failed:', insertError.message, insertError.code);
      throw insertError;
    }
    
    
    const invoice = invoiceRes.rows[0];
    
    // Invoice created successfully

    // Track items that have stock deducted for low stock checking
    const stockDeductedItems: Array<{ item_id: string; business_id: string }> = [];

    // Create invoice items
    for (let i = 0; i < invoiceItems.length; i++) {
      
      const item = invoiceItems[i];
      const itemSubtotal = item.quantity * item.unit_price;
      const itemDiscount = (itemSubtotal * (item.discount_percent || 0)) / 100;
      const taxable = itemSubtotal - itemDiscount;

      let taxAmount = 0;
      let cgst = 0;
      let sgst = 0;
      let igst = 0;

      // Calculate GST breakdown at line level
      if (place_of_supply_state_code && businessStateCode && place_of_supply_state_code === businessStateCode) {
        const half = (item.tax_rate || 0) / 2;
        cgst = taxable * half / 100;
        sgst = taxable * half / 100;
        taxAmount = cgst + sgst;
      } else {
        igst = (taxable * (item.tax_rate || 0)) / 100;
        taxAmount = igst;
      }

      const lineTotal = taxable + taxAmount;

      
      await client.query(`
        INSERT INTO invoice_items (
          invoice_id, item_id, variant_id, item_name, description, hsn_sac,
          quantity, unit, unit_price, discount_percent, discount_amount,
          tax_rate, tax_amount, taxable_value, cgst_amount, sgst_amount, igst_amount,
          line_total, sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `, [
        invoice.id,
        item.item_id || null,
        item.variant_id || null,
        item.item_name,
        item.description || null,
        item.hsn_sac || null,
        item.quantity,
        item.unit || 'PCS',
        item.unit_price,
        item.discount_percent || 0,
        itemDiscount,
        item.tax_rate || 0,
        taxAmount,
        taxable,
        cgst,
        sgst,
        igst,
        lineTotal,
        i,
      ]);
      

      // Update stock if status is final AND not a proforma invoice
      // Proforma invoices are estimates/quotes and don't affect stock
      if (status === 'final' && item.item_id && document_type !== 'proforma_invoice') {
        // Check if item is goods (services don't update stock)
        // Handle missing columns gracefully (if migration 077 hasn't run)
        let itemTypeRes;
        if (hasBatchTrackingColumns) {
          itemTypeRes = await client.query(
            `SELECT item_type, 
                    COALESCE(track_batch, false) as track_batch, 
                    COALESCE(track_serial, false) as track_serial, 
                    COALESCE(valuation_method, 'simple') as valuation_method,
                    COALESCE(is_bundle, false) as is_bundle
             FROM items WHERE id = $1 AND business_id = $2`,
            [item.item_id, business_id]
          );
        } else {
          itemTypeRes = await client.query(
            `SELECT item_type, COALESCE(is_bundle, false) as is_bundle
             FROM items WHERE id = $1 AND business_id = $2`,
            [item.item_id, business_id]
          );
          // Add default values for missing columns
          itemTypeRes.rows[0] = {
            ...itemTypeRes.rows[0],
            track_batch: false,
            track_serial: false,
            valuation_method: 'simple',
          };
        }
        const itemData = itemTypeRes.rows[0];
        const itemType = itemData?.item_type || 'goods';

        if (itemType === 'goods') {
          const trackBatch = itemData?.track_batch || false;
          const trackSerial = itemData?.track_serial || false;
          const valuationMethod = (itemData?.valuation_method || 'simple') as 'fifo' | 'lifo' | 'weighted_avg' | 'simple';
          const quantity = Number(item.quantity) || 0;

          // Bundle / combo: deduct component stock only (not the bundle SKU row)
          if (itemData?.is_bundle) {
            if (item.variant_id) {
              await client.query('ROLLBACK');
              return NextResponse.json(
                {
                  error: 'Bundle items cannot have a variant on the invoice line.',
                  item_id: item.item_id,
                  code: 'BUNDLE_VARIANT_NOT_ALLOWED',
                },
                { status: 400 }
              );
            }
            const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
            const warehouseModeEnabled = await isWarehouseModeEnabled(business_id);
            const bundleCtx: BundleDeductionContext = {
              client,
              businessId: business_id,
              branchId: finalBranchId,
              invoiceId: invoice.id,
              customerId: customer_id || null,
              warehouseModeEnabled,
              hasBatchTrackingColumns,
            };
            try {
              const childIds = await deductBundleChildrenOnInvoice(
                bundleCtx,
                item.item_id,
                quantity,
                item.location_id || null,
                item.item_name || item.item_id
              );
              for (const cid of childIds) {
                stockDeductedItems.push({ item_id: cid, business_id });
              }
            } catch (e) {
              if (e instanceof InvoiceBundleStockError) {
                await client.query('ROLLBACK');
                return NextResponse.json(e.body, { status: e.statusCode });
              }
              throw e;
            }
            continue;
          }

          // If variant_id exists, handle variant stock
          if (item.variant_id) {
            const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
            const warehouseModeEnabled = await isWarehouseModeEnabled(business_id);
            if (warehouseModeEnabled) {
              if (!item.location_id) {
                await client.query('ROLLBACK');
                return NextResponse.json(
                  {
                    error: `location_id (warehouse) is required for variant line "${item.item_name || item.item_id}".`,
                    item_id: item.item_id,
                    code: 'WAREHOUSE_REQUIRED',
                  },
                  { status: 400 }
                );
              }
              await client.query(
                `SELECT * FROM location_stock WHERE location_id = $1 AND item_id = $2 FOR UPDATE`,
                [item.location_id, item.item_id]
              );
              await client.query(
                `UPDATE location_stock
                 SET current_stock_qty = current_stock_qty - $1,
                     last_updated = CURRENT_TIMESTAMP
                 WHERE location_id = $2 AND item_id = $3`,
                [quantity, item.location_id, item.item_id]
              );
            } else {
              await adjustBranchVariantStock(client, business_id, finalBranchId, item.variant_id, -quantity);
              await refreshVariantGlobalStockFromBranches(client, business_id, item.variant_id);
            }

            let variantRes;
            if (hasBatchTrackingColumns) {
              variantRes = await client.query(
                `SELECT iv.*, 
                        COALESCE(i.track_batch, false) as track_batch, 
                        COALESCE(i.track_serial, false) as track_serial, 
                        COALESCE(i.valuation_method, 'simple') as valuation_method 
                 FROM item_variants iv
                 JOIN items i ON iv.item_id = i.id
                 WHERE iv.id = $1 AND i.business_id = $2`,
                [item.variant_id, business_id]
              );
            } else {
              variantRes = await client.query(
                `SELECT iv.* FROM item_variants iv
                 INNER JOIN items i ON iv.item_id = i.id
                 WHERE iv.id = $1 AND i.business_id = $2`,
                [item.variant_id, business_id]
              );
              variantRes.rows[0] = {
                ...variantRes.rows[0],
                track_batch: false,
                track_serial: false,
                valuation_method: 'simple',
              };
            }
            const variantData = variantRes.rows[0];
            const variantTrackBatch = variantData?.track_batch || false;
            const variantTrackSerial = variantData?.track_serial || false;
            const variantValuationMethod = (variantData?.valuation_method || 'simple') as 'fifo' | 'lifo' | 'weighted_avg' | 'simple';

            if (variantTrackBatch || variantTrackSerial) {
              try {
                const allocation = await allocateStockOnSale(
                  item.item_id,
                  quantity,
                  variantValuationMethod,
                  business_id,
                  item.location_id || undefined,
                  variantTrackSerial,
                  item.variant_id
                );

                // Update batches
                for (const batchAlloc of allocation.batchAllocations) {
                  await client.query(`
                    UPDATE item_batches
                    SET quantity = quantity - $1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2
                  `, [batchAlloc.quantity, batchAlloc.batch_id]);

                  await client.query(`
                    INSERT INTO stock_movements (
                      business_id, item_id, variant_id, location_id, type, quantity,
                      reference_type, reference_id, batch_id, unit_cost
                    )
                    VALUES ($1, $2, $3, $4, 'out', $5, 'invoice', $6, $7, $8)
                  `, [
                    business_id,
                    item.item_id,
                    item.variant_id,
                    item.location_id || null,
                    batchAlloc.quantity,
                    invoice.id,
                    batchAlloc.batch_id,
                    batchAlloc.unit_cost
                  ]);
                }

                // Update serials
                if (allocation.serialAllocations) {
                  for (const serialAlloc of allocation.serialAllocations) {
                    await client.query(`
                      UPDATE item_serials
                      SET status = 'sold',
                          sold_to_customer_id = $1,
                          sold_invoice_id = $2,
                          sold_at = CURRENT_TIMESTAMP,
                          updated_at = CURRENT_TIMESTAMP
                      WHERE id = $3
                    `, [customer_id || null, invoice.id, serialAlloc.serial_id]);

                    await client.query(`
                      INSERT INTO stock_movements (
                        business_id, item_id, variant_id, location_id, type, quantity,
                        reference_type, reference_id, serial_id, unit_cost
                      )
                      VALUES ($1, $2, $3, $4, 'out', 1, 'invoice', $5, $6, $7)
                    `, [
                      business_id,
                      item.item_id,
                      item.variant_id,
                      item.location_id || null,
                      invoice.id,
                      serialAlloc.serial_id,
                      serialAlloc.unit_cost
                    ]);
                  }
                }
              } catch (allocationError: any) {
                console.error('Error allocating variant stock on sale:', allocationError);
                // Fallback: just record movement without batch/serial
                await client.query(`
                  INSERT INTO stock_movements (
                    business_id, item_id, variant_id, location_id, type, quantity, reference_type, reference_id
                  )
                  VALUES ($1, $2, $3, $4, 'out', $5, 'invoice', $6)
                `, [business_id, item.item_id, item.variant_id, item.location_id || null, quantity, invoice.id]);
              }
            } else {
              // Simple variant stock movement
              await client.query(`
                INSERT INTO stock_movements (
                  business_id, item_id, variant_id, location_id, type, quantity, reference_type, reference_id
                )
                VALUES ($1, $2, $3, $4, 'out', $5, 'invoice', $6)
              `, [business_id, item.item_id, item.variant_id, item.location_id || null, quantity, invoice.id]);
            }
          } else {
            // No variant - handle item-level stock
            // Check if warehouse mode is enabled
            const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
            const warehouseModeEnabled = await isWarehouseModeEnabled(business_id);
            
            // CRITICAL: location_id is MANDATORY when warehouse mode is enabled
            if (warehouseModeEnabled && !item.location_id) {
              await client.query('ROLLBACK');
              return NextResponse.json(
                { 
                  error: `location_id (warehouse) is required for item "${item.item_name || item.item_id}". Warehouse mode is enabled - stock operations require warehouse context.`,
                  item_id: item.item_id,
                  item_name: item.item_name,
                  code: 'WAREHOUSE_REQUIRED'
                },
                { status: 400 }
              );
            }
            
            const locationId = item.location_id || null;
            
            if (trackBatch || trackSerial) {
              try {
                const allocation = await allocateStockOnSale(
                  item.item_id,
                  quantity,
                  valuationMethod,
                  business_id,
                  locationId || undefined,
                  trackSerial
                );

                // Update stock - conditional based on warehouse mode
                if (warehouseModeEnabled && locationId) {
                  // Warehouse mode: use location_stock
                  // Lock location stock for update
                  await client.query(`
                    SELECT * FROM location_stock 
                    WHERE location_id = $1 AND item_id = $2
                    FOR UPDATE
                  `, [locationId, item.item_id]);

                  // Update location_stock
                  await client.query(`
                    UPDATE location_stock
                    SET current_stock_qty = current_stock_qty - $1,
                        last_updated = CURRENT_TIMESTAMP
                    WHERE location_id = $2 AND item_id = $3
                  `, [quantity, locationId, item.item_id]);
                } else if (!warehouseModeEnabled) {
                  await adjustBranchItemStock(client, business_id, finalBranchId, item.item_id, -quantity);
                  await refreshItemGlobalStockFromBranches(client, business_id, item.item_id);
                }

                // Update batches
                for (const batchAlloc of allocation.batchAllocations) {
                  await client.query(`
                    UPDATE item_batches
                    SET quantity = quantity - $1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2
                  `, [batchAlloc.quantity, batchAlloc.batch_id]);

                  await client.query(`
                    INSERT INTO stock_movements (
                      business_id, item_id, location_id, type, quantity,
                      reference_type, reference_id, batch_id, unit_cost
                    )
                    VALUES ($1, $2, $3, 'out', $4, 'invoice', $5, $6, $7)
                  `, [
                    business_id,
                    item.item_id,
                    locationId,
                    batchAlloc.quantity,
                    invoice.id,
                    batchAlloc.batch_id,
                    batchAlloc.unit_cost
                  ]);
                }

                // Update serials
                if (allocation.serialAllocations) {
                  for (const serialAlloc of allocation.serialAllocations) {
                    await client.query(`
                      UPDATE item_serials
                      SET status = 'sold',
                          sold_to_customer_id = $1,
                          sold_invoice_id = $2,
                          sold_at = CURRENT_TIMESTAMP,
                          updated_at = CURRENT_TIMESTAMP
                      WHERE id = $3
                    `, [customer_id || null, invoice.id, serialAlloc.serial_id]);

                    await client.query(`
                      INSERT INTO stock_movements (
                        business_id, item_id, location_id, type, quantity,
                        reference_type, reference_id, serial_id, unit_cost
                      )
                      VALUES ($1, $2, $3, 'out', 1, 'invoice', $4, $5, $6)
                    `, [
                      business_id,
                      item.item_id,
                      locationId,
                      invoice.id,
                      serialAlloc.serial_id,
                      serialAlloc.unit_cost
                    ]);
                  }
                }
              } catch (allocationError: any) {
                console.error('Error allocating stock on sale:', allocationError);
                // Fallback stock update - conditional based on warehouse mode
                if (warehouseModeEnabled && locationId) {
                  // Warehouse mode: use location_stock
                  await client.query(`
                    UPDATE location_stock
                    SET current_stock_qty = current_stock_qty - $1,
                        last_updated = CURRENT_TIMESTAMP
                    WHERE location_id = $2 AND item_id = $3
                  `, [quantity, locationId, item.item_id]);
                } else if (!warehouseModeEnabled) {
                  await adjustBranchItemStock(client, business_id, finalBranchId, item.item_id, -quantity);
                  await refreshItemGlobalStockFromBranches(client, business_id, item.item_id);
                }

                await client.query(`
                  INSERT INTO stock_movements (
                    business_id, item_id, location_id, type, quantity, reference_type, reference_id
                  )
                  VALUES ($1, $2, $3, 'out', $4, 'invoice', $5)
                `, [business_id, item.item_id, locationId, quantity, invoice.id]);
              }
            } else {
              // Simple stock update (no batch/serial tracking)
              // Conditional based on warehouse mode
              if (warehouseModeEnabled && locationId) {
                // Warehouse mode: use location_stock
                // Lock location stock for update
                await client.query(`
                  SELECT * FROM location_stock 
                  WHERE location_id = $1 AND item_id = $2
                  FOR UPDATE
                `, [locationId, item.item_id]);

                // Update location_stock
                await client.query(`
                  UPDATE location_stock
                  SET current_stock_qty = current_stock_qty - $1,
                      last_updated = CURRENT_TIMESTAMP
                  WHERE location_id = $2 AND item_id = $3
                `, [quantity, locationId, item.item_id]);
              } else if (!warehouseModeEnabled) {
                await adjustBranchItemStock(client, business_id, finalBranchId, item.item_id, -quantity);
                await refreshItemGlobalStockFromBranches(client, business_id, item.item_id);
              }

              // Record stock movement
              await client.query(`
                INSERT INTO stock_movements (
                  business_id, item_id, location_id, type, quantity, reference_type, reference_id
                )
                VALUES ($1, $2, $3, 'out', $4, 'invoice', $5)
              `, [business_id, item.item_id, locationId, quantity, invoice.id]);
            }
          }

          // Track this item for low stock check
          stockDeductedItems.push({ item_id: item.item_id, business_id });
        }
      }
    }
    

    // Calculate COGS (Cost of Goods Sold) for inventory items
    let totalCogsAmount = 0;
    if (status === 'final') {
      for (const item of invoiceItems) {
        if (item.item_id) {
          const itemData = await client.query(
            `SELECT purchase_price, item_type, COALESCE(is_bundle, false) AS is_bundle
             FROM items WHERE id = $1 AND business_id = $2`,
            [item.item_id, business_id]
          );
          const row0 = itemData.rows[0];
          const lineQty = Number(item.quantity) || 0;
          if (row0?.item_type === 'goods' && row0?.is_bundle) {
            const comp = await client.query(
              `SELECT bi.quantity::numeric AS comp_qty, i.purchase_price
               FROM bundle_items bi
               JOIN items i ON i.id = bi.item_id
               WHERE bi.bundle_id = $1`,
              [item.item_id]
            );
            for (const c of comp.rows as { comp_qty: string | number; purchase_price: string | number | null }[]) {
              const cost = Number(c.purchase_price) || 0;
              const per = Number(c.comp_qty) || 0;
              if (cost > 0 && per > 0) {
                totalCogsAmount += cost * per * lineQty;
              }
            }
          } else if (row0?.item_type === 'goods' && row0?.purchase_price) {
            const itemCost = Number(row0.purchase_price) || 0;
            totalCogsAmount += itemCost * lineQty;
          }
        }
      }
    }

    // NOTE: Ledger entries are now created AFTER transaction commit to avoid connection pool issues
    // See code after COMMIT statement below

    // Handle Payments (multiple payment entries)
    // Proforma invoices don't accept payments - they are estimates/quotes
    // Payments should only be recorded after converting to tax invoice
    //
    // PHASE-2: when an invoice is edited (invoiceId present), we also need to
    // delete any payment-voucher ledger lines that were posted against the
    // OLD payment rows we're about to delete — otherwise they orphan and
    // double-count Cash + AR forever.
    if (invoiceId && paymentEntries.length > 0 && document_type !== 'proforma_invoice') {
      const oldPayments = await client.query<{ id: string }>(
        `SELECT id FROM payments WHERE reference_type = 'invoice' AND reference_id = $1 AND business_id = $2 AND deleted_at IS NULL`,
        [invoiceId, business_id]
      );
      const oldPaymentIds = oldPayments.rows.map(r => r.id);
      if (oldPaymentIds.length > 0) {
        await client.query(
          `DELETE FROM ledger_entry_lines
            WHERE business_id = $1
              AND voucher_type = 'payment'
              AND voucher_id = ANY($2::uuid[])`,
          [business_id, oldPaymentIds]
        );
      }
      if (useSoftDeleteInvoicePayments) {
        await client.query(
          `UPDATE payments
           SET deleted_at = CURRENT_TIMESTAMP
           WHERE reference_type = 'invoice'
             AND reference_id = $1
             AND business_id = $2
             AND deleted_at IS NULL`,
          [invoiceId, business_id]
        );
      } else {
        await client.query(
          `DELETE FROM payments
           WHERE reference_type = 'invoice'
             AND reference_id = $1
             AND business_id = $2`,
          [invoiceId, business_id]
        );
      }
    }
    // PHASE-2: track inserted payments so we can post receipt-voucher ledger
    // entries (Dr Cash/Bank, Cr AR) AFTER commit. We do NOT post inside the
    // transaction because createPaymentLedgerEntries opens its own pool client.
    const insertedPayments: Array<{
      id: string;
      amount: number;
      mode: string;
      date: string | Date;
      reference?: string;
    }> = [];
    if (paymentEntries.length > 0 && document_type !== 'proforma_invoice') {
      try {
        for (const p of paymentEntries) {
          const pAmount = Number(p.amount) || 0;
          if (pAmount > 0) {
            const ins = await client.query<{ id: string }>(`
              INSERT INTO payments (
                business_id, branch_id, type, customer_id, reference_type, reference_id,
                amount, payment_mode, payment_date, notes
              )
              VALUES ($1, $2, 'receivable', $3, 'invoice', $4, $5, $6, $7, $8)
              RETURNING id
            `, [
              business_id,
              finalBranchId,
              customer_id || null,
              invoice.id,
              pAmount,
              p.mode || 'cash',
              p.date || new Date(),
              p.reference ? `Payment for Invoice ${invoiceNumber} - Ref: ${p.reference}` : `Payment for Invoice ${invoiceNumber}`
            ]);
            insertedPayments.push({
              id: ins.rows[0].id,
              amount: pAmount,
              mode: p.mode || 'cash',
              date: p.date || new Date(),
              reference: p.reference,
            });
          }
        }
      } catch (paymentError: any) {
        throw paymentError;
      }
    }

    // Update customer current_balance (only if status is final and customer exists)
    // For invoices: balance increases customer's receivable
    // Proforma invoices don't affect customer balance - they are estimates/quotes
    if (status === 'final' && customer_id && document_type !== 'proforma_invoice') {
      const balanceToAdd = invoice.balance_amount || (invoice.grand_total - (invoice.paid_amount || 0));
      await client.query(`
        UPDATE customers
        SET current_balance = current_balance + $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [balanceToAdd, customer_id]);
    }

      // Note: If we used providedInvoiceNumber, it was already reserved via next-number API which incremented the counter.
      // If we generated one in the else block above, we already incremented it there.
      // So no additional increment needed here.

    // ------------------------------------------------------------------
    // PHASE-5: Ledger postings MUST run inside the same transaction as the
    // invoice + payments + stock writes. The deferred validate_voucher_balance
    // trigger (migration 123) only fires at COMMIT — so all per-voucher INSERTs
    // must share one PoolClient, otherwise each single-row INSERT becomes its
    // own auto-committed tx and the trigger rejects the very first line.
    //
    // If ANY ledger insert throws (constraint failure, missing account, etc.)
    // the outer catch will ROLLBACK and the entire invoice creation will fail
    // with HTTP 500 — no more orphan invoice rows without ledger entries.
    // ------------------------------------------------------------------
    if (status === 'final' && document_type !== 'proforma_invoice') {
      // Edit path: wipe stale ledger lines for this invoice so we don't double-post.
      if (invoiceId) {
        await client.query(
          `DELETE FROM ledger_entry_lines
            WHERE business_id = $1
              AND voucher_type = 'invoice'
              AND voucher_id = $2`,
          [business_id, invoice.id]
        );
        // Also wipe payment-voucher ledger lines for this invoice's payments
        // (the payments themselves were re-inserted above with new ids).
        await client.query(
          `DELETE FROM ledger_entry_lines
            WHERE business_id = $1
              AND voucher_type = 'payment'
              AND voucher_id IN (SELECT id FROM payments WHERE reference_type = 'invoice' AND reference_id = $2 AND business_id = $1 AND deleted_at IS NULL)`,
          [business_id, invoice.id]
        );
      }

      // PHASE-2: a true cash sale has NO customer (walk-in). Any invoice with
      // a saved customer must hit Accounts Receivable — even if it's paid in full
      // immediately. The receipt is then posted as a SEPARATE voucher below.
      const isCashSale = !customer_id;
      const paymentMode = insertedPayments[0]?.mode || paymentEntries[0]?.mode || 'cash';

      await createInvoiceLedgerEntries({
        businessId: business_id,
        invoiceId: invoice.id,
        invoiceNumber: invoiceNumber,
        invoiceDate: invoice_date,
        grandTotal: grandTotal,
        customerId: customer_id || null,
        paymentMode: paymentMode,
        isCashSale: isCashSale,
        cogsAmount: totalCogsAmount,
        branchId: finalBranchId,
        // PHASE-3 GST split.
        taxableValue: subtotal,
        cgstTotal: cgstTotal,
        sgstTotal: sgstTotal,
        igstTotal: igstTotal,
        // PHASE-5: share the open transaction so all 3+ lines defer-validate together.
        poolClient: client,
      });

      // PHASE-2: for credit invoices, post a receipt voucher per payment.
      // Walk-in cash sales (no customer_id) are already Cash-Dr / Sales-Cr.
      if (customer_id && insertedPayments.length > 0) {
        const { createPaymentLedgerEntries } = await import('@/lib/ledger-utils');
        for (const p of insertedPayments) {
          await createPaymentLedgerEntries({
            businessId: business_id,
            paymentId: p.id,
            paymentDate: p.date,
            amount: p.amount,
            type: 'receivable',
            customerId: customer_id,
            paymentMode: p.mode,
            referenceNumber: invoiceNumber,
            description: `Receipt against Invoice ${invoiceNumber}${p.reference ? ` (Ref: ${p.reference})` : ''}`,
            branchId: finalBranchId,
            poolClient: client,
          });
        }
      }
    }

    // Link invoice to quantity request if provided (new invoices only)
    if (!invoiceId && request_id) {
      try {
        await client.query(`
          UPDATE quantity_requests
          SET invoice_id = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [invoice.id, request_id]);
        
        // Get request details to send notification to customer
        const requestRes = await client.query(`
          SELECT requester_business_id, responder_business_id, item_id
          FROM quantity_requests
          WHERE id = $1
        `, [request_id]);
        
        if (requestRes.rows.length > 0) {
          const req = requestRes.rows[0];
          // Send notification to customer (requester) that invoice has been created
          try {
            const supplierBiz = await client.query('SELECT name FROM businesses WHERE id = $1', [req.responder_business_id]);
            const supplierName = supplierBiz.rows[0]?.name || 'Supplier';
            
            await client.query(`
              INSERT INTO notifications (business_id, type, title, message, reference_type, reference_id, created_at)
              VALUES ($1, 'quantity_response', 'Invoice Created', 
                $2 || ' has created an invoice for your request. Invoice Number: ' || $3 || '. You can convert it to a purchase from the Requests page.',
                'invoice', $4, CURRENT_TIMESTAMP)
            `, [
              req.requester_business_id,
              supplierName,
              invoice.invoice_number,
              invoice.id
            ]);
          } catch (notifError) {
            console.error('Error creating notification:', notifError);
            // Don't fail invoice creation if notification fails
          }
        }
      } catch (linkError) {
        console.error('Error linking invoice to request:', linkError);
        // Don't fail invoice creation if linking fails
      }
    }
    
    await client.query('COMMIT');
    
    // Transaction committed successfully — ledger entries were posted INSIDE the
    // transaction above (PHASE-5), so by here we know they're durable too.

    // CRITICAL: Log activity for audit trail
    
    if (status === 'final') {
      const { logActivity, getClientIP, getUserAgent } = await import('@/lib/activity-logger');
      const { validateBackdate } = await import('@/lib/backdate-controls');
      const backdateValidation = validateBackdate(invoice_date, 365, 30);
      
      await logActivity({
        business_id,
        user_id: actorUserId ?? undefined,
        action_type: 'create',
        module: 'invoices',
        entity_id: invoice.id,
        entity_type: 'invoice',
        description: `Created invoice ${invoiceNumber} dated ${invoice_date}${backdateValidation.isBackdated ? ` (backdated ${backdateValidation.daysBackdated} days)` : ''}`,
        ip_address: getClientIP(request),
        user_agent: getUserAgent(request),
        metadata: {
          invoice_number: invoiceNumber,
          invoice_date,
          branch_id: finalBranchId,
          grand_total: grandTotal,
          customer_id: customer_id || null,
          is_backdated: backdateValidation.isBackdated,
          days_backdated: backdateValidation.daysBackdated,
          backdate_reason: (body as any).backdate_reason || null
        }
      });
    }

    // Process commission earning AFTER commit to avoid transaction errors
    // This ensures commission processing errors don't affect invoice creation
    if (status === 'final' && actorUserId) {
      
      // Use a fresh connection for commission processing (outside the transaction)
      const commissionPool = getPool();
      const commissionClient = await commissionPool.connect();
      try {
        // Get invoice items with item details for category
        // Note: items table uses category_id (FK), not category (direct column)
        const invoiceItemsData = await commissionClient.query(
          `SELECT 
            ii.item_id,
            ii.quantity,
            ii.unit_price,
            c.name as item_category
           FROM invoice_items ii
           LEFT JOIN items i ON ii.item_id = i.id
           LEFT JOIN categories c ON i.category_id = c.id
           WHERE ii.invoice_id = $1
           LIMIT 1`,
          [invoice.id]
        );

        const invoiceForCommission = {
          id: invoice.id,
          grand_total: invoice.grand_total,
          created_by: actorUserId,
          items: invoiceItemsData.rows.map((row: any) => ({
            item_id: row.item_id,
            quantity: parseFloat(row.quantity) || 0,
            price: parseFloat(row.unit_price) || 0,
            item: {
              category: row.item_category,
            },
          })),
          customer: customer_id ? {
            // customer_type column doesn't exist, so we'll pass undefined
            // Commission calculator should handle this gracefully
          } : undefined,
        };

        // Process commission (this will create commission_earnings record)
        
        const { processCommissionEarning } = await import('@/lib/commission-calculator');
        await processCommissionEarning(business_id, invoice.id, invoiceForCommission);
        
      } catch (commissionError: any) {
        // Log commission error but don't fail invoice creation
        // This happens AFTER commit, so it can't affect the invoice
        console.error('Error processing commission for invoice:', commissionError);
        console.error('Commission error details:', {
          message: commissionError.message,
          code: commissionError.code,
          detail: commissionError.detail
        });
      } finally {
        commissionClient.release();
      }
    }

    // Verify invoice was actually saved by querying it back using a fresh connection
    // (Sometimes the same client connection might have transaction isolation issues)
    // Starting verification step
    
    try {
      const verifyPool = getPool();
      const verifyClient = await verifyPool.connect();
      // Verification client connected
      try {
        // Verifying invoice with fresh connection
        
        const verifyRes = await verifyClient.query(
          'SELECT id, invoice_number, business_id FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
          [invoice.id, business_id]
        );
        // Verification query completed
        if (verifyRes.rows.length === 0) {
          // Try querying by invoice number as fallback
          // Invoice not found by ID, trying fallback query by number
          const fallbackRes = await verifyClient.query(
            'SELECT id, invoice_number, business_id FROM invoices WHERE invoice_number = $1 AND business_id = $2 AND deleted_at IS NULL',
            [invoice.invoice_number, business_id]
          );
          // Fallback query completed
          if (fallbackRes.rows.length === 0) {
            console.error('[Invoice Creation] CRITICAL: Invoice was not found after commit!');
            console.error('[Invoice Creation] Searched for ID:', invoice.id);
            console.error('[Invoice Creation] Searched for Number:', invoice.invoice_number, 'Business:', business_id);
            throw new Error('Invoice was not saved to database');
          } else {
            // Invoice found by number
            // Update invoice object with the found ID in case there was a mismatch
            invoice.id = fallbackRes.rows[0].id;
          }
        } else {
          // Invoice verified in database
        }
      } catch (verifyError: any) {
        console.error('[Invoice Creation] Error during verification:', verifyError.message);
        console.error('[Invoice Creation] Verification error stack:', verifyError.stack);
        throw verifyError;
      } finally {
        verifyClient.release();
        // Verification client released
      }
    } catch (verifyError: any) {
      console.error('[Invoice Creation] CRITICAL: Verification failed completely:', verifyError.message);
      throw verifyError;
    }

    // Check for low stock alerts (async, don't wait)
    if (stockDeductedItems.length > 0) {
      checkLowStockForMultipleItems(stockDeductedItems).catch(err => 
        console.error('Error checking low stock:', err)
      );
    }

    // Commit transaction before returning
    await client.query('COMMIT');

    // PHASE 4.2: Calculate credit metrics for customer (if applicable)
    let creditMetrics = null;
    let creditWarning = null;
    
    if (invoice.customer_id && invoice.document_type !== 'proforma_invoice') {
      try {
        const customerData = await client.query(
          `SELECT credit_limit, current_balance FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
          [invoice.customer_id, business_id]
        );

        if (customerData.rows.length > 0) {
          const creditLimit = customerData.rows[0].credit_limit;
          const currentBalance = customerData.rows[0].current_balance;
          
          // Calculate current credit metrics
          const currentMetrics = calculateCreditMetrics(creditLimit, currentBalance);
          
          // Calculate projected metrics if invoice is final (affects balance)
          let projectedMetrics = null;
          if (status === 'final') {
            const invoiceBalance = invoice.balance_amount ?? (parseFloat(invoice.grand_total ?? '0') - parseFloat(invoice.paid_amount ?? '0'));
            projectedMetrics = calculateProjectedCreditMetrics(creditLimit, currentBalance, invoiceBalance);
          }
          
          creditMetrics = {
            current: currentMetrics,
            projected: projectedMetrics,
          };
          
          // Get warning message (use projected if available, otherwise current)
          creditWarning = getCreditWarningMessage(
            currentMetrics,
            'customer',
            projectedMetrics || undefined
          );

          // PHASE 5.4: Check and send credit alerts (async, non-blocking)
          if (projectedMetrics) {
            checkAndSendCreditAlerts(
              business_id,
              'customer',
              invoice.customer_id,
              creditLimit,
              currentBalance,
              projectedMetrics,
              'invoice',
              invoice.id
            ).catch(err => console.error('Error sending credit alert:', err));
          }
        }
      } catch (creditError) {
        // Don't fail invoice creation if credit calculation fails
        console.error('Error calculating credit metrics:', creditError);
      }
    }

    const offerDiscountTotal = appliedOffersPayload.reduce((s, o) => s + o.discountAmount, 0);
    const response = { 
      invoice,
      applied_offers: appliedOffersPayload,
      offer_discount_total: offerDiscountTotal,
      totals: {
        subtotal,
        discount_total: discountTotal,
        tax_total: taxTotal,
        grand_total: grandTotal,
      },
      credit_metrics: creditMetrics,
      credit_warning: creditWarning,
      stock_warnings: stockWarnings.length > 0 ? stockWarnings : undefined,
    };
    const responseObj = NextResponse.json(response, { status: 201 });
    
    return responseObj;
  } catch (error: any) {
    
    await client.query('ROLLBACK').catch(() => {
      // Ignore rollback errors if transaction was already aborted
    });
    
    console.error('[InvoiceAPI] Error creating invoice:', error.message, error.code);

    const errorResponse = { 
      error: error.message || 'Failed to create invoice',
      details: process.env.NODE_ENV === 'development' ? {
        code: error.code,
        detail: error.detail,
        hint: error.hint
      } : undefined
    };
    return NextResponse.json(errorResponse, { status: 500 });
  } finally {
    client.release();
  }
}
