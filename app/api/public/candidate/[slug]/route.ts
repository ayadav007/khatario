import { NextResponse } from 'next/server';
import { resolveBusinessByPortalSlug } from '@/lib/customer-surface';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: { slug: string } },
) {
  const business = await resolveBusinessByPortalSlug(params.slug);
  if (!business) {
    return NextResponse.json({ error: 'Portal not found' }, { status: 404 });
  }

  return NextResponse.json({
    business: {
      id: business.id,
      name: business.name,
      logo_url: business.logo_url ?? null,
    },
  });
}
