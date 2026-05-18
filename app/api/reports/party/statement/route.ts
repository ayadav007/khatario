import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/party/statement
 * Get period-based party statement (customer/supplier) with opening balance, transactions, and closing balance
 * This is a client-facing accounting statement (not a ledger)
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

    if (!fromDate || !toDate) {
      return NextResponse.json(
        { error: 'from_date and to_date are required for statement' },
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

    // Fetch party opening balance and opening balance type
    let storedOpeningBalance = 0;
    let storedOpeningBalanceType: 'debit' | 'credit' | null = null;
    
    if (partyType === 'customer') {
      const customer = await db.queryOne<{
        opening_balance: string | null;
        opening_balance_type: 'debit' | 'credit' | null;
      }>(`
        SELECT opening_balance, opening_balance_type
        FROM customers
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
      `, [partyId, businessId]);
      
      if (customer) {
        storedOpeningBalance = parseFloat(customer.opening_balance ?? '0');
        storedOpeningBalanceType = customer.opening_balance_type;
      }
    } else if (partyType === 'supplier') {
      const supplier = await db.queryOne<{
        opening_balance: string | null;
        opening_balance_type: 'debit' | 'credit' | null;
      }>(`
        SELECT opening_balance, opening_balance_type
        FROM suppliers
        WHERE id = $1 AND business_id = $2
      `, [partyId, businessId]);
      
      if (supplier) {
        storedOpeningBalance = parseFloat(supplier.opening_balance ?? '0');
        storedOpeningBalanceType = supplier.opening_balance_type;
      }
    }

    // Calculate opening balance from transactions BEFORE fromDate
    // Opening Balance = Stored opening balance + Sum(debit - credit) of ALL transactions BEFORE fromDate
    let transactionsBeforePeriod: any[] = [];
    
    if (partyType === 'customer') {
      // Invoices (Debit) before fromDate
      const invoicesBefore = await db.queryRows(`
        SELECT 
          i.grand_total as debit,
          0 as credit
        FROM invoices i
        WHERE i.business_id = $1 
          AND i.customer_id = $2
          AND i.deleted_at IS NULL
          AND i.status != 'cancelled'
          AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
          AND i.invoice_date < $3
      `, [businessId, partyId, fromDate]);

      // Payments received (Credit) before fromDate
      const paymentsBefore = await db.queryRows(`
        SELECT 
          0 as debit,
          p.amount as credit
        FROM payments p
        WHERE p.business_id = $1 
          AND p.customer_id = $2
          AND p.deleted_at IS NULL
          AND p.type = 'receivable'
          AND p.payment_date < $3
      `, [businessId, partyId, fromDate]);

      // Advance received (Credit) before fromDate
      const advancesBefore = await db.queryRows(`
        SELECT 
          0 as debit,
          ap.amount as credit
        FROM advance_payments ap
        WHERE ap.business_id = $1 
          AND ap.customer_id = $2
          AND ap.type = 'received'
          AND ap.payment_date < $3
      `, [businessId, partyId, fromDate]);

      transactionsBeforePeriod = [...invoicesBefore, ...paymentsBefore, ...advancesBefore];
    } else if (partyType === 'supplier') {
      // Purchases (Credit) before fromDate
      const purchasesBefore = await db.queryRows(`
        SELECT 
          0 as debit,
          p.grand_total as credit
        FROM purchases p
        WHERE p.business_id = $1 
          AND p.supplier_id = $2
          AND p.deleted_at IS NULL
          AND p.status != 'cancelled'
          AND p.bill_date < $3
      `, [businessId, partyId, fromDate]);

      // Payments made (Debit) before fromDate
      const paymentsBefore = await db.queryRows(`
        SELECT 
          p.amount as debit,
          0 as credit
        FROM payments p
        WHERE p.business_id = $1 
          AND p.supplier_id = $2
          AND p.deleted_at IS NULL
          AND p.type = 'payable'
          AND p.payment_date < $3
      `, [businessId, partyId, fromDate]);

      // Advance paid (Debit) before fromDate
      const advancesBefore = await db.queryRows(`
        SELECT 
          ap.amount as debit,
          0 as credit
        FROM advance_payments ap
        WHERE ap.business_id = $1 
          AND ap.supplier_id = $2
          AND ap.type = 'paid'
          AND ap.payment_date < $3
      `, [businessId, partyId, fromDate]);

      transactionsBeforePeriod = [...purchasesBefore, ...paymentsBefore, ...advancesBefore];
    }

    // Calculate net balance from transactions before period
    const netBalanceFromTransactions = transactionsBeforePeriod.reduce((sum, t) => {
      return sum + parseFloat(t.debit || 0) - parseFloat(t.credit || 0);
    }, 0);

    // Calculate adjusted opening balance as a signed number
    // For customer: "To Receive" (debit) is positive, "To Pay" (credit) is negative
    // For supplier: "To Pay" (credit) is positive, "To Receive" (debit) is negative
    let adjustedOpeningBalance = 0;

    if (partyType === 'customer') {
      // Customer opening balance contribution
      if (storedOpeningBalanceType === 'debit') {
        adjustedOpeningBalance += storedOpeningBalance; // "To Receive" → positive
      } else if (storedOpeningBalanceType === 'credit') {
        adjustedOpeningBalance -= storedOpeningBalance; // "To Pay" → negative
      }
    } else if (partyType === 'supplier') {
      // Supplier opening balance contribution
      if (storedOpeningBalanceType === 'credit') {
        adjustedOpeningBalance += storedOpeningBalance; // "To Pay" → positive
      } else if (storedOpeningBalanceType === 'debit') {
        adjustedOpeningBalance -= storedOpeningBalance; // "To Receive" → negative
      }
    }

    // Add net balance from transactions before period
    adjustedOpeningBalance += netBalanceFromTransactions;
    
    // Convert adjusted opening balance to debit/credit for virtual row
    // Positive balance = debit, Negative balance = credit
    let adjustedOpeningDebit = 0;
    let adjustedOpeningCredit = 0;
    if (adjustedOpeningBalance >= 0) {
      adjustedOpeningDebit = adjustedOpeningBalance;
    } else {
      adjustedOpeningCredit = Math.abs(adjustedOpeningBalance);
    }

    // PHASE 3.3: Create virtual opening balance row (not a transaction)
    // Opening balance injected for statement visibility (not a transaction)
    const openingBalanceRow = {
      id: null, // Not a real transaction
      reference_number: 'Opening Balance',
      transaction_date: fromDate, // Statement period start date
      transaction_type: 'opening_balance',
      description: 'Opening Balance',
      debit: adjustedOpeningDebit,
      credit: adjustedOpeningCredit,
      running_balance: adjustedOpeningBalance,
      is_virtual: true, // Mark as virtual row
    };

    // Fetch transactions BETWEEN fromDate and toDate
    let transactions: any[] = [];

    if (partyType === 'customer') {
      // Invoices (Debit) between fromDate and toDate
      const invoices = await db.queryRows(`
        SELECT 
          i.id,
          i.invoice_number as reference_number,
          i.invoice_date as transaction_date,
          'invoice' as transaction_type,
          'Sale' as description,
          i.grand_total as debit,
          0 as credit
        FROM invoices i
        WHERE i.business_id = $1 
          AND i.customer_id = $2
          AND i.deleted_at IS NULL
          AND i.status != 'cancelled'
          AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
          AND i.invoice_date >= $3
          AND i.invoice_date <= $4
        ORDER BY i.invoice_date ASC, i.created_at ASC
      `, [businessId, partyId, fromDate, toDate]);

      // Payments received (Credit) between fromDate and toDate
      const payments = await db.queryRows(`
        SELECT 
          p.id,
          ('PAY-' || SUBSTRING(p.id::text, 1, 8)) as reference_number,
          p.payment_date as transaction_date,
          'payment' as transaction_type,
          CONCAT('Payment - ', p.payment_mode) as description,
          0 as debit,
          p.amount as credit
        FROM payments p
        WHERE p.business_id = $1 
          AND p.customer_id = $2
          AND p.deleted_at IS NULL
          AND p.type = 'receivable'
          AND p.payment_date >= $3
          AND p.payment_date <= $4
        ORDER BY p.payment_date ASC, p.created_at ASC
      `, [businessId, partyId, fromDate, toDate]);

      // Advance received (Credit) between fromDate and toDate
      const advances = await db.queryRows(`
        SELECT 
          ap.id,
          ap.id::text as reference_number,
          ap.payment_date as transaction_date,
          'advance' as transaction_type,
          'Advance Received' as description,
          0 as debit,
          ap.amount as credit
        FROM advance_payments ap
        WHERE ap.business_id = $1 
          AND ap.customer_id = $2
          AND ap.type = 'received'
          AND ap.payment_date >= $3
          AND ap.payment_date <= $4
        ORDER BY ap.payment_date ASC, ap.created_at ASC
      `, [businessId, partyId, fromDate, toDate]);

      transactions = [...invoices, ...payments, ...advances];
    } else if (partyType === 'supplier') {
      // Purchases (Credit) between fromDate and toDate
      const purchases = await db.queryRows(`
        SELECT 
          p.id,
          p.bill_number as reference_number,
          p.bill_date as transaction_date,
          'purchase' as transaction_type,
          'Purchase' as description,
          0 as debit,
          p.grand_total as credit
        FROM purchases p
        WHERE p.business_id = $1 
          AND p.supplier_id = $2
          AND p.deleted_at IS NULL
          AND p.status != 'cancelled'
          AND p.bill_date >= $3
          AND p.bill_date <= $4
        ORDER BY p.bill_date ASC, p.created_at ASC
      `, [businessId, partyId, fromDate, toDate]);

      // Payments made (Debit) between fromDate and toDate
      const payments = await db.queryRows(`
        SELECT 
          p.id,
          ('PAY-' || SUBSTRING(p.id::text, 1, 8)) as reference_number,
          p.payment_date as transaction_date,
          'payment' as transaction_type,
          CONCAT('Payment - ', p.payment_mode) as description,
          p.amount as debit,
          0 as credit
        FROM payments p
        WHERE p.business_id = $1 
          AND p.supplier_id = $2
          AND p.deleted_at IS NULL
          AND p.type = 'payable'
          AND p.payment_date >= $3
          AND p.payment_date <= $4
        ORDER BY p.payment_date ASC, p.created_at ASC
      `, [businessId, partyId, fromDate, toDate]);

      // Advance paid (Debit) between fromDate and toDate
      const advances = await db.queryRows(`
        SELECT 
          ap.id,
          ap.id::text as reference_number,
          ap.payment_date as transaction_date,
          'advance' as transaction_type,
          'Advance Paid' as description,
          ap.amount as debit,
          0 as credit
        FROM advance_payments ap
        WHERE ap.business_id = $1 
          AND ap.supplier_id = $2
          AND ap.type = 'paid'
          AND ap.payment_date >= $3
          AND ap.payment_date <= $4
        ORDER BY ap.payment_date ASC, ap.created_at ASC
      `, [businessId, partyId, fromDate, toDate]);

      transactions = [...purchases, ...payments, ...advances];
    }

    // Sort by transaction_date ASC (stable ordering)
    transactions.sort((a, b) => {
      const dateA = new Date(a.transaction_date).getTime();
      const dateB = new Date(b.transaction_date).getTime();
      if (dateA !== dateB) {
        return dateA - dateB;
      }
      // Stable ordering for same-date entries: by id
      return (a.id || '').localeCompare(b.id || '');
    });

    // Calculate running balance starting from adjusted opening balance
    // running_balance = previous_balance + debit - credit
    let runningBalance = adjustedOpeningBalance;
    transactions = transactions.map(t => {
      runningBalance = runningBalance + parseFloat(t.debit || 0) - parseFloat(t.credit || 0);
      return { ...t, running_balance: runningBalance };
    });

    // Combine opening balance row with transactions
    const allRows = [openingBalanceRow, ...transactions];

    // Calculate totals
    const totalDebit = allRows.reduce((sum, t) => sum + parseFloat(t.debit || 0), 0);
    const totalCredit = allRows.reduce((sum, t) => sum + parseFloat(t.credit || 0), 0);
    const closingBalance = runningBalance; // Final running balance
    const closingBalanceType = closingBalance >= 0 ? 'debit' : 'credit';

    // Validation: opening_balance + total_debit - total_credit === closing_balance
    const calculatedClosingBalance = adjustedOpeningBalance + totalDebit - totalCredit;
    if (Math.abs(calculatedClosingBalance - closingBalance) > 0.01) {
      console.warn(
        `[Party Statement] Balance mismatch for ${partyType} ${partyId}: ` +
        `opening=${adjustedOpeningBalance}, total_debit=${totalDebit}, total_credit=${totalCredit}, ` +
        `calculated=${calculatedClosingBalance}, closing=${closingBalance}`
      );
    }

    // Get party details
    let partyDetails: any = {};
    let businessDetails: any = {};
    
    if (partyType === 'customer') {
      partyDetails = await db.queryOne(`
        SELECT name, phone, email, gstin, billing_address, shipping_address
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

    businessDetails = await db.queryOne(`
      SELECT name, address_line1, address_line2, city, state, pincode, gstin, phone, email
      FROM businesses
      WHERE id = $1
    `, [businessId]);

    return NextResponse.json({
      business: businessDetails,
      party: partyDetails,
      party_type: partyType,
      from_date: fromDate,
      to_date: toDate,
      opening_balance: adjustedOpeningBalance,
      opening_balance_type: adjustedOpeningBalance >= 0 ? 'debit' : 'credit',
      transactions: allRows, // Includes virtual opening balance row
      total_debit: totalDebit,
      total_credit: totalCredit,
      closing_balance: closingBalance,
      closing_balance_type: closingBalanceType,
    });
  } catch (error: any) {
    console.error('Error generating party statement:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}
