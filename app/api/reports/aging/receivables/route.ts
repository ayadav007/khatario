import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows, queryOne } from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getFinancialYearStartDate } from '@/lib/ledger-utils';
import { calculateCreditMetrics } from '@/lib/credit-utils';

/**
 * GET /api/reports/aging/receivables
 * Generate receivables aging report
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    const asOnDate = searchParams.get('as_on_date') || new Date().toISOString().split('T')[0];
    const customerId = searchParams.get('customer_id');

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

    // Get all outstanding invoices
    let sql = `
      SELECT 
        i.id as invoice_id,
        i.invoice_number,
        i.invoice_date,
        i.grand_total,
        i.customer_id,
        c.name as customer_name,
        COALESCE(SUM(p.amount), 0) as total_paid
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id AND c.deleted_at IS NULL
      LEFT JOIN payments p ON p.reference_type = 'invoice' AND p.reference_id = i.id AND p.type = 'receivable' AND p.deleted_at IS NULL
      WHERE i.business_id = $1
        AND i.deleted_at IS NULL
        AND i.status != 'cancelled'
        AND i.invoice_date <= $2
    `;
    const params: any[] = [businessId, asOnDate];
    let paramIndex = 3;

    if (customerId) {
      sql += ` AND i.customer_id = $${paramIndex}`;
      params.push(customerId);
      paramIndex++;
    }

    sql += ` GROUP BY i.id, i.invoice_number, i.invoice_date, i.grand_total, i.customer_id, c.name
             HAVING i.grand_total - COALESCE(SUM(p.amount), 0) > 0
             ORDER BY i.customer_id, i.invoice_date`;

    const invoices = await queryRows(sql, params);

    // Get financial year start date for opening balance aging
    const fyStartDate = await getFinancialYearStartDate(businessId);
    const fyStartDateStr = fyStartDate.toISOString().split('T')[0];

    // Fetch customer opening balances, current balances, and credit limits
    let customerBalancesSql = `
      SELECT 
        id as customer_id,
        name as customer_name,
        opening_balance,
        opening_balance_type,
        current_balance,
        credit_limit
      FROM customers
      WHERE business_id = $1 AND is_active = true AND deleted_at IS NULL
    `;
    const customerBalancesParams: any[] = [businessId];
    if (customerId) {
      customerBalancesSql += ` AND id = $2`;
      customerBalancesParams.push(customerId);
    }
    const customerBalances = await queryRows(customerBalancesSql, customerBalancesParams);

    // Calculate aging buckets
    const agingMap = new Map<string, {
      customer_id: string;
      customer_name: string;
      total_outstanding: number;
      bucket_0_30: number;
      bucket_31_60: number;
      bucket_61_90: number;
      bucket_90_plus: number;
    }>();

    const asOn = new Date(asOnDate);
    const fyStart = new Date(fyStartDateStr);

    // Process invoices
    invoices.forEach((invoice: any) => {
      const invoiceDate = new Date(invoice.invoice_date);
      const daysDiff = Math.floor((asOn.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24));
      const outstanding = parseFloat(invoice.grand_total) - parseFloat(invoice.total_paid || '0');

      if (!agingMap.has(invoice.customer_id)) {
        agingMap.set(invoice.customer_id, {
          customer_id: invoice.customer_id,
          customer_name: invoice.customer_name,
          total_outstanding: 0,
          bucket_0_30: 0,
          bucket_31_60: 0,
          bucket_61_90: 0,
          bucket_90_plus: 0,
        });
      }

      const aging = agingMap.get(invoice.customer_id)!;
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
    for (const customer of customerBalances) {
      const openingBalance = parseFloat(customer.opening_balance ?? '0');
      if (openingBalance === 0) continue; // Skip zero opening balance

      // Calculate effective opening balance for receivables
      // Customer debit = receivable (positive), Customer credit = advance (negative)
      const effectiveOpeningBalance = customer.opening_balance_type === 'debit' 
        ? openingBalance 
        : -openingBalance;

      if (effectiveOpeningBalance === 0) continue; // Skip if net zero

      // Initialize customer in aging map if not present
      if (!agingMap.has(customer.customer_id)) {
        agingMap.set(customer.customer_id, {
          customer_id: customer.customer_id,
          customer_name: customer.customer_name,
          total_outstanding: 0,
          bucket_0_30: 0,
          bucket_31_60: 0,
          bucket_61_90: 0,
          bucket_90_plus: 0,
        });
      }

      const aging = agingMap.get(customer.customer_id)!;
      
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
      const customer = customerBalances.find(c => c.customer_id === entry.customer_id);
      const calculatedTotal = entry.bucket_0_30 + entry.bucket_31_60 + entry.bucket_61_90 + entry.bucket_90_plus;
      const currentBalance = customer ? parseFloat(customer.current_balance ?? '0') : 0;
      
      // Log mismatch for debugging (should match if opening balance is correctly included)
      if (Math.abs(calculatedTotal - currentBalance) > 0.01) {
        console.warn(`[Aging] Customer ${entry.customer_id} total mismatch: calculated=${calculatedTotal}, current_balance=${currentBalance}`);
      }
      
      // Calculate credit metrics (if customer found)
      let creditLimit = 0;
      let creditUtilizationPercent: number | null = null;
      let creditStatus: string = 'UNLIMITED';
      
      if (customer) {
        const creditLimitValue = parseFloat(customer.credit_limit ?? '0');
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
    console.error('Error generating receivables aging:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

