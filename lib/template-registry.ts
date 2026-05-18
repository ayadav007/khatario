/**
 * Central Template Registry
 * All available templates and their metadata
 */

export interface TemplateMetadata {
  id: string;
  name: string;
  category: string;
  description: string;
  forDocumentTypes: string[];
  previewImage: string;
  isPremium?: boolean;
  tags?: string[];
  gstRegistrationTypes?: string[]; // Which GST registration types can use this
}

export const TEMPLATE_REGISTRY: TemplateMetadata[] = [
  // ========================================
  // TAX INVOICES & GENERAL USE
  // ========================================
  {
    id: 'gst_standard',
    name: 'GST Standard',
    category: 'invoice',
    description: 'Clean GST-compliant template for all invoice types',
    forDocumentTypes: ['tax_invoice', 'export_invoice', 'credit_note', 'debit_note'],
    previewImage: '/templates/previews/gst_standard.png',
    gstRegistrationTypes: ['regular'],
    tags: ['gst', 'professional', 'compliant']
  },
  {
    id: 'modern',
    name: 'Modern',
    category: 'invoice',
    description: 'Contemporary design with clean lines',
    forDocumentTypes: ['tax_invoice', 'proforma_invoice', 'credit_note', 'debit_note', 'sales_order', 'purchase_order'],
    previewImage: '/templates/previews/modern.png',
    gstRegistrationTypes: ['regular', 'unregistered'],
    tags: ['modern', 'minimal', 'clean']
  },
  {
    id: 'classic',
    name: 'Classic',
    category: 'invoice',
    description: 'Traditional invoice layout with bordered design',
    forDocumentTypes: ['tax_invoice', 'proforma_invoice', 'credit_note', 'debit_note', 'sales_order', 'purchase_order'],
    previewImage: '/templates/previews/classic.png',
    gstRegistrationTypes: ['regular', 'unregistered'],
    tags: ['classic', 'traditional', 'borders']
  },
  {
    id: 'tally_style',
    name: 'Tally Style Template',
    category: 'invoice',
    description: 'Structured Indian GST layout with full grid tables (Tally-like)',
    forDocumentTypes: ['tax_invoice', 'proforma_invoice', 'credit_note', 'debit_note'],
    previewImage: '/templates/previews/classic.png',
    gstRegistrationTypes: ['regular', 'unregistered'],
    tags: ['gst', 'tally', 'grid', 'accounting']
  },
  {
    id: 'elegant',
    name: 'Elegant',
    category: 'invoice',
    description: 'Sophisticated design with elegant typography',
    forDocumentTypes: ['tax_invoice', 'proforma_invoice', 'credit_note', 'debit_note'],
    previewImage: '/templates/previews/elegant.png',
    gstRegistrationTypes: ['regular', 'unregistered'],
    tags: ['elegant', 'sophisticated', 'premium']
  },
  {
    id: 'minimal',
    name: 'Minimal',
    category: 'invoice',
    description: 'Ultra-clean minimalist design',
    forDocumentTypes: ['tax_invoice', 'proforma_invoice'],
    previewImage: '/templates/previews/minimal.png',
    gstRegistrationTypes: ['regular', 'unregistered'],
    tags: ['minimal', 'simple', 'clean']
  },
  {
    id: 'export_invoice',
    name: 'Export Invoice',
    category: 'invoice',
    description: 'Specialized template for export invoices with international compliance',
    forDocumentTypes: ['export_invoice'],
    previewImage: '/templates/previews/export_invoice.png',
    gstRegistrationTypes: ['regular'],
    tags: ['export', 'international', 'compliance']
  },
  
  // ========================================
  // BILL OF SUPPLY (Composition Scheme)
  // ========================================
  {
    id: 'bill_of_supply/composition_standard',
    name: 'Composition Standard',
    category: 'bill_of_supply',
    description: 'Standard template for businesses under Composition Scheme (Section 10 CGST Act)',
    forDocumentTypes: ['bill_of_supply'],
    previewImage: '/templates/previews/composition_standard.png',
    gstRegistrationTypes: ['composition'],
    tags: ['composition', 'gst', 'bill_of_supply', 'compliant']
  },
  {
    id: 'bill_of_supply/composition_modern',
    name: 'Composition Modern',
    category: 'bill_of_supply',
    description: 'Modern design for Composition Scheme businesses',
    forDocumentTypes: ['bill_of_supply'],
    previewImage: '/templates/previews/composition_modern.png',
    gstRegistrationTypes: ['composition'],
    tags: ['composition', 'modern', 'bill_of_supply']
  },
  {
    id: 'bill_of_supply/tax_exempt',
    name: 'Tax Exempt Simple',
    category: 'bill_of_supply',
    description: 'For unregistered businesses or tax-exempt supplies',
    forDocumentTypes: ['bill_of_supply'],
    previewImage: '/templates/previews/tax_exempt.png',
    gstRegistrationTypes: ['unregistered'],
    tags: ['exempt', 'simple', 'unregistered']
  },
  
  // ========================================
  // CREDIT NOTES
  // ========================================
  {
    id: 'credit_note/standard',
    name: 'Credit Note Standard',
    category: 'credit_note',
    description: 'GST-compliant credit note with reason for credit field',
    forDocumentTypes: ['credit_note'],
    previewImage: '/templates/previews/credit_note_standard.png',
    gstRegistrationTypes: ['regular'],
    tags: ['credit', 'returns', 'gst', 'compliant']
  },
  {
    id: 'credit_note/modern',
    name: 'Credit Note Modern',
    category: 'credit_note',
    description: 'Modern design for credit notes',
    forDocumentTypes: ['credit_note'],
    previewImage: '/templates/previews/credit_note_modern.png',
    gstRegistrationTypes: ['regular'],
    tags: ['credit', 'modern', 'clean']
  },
  
  // ========================================
  // DEBIT NOTES
  // ========================================
  {
    id: 'debit_note/standard',
    name: 'Debit Note Standard',
    category: 'debit_note',
    description: 'GST-compliant debit note with reason for debit field',
    forDocumentTypes: ['debit_note'],
    previewImage: '/templates/previews/debit_note_standard.png',
    gstRegistrationTypes: ['regular'],
    tags: ['debit', 'adjustments', 'gst', 'compliant']
  },
  {
    id: 'debit_note/modern',
    name: 'Debit Note Modern',
    category: 'debit_note',
    description: 'Modern design for debit notes',
    forDocumentTypes: ['debit_note'],
    previewImage: '/templates/previews/debit_note_modern.png',
    gstRegistrationTypes: ['regular'],
    tags: ['debit', 'modern', 'clean']
  },
  
  // ========================================
  // DELIVERY CHALLANS
  // ========================================
  {
    id: 'delivery_challan/standard',
    name: 'Challan Standard',
    category: 'delivery_challan',
    description: 'Standard delivery challan with transport details and GST Rule 55 compliance',
    forDocumentTypes: ['delivery_challan'],
    previewImage: '/templates/previews/challan_standard.png',
    tags: ['challan', 'transport', 'gst', 'compliant']
  },
  {
    id: 'delivery_challan/minimal',
    name: 'Challan Minimal',
    category: 'delivery_challan',
    description: 'Simplified delivery challan for internal use',
    forDocumentTypes: ['delivery_challan'],
    previewImage: '/templates/previews/challan_minimal.png',
    tags: ['challan', 'minimal', 'simple']
  },
  
  // ========================================
  // SALES & PURCHASE ORDERS
  // ========================================
  {
    id: 'sales_order/professional',
    name: 'Sales Order Professional',
    category: 'sales_order',
    description: 'Professional sales order template',
    forDocumentTypes: ['sales_order'],
    previewImage: '/templates/previews/sales_order_professional.png',
    tags: ['order', 'professional', 'sales']
  },
  {
    id: 'purchase_order/professional',
    name: 'Purchase Order Professional',
    category: 'purchase_order',
    description: 'Professional purchase order template',
    forDocumentTypes: ['purchase_order'],
    previewImage: '/templates/previews/purchase_order_professional.png',
    tags: ['order', 'professional', 'purchase']
  },
  
  // ========================================
  // WORK ORDERS
  // ========================================
  {
    id: 'work_order/job_card',
    name: 'Job Card',
    category: 'work_order',
    description: 'Job card style work order for service businesses',
    forDocumentTypes: ['work_order'],
    previewImage: '/templates/previews/work_order_job_card.png',
    tags: ['work', 'service', 'job']
  },
  
  // ========================================
  // THERMAL PRINTER TEMPLATES
  // ========================================
  {
    id: 'thermal_80mm',
    name: 'Thermal 80mm',
    category: 'thermal',
    description: 'For 80mm thermal printers (POS systems)',
    forDocumentTypes: ['tax_invoice', 'bill_of_supply', 'delivery_challan'],
    previewImage: '/templates/previews/thermal_80mm.png',
    tags: ['thermal', 'pos', '80mm']
  },
  {
    id: 'thermal_58mm',
    name: 'Thermal 58mm',
    category: 'thermal',
    description: 'For 58mm thermal printers (compact POS)',
    forDocumentTypes: ['tax_invoice', 'bill_of_supply'],
    previewImage: '/templates/previews/thermal_58mm.png',
    tags: ['thermal', 'pos', '58mm', 'compact']
  },
];

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Get all templates that support a specific document type
 */
