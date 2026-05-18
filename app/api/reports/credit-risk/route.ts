import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { calculateCreditMetrics } from '@/lib/credit-utils';

/**
 * GET /api/reports/credit-risk
 * Get credit risk data for business (read-only, derived data)
 * 
 * Returns:
 * - total_receivables: Sum of all customer current_balance (positive only)
 * - total_payables: Sum of all supplier current_balance (positive only)
 * - over_limit_count: Count of parties (customers + suppliers) over credit limit
 * - customers_by_risk: Customers sorted by utilization DESC
 * - suppliers_by_risk: Suppliers sorted by utilization DESC
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');

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
      await assertReportAccess(businessId, 'basic');
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

    // Fetch all customers with credit data
    const customers = await db.queryRows(`
      SELECT 
        id,
        name,
        phone,
        email,
        credit_limit,
        current_balance
      FROM customers
      WHERE business_id = $1 AND is_active = true AND deleted_at IS NULL
      ORDER BY name
    `, [businessId]);

    // Fetch all suppliers with credit data
    const suppliers = await db.queryRows(`
      SELECT 
        id,
        name,
        phone,
        email,
        credit_limit,
        current_balance
      FROM suppliers
      WHERE business_id = $1 AND is_active = true
      ORDER BY name
    `, [businessId]);

    // Calculate credit metrics for each customer
    const customersWithMetrics = customers.map(customer => {
      const metrics = calculateCreditMetrics(customer.credit_limit, customer.current_balance);
      return {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        ...metrics,
        credit_limit: parseFloat(customer.credit_limit ?? '0'),
        current_balance: parseFloat(customer.current_balance ?? '0'),
      };
    });

    // Calculate credit metrics for each supplier
    const suppliersWithMetrics = suppliers.map(supplier => {
      const metrics = calculateCreditMetrics(supplier.credit_limit, supplier.current_balance);
      return {
        id: supplier.id,
        name: supplier.name,
        phone: supplier.phone,
        email: supplier.email,
        ...metrics,
        credit_limit: parseFloat(supplier.credit_limit ?? '0'),
        current_balance: parseFloat(supplier.current_balance ?? '0'),
      };
    });

    // Sort by utilization DESC (null/unlimited goes to end)
    customersWithMetrics.sort((a, b) => {
      if (a.credit_utilization_percent === null && b.credit_utilization_percent === null) return 0;
      if (a.credit_utilization_percent === null) return 1;
      if (b.credit_utilization_percent === null) return -1;
      return b.credit_utilization_percent - a.credit_utilization_percent;
    });

    suppliersWithMetrics.sort((a, b) => {
      if (a.credit_utilization_percent === null && b.credit_utilization_percent === null) return 0;
      if (a.credit_utilization_percent === null) return 1;
      if (b.credit_utilization_percent === null) return -1;
      return b.credit_utilization_percent - a.credit_utilization_percent;
    });

    // Calculate totals
    const totalReceivables = customersWithMetrics.reduce((sum, c) => {
      return sum + Math.max(0, c.current_balance);
    }, 0);

    const totalPayables = suppliersWithMetrics.reduce((sum, s) => {
      return sum + Math.max(0, s.current_balance);
    }, 0);

    // Count parties over limit
    const overLimitCount = [
      ...customersWithMetrics.filter(c => c.credit_status === 'OVER_LIMIT'),
      ...suppliersWithMetrics.filter(s => s.credit_status === 'OVER_LIMIT'),
    ].length;

    return NextResponse.json({
      total_receivables: totalReceivables,
      total_payables: totalPayables,
      over_limit_count: overLimitCount,
      customers_by_risk: customersWithMetrics,
      suppliers_by_risk: suppliersWithMetrics,
    });
  } catch (error: any) {
    console.error('Error generating credit risk report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}
