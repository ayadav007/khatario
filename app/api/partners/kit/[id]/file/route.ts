import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import { requirePartnerRequest } from '@/lib/partners/request-auth';
import { resolveSalesKitFile } from '@/lib/partners/kit';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePartnerRequest(request);
  if (!auth.ok) return auth.response;

  const file = await resolveSalesKitFile(params.id);
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  try {
    const buf = await fs.readFile(file.absPath);
    return new NextResponse(buf, {
      headers: {
        'Content-Type': file.mimeType,
        'Content-Disposition': `attachment; filename="${file.fileName.replace(/"/g, '')}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'File missing on disk' }, { status: 404 });
  }
}
