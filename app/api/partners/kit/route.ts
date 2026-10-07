import { NextRequest, NextResponse } from 'next/server';
import { requirePartnerRequest } from '@/lib/partners/request-auth';
import { listSalesKitItems } from '@/lib/partners/kit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePartnerRequest(request);
  if (!auth.ok) return auth.response;

  const items = await listSalesKitItems({ activeOnly: true });
  return NextResponse.json({
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      kind: item.kind,
      url: item.url,
      body_text: item.body_text,
      file_name: item.file_name,
      mime_type: item.mime_type,
      size_bytes: item.size_bytes,
      downloadUrl: item.kind === 'file' ? `/api/partners/kit/${item.id}/file` : null,
      sort_order: item.sort_order,
    })),
  });
}
