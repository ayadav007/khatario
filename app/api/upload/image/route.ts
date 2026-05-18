import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/upload/image
 * Upload image and convert to base64 for storage
 * This is a simple implementation that stores images as base64 in the database
 * For production, consider using cloud storage like AWS S3, Cloudinary, etc.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const type = formData.get('type') as string; // 'logo' or 'signature'
    const folder = formData.get('folder') as string; // Optional folder for organization

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type - support images and PDFs
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only JPEG, PNG, GIF, WebP, and PDF are allowed.' },
        { status: 400 }
      );
    }

    if (type === 'promo' || type === 'promotion') {
      if (file.type === 'application/pdf') {
        return NextResponse.json(
          { error: 'PDF is not allowed for promotion images. Use PNG, JPEG, WebP, or GIF.' },
          { status: 400 }
        );
      }
    }

    // Validate file size (max 5MB for receipts, 2MB for logos/signatures/promo strips)
    const maxSize =
      type === 'logo' || type === 'signature' || type === 'promo' || type === 'promotion'
        ? 2 * 1024 * 1024
        : 5 * 1024 * 1024;
    
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: `File size too large. Maximum size is ${maxSize / (1024 * 1024)}MB.` },
        { status: 400 }
      );
    }

    // Convert to base64
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${file.type};base64,${base64}`;

    return NextResponse.json({
      success: true,
      url: dataUrl,
      filename: file.name,
      size: file.size,
      type: file.type,
      message: 'File uploaded successfully'
    });
  } catch (error: any) {
    console.error('Error uploading file:', error);
    return NextResponse.json(
      { error: 'Failed to upload file', details: error.message },
      { status: 500 }
    );
  }
}

