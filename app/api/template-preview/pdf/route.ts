import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { registerGlobalInvoiceHandlebarsHelpers } from '@/lib/handlebars-invoice-helpers';
import { getSampleData } from '@/lib/template-preview-sample';
import { renderDesignerPreview } from '@/lib/template-designer-preview';
import { renderPrintHtmlToPdf } from '@/lib/pdf-generator';
import { getDefaultTemplateSettings, mergeTemplateSettings } from '@/lib/template-defaults';

export const dynamic = 'force-dynamic';

registerGlobalInvoiceHandlebarsHelpers();

/**
 * POST /api/template-preview/pdf
 * Body: { template_id, settings?, source?: 'sample' | 'last_document', document_type? }
 * The template designer's "Download sample PDF": the same render as the preview, printed to PDF.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;

    const userId = getUserIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    try {
      await authorize(userId, 'settings', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }
    const gate = await denyIfFeatureMissing(businessId, 'settings_template_customization');
    if (gate) return gate;

    const templateId = typeof body.template_id === 'string' ? body.template_id : '';
    if (!templateId) return NextResponse.json({ error: 'template_id is required' }, { status: 400 });
    const settings = (body.settings as Record<string, unknown> | undefined) ?? null;

    const result = await renderDesignerPreview({
      request,
      businessId,
      templateId,
      settings,
      source: body.source === 'last_document' ? 'last_document' : 'sample',
      documentType: String(body.document_type || 'tax_invoice'),
      forPrint: true,
      getSampleData,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    const printSettings = mergeTemplateSettings(
      (result.settings ?? {}) as Parameters<typeof mergeTemplateSettings>[0],
      getDefaultTemplateSettings(result.templateId),
    );
    const pdf = await renderPrintHtmlToPdf(result.html, result.templateId, printSettings);
    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${templateId}-sample.pdf"`,
      },
    });
  } catch (error) {
    console.error('[Template preview PDF]', error);
    return NextResponse.json({ error: 'Could not make the PDF' }, { status: 500 });
  }
}
