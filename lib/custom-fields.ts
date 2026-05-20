import type {
  CustomFieldDefinition,
  CustomFieldLayout,
  CustomFieldType,
  CustomFieldValues,
  CustomMetaDisplayRow,
} from '@/types/custom-fields';

const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_DEFINITIONS_PER_ENTITY = 25;

export function slugifyFieldKey(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return base || 'field';
}

export function isValidFieldKey(key: string): boolean {
  return FIELD_KEY_RE.test(key);
}

export function normalizeDefinitionRow(row: Record<string, unknown>): CustomFieldDefinition {
  let options: string[] = [];
  if (Array.isArray(row.options)) {
    options = row.options.map(String);
  } else if (typeof row.options === 'string') {
    try {
      const parsed = JSON.parse(row.options);
      options = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      options = [];
    }
  }
  return {
    id: String(row.id),
    business_id: String(row.business_id),
    entity_type: row.entity_type as CustomFieldDefinition['entity_type'],
    field_key: String(row.field_key),
    label: String(row.label),
    field_type: (row.field_type as CustomFieldType) || 'text',
    options,
    is_required: !!row.is_required,
    sort_order: Number(row.sort_order) || 0,
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export function parseCustomFieldValues(raw: unknown): CustomFieldValues {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return parseCustomFieldValues(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: CustomFieldValues = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || v === undefined || v === '') {
      out[k] = null;
    } else if (typeof v === 'number') {
      out[k] = v;
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

export function formatCustomFieldValue(
  def: Pick<CustomFieldDefinition, 'field_type'>,
  value: string | number | null | undefined
): string {
  if (value === null || value === undefined || value === '') return '';
  if (def.field_type === 'date') {
    try {
      const d = new Date(String(value));
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });
      }
    } catch {
      /* fall through */
    }
  }
  if (def.field_type === 'number') {
    const n = Number(value);
    if (!isNaN(n)) return n.toLocaleString('en-IN');
  }
  return String(value);
}

export function validateCustomFieldValues(
  definitions: CustomFieldDefinition[],
  values: CustomFieldValues
): { ok: true; values: CustomFieldValues } | { ok: false; error: string } {
  const sanitized: CustomFieldValues = {};
  const defMap = new Map(definitions.map((d) => [d.field_key, d]));

  for (const [key, raw] of Object.entries(values)) {
    const def = defMap.get(key);
    if (!def) continue;
    const str = raw === null || raw === undefined ? '' : String(raw).trim();

    if (!str) {
      if (def.is_required) {
        return { ok: false, error: `"${def.label}" is required` };
      }
      sanitized[key] = null;
      continue;
    }

    if (def.field_type === 'number') {
      const n = Number(str);
      if (isNaN(n)) {
        return { ok: false, error: `"${def.label}" must be a number` };
      }
      sanitized[key] = n;
      continue;
    }

    if (def.field_type === 'date') {
      const d = new Date(str);
      if (isNaN(d.getTime())) {
        return { ok: false, error: `"${def.label}" must be a valid date` };
      }
      sanitized[key] = str.slice(0, 10);
      continue;
    }

    if (def.field_type === 'dropdown' && def.options.length > 0 && !def.options.includes(str)) {
      return { ok: false, error: `"${def.label}" must be one of the allowed options` };
    }

    sanitized[key] = str;
  }

  for (const def of definitions) {
    if (def.is_required && (sanitized[def.field_key] === undefined || sanitized[def.field_key] === null)) {
      const incoming = values[def.field_key];
      if (incoming === null || incoming === undefined || String(incoming).trim() === '') {
        return { ok: false, error: `"${def.label}" is required` };
      }
    }
  }

  return { ok: true, values: sanitized };
}

export function buildCustomMetaDisplay(
  definitions: CustomFieldDefinition[],
  values: CustomFieldValues,
  layoutKeys: string[]
): CustomMetaDisplayRow[] {
  if (!layoutKeys.length) return [];
  const defByKey = new Map(definitions.map((d) => [d.field_key, d]));
  const rows: CustomMetaDisplayRow[] = [];
  for (const key of layoutKeys) {
    const def = defByKey.get(key);
    if (!def || def.entity_type !== 'invoice') continue;
    const formatted = formatCustomFieldValue(def, values[key]);
    if (!formatted) continue;
    rows.push({ key, label: def.label, value: formatted });
  }
  return rows;
}

export function getCustomItemColumnValues(
  definitions: CustomFieldDefinition[],
  itemCustomFields: CustomFieldValues,
  layoutKeys: string[]
): { key: string; label: string; value: string }[] {
  if (!layoutKeys.length) return [];
  const defByKey = new Map(definitions.map((d) => [d.field_key, d]));
  const cols: { key: string; label: string; value: string }[] = [];
  for (const key of layoutKeys) {
    const def = defByKey.get(key);
    if (!def || def.entity_type !== 'item') continue;
    const formatted = formatCustomFieldValue(def, itemCustomFields[key]);
    cols.push({ key, label: def.label, value: formatted || '—' });
  }
  return cols;
}

export function getLayoutFromSettings(settings: Record<string, unknown>): CustomFieldLayout {
  const layout = settings?.custom_field_layout;
  if (!layout || typeof layout !== 'object') {
    return { invoice_meta: [], item_table: [] };
  }
  const l = layout as CustomFieldLayout;
  return {
    invoice_meta: Array.isArray(l.invoice_meta) ? l.invoice_meta.map(String) : [],
    item_table: Array.isArray(l.item_table) ? l.item_table.map(String) : [],
  };
}

export function settingKeyForCustomItemColumn(fieldKey: string): string {
  return `show_custom_${fieldKey}`;
}

export function mergeCustomItemColumnSettings(
  layout: CustomFieldLayout,
  settings: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...settings };
  for (const key of layout.item_table || []) {
    next[settingKeyForCustomItemColumn(key)] = true;
  }
  return next;
}

export const CUSTOM_FIELD_LIMITS = {
  maxPerEntity: MAX_DEFINITIONS_PER_ENTITY,
} as const;
