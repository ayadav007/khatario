import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { fetchPartyLedgerDocs, type PartyType } from '@/lib/reports/party-ledger-docs';

export const dynamic = 'force-dynamic';

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

    if (!businessId || (partyType !== 'customer' && partyType !== 'supplier') || !partyId) {
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

    // A party deals with every branch; only narrow when the caller explicitly asks.
    const branchFilter = branchIdParam ? finalBranchId : null;

    const docs = await fetchPartyLedgerDocs({
      businessId,
      partyType: partyType as PartyType,
      asOfDate: toDate,
      partyId,
      branchId: branchFilter,
    });

    type Row = {
      id: string | null;
      reference_number: string;
      transaction_date: string;
      transaction_type: string;
      description: string;
      debit: number;
      credit: number;
    };
    // Customer: debit = amount owed by the party. Supplier statements keep the ledger view
    // (bill = credit, payment/return/TDS = debit) with the balance signed as "to pay".
    const toRow = (d: { voucherId: string | null; reference: string; docDate: string; voucherType: string; description: string; amount: number }): Row => {
      const increase = d.amount > 0 ? d.amount : 0;
      const decrease = d.amount < 0 ? -d.amount : 0;
      return {
        id: d.voucherId,
        reference_number: d.reference,
        transaction_date: d.docDate,
        transaction_type: d.voucherType,
        description: d.description,
        debit: partyType === 'customer' ? increase : decrease,
        credit: partyType === 'customer' ? decrease : increase,
      };
    };
    const signed = (r: Row) => (partyType === 'customer' ? r.debit - r.credit : r.credit - r.debit);

    const allDocRows: Row[] = docs.map(toRow);

    if (partyType === 'customer') {
      // Cash sales post straight to cash/bank, so they never touch receivables; show them as sale + receipt.
      const cashSales = await db.queryRows<{ id: string; invoice_number: string; invoice_date: string; grand_total: string }>(
        `SELECT i.id, i.invoice_number, i.invoice_date::text AS invoice_date, i.grand_total
           FROM invoices i
          WHERE i.business_id = $1 AND i.customer_id = $2 AND i.deleted_at IS NULL
            AND i.status NOT IN ('draft', 'cancelled')
            AND COALESCE(i.document_type, 'tax_invoice') NOT IN ('proforma_invoice', 'quotation', 'delivery_challan')
            AND i.invoice_date <= $3::date
            AND ($4::uuid IS NULL OR i.branch_id = $4::uuid)
            AND NOT EXISTS (
              SELECT 1 FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
               WHERE l.voucher_type = 'invoice' AND l.voucher_id = i.id AND a.account_code LIKE '1103%'
            )`,
        [businessId, partyId, toDate, branchFilter]
      );
      for (const inv of cashSales) {
        const amount = Number(inv.grand_total) || 0;
        const date = String(inv.invoice_date).slice(0, 10);
        allDocRows.push(
          { id: inv.id, reference_number: inv.invoice_number, transaction_date: date, transaction_type: 'invoice', description: 'Sale (cash)', debit: amount, credit: 0 },
          { id: inv.id, reference_number: inv.invoice_number, transaction_date: date, transaction_type: 'payment', description: 'Received at sale', debit: 0, credit: amount }
        );
      }
    }

    const advances = await db.queryRows<{ id: string; payment_date: string; amount: string }>(
      `SELECT ap.id, ap.payment_date::text AS payment_date, ap.amount
         FROM advance_payments ap
        WHERE ap.business_id = $1 AND ${partyType === 'customer' ? 'ap.customer_id' : 'ap.supplier_id'} = $2
          AND ap.type = $3 AND ap.payment_date <= $4::date`,
      [businessId, partyId, partyType === 'customer' ? 'received' : 'paid', toDate]
    ).catch(() => []);
    for (const ap of advances) {
      const amount = Number(ap.amount) || 0;
      allDocRows.push({
        id: ap.id,
        reference_number: `ADV-${ap.id.slice(0, 8)}`,
        transaction_date: String(ap.payment_date).slice(0, 10),
        transaction_type: 'advance',
        description: partyType === 'customer' ? 'Advance received' : 'Advance paid',
        debit: partyType === 'customer' ? 0 : amount,
        credit: partyType === 'customer' ? amount : 0,
      });
    }

    const r2 = (n: number) => Math.round(n * 100) / 100;
    const adjustedOpeningBalance = r2(
      allDocRows.filter((r) => r.transaction_date < fromDate).reduce((s, r) => s + signed(r), 0)
    );

    const openingBalanceRow = {
      id: null,
      reference_number: 'Opening Balance',
      transaction_date: fromDate,
      transaction_type: 'opening_balance',
      description: 'Opening Balance',
      debit: partyType === 'customer' ? Math.max(adjustedOpeningBalance, 0) : Math.max(-adjustedOpeningBalance, 0),
      credit: partyType === 'customer' ? Math.max(-adjustedOpeningBalance, 0) : Math.max(adjustedOpeningBalance, 0),
      running_balance: adjustedOpeningBalance,
      is_virtual: true,
    };

    let runningBalance = adjustedOpeningBalance;
    const transactions = allDocRows
      .filter((r) => r.transaction_date >= fromDate)
      .sort((a, b) =>
        a.transaction_date !== b.transaction_date
          ? a.transaction_date < b.transaction_date ? -1 : 1
          : signed(b) - signed(a)
      )
      .map((r) => {
        runningBalance = r2(runningBalance + signed(r));
        return { ...r, running_balance: runningBalance };
      });

    const allRows = [openingBalanceRow, ...transactions];
    const totalDebit = r2(allRows.reduce((sum, t) => sum + Number(t.debit || 0), 0));
    const totalCredit = r2(allRows.reduce((sum, t) => sum + Number(t.credit || 0), 0));
    const closingBalance = runningBalance;
    const closingBalanceType = partyType === 'customer'
      ? (closingBalance >= 0 ? 'debit' : 'credit')
      : (closingBalance >= 0 ? 'credit' : 'debit');

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
      opening_balance_type: partyType === 'customer'
        ? (adjustedOpeningBalance >= 0 ? 'debit' : 'credit')
        : (adjustedOpeningBalance >= 0 ? 'credit' : 'debit'),
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
