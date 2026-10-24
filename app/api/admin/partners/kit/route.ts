import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import {
  createSalesKitItem,
  deleteSalesKitItem,
  listSalesKitItems,
  updateSalesKitItem,
  type SalesKitKind,
} from '@/lib/partners/kit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_businesses');
  if (!auth.ok) return auth.response;
  return NextResponse.json({ items: await listSalesKitItems() });
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_businesses');
  if (!auth.ok) return auth.response;

  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const title = String(form.get('title') || '');
      const description = String(form.get('description') || '') || null;
      const kind = (String(form.get('kind') || 'file') as SalesKitKind) || 'file';
      const file = form.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'file required' }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const item = await createSalesKitItem({
        title,
        description,
        kind: 'file',
        adminId: auth.admin.id,
        file: {
          buffer,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
        },
        sortOrder: Number(form.get('sort_order') || 0),
      });
      void kind;
      return NextResponse.json({ success: true, item }, { status: 201 });
    }

    const body = await request.json();
    const item = await createSalesKitItem({
      title: String(body.title || ''),
      description: body.description ?? null,
      kind: body.kind === 'text' || body.kind === 'file' ? body.kind : 'link',
      url: body.url ?? null,
      bodyText: body.body_text ?? null,
      sortOrder: body.sort_order != null ? Number(body.sort_order) : 0,
      adminId: auth.admin.id,
    });
    return NextResponse.json({ success: true, item }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_businesses');
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    if (typeof body.id !== 'string') {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }
    const item = await updateSalesKitItem(body.id, {
      title: body.title,
      description: body.description,
      url: body.url,
      bodyText: body.body_text,
      sortOrder: body.sort_order != null ? Number(body.sort_order) : undefined,
      isActive: body.is_active,
    });
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, item });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_businesses');
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const ok = await deleteSalesKitItem(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
