import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query } from '@/lib/db';
import { DOCUMENT_ENTITY_TYPES, isValidDocumentEntityType } from '@/lib/document-entity-types';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';

/**
 * GET /api/documents
 * List documents for a specific entity
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const entityType = searchParams.get('entity_type');
    const entityId = searchParams.get('entity_id');

    if (!businessId || !entityType || !entityId) {
      return NextResponse.json(
        { error: 'business_id, entity_type, and entity_id are required' },
        { status: 400 }
      );
    }

    if (!isValidDocumentEntityType(entityType)) {
      return NextResponse.json(
        { error: `Invalid entity_type. Must be one of: ${DOCUMENT_ENTITY_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    const documents = await queryRows(
      `SELECT 
        da.*,
        u.name as uploaded_by_name
      FROM document_attachments da
      LEFT JOIN users u ON da.uploaded_by = u.id
      WHERE da.business_id = $1 
        AND da.entity_type = $2 
        AND da.entity_id = $3
      ORDER BY da.created_at DESC`,
      [businessId, entityType, entityId]
    );

    return NextResponse.json({ documents });
  } catch (error: any) {
    console.error('Error fetching documents:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/documents
 * Upload a new document
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const businessId = formData.get('business_id') as string;
    const entityType = formData.get('entity_type') as string;
    const entityId = formData.get('entity_id') as string;
    const file = formData.get('file') as File;
    const description = formData.get('description') as string | null;

    if (!businessId || !entityType || !entityId || !file) {
      return NextResponse.json(
        { error: 'business_id, entity_type, entity_id, and file are required' },
        { status: 400 }
      );
    }

    if (!isValidDocumentEntityType(entityType)) {
      return NextResponse.json(
        { error: `Invalid entity_type. Must be one of: ${DOCUMENT_ENTITY_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .doc, .docx
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xls, .xlsx
      'text/csv',
      'text/plain'
    ];

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed types: images, PDF, Word, Excel, CSV, text files' },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB for documents, 5MB for images)
    const maxSize = file.type.startsWith('image/') 
      ? 5 * 1024 * 1024  // 5MB for images
      : 10 * 1024 * 1024; // 10MB for documents
    
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: `File size too large. Maximum size is ${maxSize / (1024 * 1024)}MB` },
        { status: 400 }
      );
    }

    // Convert to base64
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${file.type};base64,${base64}`;

    // Determine file_type category
    let fileTypeCategory = 'document';
    if (file.type.startsWith('image/')) {
      fileTypeCategory = 'image';
    } else if (file.type === 'application/pdf') {
      fileTypeCategory = 'pdf';
    } else if (file.type.includes('spreadsheet') || file.type.includes('excel') || file.type === 'text/csv') {
      fileTypeCategory = 'spreadsheet';
    }

    const userId = getUserIdFromRequest(request) || request.headers.get('x-user-id') || null;

    // Insert into database
    const document = await queryOne(
      `INSERT INTO document_attachments (
        business_id, entity_type, entity_id, file_name, file_url,
        file_type, file_size, mime_type, description, uploaded_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        businessId,
        entityType,
        entityId,
        file.name,
        dataUrl,
        fileTypeCategory,
        file.size,
        file.type,
        description || null,
        userId,
      ]
    );

    if (entityType === 'purchase_order' && document?.id) {
      const sessionBusinessId = getSessionScopedBusinessId(request) || businessId;
      const { logActivity, getClientIP, getUserAgent } = await import('@/lib/activity-logger');
      await logActivity({
        business_id: sessionBusinessId,
        user_id: userId || undefined,
        action_type: 'attachment',
        module: 'purchase_orders',
        entity_id: entityId,
        entity_type: 'purchase_order',
        description: `Attachment added: ${file.name}`,
        ip_address: getClientIP(request),
        user_agent: getUserAgent(request),
        metadata: { attachment_id: document.id, file_name: file.name },
      });
    }

    return NextResponse.json({ document }, { status: 201 });
  } catch (error: any) {
    console.error('Error uploading document:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/documents
 * Delete a document (requires document ID in query params)
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get('id');
    const businessId = searchParams.get('business_id');

    if (!documentId || !businessId) {
      return NextResponse.json(
        { error: 'id and business_id are required' },
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

