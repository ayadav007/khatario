import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, getPool } from '@/lib/db';

/**
 * GET /api/budgets
 * List budgets
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

    let sql = `
      SELECT * FROM budgets
      WHERE business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (financialYear) {
      sql += ` AND financial_year = $${paramIndex}`;
      params.push(financialYear);
      paramIndex++;
    }

    sql += ` ORDER BY financial_year DESC, created_at DESC`;

    const budgets = await queryRows(sql, params);

    return NextResponse.json({ budgets });
  } catch (error: any) {
    console.error('Error fetching budgets:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/budgets
 * Create budget
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const {
      business_id,
      budget_name,
      budget_type,
      financial_year,
      period_start_date,
      period_end_date,
      notes,
      lines, // Array of { account_id, budget_amount, period_month?, period_quarter? }
    } = body;

    if (!business_id || !budget_name || !budget_type || !financial_year || 
        !period_start_date || !period_end_date || !lines || !Array.isArray(lines)) {
      return NextResponse.json(
        { error: 'business_id, budget_name, budget_type, financial_year, period_start_date, period_end_date, and lines are required' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    // Check if budget name already exists for this FY
    const existing = await queryOne(
      'SELECT id FROM budgets WHERE business_id = $1 AND budget_name = $2 AND financial_year = $3',
      [business_id, budget_name, financial_year]
    );

    if (existing) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Budget with this name already exists for this financial year' },
        { status: 409 }
      );
    }

    // Create budget
    const budget = await client.query(
      `INSERT INTO budgets (
        business_id, budget_name, budget_type, financial_year,
        period_start_date, period_end_date, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        business_id,
        budget_name,
        budget_type,
        financial_year,
        period_start_date,
        period_end_date,
        notes || null,
      ]
    );

    const budgetId = budget.rows[0].id;

    // Create budget lines
    for (const line of lines) {
      await client.query(
        `INSERT INTO budget_lines (
          business_id, budget_id, account_id, budget_amount,
          period_month, period_quarter
        )
        VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          business_id,
          budgetId,
          line.account_id,
          line.budget_amount,
          line.period_month || null,
          line.period_quarter || null,
        ]
      );
    }

    await client.query('COMMIT');

    return NextResponse.json({
      budget: budget.rows[0],
      message: 'Budget created successfully',
    }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error creating budget:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

