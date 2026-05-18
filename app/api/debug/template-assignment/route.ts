import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const businessId = searchParams.get('business_id');
    const documentType = searchParams.get('document_type') || 'tax_invoice';

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Get assignment
    const assignment = await query(
      `SELECT template_id, settings, created_at, updated_at 
       FROM business_template_assignments 
       WHERE business_id = $1 AND document_type = $2`,
      [businessId, documentType]
    );

    // Get all assignments for this business
    const allAssignments = await query(
      `SELECT document_type, template_id, updated_at 
       FROM business_template_assignments 
       WHERE business_id = $1
       ORDER BY document_type`,
      [businessId]
    );

    return NextResponse.json({
      success: true,
      requested: {
        business_id: businessId,
        document_type: documentType
      },
      assignment: assignment.rows[0] || null,
      all_assignments: allAssignments.rows,
      message: assignment.rows.length > 0 
        ? `Found assignment: ${assignment.rows[0].template_id}`
        : 'No assignment found for this document type'
    });
  } catch (error: any) {
    console.error('Error checking template assignment:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to check assignment' },
      { status: 500 }
    );
  }
}

