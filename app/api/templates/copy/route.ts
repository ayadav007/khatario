import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * POST /api/templates/copy
 * Copy template settings to multiple document types
 * Body: { business_id, template_id, source_doc_type, target_doc_types: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, template_id, source_doc_type, target_doc_types } = body;

    if (!business_id || !template_id || !source_doc_type || !Array.isArray(target_doc_types)) {
      return NextResponse.json(
        { error: 'business_id, template_id, source_doc_type, and target_doc_types[] are required' },
        { status: 400 }
      );
    }

    if (target_doc_types.length === 0) {
      return NextResponse.json(
        { error: 'At least one target document type is required' },
        { status: 400 }
      );
    }

    // Get settings from source
    const sourceResult = await query(
      `SELECT settings FROM business_template_assignments 
       WHERE business_id = $1 AND document_type = $2`,
      [business_id, source_doc_type]
    );

    const sourceSettings = sourceResult.rows[0]?.settings || {};

    // Copy to all target document types
    const copyPromises = target_doc_types.map(targetDocType =>
      query(
        `INSERT INTO business_template_assignments 
           (business_id, template_id, document_type, settings) 
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (business_id, document_type) 
         DO UPDATE SET 
           template_id = EXCLUDED.template_id,
           settings = EXCLUDED.settings,
           updated_at = CURRENT_TIMESTAMP`,
        [business_id, template_id, targetDocType, JSON.stringify(sourceSettings)]
      )
    );

    await Promise.all(copyPromises);

    return NextResponse.json({
      success: true,
      message: `Template "${template_id}" copied to ${target_doc_types.length} document type(s)`,
      copied_to: target_doc_types
    });
  } catch (error) {
    console.error('Error copying template:', error);
    return NextResponse.json(
      { error: 'Failed to copy template' },
      { status: 500 }
    );
  }
}

