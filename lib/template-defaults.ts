import { TemplateSettings } from '@/types/template';

/**
 * Generate default template settings with all fields enabled by default
 * This ensures backward compatibility and provides sensible defaults
 */
export function getDefaultTemplateSettings(templateId?: string): TemplateSettings {
  // Export invoice template specific defaults
  const isExportTemplate = templateId === 'export_invoice';
  
  // Template-specific color defaults
  let defaultPrimaryColor = '#1e3a8a'; // Default blue for most templates
  let defaultTextColor = '#000000';
  let defaultTableHeaderColor = '#1e3a8a';
  
  if (templateId === 'modern') {
    defaultPrimaryColor = '#4f46e5'; // Indigo for modern template
    defaultTableHeaderColor = '#4f46e5';
  } else if (templateId === 'elegant') {
    defaultPrimaryColor = '#059669'; // Emerald for elegant template
    defaultTableHeaderColor = '#059669';
  } else if (templateId === 'classic') {
    defaultPrimaryColor = '#dc2626'; // Red for classic template
    defaultTableHeaderColor = '#dc2626';
  } else if (templateId === 'tally_style') {
    defaultPrimaryColor = '#000000'; // Tally-like monochrome
    defaultTableHeaderColor = '#f0f0f0';
  } else if (templateId === 'minimal') {
    defaultPrimaryColor = '#000000'; // Black for minimal template
    defaultTableHeaderColor = '#000000';
  } else if (templateId === 'gst_standard') {
    defaultPrimaryColor = '#1e3a8a'; // Blue for GST standard
    defaultTableHeaderColor = '#1e3a8a';
  } else if (templateId === 'tax_exempt') {
    defaultPrimaryColor = '#059669'; // Emerald — matches legacy Bill of Supply (tax exempt) look
    defaultTableHeaderColor = '#059669';
  } else if (templateId === 'composition_standard') {
    defaultPrimaryColor = '#1e40af'; // Blue — legacy Composition Standard
    defaultTableHeaderColor = '#1e40af';
  } else if (templateId === 'composition_modern') {
    defaultPrimaryColor = '#6366f1'; // Indigo — legacy Composition Modern
    defaultTableHeaderColor = '#6366f1';
  } else if (templateId === 'credit_standard') {
    defaultPrimaryColor = '#dc2626'; // Red — credit note
    defaultTableHeaderColor = '#dc2626';
  } else if (templateId === 'debit_standard') {
    defaultPrimaryColor = '#ea580c'; // Orange — debit note
    defaultTableHeaderColor = '#ea580c';
  } else if (templateId === 'challan_standard') {
    defaultPrimaryColor = '#0891b2'; // Cyan — delivery challan
    defaultTableHeaderColor = '#0891b2';
  } else if (templateId === 'export_invoice') {
    defaultPrimaryColor = '#4A90E2'; // Legacy export banner / accents
    defaultTableHeaderColor = '#4A90E2';
  }

  return {
    template_id: templateId,
    
    // Header & Business Info - Most shown by default
    show_logo: true,
    show_business_name: true,
    show_business_address: true,
    show_business_phone: true,
    show_business_email: false,
    show_business_website: false,
    show_business_gstin: true,
    show_business_pan: false,
    show_business_cin: false,
    show_business_iec: isExportTemplate ? true : false, // IEC Code for exporters
    show_business_swift: isExportTemplate ? false : false, // SWIFT Code (optional, shown if available)
    
    // Invoice Metadata - Essential fields shown
    show_invoice_number: true,
    show_invoice_date: true,
    show_invoice_type: false,
    show_due_date: true,
    show_po_number: false,
    show_reference_number: false,
    show_place_of_supply: true,
    show_reverse_charge: false,
    show_eway_bill_number: false,
    show_delivery_note: false,
    show_other_references: false,
    show_dispatched_through: false,
    show_destination: false,
    show_terms_of_delivery: false,
    
    // Party Information - Standard fields shown
    show_bill_to: true,
    show_ship_to: isExportTemplate ? true : false, // Export invoices should show ship_to by default
    show_customer_name: true,
    show_customer_address: true,
    show_customer_phone: false,
    show_customer_email: false,
    show_customer_gstin: true,
    show_customer_state: isExportTemplate ? true : false, // Export invoices should show state
    show_customer_state_code: isExportTemplate ? true : false, // Export invoices should show state code
    show_customer_pan: false,
    show_contact_person: false,
    show_customer_country: isExportTemplate ? true : false, // Country of destination for exports
    show_buyer_tax_id: isExportTemplate ? false : false, // Buyer Tax/VAT ID (optional)
    show_customer_balance: false, // Customer outstanding balance (disabled by default)
    
    // Items Table Columns - Essential columns shown
    show_serial_number: true,
    show_item_name: true,
    show_hsn: true,
    show_unit: true,
    show_quantity: true,
    show_rate: true,
    show_discount_percent: false,
    show_discount_amount: true,
    show_tax_rate: true,
    show_tax_amount: true,
    show_line_total: true,
    show_item_image: false,
    show_batch_number: false,
    show_expiry_date: false,
    
    // Summary/Totals - All shown by default
    show_subtotal: true,
    show_discount_total: true,
    show_additional_charges: true,
    show_cgst: true,
    show_sgst: true,
    show_igst: true,
    show_cess: false,
    show_tax_total: true,
    show_round_off: true,
    show_grand_total: true,
    show_amount_in_words: isExportTemplate ? true : false, // Export invoices should show amount in words
    show_paid_amount: false,
    show_balance_amount: false,
    
    // Footer - Standard fields shown
    show_bank_details: false,
    show_bank_name: false,
    show_account_number: false,
    show_ifsc_code: false,
    show_branch_name: false,
    show_swift_code: isExportTemplate ? true : false, // SWIFT code for international payments
    show_payment_terms: isExportTemplate ? true : false, // Export invoices should show payment terms
    show_terms: true,
    show_notes: false,
    show_signature: false,
    show_authorized_signatory: false,
    show_qr_code: false,
    
    // Export-specific fields
    show_invoice_currency: isExportTemplate ? true : false, // Invoice currency (USD, EUR, etc.)
    show_exchange_rate: isExportTemplate ? false : false, // Exchange rate (optional)
    show_country_of_origin: isExportTemplate ? true : false, // Country of origin
    show_port_of_loading: isExportTemplate ? true : false, // Port of loading
    show_port_of_discharge: isExportTemplate ? true : false, // Port of discharge
    show_place_of_delivery: isExportTemplate ? false : false, // Place of delivery (optional)
    show_incoterms: isExportTemplate ? true : false, // Incoterms (EXW, FOB, CIF, etc.)
    show_transport_mode: isExportTemplate ? true : false, // Transport mode
    show_awb_number: isExportTemplate ? false : false, // Air Waybill Number (optional)
    show_bl_number: isExportTemplate ? false : false, // Bill of Lading Number (optional)
    show_export_declaration: isExportTemplate ? true : false, // Export declaration
    show_lut_declaration: isExportTemplate ? true : false, // LUT declaration
    
    // Appearance - Default values
    primary_color: defaultPrimaryColor,
    text_color: defaultTextColor,
    table_header_color: defaultTableHeaderColor,
    font_size: 12,
    font_family: 'Arial, sans-serif',
    page_size: 'A4',
    orientation: 'portrait',
    margin_top: 10,
    margin_bottom: 10,
    margin_left: 10,
    margin_right: 10,
    
    // Content - Default text
    terms: 'Payment is due within 30 days. Thank you for your business!',
    notes: '',
    footer_text: '',
  };
}

/**
 * Merge saved settings with defaults, ensuring all fields are present
 */
export function mergeTemplateSettings(
  savedSettings: Partial<TemplateSettings> = {},
  defaults: TemplateSettings = getDefaultTemplateSettings()
): TemplateSettings {
  // Start with defaults
  const merged = { ...defaults };
  
  // Override with saved settings
  Object.keys(savedSettings).forEach(key => {
    if (key in merged) {
      (merged as any)[key] = (savedSettings as any)[key];
    }
  });
  
  // Handle legacy field mappings
  if (savedSettings.show_customer_address !== undefined) {
    merged.show_bill_to = savedSettings.show_customer_address;
    merged.show_customer_address = savedSettings.show_customer_address;
  }
  
  if (savedSettings.show_gstin !== undefined) {
    merged.show_business_gstin = savedSettings.show_gstin;
    merged.show_customer_gstin = savedSettings.show_gstin;
  }
  
  if (savedSettings.show_tax !== undefined) {
    merged.show_tax_rate = savedSettings.show_tax;
    merged.show_tax_amount = savedSettings.show_tax;
  }
  
  if (savedSettings.show_discount !== undefined) {
    merged.show_discount_amount = savedSettings.show_discount;
  }
  
  return merged;
}