export function getTemplatesByDocumentType(documentType: string): TemplateMetadata[] {
  return TEMPLATE_REGISTRY.filter(t => t.forDocumentTypes.includes(documentType));
}

/**
 * Get template by ID
 */
export function getTemplateById(id: string): TemplateMetadata | undefined {
  return TEMPLATE_REGISTRY.find(t => t.id === id);
}

/**
 * Get all unique categories
 */
export function getAllCategories(): string[] {
  return Array.from(new Set(TEMPLATE_REGISTRY.map(t => t.category)));
}

/**
 * Get templates filtered by category
 */
export function getTemplatesByCategory(category: string): TemplateMetadata[] {
  return TEMPLATE_REGISTRY.filter(t => t.category === category);
}

/**
 * Get templates suitable for a business's GST registration type
 */
export function getTemplatesByGstType(documentType: string, gstType: string): TemplateMetadata[] {
  return TEMPLATE_REGISTRY.filter(t => 
    t.forDocumentTypes.includes(documentType) &&
    (!t.gstRegistrationTypes || t.gstRegistrationTypes.includes(gstType))
  );
}

/**
 * Get default template for a document type
 */
export function getDefaultTemplateForDocumentType(documentType: string, gstType?: string): string {
  // For composition scheme, always use composition templates
  if (gstType === 'composition' && documentType === 'bill_of_supply') {
    return 'bill_of_supply/composition_standard';
  }
  
  // For unregistered, use tax exempt for bill of supply
  if (gstType === 'unregistered' && documentType === 'bill_of_supply') {
    return 'bill_of_supply/tax_exempt';
  }
  
  // Default mappings
  const defaults: Record<string, string> = {
    'tax_invoice': 'gst_standard',
    'proforma_invoice': 'modern',
    'bill_of_supply': 'bill_of_supply/composition_standard',
    'export_invoice': 'export_invoice',
    'credit_note': 'credit_note/standard',
    'debit_note': 'debit_note/standard',
    'delivery_challan': 'delivery_challan/standard',
    'sales_order': 'sales_order/professional',
    'purchase_order': 'purchase_order/professional',
    'work_order': 'work_order/job_card',
  };
  
  return defaults[documentType] || 'gst_standard';
}

