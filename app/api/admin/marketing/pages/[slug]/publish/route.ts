import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { logAdminAction } from '@/lib/platform-auth';
import { sanitizeMarketingDocument } from '@/lib/marketing-builder/sanitize';
import { publishMarketingPage } from '@/lib/marketing-builder/pages-repo';
import {
  MARKETING_PAGE_PATHS,
  MARKETING_PUBLISH_ROLE,
  readJson,
  requestMeta,
  resolveSlug,
} from '@/lib/marketing-builder/api-helpers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  const auth = await requirePlatformRequest(request, MARKETING_PUBLISH_ROLE);
  if (!auth.ok) return auth.response;
  const s = resolveSlug(params.slug);
  if (!s.ok) return s.response;

  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const clean = sanitizeMarketingDocument(body.data);
  if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 422 });

  const result = await publishMarketingPage(s.slug, clean.data, auth.admin.id);
  revalidatePath(MARKETING_PAGE_PATHS[s.slug]);

  const { ip, userAgent } = requestMeta(request);
  await logAdminAction(
    auth.admin.id,
    'publish_marketing_page',
    'marketing_page',
    result.id,
    { slug: s.slug, blocks: clean.data.content.length },
    ip,
    userAgent,
  );

  return NextResponse.json({ success: true, published_at: result.published_at });
}
