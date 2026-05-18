import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getFinancialYearStartDate } from '@/lib/ledger-utils';

/**
 * GET /api/reports/party/ageing
 * Get ageing report (outstanding categorized by age: 0-30, 30-60, 60+ days)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    const partyType = searchParams.get('party_type'); // 'customer' or 'supplier'
    const asOfDate = searchParams.get('as_of_date') || new Date().toISOString().split('T')[0];

    if (!businessId || !partyType) {
      return NextResponse.json(
        { error: 'business_id and party_type are required' },
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

    // Get financial year start date for opening balance aging
    const fyStartDate = await getFinancialYearStartDate(businessId);
    const fyStartDateStr = fyStartDate.toISOString().split('T')[0];
    const asOn = new Date(asOfDate);
    const fyStart = new Date(fyStartDateStr);
    const daysFromFyStart = Math.floor((asOn.getTime() - fyStart.getTime()) / (1000 * 60 * 60 * 24));

    let ageingData: any[] = [];

    if (partyType === 'customer') {
      ageingData = await db.queryRows(`
        SELECT 
          c.id as party_id,
          c.name as party_name,
          c.phone as party_phone,
          i.id as transaction_id,
          i.invoice_number as reference_number,
          i.invoice_date,
          i.due_date,
          (i.grand_total - i.paid_amount) as outstanding,
          CASE 
            WHEN (CURRENT_DATE - COALESCE(i.due_date, i.invoice_date)) <= 30 THEN '0-30'
            WHEN (CURRENT_DATE - COALESCE(i.due_date, i.invoice_date)) <= 60 THEN '30-60'
            ELSE '60+'
          END as age_bucket,
          CURRENT_DATE - COALESCE(i.due_date, i.invoice_date) as days_old
        FROM invoices i
        INNER JOIN customers c ON i.customer_id = c.id AND c.deleted_at IS NULL
        WHERE i.business_id = $1 
          AND i.deleted_at IS NULL
          AND i.status != 'cancelled'
          AND (i.grand_total - i.paid_amount) > 0
          AND i.invoice_date <= $2
        ORDER BY c.name, i.invoice_date DESC
      `, [businessId, asOfDate]);

      // PHASE 2: Inject opening balance as virtual transaction (not a real transaction)
      // Opening balance injected for aging visibility (not a transaction)
      const customersWithOpeningBalance = await db.queryRows(`
        SELECT 
          id as party_id,
          name as party_name,
          phone as party_phone,
          opening_balance,
          opening_balance_type,
          current_balance
        FROM customers
        WHERE business_id = $1 
          AND deleted_at IS NULL
          AND is_active = true
          AND opening_balance > 0
      `, [businessId]);

      for (const customer of customersWithOpeningBalance) {
        const openingBalance = parseFloat(customer.opening_balance ?? '0');
        if (openingBalance === 0) continue;

        // Calculate effective opening balance for receivables
        // Customer debit = receivable (positive), Customer credit = advance (negative)
        const effectiveOpeningBalance = customer.opening_balance_type === 'debit' 
          ? openingBalance 
          : -openingBalance;

        if (effectiveOpeningBalance === 0) continue;

        // Add as virtual transaction row in oldest bucket (60+)
        ageingData.push({
          party_id: customer.party_id,
          party_name: customer.party_name,
          party_phone: customer.party_phone,
          transaction_id: null, // Not a real transaction
          reference_number: 'Opening Balance', // Virtual reference
          invoice_date: fyStartDateStr, // Financial year start date
          due_date: null,
          outstanding: effectiveOpeningBalance,
          age_bucket: '60+', // Always in oldest bucket
          days_old: daysFromFyStart > 0 ? daysFromFyStart : 0,
        });
      }
    } else if (partyType === 'supplier') {
      ageingData = await db.queryRows(`
        SELECT 
          s.id as party_id,
          s.name as party_name,
          s.phone as party_phone,
          p.id as transaction_id,
          p.bill_number as reference_number,
          p.bill_date as invoice_date,
          NULL as due_date,
          (p.grand_total - p.paid_amount) as outstanding,
          CASE 
            WHEN (CURRENT_DATE - p.bill_date) <= 30 THEN '0-30'
            WHEN (CURRENT_DATE - p.bill_date) <= 60 THEN '30-60'
            ELSE '60+'
          END as age_bucket,
          CURRENT_DATE - p.bill_date as days_old
        FROM purchases p
        INNER JOIN suppliers s ON p.supplier_id = s.id
        WHERE p.business_id = $1 
          AND p.deleted_at IS NULL
          AND p.status != 'cancelled'
          AND (p.grand_total - p.paid_amount) > 0
          AND p.bill_date <= $2
        ORDER BY s.name, p.bill_date DESC
      `, [businessId, asOfDate]);

      // PHASE 2: Inject opening balance as virtual transaction (not a real transaction)
      // Opening balance injected for aging visibility (not a transaction)
      const suppliersWithOpeningBalance = await db.queryRows(`
        SELECT 
          id as party_id,
          name as party_name,
          phone as party_phone,
          opening_balance,
          opening_balance_type,
          current_balance
        FROM suppliers
        WHERE business_id = $1 
          AND is_active = true
          AND opening_balance > 0
      `, [businessId]);

      for (const supplier of suppliersWithOpeningBalance) {
        const openingBalance = parseFloat(supplier.opening_balance ?? '0');
        if (openingBalance === 0) continue;

        // Calculate effective opening balance for payables
        // Supplier credit = payable (positive), Supplier debit = advance paid (negative)
        const effectiveOpeningBalance = supplier.opening_balance_type === 'credit' 
          ? openingBalance 
          : -openingBalance;

        if (effectiveOpeningBalance === 0) continue;

        // Add as virtual transaction row in oldest bucket (60+)
        ageingData.push({
          party_id: supplier.party_id,
          party_name: supplier.party_name,
          party_phone: supplier.party_phone,
          transaction_id: null, // Not a real transaction
          reference_number: 'Opening Balance', // Virtual reference
          invoice_date: fyStartDateStr, // Financial year start date
          due_date: null,
          outstanding: effectiveOpeningBalance,
          age_bucket: '60+', // Always in oldest bucket
          days_old: daysFromFyStart > 0 ? daysFromFyStart : 0,
        });
      }
    }

    // Group by party and age bucket
    const grouped: Record<string, any> = {};
    ageingData.forEach(row => {
      const key = row.party_id;
      if (!grouped[key]) {
        grouped[key] = {
          party_id: row.party_id,
          party_name: row.party_name,
          party_phone: row.party_phone,
          transactions: [],
          age_0_30: 0,
          age_30_60: 0,
          age_60_plus: 0,
          total: 0,
        };
      }
      grouped[key].transactions.push(row);
      const amount = parseFloat(row.outstanding || 0);
      grouped[key].total += amount;
      if (row.age_bucket === '0-30') {
        grouped[key].age_0_30 += amount;
      } else if (row.age_bucket === '30-60') {
        grouped[key].age_30_60 += amount;
      } else {
        grouped[key].age_60_plus += amount;
      }
    });

    const summary = Object.values(grouped);
    const totals = summary.reduce((acc, row: any) => {
      acc.age_0_30 += row.age_0_30;
      acc.age_30_60 += row.age_30_60;
      acc.age_60_plus += row.age_60_plus;
      acc.total += row.total;
      return acc;
    }, {
      age_0_30: 0,
      age_30_60: 0,
      age_60_plus: 0,
      total: 0,
    });

    return NextResponse.json({
      party_type: partyType,
      as_of_date: asOfDate,
      summary,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating ageing report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

