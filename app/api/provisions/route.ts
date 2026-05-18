import { NextRequest, NextResponse } from 'next/server';
import {
  createProvision,
  getProvisions,
  getProvisionById,
  createProvisionEntry,
  getProvisionEntries,
  getTotalProvisions,
  calculateBadDebtsProvision,
} from '@/lib/services/provisions-manager';

/**
 * GET /api/provisions
 * Get all provisions for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const financialYear = searchParams.get('financial_year');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const provisions = await getProvisions(businessId);

    // If financial year provided, include balances
    if (financialYear) {
      const asOnDate = new Date().toISOString().split('T')[0];
      const provisionsWithBalances = await Promise.all(
        provisions.map(async (provision) => {
          const entries = await getProvisionEntries(
            businessId,
            financialYear,
            provision.id
          );
          const latestEntry = entries[0];
          return {
            ...provision,
            current_balance: latestEntry?.closing_balance || 0,
            entries_count: entries.length,
          };
        })
      );

      return NextResponse.json({ provisions: provisionsWithBalances });
    }

    return NextResponse.json({ provisions });
  } catch (error: any) {
    console.error('Error fetching provisions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch provisions', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/provisions
 * Create a new provision
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      provision_code,
      provision_name,
      provision_type,
      provision_account_id,
      expense_account_id,
      calculation_method,
      calculation_rate,
      description,
    } = body;

    if (!business_id || !provision_code || !provision_name || !provision_type) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const provisionId = await createProvision(business_id, {
      provision_code,
      provision_name,
      provision_type,
      provision_account_id,
      expense_account_id,
      calculation_method,
      calculation_rate,
      description,
      is_active: true,
    });

    const provision = await getProvisionById(provisionId, business_id);

    return NextResponse.json({ provision }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating provision:', error);
    return NextResponse.json(
      { error: 'Failed to create provision', details: error.message },
      { status: 500 }
    );
  }
}

