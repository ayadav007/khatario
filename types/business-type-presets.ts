/**
 * Business Type Selection & Auto-Configuration
 * 
 * Provides user-friendly business type selection with automatic configuration
 * of tone, payment style, and ordering flow.
 */

import { WhatsAppBotUIConfig } from './whatsapp-bot-config';

// ============================================================================
// 1. BUSINESS TYPE OPTIONS (User-Facing)
// ============================================================================

export type BusinessTypeOption = 'retail' | 'wholesale' | 'both';

export interface BusinessTypeOptionConfig {
  value: BusinessTypeOption;
  label: string;
  description: string;
  icon?: string; // Optional icon identifier for UI
  recommendations: string[]; // Short bullet points shown to user
}

/**
 * Business type options with user-friendly labels
 */
export const BusinessTypeOptions: Record<BusinessTypeOption, BusinessTypeOptionConfig> = {
  retail: {
    value: 'retail',
    label: 'Retail',
    description: 'Selling directly to individual customers',
    recommendations: [
      'Casual, friendly communication',
      'Quick payment processing',
      'Flexible ordering for any quantity',
      'Focus on product recommendations'
    ],
  },
  wholesale: {
    value: 'wholesale',
    label: 'Wholesale',
    description: 'Selling to other businesses in bulk',
    recommendations: [
      'Professional, formal communication',
      'Credit terms and account-based ordering',
      'Minimum order quantities',
      'Detailed product specifications'
    ],
  },
  both: {
    value: 'both',
    label: 'Both',
    description: 'Serving both individual customers and businesses',
    recommendations: [
      'Adaptive communication style',
      'Flexible payment options',
      'Different ordering flows for each customer type',
      'Mixed recommendations'
    ],
  },
};

// ============================================================================
// 2. DEFAULT CONFIGURATIONS PER BUSINESS TYPE
// ============================================================================

/**
 * Default configuration presets for each business type
 * These are applied when user selects a business type
 */
export const BusinessTypePresets: Record<BusinessTypeOption, Partial<WhatsAppBotUIConfig>> = {
  retail: {
    communicationStyle: {
      tone: 'friendly_casual',
      responseLength: 'brief',
      useCustomerName: true,
    },
    businessType: {
      customerType: 'individual',
      requiresCreditTerms: false,
      minimumOrderAmount: undefined,
    },
    productInfo: {
      showFields: ['price', 'stock', 'description'],
      showOutOfStock: true,
      highlightBestSellers: true,
    },
    orderingProcess: {
      collectCustomerInfo: {
        name: true,
        phone: true,
        email: false,
        address: true,
      },
      requireConfirmation: true,
      allowBulkOrders: true,
      minimumQuantity: undefined,
    },
    promotions: {
      autoMentionActiveOffers: true,
      highlightDiscounts: true,
      showExpiryDates: true,
    },
    customerExperience: {
      enableUpselling: true,
      upsellingStyle: 'moderate',
      personalizeForReturningCustomers: true,
      enableTimeBasedGreetings: true,
    },
  },

  wholesale: {
    communicationStyle: {
      tone: 'professional_formal',
      responseLength: 'detailed',
      useCustomerName: true,
    },
    businessType: {
      customerType: 'business',
      requiresCreditTerms: true,
      minimumOrderAmount: 5000, // Default minimum, user can change
    },
    productInfo: {
      showFields: ['price', 'stock', 'description', 'specifications'],
      showOutOfStock: true,
      highlightBestSellers: false,
    },
    orderingProcess: {
      collectCustomerInfo: {
        name: true,
        phone: true,
        email: true, // Important for B2B
        address: true,
      },
      requireConfirmation: true,
      allowBulkOrders: true,
      minimumQuantity: 10, // Default minimum quantity
    },
    promotions: {
      autoMentionActiveOffers: true,
      highlightDiscounts: true,
      showExpiryDates: true,
    },
    customerExperience: {
      enableUpselling: false,
      upsellingStyle: 'subtle',
      personalizeForReturningCustomers: true,
      enableTimeBasedGreetings: true,
    },
  },

  both: {
    communicationStyle: {
      tone: 'helpful_expert',
      responseLength: 'moderate',
      useCustomerName: true,
    },
    businessType: {
      customerType: 'both',
      requiresCreditTerms: true, // Enable for business customers
      minimumOrderAmount: undefined, // No minimum by default
    },
    productInfo: {
      showFields: ['price', 'stock', 'description', 'specifications'],
      showOutOfStock: true,
      highlightBestSellers: true,
    },
    orderingProcess: {
      collectCustomerInfo: {
        name: true,
        phone: true,
        email: true, // Important for B2B
        address: true,
      },
      requireConfirmation: true,
      allowBulkOrders: true,
      minimumQuantity: undefined, // No minimum by default
    },
    promotions: {
      autoMentionActiveOffers: true,
      highlightDiscounts: true,
      showExpiryDates: true,
    },
    customerExperience: {
      enableUpselling: true,
      upsellingStyle: 'moderate',
      personalizeForReturningCustomers: true,
      enableTimeBasedGreetings: true,
    },
  },
};

