/**
 * Template Registry - Central source for all available templates
 * Maps template IDs to their file paths and metadata
 */

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  path: string;
  documentTypes: string[];
  color: string;
  isComposition?: boolean;
  features: string[];
}

export const TEMPLATE_REGISTRY: TemplateInfo[] = [
  // Tax Invoice Templates
  {
    id: 'gst_standard',
    name: 'GST Standard',
    description: 'Professional GST-compliant invoice',
    path: 'templates/gst_standard',
    documentTypes: ['tax_invoice'],
    color: '#3949AB',
    features: ['GST Breakdown', 'HSN Codes', 'Bank Details', 'Digital Signature']
  },
  {
    id: 'modern',
    name: 'Modern',
    description: 'Clean layout with colored header',
    path: 'templates/modern',
    documentTypes: ['tax_invoice'],
    color: '#2563eb',
    features: ['Minimalist', 'Color Accents', 'Modern Typography']
  },
  {
    id: 'classic',
    name: 'Classic',
    description: 'Traditional business invoice',
    path: 'templates/classic',
    documentTypes: ['tax_invoice'],
    color: '#059669',
    features: ['Professional', 'Detailed Layout', 'Print-Friendly']
  },
  {
    id: 'tally_style',
    name: 'Tally Style Template',
    description: 'Structured GST invoice with full bordered grid (Tally-like)',
    path: 'templates/tally_style',
    documentTypes: ['tax_invoice'],
    color: '#111827',
    features: ['Full Grid Borders', 'HSN-wise Tax Summary', 'Acknowledgement Section', 'A4 Print Optimized']
  },
  {
    id: 'elegant',
    name: 'Elegant',
    description: 'Sophisticated and refined',
    path: 'templates/elegant',
    documentTypes: ['tax_invoice'],
    color: '#dc2626',
    features: ['Premium Look', 'Elegant Typography', 'Subtle Colors']
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Simple and straightforward',
    path: 'templates/minimal',
    documentTypes: ['tax_invoice'],
    color: '#64748b',
    features: ['Clean Design', 'Easy to Read', 'Fast Loading']
  },
  {
    id: 'business_pro',
    name: 'Business Pro',
    description: 'Professional business template',
    path: 'templates/business_pro',
    documentTypes: ['tax_invoice'],
    color: '#7c3aed',
    features: ['Corporate Design', 'Professional Layout']
  },
  {
    id: 'export_invoice',
    name: 'Export Invoice',
    description: 'For international transactions',
    path: 'templates/export_invoice',
    documentTypes: ['tax_invoice'],
    color: '#0891b2',
    features: ['Export Fields', 'Multi-currency', 'Incoterms']
  },
  {
    id: 'gst_detailed',
    name: 'GST Detailed Invoice',
    description: 'Comprehensive GST invoice with detailed tax breakdown, opening balance, and financial summary',
    path: 'templates/gst_detailed',
    documentTypes: ['tax_invoice'],
    color: '#1e40af',
    features: ['Detailed Tax Breakdown', 'Opening Balance', 'HSN-wise Summary', 'Financial Summary', 'Traditional Format']
  },

  // Bill of Supply Templates
  {
    id: 'composition_standard',
    name: 'Composition Standard',
    description: 'For composition scheme businesses',
    path: 'templates/bill_of_supply/composition_standard',
    documentTypes: ['bill_of_supply'],
    color: '#f59e0b',
    isComposition: true,
    features: ['Composition Disclaimer', 'No Tax Columns', 'Section 10 Compliant']
  },
  {
    id: 'composition_modern',
    name: 'Composition Modern',
    description: 'Modern design for composition scheme',
    path: 'templates/bill_of_supply/composition_modern',
    documentTypes: ['bill_of_supply'],
    color: '#f59e0b',
    isComposition: true,
    features: ['Contemporary Style', 'Clean Layout', 'Professional']
  },
  {
    id: 'tax_exempt',
    name: 'Tax Exempt',
    description: 'For unregistered businesses',
    path: 'templates/bill_of_supply/tax_exempt',
    documentTypes: ['bill_of_supply'],
    color: '#10b981',
    isComposition: true,
    features: ['No GSTIN', 'Simple Format', 'Tax-Free Display']
  },

  // Credit Note Templates
  {
    id: 'credit_standard',
    name: 'Credit Note Standard',
    description: 'Standard credit note format',
    path: 'templates/credit_note/standard',
    documentTypes: ['credit_note'],
    color: '#ef4444',
    features: ['Original Invoice Link', 'Reason Display', 'Tax Reduction']
  },

  // Debit Note Templates
  {
    id: 'debit_standard',
    name: 'Debit Note Standard',
    description: 'Standard debit note format',
    path: 'templates/debit_note/standard',
    documentTypes: ['debit_note'],
    color: '#f97316',
    features: ['Original Invoice Link', 'Reason Display', 'Tax Addition']
  },

  // Delivery Challan Templates
  {
    id: 'challan_standard',
    name: 'Delivery Challan Standard',
    description: 'GST Rule 55 compliant',
    path: 'templates/delivery_challan/standard',
    documentTypes: ['delivery_challan'],
    color: '#06b6d4',
    features: ['Vehicle Details', 'Reason Field', 'Transport Info', 'E-Way Bill']
  },

  // Payment Receipt Template
  {
    id: 'payment_receipt',
    name: 'Payment Receipt',
    description: 'Standard payment receipt',
    path: 'templates/payment_receipt',
    documentTypes: ['payment_receipt'],
    color: '#8b5cf6',
    features: ['Payment Details', 'Outstanding Balance', 'Receipt Number']
  },

  // Thermal Printer Templates
  {
    id: 'thermal_58mm',
    name: 'Thermal 58mm',
    description: 'For 58mm thermal printers',
    path: 'templates/thermal_58mm',
    documentTypes: ['tax_invoice', 'bill_of_supply'],
    color: '#475569',
    features: ['Compact', 'Thermal Print', 'Small Format']
  },
  {
    id: 'thermal_80mm',
    name: 'Thermal 80mm',
    description: 'For 80mm thermal printers',
    path: 'templates/thermal_80mm',
    documentTypes: ['tax_invoice', 'bill_of_supply'],
    color: '#475569',
    features: ['Standard Thermal', 'Receipt Format', 'POS Ready']
  },
];

/**
 * Get all templates for a specific document type
 */
export function getTemplatesForDocType(docType: string): TemplateInfo[] {
  return TEMPLATE_REGISTRY.filter(t => t.documentTypes.includes(docType));
}

/**
 * Get template by ID
 */
export function getTemplateById(id: string): TemplateInfo | undefined {
  return TEMPLATE_REGISTRY.find(t => t.id === id);
}

/**
 * Get all unique document types
 */
export function getAllDocumentTypes(): string[] {
  const types = new Set<string>();
  TEMPLATE_REGISTRY.forEach(t => {
    t.documentTypes.forEach(dt => types.add(dt));
  });
  return Array.from(types);
}

/**
 * Count templates per document type
 */
export function getTemplateCountByDocType(): Record<string, number> {
  const counts: Record<string, number> = {};
  TEMPLATE_REGISTRY.forEach(t => {
    t.documentTypes.forEach(dt => {
      counts[dt] = (counts[dt] || 0) + 1;
    });
  });
  return counts;
}

