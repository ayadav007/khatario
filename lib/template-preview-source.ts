/**
 * Template designer preview helpers: the business's latest saved document of a type (to preview with
 * real data), and the preview-only script that lets a click on the page open its designer section.
 */
import { queryOne } from '@/lib/db';
import { hasTableColumn } from '@/lib/schema-columns';
import type { DocumentTable } from '@/lib/pdf-generator';

/** Where each document type's saved documents live. */
const SOURCES: Record<string, { table: DocumentTable; documentTypes?: string[] }> = {
  tax_invoice: { table: 'invoices', documentTypes: ['tax_invoice', 'regular'] },
  proforma_invoice: { table: 'invoices', documentTypes: ['proforma_invoice'] },
  bill_of_supply: { table: 'invoices', documentTypes: ['bill_of_supply'] },
  credit_note: { table: 'credit_notes' },
  debit_note: { table: 'debit_notes' },
  delivery_challan: { table: 'delivery_challans' },
  sales_order: { table: 'sales_orders' },
  purchase_order: { table: 'purchase_orders' },
};

export function previewSourceTable(documentType: string): DocumentTable | null {
  return SOURCES[documentType]?.table ?? null;
}

/** The newest document of this type in this business, or null when there is none yet. */
export async function findLatestDocumentId(businessId: string, documentType: string): Promise<string | null> {
  const source = SOURCES[documentType];
  if (!source) return null;
  const { table, documentTypes } = source;
  const [hasDeleted, hasCreated, hasDocType] = await Promise.all([
    hasTableColumn(table, 'deleted_at'),
    hasTableColumn(table, 'created_at'),
    documentTypes ? hasTableColumn(table, 'document_type') : Promise.resolve(false),
  ]);
  const where = ['business_id = $1'];
  const params: unknown[] = [businessId];
  if (hasDeleted) where.push('deleted_at IS NULL');
  if (documentTypes && hasDocType) {
    params.push(documentTypes);
    // Old rows without a document_type are tax invoices.
    where.push(
      documentType === 'tax_invoice'
        ? `(document_type = ANY($2::text[]) OR document_type IS NULL)`
        : `document_type = ANY($2::text[])`,
    );
  }
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM ${table} WHERE ${where.join(' AND ')} ORDER BY ${hasCreated ? 'created_at DESC, ' : ''}id DESC LIMIT 1`,
    params,
  );
  return row?.id ?? null;
}

/** Parts of the page a template marks with data-kh-section, matching the designer's sections. */
export const PREVIEW_SECTIONS = ['header', 'details', 'items', 'totals', 'footer'] as const;

/**
 * Hover outlines a marked part of the page; a click tells the designer which section to open.
 * Added to designer previews only, never to print or PDF output.
 */
const BRIDGE = `<script data-kh-preview-bridge>(function(){
var cur=null,st=document.createElement('style');
st.textContent='[data-kh-section]{cursor:pointer}[data-kh-section].kh-hover{outline:2px solid rgba(37,99,235,.6);outline-offset:3px;border-radius:2px}';
document.head.appendChild(st);
function sec(t){return t&&t.closest?t.closest('[data-kh-section]'):null}
document.addEventListener('mouseover',function(e){var s=sec(e.target);if(s===cur)return;if(cur)cur.classList.remove('kh-hover');cur=s;if(s)s.classList.add('kh-hover');});
document.documentElement.addEventListener('mouseleave',function(){if(cur)cur.classList.remove('kh-hover');cur=null;});
document.addEventListener('click',function(e){var s=sec(e.target);if(!s)return;e.preventDefault();parent.postMessage({type:'kh-designer-section',section:s.getAttribute('data-kh-section')},'*');});
})();</script>`;

export function injectPreviewBridge(html: string): string {
  const at = html.search(/<\/body>/i);
  return at < 0 ? html + BRIDGE : html.slice(0, at) + BRIDGE + html.slice(at);
}
