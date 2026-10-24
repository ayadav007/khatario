import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { logAdminAction } from '@/lib/platform-auth';
import { deleteMedia, getMediaRow, readMediaBuffer } from '@/lib/sales-funnel/media';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { key: string } }) {
  const auth = await requirePlatformRequest(request, 'support');
  if (!auth.ok) return auth.response;
  const row = await getMediaRow(params.key);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const buffer = await readMediaBuffer(row);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': row.mime_type,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'File missing on the server; upload it again' }, { status: 404 });
  }
}

/** Removes an uploaded file; built-in screenshots come back as the default. */
export async function DELETE(request: NextRequest, { params }: { params: { key: string } }) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  const removed = await deleteMedia(params.key);
  if (!removed) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await logAdminAction(auth.admin.id, 'sales_flow_media_delete', 'sales_flow_media', params.key);
  return NextResponse.json({ ok: true });
}
