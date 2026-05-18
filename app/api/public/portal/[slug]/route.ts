import { NextRequest, NextResponse } from 'next/server';
import { resolveBusinessByPortalSlug } from '@/lib/customer-surface';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`portal-meta:${ip}`, 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const business = await resolveBusinessByPortalSlug(params.slug);
  if (!business) {
    return NextResponse.json({ error: 'Portal not found' }, { status: 404 });
  }

  return NextResponse.json({
    business: {
      id: business.id,
      name: business.name,
      logo_url: business.logo_url,
      portal_slug: business.portal_slug,
      portal_theme: business.portal_theme,
      surface_settings: business.surface_settings,
      show_platform_ad: business.show_platform_ad,
    },
  });
}
