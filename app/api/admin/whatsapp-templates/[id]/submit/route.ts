import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { submitPlatformWhatsAppTemplate } from '@/lib/platform-whatsapp-templates';
import { MetaWhatsAppError } from '@/lib/meta-whatsapp';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePlatformRequest(request, 'super_admin');
  if (!auth.ok) return auth.response;
  try {
    const template = await submitPlatformWhatsAppTemplate(params.id);
    return NextResponse.json({ template });
  } catch (error: unknown) {
    if (error instanceof MetaWhatsAppError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
