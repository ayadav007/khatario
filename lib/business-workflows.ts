/**
 * Business Workflow Configuration
 * Defines default settings and behaviors based on business type and industry
 */

import { Business } from '@/types/database';

export interface WorkflowDefaults {
  invoice_template?: string;
  default_payment_terms?: string;
  enable_credit_management?: boolean;
  enable_batch_tracking?: boolean;
  enable_expiry_tracking?: boolean;
  enable_variants?: boolean;
  default_tax_rate?: number;
  invoice_prefix?: string;
}

/**
 * Get workflow defaults based on business type
 */
export function getWorkflowDefaultsByType(businessType?: string): Partial<WorkflowDefaults> {
  switch (businessType) {
    case 'retail':
      return {
        invoice_template: 'retail',
        default_payment_terms: 'Cash on Delivery',
        enable_credit_management: false,
        default_tax_rate: 18,
        invoice_prefix: 'RINV'
      };
    
    case 'wholesaler':
      return {
        invoice_template: 'business_pro',
        default_payment_terms: 'Net 30',
        enable_credit_management: true,
        default_tax_rate: 18,
        invoice_prefix: 'WINV'
      };
    
    case 'distributor':
      return {
        invoice_template: 'business_pro',
        default_payment_terms: 'Net 45',
        enable_credit_management: true,
        default_tax_rate: 18,
        invoice_prefix: 'DINV'
      };
    
    case 'manufacturer':
      return {
        invoice_template: 'business_pro',
        default_payment_terms: 'Net 30',
        enable_credit_management: true,
        enable_batch_tracking: true,
        default_tax_rate: 18,
        invoice_prefix: 'MINV'
      };
    
    case 'service':
      return {
        invoice_template: 'minimal',
        default_payment_terms: 'Net 15',
        enable_credit_management: false,
        default_tax_rate: 18,
        invoice_prefix: 'SINV'
      };
    
    default:
      return {
        invoice_template: 'modern',
        default_payment_terms: 'Net 30',
        enable_credit_management: false,
        default_tax_rate: 18,
        invoice_prefix: 'INV'
      };
  }
}

/**
 * Get workflow defaults based on industry
 */
export function getWorkflowDefaultsByIndustry(industry?: string): Partial<WorkflowDefaults> {
  switch (industry) {
    case 'pharmaceuticals':
      return {
        enable_batch_tracking: true,
        enable_expiry_tracking: true,
        default_tax_rate: 12 // Pharmaceuticals often have lower GST
      };
    
    case 'textiles':
    case 'garments':
      return {
        enable_variants: true,
        default_tax_rate: 5 // Textiles have 5% GST
      };
    
    case 'food_beverages':
      return {
        enable_batch_tracking: true,
        enable_expiry_tracking: true,
        default_tax_rate: 5 // Food items have 5% GST
      };
    
    case 'electronics':
      return {
        default_tax_rate: 18
      };
    
    case 'automotive':
      return {
        enable_batch_tracking: true,
        default_tax_rate: 28 // Auto parts have higher GST
      };
    
    case 'construction':
      return {
        default_tax_rate: 18
      };
    
    default:
      return {};
  }
}

/**
 * Get combined workflow defaults for a business
 */
export function getBusinessWorkflowDefaults(business: Partial<Business>): WorkflowDefaults {
  const typeDefaults = getWorkflowDefaultsByType(business.business_type);
  const industryDefaults = getWorkflowDefaultsByIndustry(business.industry);
  
  // Merge defaults (industry overrides type)
  return {
    ...typeDefaults,
    ...industryDefaults,
    // Ensure variants are enabled for textiles/garments
    enable_variants: industryDefaults.enable_variants || 
                     (business.industry === 'textiles' || business.industry === 'garments')
  };
}

/**
 * Apply workflow defaults to business settings
 */
export function applyWorkflowDefaults(
  businessId: string,
  defaults: WorkflowDefaults
): Record<string, any> {
  const settings: Record<string, any> = {};
  
  if (defaults.enable_variants !== undefined) {
    settings.product_variants_enabled = defaults.enable_variants;
  }
  
  if (defaults.enable_credit_management !== undefined) {
    settings.credit_management_enabled = defaults.enable_credit_management;
  }
  
  if (defaults.enable_batch_tracking !== undefined) {
    settings.batch_tracking_enabled = defaults.enable_batch_tracking;
  }
  
  if (defaults.enable_expiry_tracking !== undefined) {
    settings.expiry_tracking_enabled = defaults.enable_expiry_tracking;
  }
  
  return settings;
}

