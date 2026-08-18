/**
 * Gemini REST `generationConfig.responseSchema` for printed invoice JSON.
 * Mirrors the prompt's REQUIRED JSON SCHEMA. Does not include unit_price or
 * other Khatario-derived purchase-form fields.
 */

type GeminiSchema = Record<string, unknown>;

function nullableString(): GeminiSchema {
  return { type: 'STRING', nullable: true };
}

function nullableNumber(): GeminiSchema {
  return { type: 'NUMBER', nullable: true };
}

function nullableBoolean(): GeminiSchema {
  return { type: 'BOOLEAN', nullable: true };
}

function nullableEnum(values: string[]): GeminiSchema {
  return { type: 'STRING', nullable: true, enum: values };
}

const LINE_ITEM_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    description: nullableString(),
    hsn_code: nullableString(),
    qty: nullableNumber(),
    unit: nullableString(),
    rate: nullableNumber(),
    discount_amount: nullableNumber(),
    gst_rate: nullableNumber(),
    tax_mode: nullableEnum(['exclusive', 'inclusive']),
    taxable_value: nullableNumber(),
    cgst_amount: nullableNumber(),
    sgst_amount: nullableNumber(),
    igst_amount: nullableNumber(),
    line_total: nullableNumber(),
    discount_on_tax_inclusive: nullableBoolean(),
  },
  required: [
    'description',
    'hsn_code',
    'qty',
    'unit',
    'rate',
    'discount_amount',
    'gst_rate',
    'tax_mode',
    'taxable_value',
    'cgst_amount',
    'sgst_amount',
    'igst_amount',
    'line_total',
    'discount_on_tax_inclusive',
  ],
};

const GST_SUMMARY_ROW_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    gst_rate: { type: 'NUMBER' },
    taxable_value: { type: 'NUMBER' },
    cgst: { type: 'NUMBER' },
    sgst: { type: 'NUMBER' },
    igst: { type: 'NUMBER' },
    total_tax: { type: 'NUMBER' },
  },
  required: ['gst_rate', 'taxable_value', 'cgst', 'sgst', 'igst', 'total_tax'],
};

export const GEMINI_INVOICE_EXTRACT_RESPONSE_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    supplier_name: nullableString(),
    supplier_gstin: nullableString(),
    buyer_gstin: nullableString(),
    invoice_number: nullableString(),
    invoice_date: nullableString(),
    place_of_supply: nullableString(),
    tax_type: nullableEnum(['igst', 'cgst_sgst']),
    price_mode: nullableEnum(['exclusive', 'inclusive']),
    subtotal: nullableNumber(),
    total_cgst: nullableNumber(),
    total_sgst: nullableNumber(),
    total_igst: nullableNumber(),
    round_off: nullableNumber(),
    grand_total: nullableNumber(),
    items: { type: 'ARRAY', items: LINE_ITEM_SCHEMA },
    gst_summary: { type: 'ARRAY', items: GST_SUMMARY_ROW_SCHEMA },
  },
  required: [
    'supplier_name',
    'supplier_gstin',
    'buyer_gstin',
    'invoice_number',
    'invoice_date',
    'place_of_supply',
    'tax_type',
    'price_mode',
    'subtotal',
    'total_cgst',
    'total_sgst',
    'total_igst',
    'round_off',
    'grand_total',
    'items',
    'gst_summary',
  ],
};
