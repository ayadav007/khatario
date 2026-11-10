import { checkGstin, GST_STATE_NAMES } from '@/lib/tax/gstin';
import { resolveState } from '@/lib/tax/state-names';
import {
  looksLikeEmail,
  looksLikePincode,
  normaliseKey,
  parseAmount,
  parseBoolean,
  parseDate,
  parsePhone,
  parseTaxRate,
  resolveUnit,
  UNIT_CODES,
} from '@/lib/import/parse-values';
import { customersSection } from '@/lib/import/sections/customers';
import { suppliersSection } from '@/lib/import/sections/suppliers';
import { itemsSection } from '@/lib/import/sections/items';
import type {
  BuiltRow,
  ColumnMatches,
  DateOrder,
  ImportField,
  RowIssue,
  RowValues,
  SectionDefinition,
  SectionKey,
} from '@/lib/import/types';

export const SECTIONS: Record<SectionKey, SectionDefinition> = {
  customers: customersSection,
  suppliers: suppliersSection,
  items: itemsSection,
};

type ChoiceType = 'state' | 'unit' | 'tax_rate';

/** What the user picks from when a state, unit or tax rate in the file needs a match. */
export const VALUE_CHOICES: Record<ChoiceType, string[]> = {
  state: Object.keys(GST_STATE_NAMES)
    .map((code) => resolveState(code)?.state)
    .filter((s): s is string => Boolean(s)),
  unit: [...UNIT_CODES],
  tax_rate: ['0', '0.25', '3', '5', '12', '18', '28'],
};

const RESOLVERS: Record<ChoiceType, (text: string) => string | number | null> = {
  state: (t) => resolveState(t)?.state ?? null,
  unit: (t) => resolveUnit(t),
  tax_rate: (t) => parseTaxRate(t),
};

/** Fails its type: the row needs attention. */
const STRICT: Partial<Record<ImportField['type'], { noun: string; parse: (raw: string, order: DateOrder) => string | number | boolean | null }>> = {
  gstin: { noun: 'GSTIN', parse: (raw) => { const r = checkGstin(raw); return r.valid ? r.gstin : null; } },
  amount: { noun: 'amount', parse: (raw) => parseAmount(raw)?.amount ?? null },
  number: {
    noun: 'number',
    parse: (raw) => {
      const s = raw.replace(/[,\s]/g, '');
      return /^-?(\d+(\.\d+)?|\.\d+)$/.test(s) ? Number(s) : null;
    },
  },
  date: { noun: 'date', parse: (raw, order) => parseDate(raw, order) },
  boolean: { noun: 'yes or no', parse: (raw) => parseBoolean(raw) },
};

/** Fails its type: imported without the value, with a warning. */
const LENIENT: Partial<Record<ImportField['type'], { without: string; noun: string; parse: (raw: string) => string | null }>> = {
  phone: { without: 'phone', noun: 'number', parse: (raw) => parsePhone(raw) },
  email: { without: 'email', noun: 'email', parse: (raw) => (looksLikeEmail(raw) ? raw : null) },
  pincode: { without: 'PIN code', noun: 'PIN code', parse: (raw) => (looksLikePincode(raw) ? raw : null) },
};

/**
 * One spreadsheet row as values by field key, with its issues. Only matched columns are read;
 * messages name the column as headed in the user's file. A row with an error needs attention.
 */
export function buildRow(
  def: SectionDefinition,
  cells: string[],
  headers: string[],
  matches: ColumnMatches,
  opts: { dateOrder: DateOrder; valueMatches: Record<string, Record<string, string>> }
): BuiltRow {
  const fields = new Map(def.fields.map((f) => [f.key, f]));
  const values: RowValues = {};
  for (const f of def.fields) values[f.key] = null;
  const issues: RowIssue[] = [];
  const unmatched: BuiltRow['unmatched'] = [];
  const headerOf = new Map<string, string>();

  const columns = Object.keys(matches)
    .map(Number)
    .sort((a, b) => a - b);
  for (const index of columns) {
    const field = fields.get(matches[index] ?? '');
    if (!field || values[field.key] !== null) continue;
    const header = String(headers[index] ?? '').trim() || field.label;
    if (!headerOf.has(field.key)) headerOf.set(field.key, header);
    const raw = String(cells[index] ?? '').trim();
    if (raw === '') continue;

    const strict = STRICT[field.type];
    const lenient = LENIENT[field.type];
    if (field.type === 'state' || field.type === 'unit' || field.type === 'tax_rate') {
      const chosen = opts.valueMatches[field.key]?.[normaliseKey(raw)];
      const resolved = RESOLVERS[field.type](chosen ?? raw);
      if (resolved === null) {
        unmatched.push({ field: field.key, value: raw });
        issues.push({ field: field.key, level: 'error', message: `"${header}": choose what "${raw}" means` });
      } else {
        values[field.key] = resolved;
      }
    } else if (strict) {
      const parsed = strict.parse(raw, opts.dateOrder);
      if (parsed === null) {
        issues.push({ field: field.key, level: 'error', message: `"${header}" is not a valid ${strict.noun}: ${raw}` });
      } else {
        values[field.key] = parsed;
      }
    } else if (lenient) {
      const parsed = lenient.parse(raw);
      if (parsed === null) {
        issues.push({
          field: field.key,
          level: 'warning',
          message: `Imported without ${lenient.without}: "${raw}" is not a valid ${lenient.noun}`,
        });
      } else {
        values[field.key] = parsed;
      }
    } else {
      values[field.key] = raw;
    }
  }

  for (const f of def.fields) {
    if (f.required && values[f.key] === null && !issues.some((i) => i.field === f.key)) {
      issues.push({ field: f.key, level: 'error', message: `"${headerOf.get(f.key) ?? f.label}" is empty` });
    }
  }

  return { values, issues, unmatched };
}
