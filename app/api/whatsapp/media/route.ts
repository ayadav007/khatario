import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

export const GET = withWhatsAppPremiumApi({}, async ({ businessId }) => {
  try {
    const result = await query(
      `
      SELECT 
        id, filename, original_filename, file_type, file_size, media_url,
        created_at, updated_at
      FROM whatsapp_media_library
      WHERE business_id = $1
      ORDER BY created_at DESC
    `,
      [businessId],
    );

    return NextResponse.json({
      media: result.rows,
    });
  } catch (error: any) {
    console.error('Error fetching media library:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch media library' },
      { status: 500 },
    );
  }
});

export const POST = withWhatsAppPremiumApi(
  { claimedBusinessId: ({ request }) => getBusinessIdFromRequest(request) },
  async ({ request, businessId }) => {
    try {
      const formData = await request.formData();
      const file = formData.get('file') as File;

      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }

      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        return NextResponse.json(
          { error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' },
          { status: 400 },
        );
      }

      const maxSize = 5 * 1024 * 1024;
      if (file.size > maxSize) {
        return NextResponse.json(
          { error: 'File size too large. Maximum size is 5MB.' },
          { status: 400 },
        );
      }

      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const base64 = buffer.toString('base64');
      const dataUrl = `data:${file.type};base64,${base64}`;

      const timestamp = Date.now();
      const sanitizedOriginalName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filename = `${timestamp}_${sanitizedOriginalName}`;

      const result = await queryOne(
        `
      INSERT INTO whatsapp_media_library (business_id, filename, original_filename, file_type, file_size, media_url)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, filename, original_filename, file_type, file_size, media_url, created_at
    `,
        [businessId, filename, file.name, file.type, file.size, dataUrl],
      );

      return NextResponse.json({
        success: true,
        media: result,
        message: 'File uploaded successfully',
      });
    } catch (error: any) {
      console.error('Error uploading media:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to upload media' },
        { status: 500 },
      );
    }
  },
);

export const DELETE = withWhatsAppPremiumApi({}, async ({ request, businessId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const mediaId = searchParams.get('id');

    if (!mediaId) {
      return NextResponse.json({ error: 'Media ID is required' }, { status: 400 });
    }

    const media = await queryOne(
      `
      SELECT id FROM whatsapp_media_library
      WHERE id = $1 AND business_id = $2
    `,
      [mediaId, businessId],
    );

    if (!media) {
      return NextResponse.json({ error: 'Media not found or access denied' }, { status: 404 });
    }

    await query(
      `
      DELETE FROM whatsapp_media_library
      WHERE id = $1 AND business_id = $2
    `,
      [mediaId, businessId],
    );

    return NextResponse.json({
      success: true,
      message: 'Media deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting media:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete media' },
      { status: 500 },
    );
  }
});