// ============================================================================
// 3. UX COPY (Labels & Descriptions for UI)
// ============================================================================

export interface BusinessTypeFieldCopy {
  label: string;
  description: string;
  helperText?: string;
  options: {
    retail: { label: string; shortDescription: string };
    wholesale: { label: string; shortDescription: string };
    both: { label: string; shortDescription: string };
  };
}

/**
 * User-facing copy for Business Type selection field
 */
export const BusinessTypeFieldCopy: BusinessTypeFieldCopy = {
  label: 'Business Type',
  description: 'Select the type of customers you serve. This will automatically configure the bot\'s communication style, payment options, and ordering process.',
  helperText: 'You can customize these settings later in each section.',
  options: {
    retail: {
      label: 'Retail',
      shortDescription: 'Selling to individual customers',
    },
    wholesale: {
      label: 'Wholesale',
      shortDescription: 'Selling to other businesses',
    },
    both: {
      label: 'Both',
      shortDescription: 'Serving both individuals and businesses',
    },
  },
};

// ============================================================================
// 4. CONFIGURATION MAPPING LOGIC
// ============================================================================

/**
 * Apply business type preset to existing configuration
 * Merges preset values with existing config (preset takes priority for selected fields)
 */
export function applyBusinessTypePreset(
  businessType: BusinessTypeOption,
  existingConfig?: Partial<WhatsAppBotUIConfig>
): Partial<WhatsAppBotUIConfig> {
  const preset = BusinessTypePresets[businessType];

  // Deep merge: preset values override existing, but nested objects are merged
  return {
    ...existingConfig,
    communicationStyle: {
      tone: existingConfig?.communicationStyle?.tone ?? preset.communicationStyle?.tone ?? 'friendly_casual',
      responseLength: existingConfig?.communicationStyle?.responseLength ?? preset.communicationStyle?.responseLength ?? 'brief',
      useCustomerName: existingConfig?.communicationStyle?.useCustomerName ?? preset.communicationStyle?.useCustomerName ?? true,
    },
    businessType: {
      ...existingConfig?.businessType,
      ...preset.businessType,
      customerType: businessType === 'retail' ? 'individual' : businessType === 'wholesale' ? 'business' : 'both',
    },
    productInfo: {
      showFields: existingConfig?.productInfo?.showFields ?? preset.productInfo?.showFields ?? ['price', 'stock', 'description'],
      showOutOfStock: existingConfig?.productInfo?.showOutOfStock ?? preset.productInfo?.showOutOfStock ?? true,
      highlightBestSellers: existingConfig?.productInfo?.highlightBestSellers ?? preset.productInfo?.highlightBestSellers ?? true,
    },
    orderingProcess: {
      collectCustomerInfo: {
        name: existingConfig?.orderingProcess?.collectCustomerInfo?.name ?? preset.orderingProcess?.collectCustomerInfo?.name ?? true,
        phone: existingConfig?.orderingProcess?.collectCustomerInfo?.phone ?? preset.orderingProcess?.collectCustomerInfo?.phone ?? true,
        email: existingConfig?.orderingProcess?.collectCustomerInfo?.email ?? preset.orderingProcess?.collectCustomerInfo?.email ?? false,
        address: existingConfig?.orderingProcess?.collectCustomerInfo?.address ?? preset.orderingProcess?.collectCustomerInfo?.address ?? true,
      },
      requireConfirmation: existingConfig?.orderingProcess?.requireConfirmation ?? preset.orderingProcess?.requireConfirmation ?? true,
      allowBulkOrders: existingConfig?.orderingProcess?.allowBulkOrders ?? preset.orderingProcess?.allowBulkOrders ?? true,
      minimumQuantity: existingConfig?.orderingProcess?.minimumQuantity ?? preset.orderingProcess?.minimumQuantity,
    },
    promotions: {
      autoMentionActiveOffers: existingConfig?.promotions?.autoMentionActiveOffers ?? preset.promotions?.autoMentionActiveOffers ?? true,
      highlightDiscounts: existingConfig?.promotions?.highlightDiscounts ?? preset.promotions?.highlightDiscounts ?? true,
      showExpiryDates: existingConfig?.promotions?.showExpiryDates ?? preset.promotions?.showExpiryDates ?? true,
    },
    customerExperience: {
      enableUpselling: existingConfig?.customerExperience?.enableUpselling ?? preset.customerExperience?.enableUpselling ?? true,
      upsellingStyle: existingConfig?.customerExperience?.upsellingStyle ?? preset.customerExperience?.upsellingStyle ?? 'moderate',
      personalizeForReturningCustomers: existingConfig?.customerExperience?.personalizeForReturningCustomers ?? preset.customerExperience?.personalizeForReturningCustomers ?? true,
      enableTimeBasedGreetings: existingConfig?.customerExperience?.enableTimeBasedGreetings ?? preset.customerExperience?.enableTimeBasedGreetings ?? true,
    },
  };
}

