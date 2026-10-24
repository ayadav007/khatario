import { NextRequest, NextResponse } from 'next/server';
import { blogAiConfigured, BlogAiImageError, generateBlogImage } from '@/lib/blog/ai-image';
import { blogError, requireBlogAdmin } from '@/lib/blog/api';
import { storeBlogImage } from '@/lib/blog/media';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireBlogAdmin(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ configured: blogAiConfigured() });
}

export async function POST(request: NextRequest) {
  const auth = await requireBlogAdmin(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { prompt?: string; alt?: string } | null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
  const alt = typeof body?.alt === 'string' && body.alt.trim() ? body.alt : prompt;
  try {
    const buffer = await generateBlogImage(prompt);
    const media = await storeBlogImage(buffer, alt, auth.admin.id);
    return NextResponse.json({ media }, { status: 201 });
  } catch (error) {
    if (error instanceof BlogAiImageError) {
      return NextResponse.json({ error: error.message, optional: true }, { status: error.status });
    }
    return blogError(error);
  }
}
