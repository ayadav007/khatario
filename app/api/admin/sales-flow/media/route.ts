import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { logAdminAction } from '@/lib/platform-auth';
import { listMedia, MediaValidationError, saveUploadedMedia } from '@/lib/sales-funnel/media';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'support');
  if (!auth.ok) return auth.response;
  return NextResponse.json({ media: await listMedia() });
}

/** Multipart upload: file, key, kind (image|video), label. Replaces media with the same key. */
export async function POST(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Upload a file (the server accepts up to 12 MB per upload)' }, { status: 400 });
  }
  const file = form.get('file');
  const key = String(form.get('key') || '').trim();
  const kind = String(form.get('kind') || '') as 'image' | 'video';
  const label = form.get('label') ? String(form.get('label')) : null;
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'Choose a file' }, { status: 400 });
  if (kind !== 'image' && kind !== 'video') return NextResponse.json({ error: 'Kind must be image or video' }, { status: 400 });
  try {
    const media = await saveUploadedMedia({
      key,
      kind,
      label,
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
    });
    await logAdminAction(auth.admin.id, 'sales_flow_media_upload', 'sales_flow_media', key, { kind, size: media.sizeBytes });
    return NextResponse.json({ media });
  } catch (err) {
    if (err instanceof MediaValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('[admin/sales-flow/media] upload failed:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
