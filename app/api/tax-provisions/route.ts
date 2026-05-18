import { NextRequest, NextResponse } from 'next/server';
import {
  createOrUpdateTaxProvision,
  getTaxProvision,
  getAllTaxProvisions,
  recordTaxPayment,
  getTaxPayments,
} from '@/lib/services/tax-provision-calculator';

/**
 * GET /api/tax-provisions
 * Get tax provisions for a financial year
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const financialYear = searchParams.get('financial_year');
    const taxType = searchParams.get('tax_type') as 'current_tax' | 'deferred_tax' | null;

    if (!businessId || !financialYear) {
      return NextResponse.json(
        { error: 'business_id and financial_year are required' },
        { status: 400 }
      );
    }

    if (taxType) {
      const provision = await getTaxProvision(businessId, financialYear, taxType);
      return NextResponse.json({ provision });
    } else {
      const provisions = await getAllTaxProvisions(businessId, financialYear);
      return NextResponse.json(provisions);
    }
  } catch (error: any) {
    console.error('Error fetching tax provisions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tax provisions', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tax-provisions
 * Create or update tax provision
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      financial_year,
      tax_type,
      provision_amount,
      tax_account_id,
      expense_account_id,
      tax_rate,
      taxable_income,
      calculation_method,
      calculation_details,
      due_date,
    } = body;

    if (
      !business_id ||
      !financial_year ||
      !tax_type ||
      provision_amount === undefined ||
      !tax_account_id ||
      !expense_account_id
    ) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const provisionId = await createOrUpdateTaxProvision(
      business_id,
      financial_year,
      tax_type,
      provision_amount,
      tax_account_id,
      expense_account_id,
      tax_rate,
      taxable_income,
      calculation_method,
      calculation_details,
      due_date
    );

    const provision = await getTaxProvision(business_id, financial_year, tax_type);

    return NextResponse.json({ provision }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating tax provision:', error);
    return NextResponse.json(
      { error: 'Failed to create tax provision', details: error.message },
      { status: 500 }
    );
  }
}

