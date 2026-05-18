import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { getPool, queryOne } from '@/lib/db';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { calculateCreditMetrics, calculateProjectedCreditMetrics, getCreditWarningMessage } from '@/lib/credit-utils';
import { checkAndSendCreditAlerts } from '@/lib/credit-alerts';
import { FeatureKeys } from '@/lib/featureKeys';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  getSessionScopedBusinessId,
} from '@/lib/auth-helpers';
import { applyPurchaseGoodsStockLine, PurchaseStockError } from '@/lib/purchase-goods-stock';
import { resolveCatalogItemIdForPurchase } from '@/lib/matching/resolve-catalog-item-for-purchase';
import { createCatalogItemFromAdHocPurchaseLine } from '@/lib/purchases/create-catalog-item-from-purchase-line';
import {
  getClosingStockLockedCutoffDate,
  assertDocumentDateNotBeforeLockedClosingStock,
  ClosingStockPeriodLockedError,
} from '@/lib/closing-stock-period-lock';
import {
  computePurchaseDocument,
  stateCodeFromGstin,
} from '@/lib/purchase-gst-calculator';

/**
 * GET /api/purchases
 * Fetch all purchases for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || 'all';
    const agingDaysMin = searchParams.get('aging_days_min');
    const agingDaysMax = searchParams.get('aging_days_max');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

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

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'purchases', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get user's accessible branch IDs
    let accessibleBranchIds: string[] = [];
    let isAdmin = false;
    try {
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
          const { queryOne } = await import('@/lib/db');
          const user = await queryOne<{ is_primary_admin: boolean }>(
            'SELECT is_primary_admin FROM users WHERE id = $1',
            [userId]
          );
          isAdmin = user?.is_primary_admin || false;
        } catch (error) {
          // Ignore error
        }
      }
    } catch (error) {
      console.error('Error fetching user accessible branches:', error);
      // If error, return empty result to be safe
      return NextResponse.json({ 
        purchases: [],
        pagination: {
          page: 1,
          limit: 50,
          total: 0,
          totalPages: 0
        }
      });
    }

    const branchIdParam = searchParams.get('branch_id'); // Optional: 'ALL' for consolidated, or specific branch
    
    let sql = `
      SELECT 
        p.id, p.business_id, p.supplier_id, p.bill_number,
        p.bill_date, p.status, p.subtotal, p.tax_total,
        p.cgst_total, p.sgst_total, p.igst_total,
        p.grand_total, p.paid_amount, p.balance_amount, p.payment_status, 
        p.notes, p.created_at,
        p.place_of_supply_state_code, p.is_reverse_charge, p.supplier_gstin,
        p.document_type, p.itc_eligible, p.itc_availed,
        s.name as supplier_name,
        CASE 
          WHEN p.bill_date < CURRENT_DATE AND (p.grand_total - COALESCE(p.paid_amount, 0)) > 0 
            THEN CURRENT_DATE - p.bill_date
          ELSE 0
        END as days_overdue
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.business_id = $1
        AND p.deleted_at IS NULL
        AND p.status != 'cancelled'
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    // Filter by branch if specified
    if (branchIdParam && branchIdParam !== 'ALL' && branchIdParam !== 'all') {
      sql += ` AND p.branch_id = $${paramIndex}`;
      params.push(branchIdParam);
      paramIndex++;
    } else if (!isAdmin) {
      // Non-admin users: Filter by user's accessible branches
      if (accessibleBranchIds.length === 0) {
        // User has no branch access - return empty result
        return NextResponse.json({ 
          purchases: [],
          pagination: {
            page: 1,
            limit: 50,
            total: 0,
            totalPages: 0
          }
        });
      }
      sql += ` AND p.branch_id = ANY($${paramIndex}::uuid[])`;
      params.push(accessibleBranchIds);
      paramIndex++;
    }
    // Admin users with no branchId filter: Show all branches (no additional WHERE clause)

    // Add search filter
    if (search) {
      sql += ` AND (p.bill_number ILIKE $${paramIndex} OR s.name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Add status filter
    if (status !== 'all') {
      if (status === 'unpaid') {
        sql += ` AND p.payment_status IN ('unpaid', 'partially_paid')`;
      } else if (status === 'paid') {
        sql += ` AND p.payment_status = 'paid'`;
      } else {
        sql += ` AND p.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }
    }

    // Add date filter
    if (dateFrom) {
      sql += ` AND DATE(p.bill_date) >= DATE($${paramIndex})`;
      params.push(dateFrom);
      paramIndex++;
    }
    if (dateTo) {
      sql += ` AND DATE(p.bill_date) <= DATE($${paramIndex})`;
      params.push(dateTo);
      paramIndex++;
    }

    // Add aging filter
    if (agingDaysMin && agingDaysMax) {
      const minDays = parseInt(agingDaysMin);
      const maxDays = parseInt(agingDaysMax);
      if (!isNaN(minDays) && !isNaN(maxDays)) {
        sql += ` AND (
          CASE 
            WHEN p.bill_date < CURRENT_DATE 
              THEN CURRENT_DATE - p.bill_date
            ELSE 0
          END
        ) >= $${paramIndex} AND (
          CASE 
            WHEN p.bill_date < CURRENT_DATE 
              THEN CURRENT_DATE - p.bill_date
            ELSE 0
          END
        ) <= $${paramIndex + 1}`;
        params.push(minDays, maxDays);
        paramIndex += 2;
      }
    }

    // Get total count for pagination (before adding LIMIT/OFFSET)
    const countParams = [...params];
    const countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
    const countResult = await db.queryOne<{ total: number }>(countSql, countParams);
    const total = countResult?.total || 0;

    // Add pagination
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    sql += ` ORDER BY p.bill_date DESC, p.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const purchases = await db.queryRows(sql, params);

    return NextResponse.json({ 
      purchases,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching purchases:', error);
    return NextResponse.json(
      { error: 'Failed to fetch purchases', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/purchases
 * Create a new purchase
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  let client;
  
  try {
    client = await pool.connect();
    const body = await request.json();
    const business_id = getSessionScopedBusinessId(request);
    const {
      branch_id, // MANDATORY: Branch (accounting entity) that made this purchase
      supplier_id,
      bill_number,
      bill_date,
      status = 'draft',
      items,
      subtotal,
      tax_total,
      round_off,
      grand_total,
      paid_amount = 0,
      notes,
      place_of_supply_state_code,
      is_reverse_charge = false,
      document_type = 'tax_invoice',
      port_code,
      itc_eligible = true,
      created_by, // User ID who created the purchase
      price_mode,
      supplier_state_code: supplier_state_code_input,
      invoice_number: invoice_number_input,
      supplier_gstin: supplier_gstin_input,
    } = body;

    const normalizedSupplierId =
      supplier_id != null && String(supplier_id).trim() !== ''
        ? String(supplier_id).trim()
        : null;

    if (!business_id || !bill_date || !items || items.length === 0) {
      return NextResponse.json(
        { error: 'Active business scope, bill_date, and items are required' },
        { status: 400 }
      );
    }

    try {
      const cutoff = await getClosingStockLockedCutoffDate(business_id);
      assertDocumentDateNotBeforeLockedClosingStock(String(bill_date).slice(0, 10), cutoff);
    } catch (e) {
      if (e instanceof ClosingStockPeriodLockedError) {
        return NextResponse.json(
          { error: e.message, code: 'CLOSING_STOCK_PERIOD_LOCKED', cutoff: e.cutoffDate },
          { status: 409 }
        );
      }
      throw e;
    }

    if (!created_by) {
      return NextResponse.json(
        { error: 'created_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce access boundary - reject attendance-only employees
    const { checkEmployeeAccessBoundary } = await import('@/lib/access-boundary');
    const accessCheck = await checkEmployeeAccessBoundary(created_by, 'portal');
    if (!accessCheck.allowed) {
      return NextResponse.json(
        { error: accessCheck.reason, code: 'ACCESS_DENIED' },
        { status: 403 }
      );
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

    // AUTHORIZATION: Check create permission (must use resolved branch)
    try {
      await authorize(created_by, 'purchases', 'create', { branchId: finalBranchId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // PBAC: Check warehouse access for each item (if warehouse mode enabled)
    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(business_id);
    
    if (warehouseModeEnabled && created_by) {
      const { checkUserWarehouseAccess } = await import('@/lib/warehouse-access');
      
      for (const item of items) {
        if (!item.location_id) continue;
        
        const warehouseAccess = await checkUserWarehouseAccess(created_by, item.location_id);
        
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

    const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
    try {
      await assertGstPeriodNotFiledForDocumentDate(business_id, finalBranchId, bill_date, 'save purchase');
    } catch (error: any) {
      return NextResponse.json(
        {
          error: error.message || 'GST period is filed',
          code: 'GST_PERIOD_FILED',
        },
        { status: 403 }
      );
    }

    // CRITICAL: Check period lock BEFORE creating purchase
    const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
    try {
      await assertPeriodNotLocked(business_id, finalBranchId, bill_date, 'purchase');
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
    const backdateValidation = validateBackdate(bill_date, 365, 30);
    
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
      
      if (backdateValidation.requiresApproval && created_by) {
        const hasApproval = await hasBackdateApprovalPermission(created_by, backdateValidation.daysBackdated);
        
        if (!hasApproval) {
          return NextResponse.json(
            { 
              error: `Backdated purchases > 30 days require approval. Bill date is ${backdateValidation.daysBackdated} days old.`,
              code: 'BACKDATE_APPROVAL_REQUIRED',
              days_backdated: backdateValidation.daysBackdated
            },
            { status: 403 }
          );
        }
      }
    }

    if (normalizedSupplierId) {
      const supOk = await queryOne<{ id: string }>(
        `SELECT id FROM suppliers WHERE id = $1 AND business_id = $2 AND (is_active IS NULL OR is_active = true)`,
        [normalizedSupplierId, business_id]
      );
      if (!supOk) {
        return NextResponse.json(
          { error: 'Supplier not found for this business', code: 'SUPPLIER_INVALID' },
          { status: 400 }
        );
      }
    }

    await client.query('BEGIN');

    try {
      await enforceAccess({
        businessId: business_id,
        userId: created_by,
        branchId: finalBranchId,
        feature: FeatureKeys.PURCHASE_MANAGEMENT,
        limitType: 'purchases',
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

    // Fetch business and supplier info for GST calculations
    const businessRes = await client.query(
      'SELECT state_code, state FROM businesses WHERE id = $1',
      [business_id]
    );
    
    if (businessRes.rows.length === 0) {
      throw new Error('Business not found');
    }
    
    const business = businessRes.rows[0];
    
    // Get supplier GSTIN + state for GST split
    let supplierGstin: string | null = null;
    let supplierStateFromMaster: string | null = null;
    if (normalizedSupplierId) {
      const supplierRes = await client.query(
        'SELECT gstin, state_code FROM suppliers WHERE id = $1 AND business_id = $2',
        [normalizedSupplierId, business_id]
      );
      if (supplierRes.rows.length > 0) {
        supplierGstin = supplierRes.rows[0].gstin;
        supplierStateFromMaster = supplierRes.rows[0].state_code;
      }
    }

    const effectiveSupplierGstin =
      (typeof supplier_gstin_input === 'string' && supplier_gstin_input.trim()
        ? supplier_gstin_input.trim().toUpperCase()
        : null) || (supplierGstin ? String(supplierGstin).trim().toUpperCase() : null);

    const supplierStateResolved =
      (typeof supplier_state_code_input === 'string' && supplier_state_code_input.trim()
        ? supplier_state_code_input.trim().slice(0, 2)
        : null) ||
      (supplierStateFromMaster ? String(supplierStateFromMaster).trim().slice(0, 2) : '') ||
      stateCodeFromGstin(effectiveSupplierGstin || supplierGstin || undefined);

    const headerPriceMode = price_mode === 'inclusive' ? 'inclusive' : 'exclusive';

    const invoiceNumberStored =
      (typeof invoice_number_input === 'string' && invoice_number_input.trim()
        ? invoice_number_input.trim()
        : null) || (bill_number ? String(bill_number).trim() : null);

    // Helper for state code
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
    const finalPlaceOfSupply = place_of_supply_state_code || businessStateCode;

    const supplierStateForGst =
      supplierStateResolved && String(supplierStateResolved).trim().length >= 2
        ? String(supplierStateResolved).trim().slice(0, 2)
        : String(finalPlaceOfSupply || businessStateCode || '')
            .trim()
            .slice(0, 2);

    const gstDoc = computePurchaseDocument(
      items.map((item: any) => ({
        quantity: Number(item.quantity) || 0,
        unit_price: Number(item.unit_price) || 0,
        discount_percent: Number(item.discount_percent) || 0,
        discount_amount: Number(item.discount_amount) || 0,
        discount_on_tax_inclusive: item.discount_on_tax_inclusive === true,
        tax_rate: Number(item.tax_rate) || 0,
        tax_mode: item.tax_mode,
        manual_cgst: item.manual_cgst,
        manual_sgst: item.manual_sgst,
        manual_igst: item.manual_igst,
      })),
      {
        supplierStateCode: supplierStateForGst || '',
        companyStateCode: businessStateCode || '',
        headerPriceMode,
      }
    );

    const calculatedSubtotal = gstDoc.subtotal;
    const calculatedTaxTotal = gstDoc.taxTotal;
    const calculatedCgstTotal = gstDoc.cgstTotal;
    const calculatedSgstTotal = gstDoc.sgstTotal;
    const calculatedIgstTotal = gstDoc.igstTotal;

    // Use provided totals or calculated ones
    const finalSubtotal = subtotal !== undefined ? subtotal : calculatedSubtotal;
    const finalTaxTotal = tax_total !== undefined ? tax_total : calculatedTaxTotal;
    const finalCgstTotal = calculatedCgstTotal;
    const finalSgstTotal = calculatedSgstTotal;
    const finalIgstTotal = calculatedIgstTotal;
    const finalRoundOff = typeof round_off === 'number' && isFinite(round_off) ? round_off : 0;
    const computedGrand = calculatedSubtotal + calculatedTaxTotal + finalRoundOff;
    const finalGrandTotal =
      grand_total !== undefined ? grand_total : computedGrand;

    // Calculate balance_amount and payment_status
    const balanceAmount = finalGrandTotal - (paid_amount || 0);
    let paymentStatus: 'unpaid' | 'partially_paid' | 'paid' = 'unpaid';
    if (paid_amount <= 0) {
      paymentStatus = 'unpaid';
    } else if (balanceAmount <= 0) {
      paymentStatus = 'paid';
    } else {
      paymentStatus = 'partially_paid';
    }

    // Insert purchase
    const purchaseResult = await client.query(
      `
      INSERT INTO purchases (
        business_id, branch_id, supplier_id, bill_number, bill_date,
        status, subtotal, tax_total, cgst_total, sgst_total, igst_total,
        round_off, grand_total, paid_amount, balance_amount, payment_status, notes,
        place_of_supply_state_code, is_reverse_charge, supplier_gstin,
        document_type, port_code, itc_eligible,
        price_mode, supplier_state_code, invoice_number
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
      RETURNING *
    `,
      [
        business_id,
        finalBranchId,
        normalizedSupplierId,
        bill_number || null,
        bill_date,
        status,
        finalSubtotal,
        finalTaxTotal,
        finalCgstTotal,
        finalSgstTotal,
        finalIgstTotal,
        finalRoundOff,
        finalGrandTotal,
        paid_amount,
        balanceAmount,
        paymentStatus,
        notes || null,
        finalPlaceOfSupply || null,
        is_reverse_charge,
        effectiveSupplierGstin,
        document_type,
        port_code || null,
        itc_eligible,
        headerPriceMode,
        (supplierStateResolved && String(supplierStateResolved).trim().length >= 2
          ? String(supplierStateResolved).trim().slice(0, 2)
          : supplierStateForGst) || null,
        invoiceNumberStored,
      ]
    );

    const purchase = purchaseResult.rows[0];
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    // Insert purchase items with GST breakdown
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const computed = gstDoc.lineComputeds[i];
      const qty = Number(item.quantity) || 0;
      const taxable = computed.taxableValue;
      const taxAmount = computed.taxAmount;
      const cgst = computed.cgstAmount;
      const sgst = computed.sgstAmount;
      const igst = computed.igstAmount;
      const lineTotal = computed.lineTotal;
      const lineTaxMode =
        item.tax_mode === 'inclusive' || item.tax_mode === 'exclusive' ? item.tax_mode : headerPriceMode;

      const rawVariantId =
        typeof item.variant_id === 'string' && uuidRe.test(item.variant_id.trim())
          ? item.variant_id.trim()
          : null;

      const unitCostForStock = qty > 0 ? taxable / qty : Number(item.unit_price) || 0;

      const lineIntent = item.item_type === 'service' ? 'service' : 'goods';

      // Insert purchase item with GST breakdown
      await client.query(
        `
        INSERT INTO purchase_items (
          purchase_id, item_id, variant_id, item_name, hsn_sac, quantity,
          unit, unit_price, discount_percent, discount_amount, discount_account_id, taxable_value,
          tax_rate, tax_mode, tax_amount, cgst_amount, sgst_amount, igst_amount, line_total,
          location_id, line_item_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      `,
        [
          purchase.id,
          item.item_id || null,
          rawVariantId,
          item.item_name,
          item.hsn_sac || null,
          item.quantity,
          item.unit || 'PCS',
          item.unit_price,
          computed.discountPercent,
          computed.discountAmount,
          item.discount_account_id || null,
          taxable,
          item.tax_rate || 0,
          lineTaxMode,
          taxAmount,
          cgst,
          sgst,
          igst,
          lineTotal,
          item.location_id || null,
          lineIntent,
        ],
      );

      // If item_id is missing, resolve against catalogue (exact → HSN → fuzzy name)
      let effectiveItemId =
        item.item_id && String(item.item_id).trim() !== '' ? String(item.item_id).trim() : null;
      if (!effectiveItemId && item.item_name) {
        effectiveItemId = await resolveCatalogItemIdForPurchase(client, business_id, {
          name: String(item.item_name),
          hsn_sac: item.hsn_sac ?? null,
        });
        if (effectiveItemId) {
          await client.query(
            'UPDATE purchase_items SET item_id = $1 WHERE purchase_id = $2 AND item_name = $3 AND item_id IS NULL',
            [effectiveItemId, purchase.id, item.item_name],
          );
        }
      }

      if (
        status === 'final' &&
        lineIntent === 'goods' &&
        !effectiveItemId &&
        String(item.item_name || '').trim().length > 0
      ) {
        try {
          const newId = await createCatalogItemFromAdHocPurchaseLine(client, {
            businessId: business_id,
            createdBy: created_by,
            rawLineName: String(item.item_name),
            unit: item.unit || 'PCS',
            purchasePrice: unitCostForStock,
            taxRate: Number(item.tax_rate) || 0,
            hsnSac: item.hsn_sac ?? null,
            defaultSupplierId: normalizedSupplierId,
          });
          effectiveItemId = newId;
          await client.query(
            'UPDATE purchase_items SET item_id = $1 WHERE purchase_id = $2 AND item_name = $3 AND item_id IS NULL',
            [effectiveItemId, purchase.id, item.item_name],
          );
        } catch (e) {
          if (e instanceof PurchaseStockError) {
            await client.query('ROLLBACK');
            return NextResponse.json(
              {
                error: e.message,
                code: e.code,
                ...(e.details && typeof e.details === 'object' ? e.details : {}),
              },
              { status: e.statusCode },
            );
          }
          throw e;
        }
      }

      const lineIsService = lineIntent === 'service';
      if (status === 'final' && !lineIsService && !effectiveItemId) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: `Goods line "${item.item_name || 'Item'}" is not linked to a catalogue item. Search and select a product (or create it in Items) before finalizing — otherwise stock is not updated.`,
            code: 'PURCHASE_GOODS_LINE_UNLINKED',
          },
          { status: 400 }
        );
      }

      if (status === 'final' && effectiveItemId) {
        const itemTypeRes = await client.query(
          'SELECT item_type, track_batch, track_serial FROM items WHERE id = $1 AND business_id = $2',
          [effectiveItemId, business_id]
        );
        const itemData = itemTypeRes.rows[0];

        if (!itemData) {
          throw new PurchaseStockError(
            `Item "${item.item_name || effectiveItemId}" is not in this business catalog (wrong item_id or deleted item). Fix the line and save again.`,
            400,
            'ITEM_BUSINESS_MISMATCH',
            { item_id: effectiveItemId, purchase_id: purchase.id }
          );
        } else if ((itemData.item_type || 'goods') === 'goods') {
          try {
            await applyPurchaseGoodsStockLine(
              client,
              {
                businessId: business_id,
                branchId: finalBranchId,
                purchaseId: purchase.id,
                supplierId: normalizedSupplierId,
                billRef: bill_number || 'New',
                warehouseModeEnabled,
                trackBatch: itemData.track_batch || false,
                trackSerial: itemData.track_serial || false,
              },
              {
                item_id: effectiveItemId,
                variant_id: rawVariantId,
                item_name: item.item_name,
                quantity: Number(item.quantity) || 0,
                unit_price: unitCostForStock,
                location_id: item.location_id || null,
                batch_number: item.batch_number ?? null,
                serial_numbers: item.serial_numbers,
                manufacturing_date: item.manufacturing_date ?? null,
                expiry_date: item.expiry_date ?? null,
              }
            );
          } catch (e) {
            if (e instanceof PurchaseStockError) {
              await client.query('ROLLBACK');
              return NextResponse.json(
                {
                  error: e.message,
                  code: e.code,
                  ...(e.details && typeof e.details === 'object' ? e.details : {}),
                },
                { status: e.statusCode }
              );
            }
            throw e;
          }
        }
      }
    }

    // Calculate inventory amount (total of goods lines persisted on purchase_items)
    let totalInventoryAmount = 0;
    if (status === 'final') {
      const invRes = await client.query(
        `
        SELECT COALESCE(SUM(
          (COALESCE(i.purchase_price::numeric, pi.unit_price::numeric)) * pi.quantity::numeric
        ), 0) AS total
        FROM purchase_items pi
        JOIN items i ON i.id = pi.item_id AND i.business_id = $2
        WHERE pi.purchase_id = $1 AND i.item_type = 'goods'
      `,
        [purchase.id, business_id]
      );
      totalInventoryAmount = Number(invRes.rows[0]?.total) || 0;
    }

    // Create ledger entries for purchase (only if status is final)
    if (status === 'final') {
      const { createPurchaseLedgerEntries } = await import('@/lib/ledger-utils');
      const isCashPurchase =
        !normalizedSupplierId || (paid_amount > 0 && paid_amount >= finalGrandTotal);

      await createPurchaseLedgerEntries({
        businessId: business_id,
        purchaseId: purchase.id,
        purchaseNumber: bill_number || purchase.id.substring(0, 8),
        purchaseDate: bill_date,
        grandTotal: finalGrandTotal,
        supplierId: normalizedSupplierId,
        isCashPurchase: isCashPurchase,
        inventoryAmount: totalInventoryAmount,
        branchId: finalBranchId,
        poolClient: client,
        // PHASE-3: GST split. Tax debits Input CGST/SGST/IGST when ITC is eligible;
        // for blocked credits (s.17(5), itc_eligible=false) tax stays inside Purchases.
        // For RCM purchases the dual-entry (Dr Input + Cr RCM Output) is also created.
        taxableValue: finalSubtotal,
        cgstTotal: finalCgstTotal,
        sgstTotal: finalSgstTotal,
        igstTotal: finalIgstTotal,
        itcEligible: itc_eligible !== false,
        isReverseCharge: !!is_reverse_charge,
      });
    }

    // Update supplier current_balance (only if status is final and supplier exists)
    if (status === 'final' && normalizedSupplierId) {
      await client.query(
        `
        UPDATE suppliers
        SET current_balance = current_balance + $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `,
        [balanceAmount, normalizedSupplierId]
      );
    }

    // Create payment record if paid_amount > 0 (for cash flow tracking)
    if (status === 'final' && paid_amount > 0) {
      await client.query(
        `
        INSERT INTO payments (
          business_id, branch_id, type, supplier_id, reference_type, reference_id,
          amount, payment_mode, payment_date, notes, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
        [
          business_id,
          finalBranchId,
          'payable',
          normalizedSupplierId,
          'purchase',
          purchase.id,
          paid_amount,
          'cash',
          bill_date,
          `Payment for purchase ${bill_number || purchase.id.substring(0, 8)}`,
          created_by || null,
        ]
      );
    }

    await client.query('COMMIT');

    // CRITICAL: Log activity for audit trail
    if (status === 'final') {
      const { logActivity, getClientIP, getUserAgent } = await import('@/lib/activity-logger');
      const { validateBackdate } = await import('@/lib/backdate-controls');
      const backdateValidation = validateBackdate(bill_date, 365, 30);

      await logActivity({
        business_id,
        user_id: created_by || null,
        action_type: 'create',
        module: 'purchases',
        entity_id: purchase.id,
        entity_type: 'purchase',
        description: `Created purchase ${bill_number || 'New'} dated ${bill_date}${backdateValidation.isBackdated ? ` (backdated ${backdateValidation.daysBackdated} days)` : ''}`,
        ip_address: getClientIP(request),
        user_agent: getUserAgent(request),
        metadata: {
          bill_number: bill_number || null,
          bill_date,
          branch_id: finalBranchId,
          grand_total: finalGrandTotal,
          supplier_id: normalizedSupplierId,
          is_backdated: backdateValidation.isBackdated,
          days_backdated: backdateValidation.daysBackdated,
          backdate_reason: (body as any).backdate_reason || null,
        },
      });
    }

    // PHASE 4.3: Calculate credit metrics for supplier (if applicable)
    let creditMetrics = null;
    let creditWarning = null;

    if (purchase.supplier_id) {
      try {
        const supplierData = await client.query(
          `SELECT credit_limit, current_balance FROM suppliers WHERE id = $1 AND business_id = $2`,
          [purchase.supplier_id, business_id]
        );

        if (supplierData.rows.length > 0) {
          const creditLimit = supplierData.rows[0].credit_limit;
          const currentBalance = supplierData.rows[0].current_balance;

          const currentMetrics = calculateCreditMetrics(creditLimit, currentBalance);

          let projectedMetrics = null;
          if (status === 'final') {
            const purchaseBalance =
              purchase.balance_amount ??
              (parseFloat(purchase.grand_total ?? '0') - parseFloat(purchase.paid_amount ?? '0'));
            projectedMetrics = calculateProjectedCreditMetrics(
              creditLimit,
              currentBalance,
              purchaseBalance
            );
          }

          creditMetrics = {
            current: currentMetrics,
            projected: projectedMetrics,
          };

          creditWarning = getCreditWarningMessage(
            currentMetrics,
            'supplier',
            projectedMetrics || undefined
          );

          if (projectedMetrics) {
            checkAndSendCreditAlerts(
              business_id,
              'supplier',
              purchase.supplier_id,
              creditLimit,
              currentBalance,
              projectedMetrics,
              'purchase',
              purchase.id
            ).catch((err) => console.error('Error sending credit alert:', err));
          }
        }
      } catch (creditError) {
        console.error('Error calculating credit metrics:', creditError);
      }
    }

    return NextResponse.json(
      {
        purchase,
        credit_metrics: creditMetrics,
        credit_warning: creditWarning,
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
    if (error instanceof PurchaseStockError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          ...(error.details && typeof error.details === 'object' ? error.details : {}),
        },
        { status: error.statusCode }
      );
    }
    console.error('Error creating purchase:', error);
    return NextResponse.json(
      { error: 'Failed to create purchase', details: error.message },
      { status: 500 }
    );
  } finally {
    if (client) {
      client.release();
    }
  }
}

