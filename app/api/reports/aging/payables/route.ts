import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows } from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getFinancialYearStartDate } from '@/lib/ledger-utils';
import { calculateCreditMetrics } from '@/lib/credit-utils';

/**
 * GET /api/reports/aging/payables
 * Generate payables aging report
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    const asOnDate = searchParams.get('as_on_date') || new Date().toISOString().split('T')[0];
    const supplierId = searchParams.get('supplier_id');

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

    // CRITICAL: Enforce subscription report access
    try {
      await assertReportAccess(businessId, 'advanced');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // CRITICAL: Resolve branch_id using helper (handles default branch fallback)
    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchIdParam,
        businessId: businessId,
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

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'report', 'read', {
        businessId,
        branchId: finalBranchId,
        resource: {
          business_id: businessId,
          branch_id: finalBranchId,
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get all outstanding purchases
    let sql = `
      SELECT 
        p.id as purchase_id,
        p.bill_number,
        p.bill_date,
        p.grand_total,
        p.supplier_id,
        s.name as supplier_name,
        COALESCE(SUM(pay.amount), 0) as total_paid
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN payments pay ON pay.reference_type = 'purchase' AND pay.reference_id = p.id AND pay.type = 'payable' AND pay.deleted_at IS NULL
      WHERE p.business_id = $1
        AND p.deleted_at IS NULL
        AND p.status != 'cancelled'
        AND p.bill_date <= $2
    `;
    const params: any[] = [businessId, asOnDate];
    let paramIndex = 3;

    if (supplierId) {
      sql += ` AND p.supplier_id = $${paramIndex}`;
      params.push(supplierId);
      paramIndex++;
    }

    sql += ` GROUP BY p.id, p.bill_number, p.bill_date, p.grand_total, p.supplier_id, s.name
             HAVING p.grand_total - COALESCE(SUM(pay.amount), 0) > 0
             ORDER BY p.supplier_id, p.bill_date`;

    const purchases = await queryRows(sql, params);

    // Get financial year start date for opening balance aging
    const fyStartDate = await getFinancialYearStartDate(businessId);
    const fyStartDateStr = fyStartDate.toISOString().split('T')[0];

    // Fetch supplier opening balances, current balances, and credit limits
    let supplierBalancesSql = `
      SELECT 
        id as supplier_id,
        name as supplier_name,
        opening_balance,
        opening_balance_type,
        current_balance,
        credit_limit
      FROM suppliers
      WHERE business_id = $1 AND is_active = true
    `;
    const supplierBalancesParams: any[] = [businessId];
    if (supplierId) {
      supplierBalancesSql += ` AND id = $2`;
      supplierBalancesParams.push(supplierId);
    }
    const supplierBalances = await queryRows(supplierBalancesSql, supplierBalancesParams);

    // Calculate aging buckets
    const agingMap = new Map<string, {
      supplier_id: string;
      supplier_name: string;
      total_outstanding: number;
      bucket_0_30: number;
      bucket_31_60: number;
      bucket_61_90: number;
      bucket_90_plus: number;
    }>();

    const asOn = new Date(asOnDate);
    const fyStart = new Date(fyStartDateStr);

    // Process purchases
    purchases.forEach((purchase: any) => {
      const purchaseDate = new Date(purchase.bill_date);
      const daysDiff = Math.floor((asOn.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24));
      const outstanding = parseFloat(purchase.grand_total) - parseFloat(purchase.total_paid || '0');

      if (!agingMap.has(purchase.supplier_id)) {
        agingMap.set(purchase.supplier_id, {
          supplier_id: purchase.supplier_id,
          supplier_name: purchase.supplier_name,
          total_outstanding: 0,
          bucket_0_30: 0,
          bucket_31_60: 0,
          bucket_61_90: 0,
          bucket_90_plus: 0,
        });
      }

      const aging = agingMap.get(purchase.supplier_id)!;
      aging.total_outstanding += outstanding;

      if (daysDiff <= 30) {
        aging.bucket_0_30 += outstanding;
      } else if (daysDiff <= 60) {
        aging.bucket_31_60 += outstanding;
      } else if (daysDiff <= 90) {
        aging.bucket_61_90 += outstanding;
      } else {
        aging.bucket_90_plus += outstanding;
      }
    });

    // PHASE 2: Inject opening balance into aging (virtual transaction in oldest bucket)
    // Opening balance injected for aging visibility (not a transaction)
    for (const supplier of supplierBalances) {
      const openingBalance = parseFloat(supplier.opening_balance ?? '0');
      if (openingBalance === 0) continue; // Skip zero opening balance

      // Calculate effective opening balance for payables
      // Supplier credit = payable (positive), Supplier debit = advance paid (negative)
      const effectiveOpeningBalance = supplier.opening_balance_type === 'credit' 
        ? openingBalance 
        : -openingBalance;

      if (effectiveOpeningBalance === 0) continue; // Skip if net zero

      // Initialize supplier in aging map if not present
      if (!agingMap.has(supplier.supplier_id)) {
        agingMap.set(supplier.supplier_id, {
          supplier_id: supplier.supplier_id,
          supplier_name: supplier.supplier_name,
          total_outstanding: 0,
          bucket_0_30: 0,
          bucket_31_60: 0,
          bucket_61_90: 0,
          bucket_90_plus: 0,
        });
      }

      const aging = agingMap.get(supplier.supplier_id)!;
      
      // Opening balance always goes to oldest bucket (90+ days)
      // Calculate days from financial year start to as_on_date
      const daysFromFyStart = Math.floor((asOn.getTime() - fyStart.getTime()) / (1000 * 60 * 60 * 24));
      
      // Always put in 90+ bucket (oldest)
      aging.bucket_90_plus += effectiveOpeningBalance;
      aging.total_outstanding += effectiveOpeningBalance;
    }

    // PHASE 4.5: Enhance aging report with credit risk data
    // Verify totals match current_balance and add credit metrics
    const aging = Array.from(agingMap.values()).map(entry => {
      const supplier = supplierBalances.find(s => s.supplier_id === entry.supplier_id);
      const calculatedTotal = entry.bucket_0_30 + entry.bucket_31_60 + entry.bucket_61_90 + entry.bucket_90_plus;
      const currentBalance = supplier ? parseFloat(supplier.current_balance ?? '0') : 0;
      
      // Log mismatch for debugging (should match if opening balance is correctly included)
      if (Math.abs(calculatedTotal - currentBalance) > 0.01) {
        console.warn(`[Aging] Supplier ${entry.supplier_id} total mismatch: calculated=${calculatedTotal}, current_balance=${currentBalance}`);
      }
      
      // Calculate credit metrics (if supplier found)
      let creditLimit = 0;
      let creditUtilizationPercent: number | null = null;
      let creditStatus: string = 'UNLIMITED';
      
      if (supplier) {
        const creditLimitValue = parseFloat(supplier.credit_limit ?? '0');
        const metrics = calculateCreditMetrics(creditLimitValue, currentBalance);
        creditLimit = metrics.credit_limit;
        creditUtilizationPercent = metrics.credit_utilization_percent;
        creditStatus = metrics.credit_status;
      }
      
      return {
        ...entry,
        credit_limit: creditLimit,
        credit_utilization_percent: creditUtilizationPercent,
        credit_status: creditStatus,
      };
    }).sort((a, b) => b.total_outstanding - a.total_outstanding);

    return NextResponse.json({
      as_on_date: asOnDate,
      aging,
    });
  } catch (error: any) {
    console.error('Error generating payables aging:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

