import {
  buildCustomMetaDisplay,
  getCustomItemColumnValues,
  getLayoutFromSettings,
  parseCustomFieldValues,
} from '@/lib/custom-fields';
import { fetchDefinitionsForBusiness } from '@/lib/custom-fields-persist';

/**
 * Enriches invoice render payload with custom meta rows and per-line item custom values.
 */
export async function enrichInvoiceRenderData<T extends {
  invoice: Record<string, unknown>;
  items: Record<string, unknown>[];
  settings: Record<string, unknown>;
  business?: { id?: string };
}>(data: T): Promise<T> {
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

  const invoiceValues = parseCustomFieldValues(data.invoice.custom_fields);
  const customMetaDisplay = buildCustomMetaDisplay(
    invoiceDefs,
    invoiceValues,
    layout.invoice_meta || []
  );

  const itemLayout = layout.item_table || [];
  const items = data.items.map((item) => {
    const itemFields = parseCustomFieldValues(
      item.item_custom_fields ?? item.custom_fields
    );
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
