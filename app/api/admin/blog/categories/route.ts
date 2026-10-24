import { NextRequest, NextResponse } from 'next/server';
import { blogError, requireBlogAdmin } from '@/lib/blog/api';
import { listCategories } from '@/lib/blog/repo';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireBlogAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ categories: await listCategories() });
  } catch (error) {
    return blogError(error);
  }
}
