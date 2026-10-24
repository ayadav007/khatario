import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { sendApprovedTemplateTest } from '@/lib/platform-whatsapp-send';
import { MetaWhatsAppError } from '@/lib/meta-whatsapp';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePlatformRequest(request, 'super_admin');
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const result = await sendApprovedTemplateTest({
      templateId: params.id,
      toPhone: String(body.to_phone || ''),
      vars: Array.isArray(body.vars) ? body.vars.map(String) : [],
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof MetaWhatsAppError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = message === 'META_WA_NOT_CONFIGURED' ? 503 : 400;
    return NextResponse.json({ error: message, code: status === 503 ? 'META_WA_NOT_CONFIGURED' : undefined }, { status });
  }
}
