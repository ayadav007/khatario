import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import {
  MEDIA_MAX_UPLOAD_BYTES,
  detectImageType,
  listMarketingMedia,
  storeMarketingImage,
} from '@/lib/marketing-builder/media';
import { MARKETING_EDIT_ROLE } from '@/lib/marketing-builder/api-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, MARKETING_EDIT_ROLE);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ items: await listMarketingMedia() });
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformRequest(request, MARKETING_EDIT_ROLE);
  if (!auth.ok) return auth.response;

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get('file');
  } catch {
    return NextResponse.json({ error: 'Expected a multipart upload with a "file" field' }, { status: 400 });
  }
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }
  if (file.size > MEDIA_MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'Image is larger than 8 MB' }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!detectImageType(buffer)) {
    return NextResponse.json({ error: 'Only JPEG, PNG, WebP or AVIF images are allowed' }, { status: 415 });
  }

  try {
    const stored = await storeMarketingImage(buffer);
    return NextResponse.json(stored, { status: 201 });
  } catch (err) {
    console.error('[marketing-media] upload failed', err);
    return NextResponse.json({ error: 'Could not process this image' }, { status: 422 });
  }
}
