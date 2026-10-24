import { NextRequest, NextResponse } from 'next/server';
import { readMarketingMedia } from '@/lib/marketing-builder/media';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: { file: string } }) {
  const data = await readMarketingMedia(params.file);
  if (!data) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': 'image/webp',
      'Content-Length': String(data.length),
      // Names are content hashes, so a file never changes once written.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
