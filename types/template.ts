export interface TemplateColor {
  header: string;
  accent: string;
  table_header: string;
  text: string;
}

export interface TemplateSection {
  type: string;
  [key: string]: any;
}

export interface InvoiceTemplate {
  id: string;
  name: string;
  paper_size: 'A4' | 'A5' | 'POS_58mm' | 'POS_80mm';
  orientation: 'portrait' | 'landscape';
  supports_custom_colors: boolean;
  default_colors: TemplateColor;
  sections: {
    header?: TemplateSection;
    party_info?: TemplateSection;
    items_table?: TemplateSection;
    summary?: TemplateSection;
    footer?: TemplateSection;
    [key: string]: TemplateSection | undefined;
  };
}

export interface TemplateSettings {
  // Template ID
  template_id?: string;
  
  // Header & Business Info
  show_logo: boolean;
  show_business_name: boolean;
  show_business_address: boolean;
  show_business_phone: boolean;
  show_business_email: boolean;
  show_business_website: boolean;
  show_business_gstin: boolean;
  show_business_pan: boolean;
  show_business_cin: boolean;
  show_business_iec: boolean; // IEC Code for exporters
  show_business_swift: boolean; // SWIFT Code for international payments
  
  // Invoice Metadata
  show_invoice_number: boolean;
  show_invoice_date: boolean;
  show_invoice_type: boolean;
  show_due_date: boolean;
  show_po_number: boolean;
  show_reference_number: boolean;
  show_place_of_supply: boolean;
  show_reverse_charge: boolean;
  show_eway_bill_number: boolean;
  show_delivery_note: boolean;
  show_payment_terms: boolean;
  show_other_references: boolean;
  show_dispatched_through: boolean;
  show_destination: boolean;
  show_terms_of_delivery: boolean;
  
  // Party Information
  show_bill_to: boolean;
  show_ship_to: boolean;
  show_customer_name: boolean;
  show_customer_address: boolean;
  show_customer_phone: boolean;
  show_customer_email: boolean;
  show_customer_gstin: boolean;
  show_customer_state: boolean;
  show_customer_state_code: boolean;
  show_customer_pan: boolean;
  show_contact_person: boolean;
  show_customer_country: boolean; // Country of destination for exports
  show_buyer_tax_id: boolean; // Buyer Tax/VAT ID
  show_customer_balance: boolean; // Customer outstanding balance
  
  // Items Table Columns
  show_serial_number: boolean;
  show_item_name: boolean;
  show_hsn: boolean;
  show_unit: boolean;
  show_quantity: boolean;
  show_rate: boolean;
  show_discount_percent: boolean;
  show_discount_amount: boolean;
  show_tax_rate: boolean;
  show_tax_amount: boolean;
  show_line_total: boolean;
  show_item_image: boolean;
  show_batch_number: boolean;
  show_expiry_date: boolean;
  
  // Summary/Totals
  show_subtotal: boolean;
  show_discount_total: boolean;
  show_additional_charges: boolean;
  show_cgst: boolean;
  show_sgst: boolean;
  show_igst: boolean;
  show_cess: boolean;
  show_tax_total: boolean;
  show_round_off: boolean;
  show_grand_total: boolean;
  show_amount_in_words: boolean;
  show_paid_amount: boolean;
  show_balance_amount: boolean;
  
  // Footer
  show_bank_details: boolean;
  show_bank_name: boolean;
  show_account_number: boolean;
  show_ifsc_code: boolean;
  show_branch_name: boolean;
  show_swift_code: boolean; // SWIFT code for international payments
  show_terms: boolean;
  
  // Export-specific fields
  show_invoice_currency: boolean; // Invoice currency (USD, EUR, etc.)
  show_exchange_rate: boolean; // Exchange rate
  show_country_of_origin: boolean; // Country of origin
  show_port_of_loading: boolean; // Port of loading
  show_port_of_discharge: boolean; // Port of discharge
  show_place_of_delivery: boolean; // Place of delivery
  show_incoterms: boolean; // Incoterms (EXW, FOB, CIF, etc.)
  show_transport_mode: boolean; // Transport mode
  show_awb_number: boolean; // Air Waybill Number
  show_bl_number: boolean; // Bill of Lading Number
  show_export_declaration: boolean; // Export declaration
  show_lut_declaration: boolean; // LUT declaration
  show_notes: boolean;
  show_signature: boolean;
  show_authorized_signatory: boolean;
  show_qr_code: boolean;
  
  // Appearance
  primary_color: string;
  text_color?: string;
  table_header_color?: string;
  font_size: number;
  font_family: string;
  page_size: string;
  orientation: 'portrait' | 'landscape';
  margin_top: number;
  margin_bottom: number;
  margin_left: number;
  margin_right: number;
  
  // Content
  terms: string;
  payment_terms?: string;
  notes: string;
  footer_text: string;
  
  // Legacy support (deprecated, use specific fields above)
  show_gstin?: boolean; // Use show_business_gstin + show_customer_gstin instead
  show_tax?: boolean; // Use show_tax_rate + show_tax_amount instead
  show_discount?: boolean; // Use show_discount_percent + show_discount_amount instead
  custom_colors?: TemplateColor;
}

