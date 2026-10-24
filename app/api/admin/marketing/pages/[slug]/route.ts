import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { hasMinimumRole } from '@/lib/platform-auth';
import { sanitizeMarketingDocument } from '@/lib/marketing-builder/sanitize';
import {
  discardMarketingDraft,
  getMarketingPage,
  saveMarketingDraft,
} from '@/lib/marketing-builder/pages-repo';
import {
  MARKETING_EDIT_ROLE,
  MARKETING_PUBLISH_ROLE,
  readJson,
  resolveSlug,
} from '@/lib/marketing-builder/api-helpers';

export const dynamic = 'force-dynamic';

type Params = { params: { slug: string } };

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requirePlatformRequest(request, MARKETING_EDIT_ROLE);
  if (!auth.ok) return auth.response;
  const s = resolveSlug(params.slug);
  if (!s.ok) return s.response;

  const page = await getMarketingPage(s.slug);
  return NextResponse.json({
    slug: s.slug,
    draft: page?.draft_data ?? null,
    draft_updated_at: page?.draft_updated_at ?? null,
    draft_updated_by: page?.draft_updated_by ?? null,
    draft_updated_by_name: page?.draft_updated_by_name ?? null,
    published: page?.published_data ?? null,
    published_at: page?.published_at ?? null,
    published_by_name: page?.published_by_name ?? null,
    can_publish: hasMinimumRole(auth.admin, MARKETING_PUBLISH_ROLE),
    admin_id: auth.admin.id,
  });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await requirePlatformRequest(request, MARKETING_EDIT_ROLE);
  if (!auth.ok) return auth.response;
  const s = resolveSlug(params.slug);
  if (!s.ok) return s.response;

  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const clean = sanitizeMarketingDocument(body.data);
  if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 422 });

  const base = body.base_updated_at;
  if ((typeof base === 'string' || base === null) && body.force !== true) {
    const current = await getMarketingPage(s.slug);
    if (
      current?.draft_updated_at &&
      current.draft_updated_by &&
      current.draft_updated_by !== auth.admin.id &&
      (base === null || new Date(current.draft_updated_at).getTime() > new Date(base).getTime())
    ) {
      return NextResponse.json(
        {
          error: 'Another admin saved changes to this page',
          code: 'DRAFT_CONFLICT',
          draft_updated_at: current.draft_updated_at,
          draft_updated_by_name: current.draft_updated_by_name,
        },
        { status: 409 },
      );
    }
  }

  const savedAt = await saveMarketingDraft(s.slug, clean.data, auth.admin.id);
  return NextResponse.json({ success: true, draft_updated_at: savedAt });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requirePlatformRequest(request, MARKETING_EDIT_ROLE);
  if (!auth.ok) return auth.response;
  const s = resolveSlug(params.slug);
  if (!s.ok) return s.response;

  await discardMarketingDraft(s.slug);
  return NextResponse.json({ success: true });
}
