import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';

/**
 * GET /api/currencies
 * List currencies
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

    const currencies = await queryRows(`
      SELECT * FROM currencies
      WHERE business_id = $1 AND is_active = true
      ORDER BY is_base_currency DESC, currency_code
    `, [businessId]);

    return NextResponse.json({ currencies });
  } catch (error: any) {
    console.error('Error fetching currencies:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/currencies
 * Add currency
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      currency_code,
      currency_name,
      symbol,
      is_base_currency = false,
    } = body;

    if (!business_id || !currency_code || !currency_name || !symbol) {
      return NextResponse.json(
        { error: 'business_id, currency_code, currency_name, and symbol are required' },
        { status: 400 }
      );
    }

    // If setting as base currency, unset other base currencies
    if (is_base_currency) {
      await queryOne(
        'UPDATE currencies SET is_base_currency = false WHERE business_id = $1',
        [business_id]
      );
    }

    // Check if currency already exists
    const existing = await queryOne(
      'SELECT id FROM currencies WHERE business_id = $1 AND currency_code = $2',
      [business_id, currency_code]
    );

    if (existing) {
      return NextResponse.json(
        { error: 'Currency already exists' },
        { status: 409 }
      );
    }

    const currency = await queryOne(
      `INSERT INTO currencies (
        business_id, currency_code, currency_name, symbol, is_base_currency
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [business_id, currency_code, currency_name, symbol, is_base_currency]
    );

    return NextResponse.json({ currency }, { status: 201 });
  } catch (error: any) {
    console.error('Error adding currency:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

