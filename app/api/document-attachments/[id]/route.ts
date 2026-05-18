import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';

/**
 * GET /api/document-attachments/[id]
 * Get/download a specific document attachment
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const documentId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const document = await queryOne(
      `SELECT * FROM document_attachments WHERE id = $1 AND business_id = $2`,
      [documentId, businessId]
    );

    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Return document metadata
    // For actual file download, the client can use the file_url (base64 data URL)
    return NextResponse.json({ document });
  } catch (error: any) {
    console.error('Error fetching document:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/document-attachments/[id]
 * Update document metadata
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const documentId = params.id;
    const body = await request.json();
    const { business_id, file_name, description } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Verify document belongs to business
    const existingDoc = await queryOne(
      `SELECT id FROM document_attachments WHERE id = $1 AND business_id = $2`,
      [documentId, business_id]
    );

    if (!existingDoc) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Update document
    const updatedDoc = await queryOne(
      `UPDATE document_attachments
       SET file_name = COALESCE($1, file_name),
           description = COALESCE($2, description),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND business_id = $4
       RETURNING *`,
      [file_name, description, documentId, business_id]
    );

    return NextResponse.json({ document: updatedDoc });
  } catch (error: any) {
    console.error('Error updating document:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/document-attachments/[id]
 * Delete a document
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const documentId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Verify document belongs to business
    const document = await queryOne(
      `SELECT id FROM document_attachments WHERE id = $1 AND business_id = $2`,
      [documentId, businessId]
    );

    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    await query(
      `DELETE FROM document_attachments WHERE id = $1 AND business_id = $2`,
      [documentId, businessId]
    );

    return NextResponse.json({ message: 'Document deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting document:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

