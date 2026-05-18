import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getFinancialYearStartDate } from '@/lib/ledger-utils';

/**
 * GET /api/reports/party/ledger
 * Get party ledger report (customer or supplier transaction history)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    const partyType = searchParams.get('party_type'); // 'customer' or 'supplier'
    const partyId = searchParams.get('party_id');
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');

    if (!businessId || !partyType || !partyId) {
      return NextResponse.json(
        { error: 'business_id, party_type, and party_id are required' },
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

    // Get user's accessible branch IDs
    let accessibleBranchIds: string[] = [];
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
    } catch (error) {
      console.error('Error fetching user accessible branches:', error);
      // If error, return empty result to be safe
      return NextResponse.json({
        openingBalance: 0,
        openingBalanceType: null,
        currentBalance: 0,
        transactions: [],
        summary: {
          totalDebit: 0,
          totalCredit: 0,
          balance: 0
        }
      });
    }

    // If user has no branch access, return empty result
    if (accessibleBranchIds.length === 0) {
      return NextResponse.json({
        openingBalance: 0,
        openingBalanceType: null,
        currentBalance: 0,
        transactions: [],
        summary: {
          totalDebit: 0,
          totalCredit: 0,
          balance: 0
        }
      });
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

    // CRITICAL: Verify user has access to the resolved branch
    if (!accessibleBranchIds.includes(finalBranchId)) {
      return NextResponse.json(
        { error: 'You do not have access to this branch' },
        { status: 403 }
      );
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

    // Build date filters for different tables
    const buildDateFilter = (dateColumn: string, baseParams: any[], startIndex: number) => {
      let filter = '';
      let params = [...baseParams];
      let idx = startIndex;
      
      if (fromDate) {
        filter += ` AND ${dateColumn} >= $${idx}`;
        params.push(fromDate);
        idx++;
      }
      if (toDate) {
        filter += ` AND ${dateColumn} <= $${idx}`;
        params.push(toDate);
        idx++;
      }
      return { filter, params };
    };

    const baseParams = [businessId, partyId];

    // Fetch party opening balance and current balance
    let partyOpeningBalance = 0;
    let partyOpeningBalanceType: 'debit' | 'credit' | null = null;
    let partyCurrentBalance = 0;
    
    if (partyType === 'customer') {
      const customer = await db.queryOne<{
        opening_balance: string | null;
        opening_balance_type: 'debit' | 'credit' | null;
        current_balance: string | null;
      }>(`
        SELECT opening_balance, opening_balance_type, current_balance
        FROM customers
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
      `, [partyId, businessId]);
      
      if (customer) {
        partyOpeningBalance = parseFloat(customer.opening_balance ?? '0');
        partyOpeningBalanceType = customer.opening_balance_type;
        partyCurrentBalance = parseFloat(customer.current_balance ?? '0');
      }
    } else if (partyType === 'supplier') {
      const supplier = await db.queryOne<{
        opening_balance: string | null;
        opening_balance_type: 'debit' | 'credit' | null;
        current_balance: string | null;
      }>(`
        SELECT opening_balance, opening_balance_type, current_balance
        FROM suppliers
        WHERE id = $1 AND business_id = $2
      `, [partyId, businessId]);
      
      if (supplier) {
        partyOpeningBalance = parseFloat(supplier.opening_balance ?? '0');
        partyOpeningBalanceType = supplier.opening_balance_type;
        partyCurrentBalance = parseFloat(supplier.current_balance ?? '0');
      }
    }

    let transactions: any[] = [];

    if (partyType === 'customer') {
      // Invoices (Debit) - Filter by branch
      const invoiceDateFilter = buildDateFilter('i.invoice_date', baseParams, 3);
      const invoiceBranchFilter = ` AND i.branch_id = ANY($${invoiceDateFilter.params.length + 1}::uuid[])`;
      const invoices = await db.queryRows(`
        SELECT 
          i.id,
          i.invoice_number as reference_number,
          i.invoice_date as transaction_date,
          'invoice' as transaction_type,
          'Sale' as description,
          i.grand_total as debit,
          0 as credit,
          i.paid_amount,
          (i.grand_total - i.paid_amount) as balance
        FROM invoices i
        WHERE i.business_id = $1 
          AND i.deleted_at IS NULL
          AND i.customer_id = $2
          AND i.status != 'cancelled'
          AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
          ${invoiceDateFilter.filter}
          ${invoiceBranchFilter}
      `, [...invoiceDateFilter.params, accessibleBranchIds]);

      // Payments received (Credit) - Filter by branch
      const paymentDateFilter = buildDateFilter('p.payment_date', baseParams, 3);
      const paymentBranchFilter = ` AND p.branch_id = ANY($${paymentDateFilter.params.length + 1}::uuid[])`;
      const payments = await db.queryRows(`
        SELECT 
          p.id,
          ('PAY-' || SUBSTRING(p.id::text, 1, 8)) as reference_number,
          p.payment_date as transaction_date,
          'payment' as transaction_type,
          CONCAT('Payment - ', p.payment_mode) as description,
          0 as debit,
          p.amount as credit,
          0 as paid_amount,
          0 as balance
        FROM payments p
        WHERE p.business_id = $1 
          AND p.deleted_at IS NULL
          AND p.customer_id = $2
          AND p.type = 'receivable'
          ${paymentDateFilter.filter}
          ${paymentBranchFilter}
      `, [...paymentDateFilter.params, accessibleBranchIds]);

      // Advance received (Credit) - Note: advance_payments may not have branch_id
      const advanceDateFilter = buildDateFilter('ap.payment_date', baseParams, 3);
      const advances = await db.queryRows(`
        SELECT 
          ap.id,
          ap.id::text as reference_number,
          ap.payment_date as transaction_date,
          'advance' as transaction_type,
          'Advance Received' as description,
          0 as debit,
          ap.amount as credit,
          0 as paid_amount,
          0 as balance
        FROM advance_payments ap
        WHERE ap.business_id = $1 
          AND ap.customer_id = $2
          AND ap.type = 'received'
          ${advanceDateFilter.filter}
      `, advanceDateFilter.params);

      transactions = [...invoices, ...payments, ...advances];
    } else if (partyType === 'supplier') {
      // Purchases (Credit) - Filter by branch
      const purchaseDateFilter = buildDateFilter('p.bill_date', baseParams, 3);
      const purchaseBranchFilter = ` AND p.branch_id = ANY($${purchaseDateFilter.params.length + 1}::uuid[])`;
      const purchases = await db.queryRows(`
        SELECT 
          p.id,
          p.bill_number as reference_number,
          p.bill_date as transaction_date,
          'purchase' as transaction_type,
          'Purchase' as description,
          0 as debit,
          p.grand_total as credit,
          p.paid_amount,
          (p.grand_total - p.paid_amount) as balance
        FROM purchases p
        WHERE p.business_id = $1 
          AND p.deleted_at IS NULL
          AND p.supplier_id = $2
          AND p.status != 'cancelled'
          ${purchaseDateFilter.filter}
          ${purchaseBranchFilter}
      `, [...purchaseDateFilter.params, accessibleBranchIds]);

      // Payments made (Debit) - Filter by branch
      const paymentDateFilter = buildDateFilter('p.payment_date', baseParams, 3);
      const paymentBranchFilter = ` AND p.branch_id = ANY($${paymentDateFilter.params.length + 1}::uuid[])`;
      const payments = await db.queryRows(`
        SELECT 
          p.id,
          ('PAY-' || SUBSTRING(p.id::text, 1, 8)) as reference_number,
          p.payment_date as transaction_date,
          'payment' as transaction_type,
          CONCAT('Payment - ', p.payment_mode) as description,
          p.amount as debit,
          0 as credit,
          0 as paid_amount,
          0 as balance
        FROM payments p
        WHERE p.business_id = $1 
          AND p.deleted_at IS NULL
          AND p.supplier_id = $2
          AND p.type = 'payable'
          ${paymentDateFilter.filter}
          ${paymentBranchFilter}
      `, [...paymentDateFilter.params, accessibleBranchIds]);

      // Advance paid (Debit)
      const advanceDateFilter = buildDateFilter('ap.payment_date', baseParams, 3);
      const advances = await db.queryRows(`
        SELECT 
          ap.id,
          ap.id::text as reference_number,
          ap.payment_date as transaction_date,
          'advance' as transaction_type,
          'Advance Paid' as description,
          ap.amount as debit,
          0 as credit,
          0 as paid_amount,
          0 as balance
        FROM advance_payments ap
        WHERE ap.business_id = $1 
          AND ap.supplier_id = $2
          AND ap.type = 'paid'
          ${advanceDateFilter.filter}
      `, advanceDateFilter.params);

      transactions = [...purchases, ...payments, ...advances];
    }

    // Get financial year start date for opening balance
    const fyStartDate = await getFinancialYearStartDate(businessId);
    const fyStartDateStr = fyStartDate.toISOString().split('T')[0];

    // PHASE 2: Create virtual opening balance row (not a transaction)
    // Opening balance injected for ledger visibility (not a transaction)
    if (partyOpeningBalance > 0 && partyOpeningBalanceType) {
      let openingDebit = 0;
      let openingCredit = 0;

      if (partyType === 'customer') {
        // Customer: "To Receive" (debit opening balance) → Debit, "To Pay" (credit opening balance) → Credit
        if (partyOpeningBalanceType === 'debit') {
          openingDebit = partyOpeningBalance;
        } else {
          openingCredit = partyOpeningBalance;
        }
      } else if (partyType === 'supplier') {
        // Supplier: "To Pay" (credit opening balance) → Credit, "To Receive" (debit opening balance) → Debit
        if (partyOpeningBalanceType === 'credit') {
          openingCredit = partyOpeningBalance;
        } else {
          openingDebit = partyOpeningBalance;
        }
      }

      // Create virtual opening balance row at the top
      const openingBalanceRow = {
        id: null, // Not a real transaction
        reference_number: 'Opening Balance',
        transaction_date: fyStartDateStr, // Financial year start date
        transaction_type: 'opening_balance',
        description: 'Opening Balance',
        debit: openingDebit,
        credit: openingCredit,
        paid_amount: 0,
        balance: 0,
        is_virtual: true, // Mark as virtual row
      };

      // Insert at the beginning of transactions array
      transactions.unshift(openingBalanceRow);
    }

    // Sort by date (opening balance will be first due to FY start date being earliest)
    transactions.sort((a, b) => {
      const dateA = new Date(a.transaction_date).getTime();
      const dateB = new Date(b.transaction_date).getTime();
      if (dateA !== dateB) {
        return dateA - dateB;
      }
      // Stable ordering for same-date entries: opening balance first, then by id
      if (a.is_virtual) return -1;
      if (b.is_virtual) return 1;
      return (a.id || '').localeCompare(b.id || '');
    });

    // Calculate running balance sequentially
    // running_balance = previous_balance + debit - credit
    let runningBalance = 0;
    transactions = transactions.map(t => {
      runningBalance = runningBalance + parseFloat(t.debit || 0) - parseFloat(t.credit || 0);
      return { ...t, running_balance: runningBalance };
    });

    // Calculate opening balance from transactions before fromDate (if date filter provided)
    // This is used for date-filtered reports to show balance at start of period
    let openingBalanceFromTransactions = 0;
    if (fromDate) {
      if (partyType === 'customer') {
        const opening = await db.queryOne(`
          SELECT 
            COALESCE(SUM(i.grand_total - i.paid_amount), 0) as outstanding
          FROM invoices i
          WHERE i.business_id = $1 
            AND i.customer_id = $2
            AND i.deleted_at IS NULL
            AND i.status != 'cancelled'
            AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
            AND i.invoice_date < $3
        `, [businessId, partyId, fromDate]);
        openingBalanceFromTransactions = parseFloat(opening?.outstanding || 0);
      } else {
        const opening = await db.queryOne(`
          SELECT 
            COALESCE(SUM(p.grand_total - p.paid_amount), 0) as outstanding
          FROM purchases p
          WHERE p.business_id = $1 
            AND p.supplier_id = $2
            AND p.deleted_at IS NULL
            AND p.status != 'cancelled'
            AND p.bill_date < $3
        `, [businessId, partyId, fromDate]);
        openingBalanceFromTransactions = parseFloat(opening?.outstanding || 0);
      }
    }

    // Validation: Final running balance MUST equal party.current_balance
    const finalRunningBalance = transactions.length > 0 
      ? transactions[transactions.length - 1].running_balance 
      : 0;
    
    if (Math.abs(finalRunningBalance - partyCurrentBalance) > 0.01) {
      console.warn(
        `[Party Ledger] Balance mismatch for ${partyType} ${partyId}: ` +
        `calculated=${finalRunningBalance}, current_balance=${partyCurrentBalance}`
      );
    }

    // Get party details
    let partyDetails: any = {};
    if (partyType === 'customer') {
      partyDetails = await db.queryOne(`
        SELECT name, phone, email, gstin, billing_address
        FROM customers
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
      `, [partyId, businessId]);
    } else {
      partyDetails = await db.queryOne(`
        SELECT name, phone, email, gstin, address
        FROM suppliers
        WHERE id = $1 AND business_id = $2
      `, [partyId, businessId]);
    }

    return NextResponse.json({
      party_type: partyType,
      party_details: partyDetails,
      opening_balance: openingBalanceFromTransactions, // Balance from transactions before fromDate (if filtered)
      transactions,
      closing_balance: finalRunningBalance, // Final running balance (includes opening balance)
    });
  } catch (error: any) {
    console.error('Error generating party ledger report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

