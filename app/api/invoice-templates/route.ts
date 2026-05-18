import { NextRequest, NextResponse } from 'next/server';
import { query as dbQuery, queryOne } from '@/lib/db';

/**
 * GET /api/invoice-templates
 * Get all invoice templates for a business
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

    // Get business-specific templates and global templates
    const templates = await dbQuery(
      `SELECT * FROM invoice_templates
       WHERE (business_id = $1 OR is_global = true)
       AND is_active = true
       ORDER BY usage_count DESC, template_name`,
      [businessId]
    );

    return NextResponse.json({ templates });

  } catch (error: any) {
    console.error('Error getting invoice templates:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/invoice-templates
 * Create a new invoice template
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      template_name,
      vendor_pattern,
      template_yaml,
      is_global = false,
      created_by
    } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!template_name || !template_yaml) {
      return NextResponse.json(
        { error: 'template_name and template_yaml are required' },
        { status: 400 }
      );
    }

    // Validate YAML format (basic check)
    if (!template_yaml.includes('fields:')) {
      return NextResponse.json(
        { error: 'Invalid template format. Must contain "fields:" section' },
        { status: 400 }
      );
    }

    // Check if template name already exists for this business
    const existing = await queryOne(
      `SELECT id FROM invoice_templates
       WHERE business_id = $1 AND template_name = $2`,
      [business_id, template_name]
    );

    if (existing) {
      return NextResponse.json(
        { error: 'Template with this name already exists' },
        { status: 409 }
      );
    }

    // Create template
    const template = await queryOne(
      `INSERT INTO invoice_templates (
        business_id, template_name, vendor_pattern, 
        template_yaml, is_global, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [business_id, template_name, vendor_pattern, template_yaml, is_global, created_by]
    );

    return NextResponse.json({ template }, { status: 201 });

  } catch (error: any) {
    console.error('Error creating invoice template:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/invoice-templates?id=xxx
 * Update an invoice template
 */
export async function PATCH(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const templateId = searchParams.get('id');

    if (!templateId) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { template_name, vendor_pattern, template_yaml, is_active } = body;

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (template_name !== undefined) {
      updates.push(`template_name = $${paramCount++}`);
      values.push(template_name);
    }

    if (vendor_pattern !== undefined) {
      updates.push(`vendor_pattern = $${paramCount++}`);
      values.push(vendor_pattern);
    }

    if (template_yaml !== undefined) {
      updates.push(`template_yaml = $${paramCount++}`);
      values.push(template_yaml);
    }

    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(is_active);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(templateId);

    const template = await queryOne(
      `UPDATE invoice_templates 
       SET ${updates.join(', ')}
       WHERE id = $${paramCount}
       RETURNING *`,
      values
    );

    if (!template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ template });

  } catch (error: any) {
    console.error('Error updating invoice template:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/invoice-templates?id=xxx
 * Delete an invoice template
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const templateId = searchParams.get('id');

    if (!templateId) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      );
    }

    await dbQuery(
      `DELETE FROM invoice_templates WHERE id = $1`,
      [templateId]
    );

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Error deleting invoice template:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}