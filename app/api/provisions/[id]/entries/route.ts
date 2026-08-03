import { NextRequest, NextResponse } from 'next/server';
import { createProvisionEntry, getProvisionEntries } from '@/lib/services/provisions-manager';

export const dynamic = 'force-dynamic';

import { requireTenantBusinessId } from '@/lib/auth-helpers';

/**
 * GET /api/provisions/[id]/entries
 * Get provision entries
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;
    const financialYear = searchParams.get('financial_year');

    if (!businessId || !financialYear) {
      return NextResponse.json(
        { error: 'business_id and financial_year are required' },
        { status: 400 }
      );
    }

    const entries = await getProvisionEntries(
      businessId,
      financialYear,
      params.id
    );

    return NextResponse.json({ entries });
  } catch (error: any) {
    console.error('Error fetching provision entries:', error);
    return NextResponse.json(
      { error: 'Failed to fetch provision entries', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/provisions/[id]/entries
 * Create provision entry
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;
    const {
      financial_year,
      entry_date,
      entry_type,
      amount,
      reference_type,
      reference_id,
      narration,
    } = body;

    if (
      !business_id ||
      !financial_year ||
      !entry_date ||
      !entry_type ||
      !amount
    ) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const entryId = await createProvisionEntry(
      business_id,
      params.id,
      financial_year,
      entry_date,
      entry_type,
      amount,
      reference_type,
      reference_id,
      narration
    );

    return NextResponse.json({ id: entryId }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating provision entry:', error);
    return NextResponse.json(
      { error: 'Failed to create provision entry', details: error.message },
      { status: 500 }
    );
  }
}

