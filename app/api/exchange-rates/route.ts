import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';

/**
 * GET /api/exchange-rates
 * Get exchange rate for a date
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const fromCurrency = searchParams.get('from_currency');
    const toCurrency = searchParams.get('to_currency');
    const rateDate = searchParams.get('rate_date') || new Date().toISOString().split('T')[0];

    if (!businessId || !fromCurrency || !toCurrency) {
      return NextResponse.json(
        { error: 'business_id, from_currency, and to_currency are required' },
        { status: 400 }
      );
    }

    // Get the most recent rate on or before the specified date
    const rate = await queryOne(`
      SELECT * FROM exchange_rates
      WHERE business_id = $1
        AND from_currency_code = $2
        AND to_currency_code = $3
        AND rate_date <= $4
        AND is_active = true
      ORDER BY rate_date DESC
      LIMIT 1
    `, [businessId, fromCurrency, toCurrency, rateDate]);

    if (!rate) {
      return NextResponse.json(
        { error: 'Exchange rate not found for the specified currencies and date' },
        { status: 404 }
      );
    }

    return NextResponse.json({ rate });
  } catch (error: any) {
    console.error('Error fetching exchange rate:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/exchange-rates
 * Add exchange rate
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      from_currency_code,
      to_currency_code,
      rate_date,
      exchange_rate,
    } = body;

    if (!business_id || !from_currency_code || !to_currency_code || !rate_date || !exchange_rate) {
      return NextResponse.json(
        { error: 'business_id, from_currency_code, to_currency_code, rate_date, and exchange_rate are required' },
        { status: 400 }
      );
    }

    // Check if rate already exists for this date
    const existing = await queryOne(
      'SELECT id FROM exchange_rates WHERE business_id = $1 AND from_currency_code = $2 AND to_currency_code = $3 AND rate_date = $4',
      [business_id, from_currency_code, to_currency_code, rate_date]
    );

    if (existing) {
      return NextResponse.json(
        { error: 'Exchange rate already exists for this date' },
        { status: 409 }
      );
    }

    const rate = await queryOne(
      `INSERT INTO exchange_rates (
        business_id, from_currency_code, to_currency_code, rate_date, exchange_rate
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [business_id, from_currency_code, to_currency_code, rate_date, exchange_rate]
    );

    return NextResponse.json({ rate }, { status: 201 });
  } catch (error: any) {
    console.error('Error adding exchange rate:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

