/** Order of day and month in numeric dates such as 01-04-2026. */
export type DateOrder = 'dmy' | 'mdy';

export type SectionKey = 'customers' | 'suppliers' | 'items';
export type SourceApp = 'tally' | 'vyapar' | 'zoho_books' | 'other';
export type FieldType =
  | 'text'
  | 'amount'
  | 'number'
  | 'date'
  | 'phone'
  | 'gstin'
  | 'email'
  | 'pincode'
  | 'state'
  | 'unit'
  | 'tax_rate'
  | 'boolean';
export interface ImportField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  aliases: string[];
}
/** Column index to field key; null means "Don't import". */
export type ColumnMatches = Record<number, string | null>;
