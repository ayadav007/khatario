import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { generateOfferLetterPreviewHtml } from '@/lib/offer-letter-generator';
import { parseOfferLetterTemplateSettings } from '@/lib/hr/offer-letter-template-settings';
import { isValidOfferLetterTemplateId } from '@/lib/offer-letter-template-registry';

export const dynamic = 'force-dynamic';

async function renderPreview(
  request: NextRequest,
  settingsRaw: unknown,
  templateId?: string,
) {
  const businessId = getBusinessIdFromRequest(request);
  const userId = getUserIdFromRequest(request);
  if (!businessId || !userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  await authorize(userId, 'settings', 'read', { businessId });

  const settings = settingsRaw
    ? parseOfferLetterTemplateSettings(settingsRaw)
    : undefined;
  const templateIdOverride =
    templateId && isValidOfferLetterTemplateId(templateId) ? templateId : undefined;

  const html = await generateOfferLetterPreviewHtml(businessId, {
    settingsOverride: settings,
    templateIdOverride,
  });

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * GET /api/settings/offer-letter-template/preview?settings={json}&template_id=standard
 */
export async function GET(request: NextRequest) {
  try {
    const settingsParam = request.nextUrl.searchParams.get('settings');
    const templateId = request.nextUrl.searchParams.get('template_id') ?? undefined;
    let settingsRaw: unknown = undefined;
    if (settingsParam) {
      try {
        settingsRaw = JSON.parse(decodeURIComponent(settingsParam));
      } catch {
        return NextResponse.json({ error: 'Invalid settings JSON' }, { status: 400 });
      }
    }
    return await renderPreview(request, settingsRaw, templateId);
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[offer-letter-template/preview GET]', error);
    return NextResponse.json({ error: 'Failed to render preview' }, { status: 500 });
  }
}

/**
 * POST /api/settings/offer-letter-template/preview
 * Body: { settings?: OfferLetterTemplateSettings, template_id?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const settingsRaw = body?.settings ?? body;
    const templateId = body?.template_id as string | undefined;
    return await renderPreview(request, settingsRaw, templateId);
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[offer-letter-template/preview POST]', error);
    return NextResponse.json({ error: 'Failed to render preview' }, { status: 500 });
  }
}