/**
 * Get the current business type from configuration
 */
export function getBusinessTypeFromConfig(config: Partial<WhatsAppBotUIConfig>): BusinessTypeOption {
  const customerType = config.businessType?.customerType;
  
  if (customerType === 'individual') return 'retail';
  if (customerType === 'business') return 'wholesale';
  if (customerType === 'both') return 'both';
  
  // Default to retail if not set
  return 'retail';
}

/**
 * Check if configuration matches a business type preset
 * Used to show "Using [Business Type] defaults" or "Custom configuration"
 */
export function isUsingPresetDefaults(
  businessType: BusinessTypeOption,
  currentConfig: Partial<WhatsAppBotUIConfig>
): boolean {
  const preset = BusinessTypePresets[businessType];
  const currentType = getBusinessTypeFromConfig(currentConfig);

  // Must match the selected business type
  if (currentType !== businessType) return false;

  // Check key fields match preset
  const checks = [
    currentConfig.communicationStyle?.tone === preset.communicationStyle?.tone,
    currentConfig.businessType?.requiresCreditTerms === preset.businessType?.requiresCreditTerms,
    JSON.stringify(currentConfig.orderingProcess?.collectCustomerInfo) === JSON.stringify(preset.orderingProcess?.collectCustomerInfo),
    currentConfig.customerExperience?.enableUpselling === preset.customerExperience?.enableUpselling,
  ];

  // Return true if all key fields match
  return checks.every(check => check === true);
}

// ============================================================================
// 5. UI FIELD DEFINITION
// ============================================================================

export interface BusinessTypeUIField {
  key: 'businessType';
  type: 'radio-group';
  label: string;
  description: string;
  helperText?: string;
  required: boolean;
  options: Array<{
    value: BusinessTypeOption;
    label: string;
    description: string;
    recommendations?: string[];
  }>;
  onChange?: (value: BusinessTypeOption, applyPreset: boolean) => void;
}

/**
 * Complete field definition for UI rendering
 */
export const BusinessTypeField: BusinessTypeUIField = {
  key: 'businessType',
  type: 'radio-group',
  label: BusinessTypeFieldCopy.label,
  description: BusinessTypeFieldCopy.description,
  helperText: BusinessTypeFieldCopy.helperText,
  required: true,
  options: [
    {
      value: 'retail',
      label: BusinessTypeFieldCopy.options.retail.label,
      description: BusinessTypeFieldCopy.options.retail.shortDescription,
      recommendations: BusinessTypeOptions.retail.recommendations,
    },
    {
      value: 'wholesale',
      label: BusinessTypeFieldCopy.options.wholesale.label,
      description: BusinessTypeFieldCopy.options.wholesale.shortDescription,
      recommendations: BusinessTypeOptions.wholesale.recommendations,
    },
    {
      value: 'both',
      label: BusinessTypeFieldCopy.options.both.label,
      description: BusinessTypeFieldCopy.options.both.shortDescription,
      recommendations: BusinessTypeOptions.both.recommendations,
    },
  ],
};

// ============================================================================
// 6. SUMMARY OF AUTO-CONFIGURED FIELDS
// ============================================================================

/**
 * Fields that are automatically configured when business type changes
 * Shown to user as "These settings will be configured automatically"
 */
export const AutoConfiguredFields = {
  retail: [
    'Communication tone: Friendly & Casual',
    'Payment: Immediate payment required',
    'Ordering: Any quantity allowed',
    'Customer info: Name, phone, address',
    'Product recommendations: Enabled',
  ],
  wholesale: [
    'Communication tone: Professional & Formal',
    'Payment: Credit terms available',
    'Ordering: Minimum quantity required',
    'Customer info: Name, phone, email, address',
    'Product recommendations: Disabled',
  ],
  both: [
    'Communication tone: Helpful & Expert',
    'Payment: Flexible (immediate + credit)',
    'Ordering: Flexible quantities',
    'Customer info: Name, phone, email, address',
    'Product recommendations: Enabled',
  ],
};
