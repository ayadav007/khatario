/**
 * The template designer's model: which settings live in which section (in the order they appear on
 * the printed page), and the presets (palettes, density, margins) that write ordinary template
 * settings. Nothing here is stored separately; presets only set existing keys.
 */

export type DesignerSettings = Record<string, unknown>;

export interface DesignerField {
  key: string;
  label: string;
}

export interface DesignerFieldGroup {
  title?: string;
  fields: DesignerField[];
}

export type DesignerSectionId = 'style' | 'header' | 'details' | 'items' | 'totals' | 'footer' | 'export' | 'page';

export interface DesignerSection {
  id: DesignerSectionId;
  title: string;
  /** Switches in this section, in the order they print. */
  groups: DesignerFieldGroup[];
}

const f = (key: string, label: string): DesignerField => ({ key, label });

export const DESIGNER_SECTIONS: DesignerSection[] = [
  { id: 'style', title: 'Style', groups: [] },
  {
    id: 'header',
    title: 'Header',
    groups: [{
      fields: [
        f('show_logo', 'Logo'),
        f('show_business_name', 'Business name'),
        f('show_business_address', 'Address'),
        f('show_business_phone', 'Phone'),
        f('show_business_email', 'Email'),
        f('show_business_website', 'Website'),
        f('show_business_gstin', 'GSTIN'),
        f('show_business_pan', 'PAN'),
        f('show_business_cin', 'CIN'),
        f('show_business_iec', 'IEC code'),
        f('show_business_swift', 'SWIFT code'),
      ],
    }],
  },
  {
    id: 'details',
    title: 'Customer and invoice details',
    groups: [
      {
        title: 'Customer',
        fields: [
          f('show_bill_to', 'Bill to'),
          f('show_ship_to', 'Ship to'),
          f('show_customer_name', 'Name'),
          f('show_customer_address', 'Address'),
          f('show_customer_phone', 'Phone'),
          f('show_customer_email', 'Email'),
          f('show_customer_gstin', 'GSTIN'),
          f('show_customer_state', 'State'),
          f('show_customer_state_code', 'State code'),
          f('show_customer_pan', 'PAN'),
          f('show_contact_person', 'Contact person'),
        ],
      },
      {
        title: 'Invoice',
        fields: [
          f('show_invoice_number', 'Invoice number'),
          f('show_invoice_date', 'Invoice date'),
          f('show_invoice_type', 'Invoice type'),
          f('show_due_date', 'Due date'),
          f('show_po_number', 'PO number'),
          f('show_reference_number', 'Reference number'),
          f('show_place_of_supply', 'Place of supply'),
          f('show_reverse_charge', 'Reverse charge'),
          f('show_eway_bill_number', 'E-way bill number'),
          f('show_delivery_note', 'Delivery note'),
          f('show_payment_terms', 'Mode or terms of payment'),
          f('show_other_references', 'Other references'),
          f('show_dispatched_through', 'Dispatched through'),
          f('show_destination', 'Destination'),
          f('show_terms_of_delivery', 'Terms of delivery'),
        ],
      },
    ],
  },
  {
    id: 'items',
    title: 'Items table',
    groups: [{
      fields: [
        f('show_serial_number', 'Serial number'),
        f('show_item_name', 'Item name'),
        f('show_item_image', 'Item image'),
        f('show_hsn', 'HSN/SAC'),
        f('show_quantity', 'Quantity'),
        f('show_unit', 'Unit'),
        f('show_rate', 'Rate'),
        f('show_discount_percent', 'Discount %'),
        f('show_discount_amount', 'Discount amount'),
        f('show_tax_rate', 'Tax rate'),
        f('show_tax_amount', 'Tax amount'),
        f('show_line_total', 'Line total'),
        f('show_batch_number', 'Batch number'),
        f('show_expiry_date', 'Expiry date'),
      ],
    }],
  },
  {
    id: 'totals',
    title: 'Totals and tax',
    groups: [{
      fields: [
        f('show_subtotal', 'Subtotal'),
        f('show_discount_total', 'Total discount'),
        f('show_additional_charges', 'Additional charges'),
        f('show_cgst', 'CGST'),
        f('show_sgst', 'SGST'),
        f('show_igst', 'IGST'),
        f('show_cess', 'Cess'),
        f('show_tax_total', 'Total tax'),
        f('show_round_off', 'Round off'),
        f('show_grand_total', 'Grand total'),
        f('show_paid_amount', 'Paid amount'),
        f('show_balance_amount', 'Balance due'),
        f('show_customer_balance', "Customer's previous balance"),
        f('show_amount_in_words', 'Amount in words'),
        f('show_hsn_summary', 'HSN-wise tax summary'),
      ],
    }],
  },
  {
    id: 'footer',
    title: 'Footer',
    groups: [
      {
        title: 'Bank details',
        fields: [
          f('show_bank_details', 'Show bank details'),
          f('show_bank_name', 'Bank name'),
          f('show_account_number', 'Account number'),
          f('show_ifsc_code', 'IFSC code'),
          f('show_branch_name', 'Branch'),
          f('show_swift_code', 'SWIFT code'),
        ],
      },
      {
        title: 'Sign-off',
        fields: [
          f('show_terms', 'Terms and conditions'),
          f('show_notes', 'Notes'),
          f('show_signature', 'Signature image'),
          f('show_authorized_signatory', 'Authorised signatory line'),
          f('show_copy_label', 'Copy label (Original for recipient)'),
          f('show_qr_code', 'QR code'),
        ],
      },
    ],
  },
  {
    id: 'export',
    title: 'Export details',
    groups: [{
      fields: [
        f('show_invoice_currency', 'Invoice currency'),
        f('show_exchange_rate', 'Exchange rate'),
        f('show_customer_country', 'Customer country'),
        f('show_buyer_tax_id', 'Buyer tax ID'),
        f('show_country_of_origin', 'Country of origin'),
        f('show_port_of_loading', 'Port of loading'),
        f('show_port_of_discharge', 'Port of discharge'),
        f('show_place_of_delivery', 'Place of delivery'),
        f('show_incoterms', 'Incoterms'),
        f('show_transport_mode', 'Transport mode'),
        f('show_awb_number', 'AWB number'),
        f('show_bl_number', 'BL number'),
        f('show_export_declaration', 'Export declaration'),
        f('show_lut_declaration', 'LUT declaration'),
      ],
    }],
  },
  { id: 'page', title: 'Page', groups: [] },
];

