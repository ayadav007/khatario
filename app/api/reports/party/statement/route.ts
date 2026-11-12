import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import type { PartyType } from '@/lib/reports/party-ledger-docs';
import { computePartyStatement } from '@/lib/reports/party-statement';

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

    const statement = await computePartyStatement({
      businessId,
      partyType: partyType as PartyType,
      partyId,
      fromDate,
      toDate,
      branchFilter,
    });
    const adjustedOpeningBalance = statement.opening_balance;
    const allRows = statement.transactions;
    const totalDebit = statement.total_debit;
    const totalCredit = statement.total_credit;
    const closingBalance = statement.closing_balance;
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
