import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { listMarketingVersions } from '@/lib/marketing-builder/pages-repo';
import { MARKETING_EDIT_ROLE, resolveSlug } from '@/lib/marketing-builder/api-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { slug: string } }) {
  const auth = await requirePlatformRequest(request, MARKETING_EDIT_ROLE);
  if (!auth.ok) return auth.response;
  const s = resolveSlug(params.slug);
  if (!s.ok) return s.response;

  const versions = await listMarketingVersions(s.slug);
  return NextResponse.json({ versions });
}
