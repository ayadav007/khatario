export type CustomFieldEntityType = 'item' | 'invoice';

export type CustomFieldType = 'text' | 'number' | 'date' | 'dropdown';

export interface CustomFieldDefinition {
  id: string;
  business_id: string;
  entity_type: CustomFieldEntityType;
  field_key: string;
  label: string;
  field_type: CustomFieldType;
  options: string[];
  is_required: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export type CustomFieldValues = Record<string, string | number | null>;

/** Per-template visibility and order (stored in template settings JSON). */
export interface CustomFieldLayout {
  invoice_meta?: string[];
  item_table?: string[];
}

export interface CustomMetaDisplayRow {
  key: string;
  label: string;
  value: string;
}

export interface CustomItemColumnDisplay {
  key: string;
  label: string;
  value: string;
}
