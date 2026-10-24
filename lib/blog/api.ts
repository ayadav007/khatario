import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { BlogAiImageError } from '@/lib/blog/ai-image';
import { invalidateBlog } from '@/lib/blog/cache';
import { BlogInputError } from '@/lib/blog/validate';

export const BLOG_ADMIN_ROLE = 'admin';

export async function requireBlogAdmin(request: NextRequest) {
  return requirePlatformRequest(request, BLOG_ADMIN_ROLE);
}

export async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function blogError(error: unknown) {
  if (error instanceof BlogInputError || error instanceof BlogAiImageError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('[blog]', error);
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
}

export function invalidateSaved(slugs: Array<string | null | undefined>) {
  invalidateBlog(slugs.filter((slug): slug is string => !!slug));
}
