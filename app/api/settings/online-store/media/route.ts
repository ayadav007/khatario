import { NextRequest, NextResponse } from 'next/server';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { detectThemeUpload, storeThemeImage, storeThemeVideo } from '@/lib/store/theme-media';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;
// GIFs and videos (Canva ads) are bigger; nginx allows 12 MB bodies.
const MAX_MOTION_BYTES = 10 * 1024 * 1024;
// A little headroom for the multipart framing around a 10 MB file.
const MAX_BODY_BYTES = Math.floor(10.1 * 1024 * 1024);

/**
 * Studio 2 image upload: the photo is re-encoded to webp (animated GIF and WebP stay animated) and stored on disk
 * for this business (lib/store/theme-media), and the editor stores the returned `/media/store-theme/…` URL in the
 * theme. MP4 and WebM are taken only from fields that play video (`video=1`) and kept as uploaded.
 */
export async function POST(request: NextRequest) {
  const tenant = await requireTenantPermission(request, null, 'settings', 'update');
  if (!tenant.ok) return tenant.response;
  const planDenied = await denyIfFeatureMissing(tenant.businessId, 'advanced_online_store');
  if (planDenied) return planDenied;

  const length = Number(request.headers.get('content-length'));
  if (!request.headers.get('content-length') || !Number.isFinite(length)) {
    return NextResponse.json({ error: 'Content-Length required' }, { status: 411 });
  }
  if (length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Files must be 10 MB or smaller.' }, { status: 413 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  const allowVideo = form?.get('video') === '1';
  if (file.size > MAX_MOTION_BYTES) return NextResponse.json({ error: 'Files must be 10 MB or smaller.' }, { status: 413 });
  const input = Buffer.from(await file.arrayBuffer());
  // The type comes from the file's own bytes, not the browser's Content-Type.
  const kind = detectThemeUpload(input);
  const video = kind === 'mp4' || kind === 'webm';
  if (!kind || (video && !allowVideo)) {
    const allowed = allowVideo ? 'JPEG, PNG, WebP, AVIF, GIF, MP4 or WebM' : 'JPEG, PNG, WebP, AVIF or GIF';
    return NextResponse.json({ error: `Only ${allowed} files are allowed.` }, { status: 400 });
  }
  if (kind === 'image' && file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Photos must be 5 MB or smaller.' }, { status: 413 });
  }
  try {
    if (video) return NextResponse.json(await storeThemeVideo(tenant.businessId, input, kind));
    return NextResponse.json(await storeThemeImage(tenant.businessId, input));
  } catch (error) {
    console.error('online-store media POST:', error);
    return NextResponse.json({ error: 'Could not save the image' }, { status: 500 });
  }
}
