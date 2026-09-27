import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { sanitizeMarketingDocument } from '@/lib/marketing-builder/sanitize';
import { getMarketingVersion, saveMarketingDraft } from '@/lib/marketing-builder/pages-repo';
import { MARKETING_EDIT_ROLE, resolveSlug } from '@/lib/marketing-builder/api-helpers';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loads a published version into the draft; it goes live only after Publish. */
export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string; id: string } },
) {
  const auth = await requirePlatformRequest(request, MARKETING_EDIT_ROLE);
  if (!auth.ok) return auth.response;
  const s = resolveSlug(params.slug);
  if (!s.ok) return s.response;
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Version not found' }, { status: 404 });

  const version = await getMarketingVersion(s.slug, params.id);
  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 });

  const clean = sanitizeMarketingDocument(version);
  if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 422 });

  const savedAt = await saveMarketingDraft(s.slug, clean.data, auth.admin.id);
  return NextResponse.json({ success: true, data: clean.data, draft_updated_at: savedAt });
}
