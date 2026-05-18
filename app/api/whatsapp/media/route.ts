import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

/**
 * GET /api/whatsapp/media
 * List all media files for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'Business ID is required' },
        { status: 400 }
      );
    }

    const result = await query(`
      SELECT 
        id, filename, original_filename, file_type, file_size, media_url,
        created_at, updated_at
      FROM whatsapp_media_library
      WHERE business_id = $1
      ORDER BY created_at DESC
    `, [businessId]);

    return NextResponse.json({
      media: result.rows
    });
  } catch (error: any) {
    console.error('Error fetching media library:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch media library' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/whatsapp/media
 * Upload a new media file to the library
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const businessId = formData.get('business_id') as string;
    const file = formData.get('file') as File;

    if (!businessId) {
      return NextResponse.json(
        { error: 'Business ID is required' },
        { status: 400 }
      );
    }

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' },
        { status: 400 }
      );
    }

    // Validate file size (max 5MB for WhatsApp)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File size too large. Maximum size is 5MB.' },
        { status: 400 }
      );
    }

    // Convert to base64 data URL
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${file.type};base64,${base64}`;

    // Generate a unique filename
    const timestamp = Date.now();
    const sanitizedOriginalName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename = `${timestamp}_${sanitizedOriginalName}`;

    // Insert into database
    const result = await queryOne(`
      INSERT INTO whatsapp_media_library (business_id, filename, original_filename, file_type, file_size, media_url)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, filename, original_filename, file_type, file_size, media_url, created_at
    `, [businessId, filename, file.name, file.type, file.size, dataUrl]);

    return NextResponse.json({
      success: true,
      media: result,
      message: 'File uploaded successfully'
    });
  } catch (error: any) {
    console.error('Error uploading media:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to upload media' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/whatsapp/media
 * Delete a media file from the library
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mediaId = searchParams.get('id');
    const businessId = searchParams.get('business_id');

    if (!mediaId || !businessId) {
      return NextResponse.json(
        { error: 'Media ID and Business ID are required' },
        { status: 400 }
      );
    }

    // Verify the media belongs to the business
    const media = await queryOne(`
      SELECT id FROM whatsapp_media_library
      WHERE id = $1 AND business_id = $2
    `, [mediaId, businessId]);

    if (!media) {
      return NextResponse.json(
        { error: 'Media not found or access denied' },
        { status: 404 }
      );
    }

    // Delete the media
    await query(`
      DELETE FROM whatsapp_media_library
      WHERE id = $1 AND business_id = $2
    `, [mediaId, businessId]);

    return NextResponse.json({
      success: true,
      message: 'Media deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting media:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete media' },
      { status: 500 }
    );
  }
}

