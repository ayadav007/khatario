/**
 * Renders what the template designer shows: the template with unsaved settings, filled with sample
 * data or with the business's latest saved document of that type.
 */
import type { NextRequest } from 'next/server';
import { finalizePrintHtml, generateDocumentHtml } from '@/lib/pdf-generator';
import { requireDocumentReadAccess } from '@/lib/document-access';
import { renderTemplatePreviewHtml } from '@/lib/template-preview-render';
import { injectTemplateScreenPreviewCss } from '@/lib/template-screen-preview';
import { findLatestDocumentId, injectPreviewBridge, previewSourceTable } from '@/lib/template-preview-source';

export type DesignerPreviewSource = 'sample' | 'last_document';

export type DesignerPreviewResult =
  | { ok: true; html: string; templateId: string; settings: Record<string, unknown>; documentNumber?: string }
  | { ok: false; status: number; error: string };

export async function renderDesignerPreview(opts: {
  request: NextRequest;
  businessId: string;
  templateId: string;
  settings: Record<string, unknown> | null;
  source: DesignerPreviewSource;
  documentType: string;
  forPrint: boolean;
  getSampleData: (templateId: string) => Record<string, unknown>;
}): Promise<DesignerPreviewResult> {
  if (opts.source === 'last_document') {
    const table = previewSourceTable(opts.documentType);
    const id = table ? await findLatestDocumentId(opts.businessId, opts.documentType) : null;
    if (!table || !id) return { ok: false, status: 404, error: 'no_document' };
    // The same read check as opening that document; the designer permission alone is not enough.
    const access = await requireDocumentReadAccess(opts.request, table, id);
    if (!access.ok) return { ok: false, status: access.response.status, error: 'forbidden' };

    const out = await generateDocumentHtml(id, table, {
      templateId: opts.templateId,
      settings: opts.settings ?? undefined,
    });
    let html = await finalizePrintHtml(out.html, out.templateId, out.settings, out.businessId);
    const settings = out.settings as unknown as Record<string, unknown>;
    if (!opts.forPrint) html = injectPreviewBridge(injectTemplateScreenPreviewCss(html, out.templateId, settings));
    return { ok: true, html, templateId: out.templateId, settings, documentNumber: out.documentNumber };
  }

  const html = await renderTemplatePreviewHtml({
    templateId: opts.templateId,
    businessId: opts.businessId,
    customSettings: opts.settings,
    getSampleData: opts.getSampleData,
    forPrint: opts.forPrint,
    clickToEdit: !opts.forPrint,
  });
  return { ok: true, html, templateId: opts.templateId, settings: opts.settings ?? {} };
}