/** Export details only matter on the export template. */
export function sectionsFor(templateId: string): DesignerSection[] {
  return DESIGNER_SECTIONS.filter((s) => s.id !== 'export' || templateId === 'export_invoice');
}

export function isShown(settings: DesignerSettings, key: string): boolean {
  return settings[key] !== false;
}

/** Fields the business can change in a section: GST-locked ones are summarised elsewhere. */
export function editableGroups(section: DesignerSection, locked: string[]): DesignerFieldGroup[] {
  return section.groups
    .map((g) => ({ ...g, fields: g.fields.filter((fl) => !locked.includes(fl.key)) }))
    .filter((g) => g.fields.length > 0);
}

/** "5 of 8 shown" over the switches a business can change. */
export function sectionSummary(section: DesignerSection, settings: DesignerSettings, locked: string[]): string {
  const fields = editableGroups(section, locked).flatMap((g) => g.fields);
  if (!fields.length) return '';
  const on = fields.filter((fl) => isShown(settings, fl.key)).length;
  return `${on} of ${fields.length} shown`;
}

// ─── Palettes ────────────────────────────────────────────────────────────────

export interface Palette {
  id: string;
  name: string;
  primary: string;
  header: string;
}

/** Print-safe colour schemes: a title colour and a table-header colour. */
export const PALETTES: Palette[] = [
  { id: 'navy', name: 'Navy', primary: '#1e3a8a', header: '#1e3a8a' },
  { id: 'indigo', name: 'Indigo', primary: '#3949ab', header: '#3949ab' },
  { id: 'forest', name: 'Forest', primary: '#065f46', header: '#065f46' },
  { id: 'teal', name: 'Teal', primary: '#0f766e', header: '#ccfbf1' },
  { id: 'maroon', name: 'Maroon', primary: '#7f1d1d', header: '#7f1d1d' },
  { id: 'charcoal', name: 'Charcoal', primary: '#111827', header: '#e5e7eb' },
];

const norm = (c: unknown) => String(c ?? '').trim().toLowerCase();

/** The palette the settings match, if any. */
export function paletteOf(settings: DesignerSettings): string | null {
  const p = PALETTES.find((x) => norm(x.primary) === norm(settings.primary_color) && norm(x.header) === norm(settings.table_header_color));
  return p ? p.id : null;
}

/**
 * Settings for a palette or a single brand colour. The header text colour is cleared so the renderer
 * picks black or white for contrast against the new header.
 */
export function colourSettings(primary: string, header: string = primary): DesignerSettings {
  return { primary_color: primary, table_header_color: header, table_header_text_color: undefined };
}

// ─── Density ────────────────────────────────────────────────────────────────

export type Density = 'compact' | 'regular' | 'roomy';
export const DENSITY_FONT_SIZE: Record<Density, number> = { compact: 10, regular: 12, roomy: 13 };

export function densityOf(settings: DesignerSettings): Density {
  const size = Number(settings.font_size) || 12;
  if (size <= 10.5) return 'compact';
  if (size >= 13) return 'roomy';
  return 'regular';
}

// ─── Margins ────────────────────────────────────────────────────────────────

export type MarginPreset = 'narrow' | 'normal' | 'wide' | 'custom';
export const MARGIN_MM: Record<Exclude<MarginPreset, 'custom'>, number> = { narrow: 6, normal: 10, wide: 16 };
const SIDES = ['margin_top', 'margin_right', 'margin_bottom', 'margin_left'] as const;

export function marginSettings(preset: Exclude<MarginPreset, 'custom'>): DesignerSettings {
  return Object.fromEntries(SIDES.map((s) => [s, MARGIN_MM[preset]]));
}

export function marginPresetOf(settings: DesignerSettings): MarginPreset {
  const values = SIDES.map((s) => Number(settings[s] ?? 10));
  if (values.some((v) => v !== values[0])) return 'custom';
  const match = (Object.keys(MARGIN_MM) as (keyof typeof MARGIN_MM)[]).find((k) => MARGIN_MM[k] === values[0]);
  return match || 'custom';
}

export const PAGE_SIZES = [
  { value: 'A4', label: 'A4' },
  { value: 'A5', label: 'A5' },
  { value: 'Letter', label: 'Letter' },
  { value: 'Legal', label: 'Legal' },
];

export const FONT_OPTIONS = [
  { value: 'Inter', label: 'Inter' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'Segoe UI', label: 'Segoe UI' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Courier New', label: 'Courier New' },
];

/** Label for previewing with the business's newest saved document; types without one are absent. */
export const LAST_DOCUMENT_LABELS: Record<string, string> = {
  tax_invoice: 'Last invoice',
  proforma_invoice: 'Last proforma',
  bill_of_supply: 'Last bill',
  credit_note: 'Last credit note',
  debit_note: 'Last debit note',
  delivery_challan: 'Last challan',
  sales_order: 'Last order',
  purchase_order: 'Last purchase order',
};
