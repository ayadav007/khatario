import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

/**
 * POST /api/upload/attachments
 * Upload attachments for invoices or other documents
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const businessId = formData.get('business_id') as string;
    const documentType = formData.get('document_type') as string;
    const files = formData.getAll('files') as File[];

    if (!businessId || !documentType || files.length === 0) {
      return NextResponse.json(
        { error: 'business_id, document_type, and files are required' },
        { status: 400 }
      );
    }

    // Validate file types
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv', 'text/plain'
    ];

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB

    const uploadedFiles = [];

    for (const file of files) {
      if (!allowedTypes.includes(file.type)) {
        return NextResponse.json(
          { error: `Invalid file type for ${file.name}. Allowed types: images, PDF, Word, Excel, CSV, text files` },
          { status: 400 }
        );
      }

      if (file.size > maxSize) {
        return NextResponse.json(
          { error: `File ${file.name} is too large. Maximum size is 10MB` },
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

      // For now, we'll store the file metadata in the response
      // The actual file will be stored when the invoice is saved
      uploadedFiles.push({
        id: `temp_${Date.now()}_${Math.random()}`,
        file_name: file.name,
        file_path: dataUrl,
        file_size: file.size,
        file_type: fileTypeCategory,
        mime_type: file.type,
      });
    }

    return NextResponse.json({
      success: true,
      files: uploadedFiles,
    });
  } catch (error: any) {
    console.error('Error uploading attachments:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
