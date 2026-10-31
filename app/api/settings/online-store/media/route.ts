import { NextRequest, NextResponse } from 'next/server';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { detectImageType } from '@/lib/marketing-builder/media';
import { storeThemeImage } from '@/lib/store/theme-media';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;
// A little headroom for the multipart framing around a 5 MB file.
const MAX_BODY_BYTES = Math.floor(5.1 * 1024 * 1024);

/**
 * Studio 2 image upload: the photo is re-encoded to webp and stored on disk for this business
 * (lib/store/theme-media), and the editor stores the returned `/media/store-theme/…` URL in the theme.
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
  if (length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Images must be 5 MB or smaller.' }, { status: 413 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Images must be 5 MB or smaller.' }, { status: 413 });
  const input = Buffer.from(await file.arrayBuffer());
  // The type comes from the file's own bytes, not the browser's Content-Type.
  if (!detectImageType(input)) {
    return NextResponse.json({ error: 'Only JPEG, PNG, WebP or AVIF images are allowed.' }, { status: 400 });
  }
  try {
    return NextResponse.json(await storeThemeImage(tenant.businessId, input));
  } catch (error) {
    console.error('online-store media POST:', error);
    return NextResponse.json({ error: 'Could not save the image' }, { status: 500 });
  }
}
