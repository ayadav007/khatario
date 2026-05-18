import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/template-assignments?business_id=X
 * Get all active template assignments for a business
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const result = await query(
      `SELECT template_id, document_type, settings, updated_at 
       FROM business_template_assignments 
       WHERE business_id = $1
       ORDER BY document_type`,
      [businessId]
    );

    return NextResponse.json({
      success: true,
      assignments: result.rows
    });
  } catch (error) {
    console.error('Error fetching template assignments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch template assignments' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/template-assignments
 * Activate a template for a specific document type
 * Body: { business_id, template_id, document_type, settings? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, template_id, document_type, settings = {} } = body;

    if (!business_id || !template_id || !document_type) {
      return NextResponse.json(
        { error: 'business_id, template_id, and document_type are required' },
        { status: 400 }
      );
    }

    // Upsert: insert or update if exists
    const result = await query(
      `INSERT INTO business_template_assignments 
         (business_id, template_id, document_type, settings) 
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (business_id, document_type) 
       DO UPDATE SET 
         template_id = EXCLUDED.template_id,
         settings = EXCLUDED.settings,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [business_id, template_id, document_type, JSON.stringify(settings)]
    );

    return NextResponse.json({
      success: true,
      message: `Template "${template_id}" activated for ${document_type}`,
      assignment: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating template assignment:', error);
    return NextResponse.json(
      { error: 'Failed to activate template' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/template-assignments
 * Update template settings for a specific assignment
 * Body: { business_id, document_type, template_id?, settings }
 * 
 * NOTE: If template_id is provided, it will also update the template_id in the assignment.
 * This ensures that when a user changes template, the assignment is updated correctly.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, document_type, template_id, settings } = body;

    if (!business_id || !document_type || !settings) {
      return NextResponse.json(
        { error: 'business_id, document_type, and settings are required' },
        { status: 400 }
      );
    }

    // If template_id is provided, update both template_id and settings
    // Otherwise, just update settings (for backward compatibility)
    let result;
    if (template_id) {
      // Update both template_id and settings
      result = await query(
        `UPDATE business_template_assignments 
         SET template_id = $1, settings = $2, updated_at = CURRENT_TIMESTAMP
         WHERE business_id = $3 AND document_type = $4
         RETURNING *`,
        [template_id, JSON.stringify(settings), business_id, document_type]
      );
      
      // If no row was updated, create a new assignment
      if (result.rows.length === 0) {
        result = await query(
          `INSERT INTO business_template_assignments 
           (business_id, template_id, document_type, settings) 
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (business_id, document_type) 
           DO UPDATE SET 
             template_id = EXCLUDED.template_id,
             settings = EXCLUDED.settings,
             updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [business_id, template_id, document_type, JSON.stringify(settings)]
        );
      }
    } else {
      // Just update settings (backward compatibility)
      result = await query(
        `UPDATE business_template_assignments 
         SET settings = $1, updated_at = CURRENT_TIMESTAMP
         WHERE business_id = $2 AND document_type = $3
         RETURNING *`,
        [JSON.stringify(settings), business_id, document_type]
      );
    }

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Template assignment not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Template settings updated',
      assignment: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating template settings:', error);
    return NextResponse.json(
      { error: 'Failed to update template settings' },
      { status: 500 }
    );
  }
}

