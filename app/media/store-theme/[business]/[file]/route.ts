import { NextRequest, NextResponse } from 'next/server';
import { readThemeImage, themeMediaContentType } from '@/lib/store/theme-media';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { business: string; file: string } }) {
  const data = await readThemeImage(params.business, params.file);
  if (!data) return new NextResponse('Not found', { status: 404 });

  const headers: Record<string, string> = {
    'Content-Type': themeMediaContentType(params.file),
    // Names are content hashes, so a file never changes once written.
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  };
  // Safari plays video only when the server answers byte ranges.
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    const size = data.length;
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new NextResponse(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    }
    const part = data.subarray(start, end + 1);
    return new NextResponse(new Uint8Array(part), {
      status: 206,
      headers: { ...headers, 'Content-Length': String(part.length), 'Content-Range': `bytes ${start}-${end}/${size}` },
    });
  }

  return new NextResponse(new Uint8Array(data), { headers: { ...headers, 'Content-Length': String(data.length) } });
}
