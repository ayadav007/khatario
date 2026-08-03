import {
  buildCustomMetaDisplay,
  getCustomItemColumnValues,
  getLayoutFromSettings,
  parseCustomFieldValues,
} from '@/lib/custom-fields';
import { fetchDefinitionsForBusiness } from '@/lib/custom-fields-persist';
import type { CustomFieldDefinition, CustomFieldValues } from '@/types/custom-fields';

function sampleValueFor(def: CustomFieldDefinition): string | number {
  switch (def.field_type) {
    case 'number':
      return 1234;
    case 'date':
      return new Date().toISOString().slice(0, 10);
    case 'dropdown':
      return def.options[0] || 'Sample';
    default:
      return 'Sample';
  }
}

/** Fills missing values with type-appropriate samples so template previews show ticked fields. */
function withSampleValues(
  values: CustomFieldValues,
  defs: CustomFieldDefinition[],
  layoutKeys: string[]
): CustomFieldValues {
  const defByKey = new Map(defs.map((d) => [d.field_key, d]));
  const next = { ...values };
  for (const key of layoutKeys) {
    const def = defByKey.get(key);
    if (!def) continue;
    const v = next[key];
    if (v === null || v === undefined || v === '') {
      next[key] = sampleValueFor(def);
    }
  }
  return next;
}

export type EnrichInvoiceRenderOptions = {
  /**
   * Preview-only: fill ticked-but-empty custom fields with sample values so the
   * customize drawer reflects layout changes immediately. Never use for real documents.
   */
  previewSampleValues?: boolean;
};

/**
 * Enriches invoice render payload with custom meta rows and per-line item custom values.
 */
export async function enrichInvoiceRenderData<T extends {
  invoice: Record<string, unknown>;
  items: Record<string, unknown>[];
  settings: Record<string, unknown>;
  business?: { id?: string };
}>(data: T, options?: EnrichInvoiceRenderOptions): Promise<T> {
  const businessId = data.business?.id as string | undefined;
  if (!businessId) return data;

  let definitions;
  try {
    definitions = await fetchDefinitionsForBusiness(businessId);
  } catch {
    return data;
  }

  const layout = getLayoutFromSettings(data.settings || {});
  const invoiceDefs = definitions.filter((d) => d.entity_type === 'invoice');
  const itemDefs = definitions.filter((d) => d.entity_type === 'item');
  const useSamples = options?.previewSampleValues === true;

  let invoiceValues = parseCustomFieldValues(data.invoice.custom_fields);
  if (useSamples) {
    invoiceValues = withSampleValues(invoiceValues, invoiceDefs, layout.invoice_meta || []);
  }
  const customMetaDisplay = buildCustomMetaDisplay(
    invoiceDefs,
    invoiceValues,
    layout.invoice_meta || []
  );

  const itemLayout = layout.item_table || [];
  const items = data.items.map((item) => {
    let itemFields = parseCustomFieldValues(
      item.item_custom_fields ?? item.custom_fields
    );
    if (useSamples) {
      itemFields = withSampleValues(itemFields, itemDefs, itemLayout);
    }
    const item_custom_lines = getCustomItemColumnValues(itemDefs, itemFields, itemLayout);
    return { ...item, item_custom_lines };
  });

  return {
    ...data,
    invoice: {
      ...data.invoice,
      custom_meta_display: customMetaDisplay,
    },
    items,
  };
}
