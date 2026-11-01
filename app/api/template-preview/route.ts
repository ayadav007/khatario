import { NextRequest, NextResponse } from 'next/server';
import { renderTemplatePreviewHtml } from '@/lib/template-preview-render';
import { getSampleData } from '@/lib/template-preview-sample';
import { renderDesignerPreview } from '@/lib/template-designer-preview';
import { registerGlobalInvoiceHandlebarsHelpers } from '@/lib/handlebars-invoice-helpers';

export const dynamic = 'force-dynamic';

import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';

async function requireTemplatePreview(request: NextRequest, businessId: string) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return new NextResponse('Authentication required', { status: 401 });
  }
  try {
    await authorize(userId, 'settings', 'read', { businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }
  return denyIfFeatureMissing(businessId, 'settings_template_customization');
}

registerGlobalInvoiceHandlebarsHelpers();

/**
 * GET /api/template-preview?template_id=gst_standard&settings={...}
 * Renders template HTML with sample data for iframe preview
 * Optionally accepts custom settings as JSON string in query param
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const templateId = searchParams.get('template_id');
    const customSettingsParam = searchParams.get('settings');
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;
    const gate = await requireTemplatePreview(request, businessId);
    if (gate) return gate;
    if (!templateId) {
      return new NextResponse('template_id parameter is required', { status: 400 });
    }

    let customSettings: Record<string, unknown> | null = null;
    if (customSettingsParam) {
      try {
        customSettings = JSON.parse(decodeURIComponent(customSettingsParam));
      } catch (e) {
        console.error('[Preview] Failed to parse settings JSON:', e);
      }
    }

    const html = await renderTemplatePreviewHtml({
      templateId,
      businessId,
      customSettings,
      getSampleData,
    });

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (error) {
    console.error('Error rendering template:', error);
    const message = error instanceof Error ? error.message : 'Error rendering template';
    return new NextResponse(message, { status: 500 });
  }
}

/**
 * POST /api/template-preview
 * Body: { template_id, business_id?, settings?, source?: 'sample' | 'last_document', document_type? } — used by the
 * template designer (POST avoids URL length limits). 'last_document' fills the template with the business's newest
 * document of that type.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;
    const gate = await requireTemplatePreview(request, business_id);
    if (gate) return gate;
    const templateId = body.template_id as string | undefined;
    const customSettings = (body.settings as Record<string, unknown> | undefined) ?? null;

    if (!templateId) {
      return new NextResponse('template_id is required', { status: 400 });
    }

    const result = await renderDesignerPreview({
      request,
      businessId: business_id,
      templateId,
      settings: customSettings,
      source: body.source === 'last_document' ? 'last_document' : 'sample',
      documentType: String(body.document_type || 'tax_invoice'),
      forPrint: false,
      getSampleData,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    const headers: Record<string, string> = { 'Content-Type': 'text/html' };
    if (result.documentNumber) headers['X-Preview-Document'] = encodeURIComponent(result.documentNumber);
    return new NextResponse(result.html, { headers });
  } catch (error) {
    console.error('Error rendering template (POST):', error);
    const message = error instanceof Error ? error.message : 'Error rendering template';
    return new NextResponse(message, { status: 500 });
  }
}

