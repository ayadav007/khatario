import * as db from '@/lib/db';

export interface TemplateAssignment {
  template_id: string;
  settings: Record<string, any> | null;
  document_type: string;
}

// Proforma and bill of supply live in the invoices table and fall back to the
// tax invoice template when the business has not assigned one of their own.
const FALLS_BACK_TO_TAX_INVOICE = new Set(['proforma_invoice', 'bill_of_supply']);

function parseSettings(raw: unknown): Record<string, any> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw as Record<string, any>;
}

async function loadAssignment(businessId: string, documentType: string): Promise<TemplateAssignment | null> {
  const row = await db.queryOne<{ template_id: string; settings: unknown }>(
    `SELECT template_id, settings
     FROM business_template_assignments
     WHERE business_id = $1 AND document_type = $2
     LIMIT 1`,
    [businessId, documentType]
  );
  if (!row?.template_id) return null;
  return { template_id: row.template_id, settings: parseSettings(row.settings), document_type: documentType };
}

/** The template assignment that applies to a document type, shared by preview, save and PDF. */
export async function findTemplateAssignment(
  businessId: string,
  documentType: string
): Promise<TemplateAssignment | null> {
  if (!businessId) return null;
  const own = await loadAssignment(businessId, documentType);
  if (own || !FALLS_BACK_TO_TAX_INVOICE.has(documentType)) return own;
  return loadAssignment(businessId, 'tax_invoice');
}
