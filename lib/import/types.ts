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

/** Business and acting user, always taken from the session. */
export type ServiceCtx = { businessId: string; userId: string };
export type CreateResult<T> =
  | { ok: true; record: T }
  | { ok: false; status: number; code: string; error: string; existing?: T; details?: string };

/** One row's values by field key, after parsing. */
export type RowValues = Record<string, string | number | boolean | null>;
export interface RowIssue {
  field: string | null;
  message: string;
  level: 'error' | 'warning';
}
export interface BuiltRow {
  values: RowValues;
  issues: RowIssue[];
  /** Values the user must match to a choice (state, unit, tax rate) before the row is ready. */
  unmatched: { field: string; value: string }[];
}
export interface ExistingMatch {
  id: string;
  label: string;
  matchedOn: string;
}
export interface SectionDefinition {
  key: SectionKey;
  label: string;
  module: 'customers' | 'suppliers' | 'items';
  limitType: 'customers' | 'suppliers' | 'items';
  fields: ImportField[];
  /** Keys that identify the same record within one file, e.g. 'gstin:27AAAPA1234A1ZT'. */
  duplicateKeys(values: RowValues): string[];
  findExisting(ctx: ServiceCtx, values: RowValues): Promise<ExistingMatch | null>;
  saveRow(
    ctx: ServiceCtx,
    values: RowValues
  ): Promise<{ ok: true; table: string; id: string } | { ok: false; error: string }>;
  /** One transaction per call, at most 500 ids; one result per input id, in input order. */
  undoRecords(
    ctx: ServiceCtx,
    ids: string[]
  ): Promise<Array<{ id: string; ok: true } | { id: string; ok: false; reason: string }>>;
  undoRecord(ctx: ServiceCtx, id: string): Promise<{ ok: true } | { ok: false; reason: string }>;
}
