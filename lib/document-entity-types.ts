/** Valid entity_type values for document_attachments / upload APIs */
export const DOCUMENT_ENTITY_TYPES = [
  'invoice',
  'purchase',
  'credit_note',
  'purchase_return',
  'journal_entry',
  'expense',
  'customer',
  'supplier',
  'purchase_order',
] as const;

export type DocumentEntityType = (typeof DOCUMENT_ENTITY_TYPES)[number];

export function isValidDocumentEntityType(value: string): value is DocumentEntityType {
  return (DOCUMENT_ENTITY_TYPES as readonly string[]).includes(value);
}
