import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { logAdminAction } from '@/lib/platform-auth';
import { deleteAdMapping, listAdMappings, unmappedAds, upsertAdMapping } from '@/lib/sales-funnel/admin';
import { getPublishedFlow } from '@/lib/sales-funnel/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'support');
  if (!auth.ok) return auth.response;
  const [mappings, unmapped, published] = await Promise.all([listAdMappings(), unmappedAds(), getPublishedFlow()]);
  const entries = published.flow.entries.map((e) => ({ id: e.id, label: e.label }));
  return NextResponse.json({ mappings, unmapped, entries });
}

export async function PUT(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const s = (v: unknown) => (v == null || v === '' ? null : String(v));
  try {
    await upsertAdMapping({
      ad_id: String(b.ad_id || ''),
      campaign_id: s(b.campaign_id),
      campaign_name: s(b.campaign_name),
      ad_name: s(b.ad_name),
      entry_key: s(b.entry_key),
    });
    await logAdminAction(auth.admin.id, 'sales_flow_ad_mapping_save', 'meta_ad_mapping', String(b.ad_id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  const adId = request.nextUrl.searchParams.get('ad_id') || '';
  if (!(await deleteAdMapping(adId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await logAdminAction(auth.admin.id, 'sales_flow_ad_mapping_delete', 'meta_ad_mapping', adId);
  return NextResponse.json({ ok: true });
}
