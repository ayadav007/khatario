import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query, getPool } from '@/lib/db';
import { JournalEntryTemplate } from '@/types/journal-entries';

/**
 * GET /api/journal-entries/templates
 * List journal entry templates
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const isActive = searchParams.get('is_active'); // Optional filter

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT 
        id,
        business_id,
        name,
        description,
        entry_date_offset,
        lines,
        tags,
        is_active,
        created_at,
        updated_at,
        created_by
      FROM journal_entry_templates
      WHERE business_id = $1
    `;

    const params: any[] = [businessId];

    if (isActive !== null && isActive !== undefined) {
      sql += ` AND is_active = $2`;
      params.push(isActive === 'true');
    }

    sql += ` ORDER BY name`;

    const templates = await queryRows<JournalEntryTemplate>(sql, params);

    return NextResponse.json({ templates });
  } catch (error: any) {
    console.error('Error fetching journal entry templates:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/journal-entries/templates
 * Create a new journal entry template
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const {
      business_id,
      name,
      description,
      entry_date_offset = 0,
      lines, // Array of { account_id, debit, credit, narration }
      tags,
      is_active = true,
    } = body;

    if (!business_id || !name || !lines || !Array.isArray(lines) || lines.length < 2) {
      return NextResponse.json(
        { error: 'business_id, name, and at least 2 lines are required' },
        { status: 400 }
      );
    }

    // Validate debit = credit
    const totalDebit = lines.reduce((sum, line) => sum + (parseFloat(line.debit?.toString() || '0')), 0);
    const totalCredit = lines.reduce((sum, line) => sum + (parseFloat(line.credit?.toString() || '0')), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return NextResponse.json(
        { error: `Debit and Credit must be equal. Debit: ${totalDebit}, Credit: ${totalCredit}` },
        { status: 400 }
      );
    }

    // Validate each line
    for (const line of lines) {
      if (!line.account_id) {
        return NextResponse.json(
          { error: 'All lines must have an account_id' },
          { status: 400 }
        );
      }
    }

    const userId = request.headers.get('x-user-id') || null;

    await client.query('BEGIN');

    // Check if template with same name already exists
    const existing = await queryOne(
      `SELECT id FROM journal_entry_templates WHERE business_id = $1 AND name = $2`,
      [business_id, name]
    );

    if (existing) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Template with this name already exists' },
        { status: 400 }
      );
    }

    // Insert template
    const result = await query(
      `INSERT INTO journal_entry_templates (
        business_id, name, description, entry_date_offset, lines, tags, is_active, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        business_id,
        name,
        description || null,
        entry_date_offset,
        JSON.stringify(lines),
        tags && Array.isArray(tags) ? tags : null,
        is_active,
        userId,
      ]
    );

    await client.query('COMMIT');

    return NextResponse.json({ template: result.rows[0] }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error creating journal entry template:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

