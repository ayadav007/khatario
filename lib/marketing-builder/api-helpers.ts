import { NextRequest, NextResponse } from 'next/server';
import { isMarketingPageSlug, type MarketingPageSlug } from '@/lib/marketing-builder/block-types';

export const MARKETING_EDIT_ROLE = 'admin';
export const MARKETING_PUBLISH_ROLE = 'super_admin';

export const MARKETING_PAGE_PATHS: Record<MarketingPageSlug, string> = { home: '/' };

export function resolveSlug(
  slug: string,
): { ok: true; slug: MarketingPageSlug } | { ok: false; response: NextResponse } {
  if (!isMarketingPageSlug(slug)) {
    return { ok: false, response: NextResponse.json({ error: 'Unknown page' }, { status: 404 }) };
  }
  return { ok: true, slug };
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export function requestMeta(request: NextRequest): { ip?: string; userAgent?: string } {
  return {
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
  };
}
