import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, getPool } from '@/lib/db';

/**
 * POST /api/accounts/initialize
 * Initialize default Chart of Accounts for an existing business
 * This is useful for businesses created before the auto-creation feature was added
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const { business_id } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    // Check if business exists
    const business = await queryOne(
      'SELECT id, name FROM businesses WHERE id = $1',
      [business_id]
    );

    if (!business) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      );
    }

    // Check if accounts already exist
    const existingAccounts = await queryOne(
      'SELECT COUNT(*) as count FROM accounts WHERE business_id = $1',
      [business_id]
    );

    if (parseInt(existingAccounts?.count || '0') > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { 
          error: 'Chart of Accounts already exists for this business',
          account_count: parseInt(existingAccounts?.count || '0')
        },
        { status: 400 }
      );
    }

    // Check if the function exists
    try {
      await client.query('SELECT create_default_chart_of_accounts($1)', [business_id]);
    } catch (error: any) {
      await client.query('ROLLBACK');
      
      // Check if it's because the function doesn't exist
      if (error.code === '42883') {
        return NextResponse.json(
          { 
            error: 'Chart of Accounts function not found. Please run migration 063_chart_of_accounts_seed.sql first.',
            details: error.message
          },
          { status: 500 }
        );
      }
      
      throw error;
    }

    // Get count of created accounts
    const accountCount = await queryOne(
      'SELECT COUNT(*) as count FROM accounts WHERE business_id = $1',
      [business_id]
    );

    // Get count of created groups
    const groupCount = await queryOne(
      'SELECT COUNT(*) as count FROM account_groups WHERE business_id = $1',
      [business_id]
    );

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      message: 'Default Chart of Accounts created successfully',
      business_id,
      business_name: business.name,
      account_groups_created: parseInt(groupCount?.count || '0'),
      accounts_created: parseInt(accountCount?.count || '0'),
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error initializing Chart of Accounts:', error);
    return NextResponse.json(
      { 
        error: error.message || 'Failed to initialize Chart of Accounts',
        details: error.message
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

