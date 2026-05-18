import { NextRequest, NextResponse } from 'next/server';
import { getAccountMappings, updateAccountMappings, autoDetectAccountMappings } from '@/lib/account-mappings';
import { AccountMappings } from '@/lib/account-mappings';

/**
 * GET /api/settings/account-mappings
 * Get account mappings for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const mappings = await getAccountMappings(businessId);

    return NextResponse.json({ mappings });
  } catch (error: any) {
    console.error('Error fetching account mappings:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settings/account-mappings
 * Update account mappings for a business
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, mappings } = body;

    if (!business_id || !mappings) {
      return NextResponse.json(
        { error: 'business_id and mappings are required' },
        { status: 400 }
      );
    }

    await updateAccountMappings(business_id, mappings as Partial<AccountMappings>);

    return NextResponse.json({ success: true, message: 'Account mappings updated' });
  } catch (error: any) {
    console.error('Error updating account mappings:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settings/account-mappings/auto-detect
 * Auto-detect and save account mappings from existing accounts
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const mappings = await autoDetectAccountMappings(business_id);

    return NextResponse.json({ 
      success: true, 
      message: 'Account mappings auto-detected and saved',
      mappings 
    });
  } catch (error: any) {
    console.error('Error auto-detecting account mappings:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

