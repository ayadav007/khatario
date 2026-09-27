import { NextRequest, NextResponse } from 'next/server';
import { finalizePrintHtml, generateDocumentHtml } from '@/lib/pdf-generator';
import { requireDocumentReadAccess } from '@/lib/document-access';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { table: string; id: string } }
) {
  try {
    const { id } = params;

    const access = await requireDocumentReadAccess(req, params.table, id);
    if (!access.ok) return access.response;

    const { html, templateId, settings, businessId } = await generateDocumentHtml(id, access.table);
    const finalizedHtml = await finalizePrintHtml(html, templateId, settings, businessId);

    return NextResponse.json({ html: finalizedHtml, templateId });

  } catch (error: any) {
    console.error(`Error generating ${params.table} preview:`, error);
    const status = error.message === 'Document not found' ? 404 : 500;
    return NextResponse.json(
      { error: error.message || 'Failed to generate preview' },
      { status }
    );
  }
}
