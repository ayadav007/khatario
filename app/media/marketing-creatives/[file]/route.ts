import { NextRequest, NextResponse } from 'next/server';
import { readCreative } from '@/lib/marketing/creative';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: { file: string } }) {
  try {
    const data = await readCreative(`/media/marketing-creatives/${params.file}`);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(data.length),
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
