import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query, getPool } from '@/lib/db';

/**
 * GET /api/journal-entries/templates/[id]
 * Get a specific journal entry template
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const templateId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const template = await queryOne(
      `SELECT 
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
      WHERE id = $1 AND business_id = $2`,
      [templateId, businessId]
    );

    if (!template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ template });
  } catch (error: any) {
    console.error('Error fetching journal entry template:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/journal-entries/templates/[id]
 * Update a journal entry template
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const templateId = params.id;
    const body = await request.json();
    const {
      business_id,
      name,
      description,
      entry_date_offset,
      lines,
      tags,
      is_active,
    } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Check if template exists
    const existing = await queryOne(
      `SELECT id FROM journal_entry_templates WHERE id = $1 AND business_id = $2`,
      [templateId, business_id]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );
    }

    // Validate lines if provided
    if (lines && Array.isArray(lines)) {
      const totalDebit = lines.reduce((sum, line) => sum + (parseFloat(line.debit?.toString() || '0')), 0);
      const totalCredit = lines.reduce((sum, line) => sum + (parseFloat(line.credit?.toString() || '0')), 0);

      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return NextResponse.json(
          { error: `Debit and Credit must be equal. Debit: ${totalDebit}, Credit: ${totalCredit}` },
          { status: 400 }
        );
      }
    }

    await client.query('BEGIN');

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    if (entry_date_offset !== undefined) {
      updates.push(`entry_date_offset = $${paramIndex++}`);
      values.push(entry_date_offset);
    }
    if (lines !== undefined) {
      updates.push(`lines = $${paramIndex++}`);
      values.push(JSON.stringify(lines));
    }
    if (tags !== undefined) {
      updates.push(`tags = $${paramIndex++}`);
      values.push(tags && Array.isArray(tags) ? tags : null);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(is_active);
    }

    if (updates.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(templateId, business_id);

    await query(
      `UPDATE journal_entry_templates 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND business_id = $${paramIndex++}`,
      values
    );

    await client.query('COMMIT');

    // Fetch updated template
    const updated = await queryOne(
      `SELECT * FROM journal_entry_templates WHERE id = $1 AND business_id = $2`,
      [templateId, business_id]
    );

    return NextResponse.json({ template: updated });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error updating journal entry template:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/journal-entries/templates/[id]
 * Delete a journal entry template
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const templateId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    // Check if template exists
    const existing = await queryOne(
      `SELECT id FROM journal_entry_templates WHERE id = $1 AND business_id = $2`,
      [templateId, businessId]
    );

    if (!existing) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );
    }

    // Check if template is being used by any journal entries
    const inUse = await queryOne(
      `SELECT id FROM journal_entries WHERE template_id = $1 AND business_id = $2 LIMIT 1`,
      [templateId, businessId]
    );

    if (inUse) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Template is being used by journal entries and cannot be deleted' },
        { status: 400 }
      );
    }

    // Delete template
    await query(
      `DELETE FROM journal_entry_templates WHERE id = $1 AND business_id = $2`,
      [templateId, businessId]
    );

    await client.query('COMMIT');

    return NextResponse.json({ message: 'Template deleted successfully' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error deleting journal entry template:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

