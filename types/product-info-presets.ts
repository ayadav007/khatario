/**
 * Product Information Display Configuration
 * 
 * Provides configuration for which product fields to display and their priority.
 * Includes industry presets and custom field selection with prioritization.
 */

import { WhatsAppBotUIConfig } from './whatsapp-bot-config';

// ============================================================================
// 1. PRODUCT FIELD DEFINITIONS
// ============================================================================

export type ProductField = 
  | 'price' 
  | 'stock' 
  | 'description' 
  | 'specifications' 
  | 'ingredients' 
  | 'sizes' 
  | 'colors' 
  | 'dimensions' 
  | 'warranty';

export interface ProductFieldConfig {
  value: ProductField;
  label: string;
  description: string;
  applicableTo: Array<'food' | 'retail' | 'services' | 'all'>;
  icon?: string;
}

/**
 * Available product fields with metadata
 */
export const ProductFields: Record<ProductField, ProductFieldConfig> = {
  price: {
    value: 'price',
    label: 'Price',
    description: 'Product selling price',
    applicableTo: ['all'],
  },
  stock: {
    value: 'stock',
    label: 'Stock Availability',
    description: 'Current stock quantity and availability status',
    applicableTo: ['food', 'retail'],
  },
  description: {
    value: 'description',
    label: 'Description',
    description: 'Product description and features',
    applicableTo: ['all'],
  },
  specifications: {
    value: 'specifications',
    label: 'Specifications',
    description: 'Technical specifications and details',
    applicableTo: ['retail', 'services'],
  },
  ingredients: {
    value: 'ingredients',
    label: 'Ingredients',
    description: 'List of ingredients (for food products)',
    applicableTo: ['food'],
  },
  sizes: {
    value: 'sizes',
    label: 'Sizes',
    description: 'Available sizes (e.g., S, M, L, XL)',
    applicableTo: ['retail'],
  },
  colors: {
    value: 'colors',
    label: 'Colors',
    description: 'Available colors and variants',
    applicableTo: ['retail'],
  },
  dimensions: {
    value: 'dimensions',
    label: 'Dimensions',
    description: 'Product dimensions (length, width, height)',
    applicableTo: ['retail'],
  },
  warranty: {
    value: 'warranty',
    label: 'Warranty',
    description: 'Warranty period and terms',
    applicableTo: ['retail', 'services'],
  },
};

// ============================================================================
// 2. INDUSTRY PRESETS
// ============================================================================

export type IndustryPreset = 'food' | 'retail' | 'services' | 'custom';

export interface IndustryPresetConfig {
  value: IndustryPreset;
  label: string;
  description: string;
  defaultFields: ProductField[]; // Ordered by priority
}

/**
 * Industry presets with default field selections and priorities
 */
export const IndustryPresets: Record<IndustryPreset, IndustryPresetConfig> = {
  food: {
    value: 'food',
    label: 'Food Business',
    description: 'Restaurants, food delivery, catering',
    defaultFields: ['price', 'ingredients', 'stock', 'description'],
  },
  retail: {
    value: 'retail',
    label: 'Retail Goods',
    description: 'Clothing, electronics, furniture, general merchandise',
    defaultFields: ['price', 'stock', 'sizes', 'colors', 'description', 'specifications', 'dimensions', 'warranty'],
  },
  services: {
    value: 'services',
    label: 'Services',
    description: 'Professional services, consulting, maintenance',
    defaultFields: ['price', 'description', 'specifications', 'warranty'],
  },
  custom: {
    value: 'custom',
    label: 'Custom',
    description: 'Select your own fields and priority',
    defaultFields: ['price', 'stock', 'description'], // Default minimal set
  },
};

// ============================================================================
// 3. PRODUCT INFO CONFIGURATION
// ============================================================================

export interface ProductInfoDisplayConfig {
  industryPreset?: IndustryPreset;
  selectedFields: ProductField[]; // Ordered by priority (first = highest priority)
  showOutOfStock: boolean;
  highlightBestSellers: boolean;
}

// ============================================================================
// 4. DEFAULT CONFIGURATIONS
// ============================================================================

/**
 * Default product info configuration
 */
export const DefaultProductInfoConfig: ProductInfoDisplayConfig = {
  industryPreset: 'custom',
  selectedFields: ['price', 'stock', 'description'],
  showOutOfStock: true,
  highlightBestSellers: false,
};

// ============================================================================
// 5. RESTAURANT EXAMPLE
// ============================================================================

/**
 * Example configuration for a restaurant (food business)
 */
export const RestaurantProductInfoExample: ProductInfoDisplayConfig = {
  industryPreset: 'food',
  selectedFields: ['price', 'ingredients', 'stock', 'description'],
  showOutOfStock: false, // Don't show unavailable items
  highlightBestSellers: true, // Highlight popular dishes
};

// ============================================================================
// 6. VALIDATION RULES
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
}

/**
 * Validate product info display configuration
 */
export function validateProductInfoConfig(config: Partial<ProductInfoDisplayConfig>): ValidationResult {
  const errors: Array<{ field: string; message: string }> = [];
  const warnings: Array<{ field: string; message: string }> = [];

  // Validate industry preset
  if (config.industryPreset && !Object.values(IndustryPresets).some(preset => preset.value === config.industryPreset)) {
    errors.push({
      field: 'productInfo.industryPreset',
      message: 'Invalid industry preset selected',
    });
  }

  // Validate selected fields
  if (!config.selectedFields || config.selectedFields.length === 0) {
    errors.push({
      field: 'productInfo.selectedFields',
      message: 'At least one field must be selected',
    });
  } else {
    // Validate each field is valid
    const validFields = Object.keys(ProductFields) as ProductField[];
    const invalidFields = config.selectedFields.filter(field => !validFields.includes(field));
    
    if (invalidFields.length > 0) {
      errors.push({
        field: 'productInfo.selectedFields',
        message: `Invalid fields selected: ${invalidFields.join(', ')}`,
      });
    }

    // Check for duplicates
    const uniqueFields = new Set(config.selectedFields);
    if (uniqueFields.size !== config.selectedFields.length) {
      errors.push({
        field: 'productInfo.selectedFields',
        message: 'Duplicate fields found in selection',
      });
    }

    // Warning if price is not selected (usually important)
    if (!config.selectedFields.includes('price')) {
      warnings.push({
        field: 'productInfo.selectedFields',
        message: 'Price is typically important information for customers',
      });
    }
  }

  // Validate showOutOfStock (must be boolean)
  if (config.showOutOfStock !== undefined && typeof config.showOutOfStock !== 'boolean') {
    errors.push({
      field: 'productInfo.showOutOfStock',
      message: 'Show out of stock must be true or false',
    });
  }

  // Validate highlightBestSellers (must be boolean)
  if (config.highlightBestSellers !== undefined && typeof config.highlightBestSellers !== 'boolean') {
    errors.push({
      field: 'productInfo.highlightBestSellers',
      message: 'Highlight best sellers must be true or false',
    });
  }

  // Warning if industry preset doesn't match selected fields
  if (config.industryPreset && config.industryPreset !== 'custom' && config.selectedFields) {
    const presetFields = IndustryPresets[config.industryPreset].defaultFields;
    const mismatch = config.selectedFields.filter(field => !presetFields.includes(field));
    if (mismatch.length > 0) {
      warnings.push({
        field: 'productInfo.selectedFields',
        message: `Some selected fields are not typical for ${IndustryPresets[config.industryPreset].label}. Consider using the preset defaults.`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// 7. MAPPING LOGIC
// ============================================================================

/**
 * Apply industry preset to configuration
 */
export function applyIndustryPreset(preset: IndustryPreset): ProductInfoDisplayConfig {
  const presetConfig = IndustryPresets[preset];
  
  return {
    industryPreset: preset,
    selectedFields: [...presetConfig.defaultFields], // Copy array
    showOutOfStock: preset === 'food' ? false : true, // Food businesses typically hide out of stock
    highlightBestSellers: preset === 'food' ? true : false, // Food businesses typically highlight bestsellers
  };
}

/**
 * Map product info config to internal WhatsApp bot config
 */
export function mapProductInfoToInternalConfig(
  config: ProductInfoDisplayConfig
): Partial<WhatsAppBotUIConfig> {
  return {
    productInfo: {
      showFields: config.selectedFields,
      showOutOfStock: config.showOutOfStock,
      highlightBestSellers: config.highlightBestSellers,
    },
  };
}

/**
 * Map internal config to product info display config
 */
export function mapInternalConfigToProductInfo(
  config: Partial<WhatsAppBotUIConfig>
): Partial<ProductInfoDisplayConfig> {
  if (!config.productInfo) {
    return {};
  }

  // Determine industry preset based on selected fields
  let industryPreset: IndustryPreset = 'custom';
  const selectedFields = config.productInfo.showFields || [];

  // Check if fields match any preset
  for (const [presetKey, presetConfig] of Object.entries(IndustryPresets)) {
    if (presetKey === 'custom') continue;
    
    const presetFields = presetConfig.defaultFields;
    const matches = presetFields.every(field => selectedFields.includes(field)) &&
                    selectedFields.every(field => presetFields.includes(field)) &&
                    presetFields.length === selectedFields.length;
    
    if (matches) {
      industryPreset = presetKey as IndustryPreset;
      break;
    }
  }

  return {
    industryPreset,
    selectedFields: selectedFields as ProductField[],
    showOutOfStock: config.productInfo.showOutOfStock,
    highlightBestSellers: config.productInfo.highlightBestSellers,
  };
}

/**
 * Get available fields for an industry preset
 */
export function getAvailableFieldsForIndustry(industry: IndustryPreset): ProductField[] {
  if (industry === 'custom') {
    return Object.keys(ProductFields) as ProductField[];
  }

  // Return all fields applicable to this industry
  const applicableFields: ProductField[] = [];
  
  Object.values(ProductFields).forEach(field => {
    if (field.applicableTo.includes('all') || field.applicableTo.includes(industry)) {
      applicableFields.push(field.value);
    }
  });

  return applicableFields;
}

/**
 * Reorder fields (for drag-and-drop)
 */
export function reorderFields(
  fields: ProductField[],
  fromIndex: number,
  toIndex: number
): ProductField[] {
  const result = [...fields];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  return result;
}

// ============================================================================
// 8. UI FIELD DEFINITION
// ============================================================================

export interface ProductInfoUIField {
  key: 'productInfo';
  type: 'section';
  label: string;
  description: string;
  fields: Array<{
    key: string;
    type: 'preset-select' | 'field-checkboxes' | 'field-drag-list' | 'toggle';
    label: string;
    description: string;
    options?: any;
    default?: any;
  }>;
}

/**
 * Complete UI field definition for product info display section
 */
export const ProductInfoField: ProductInfoUIField = {
  key: 'productInfo',
  type: 'section',
  label: 'Product Information Display',
  description: 'Choose which product details to show to customers and set their display priority.',
  fields: [
    {
      key: 'industryPreset',
      type: 'preset-select',
      label: 'Industry Preset',
      description: 'Select an industry preset to quickly configure recommended fields, or choose Custom to select your own.',
      options: {
        presets: Object.values(IndustryPresets).map(preset => ({
          value: preset.value,
          label: preset.label,
          description: preset.description,
          fields: preset.defaultFields.map(field => ProductFields[field].label),
        })),
      },
      default: DefaultProductInfoConfig.industryPreset,
    },
    {
      key: 'selectedFields',
      type: 'field-drag-list',
      label: 'Fields to Display',
      description: 'Select fields to show and drag to prioritize (top = highest priority). Fields are only shown if data exists.',
      options: {
        availableFields: Object.values(ProductFields).map(field => ({
          value: field.value,
          label: field.label,
          description: field.description,
        })),
        canReorder: true,
        minSelections: 1,
      },
      default: DefaultProductInfoConfig.selectedFields,
    },
    {
      key: 'showOutOfStock',
      type: 'toggle',
      label: 'Show Out of Stock Products',
      description: 'Display products even when they are out of stock',
      default: DefaultProductInfoConfig.showOutOfStock,
    },
    {
      key: 'highlightBestSellers',
      type: 'toggle',
      label: 'Highlight Best Sellers',
      description: 'Emphasize popular products in responses',
      default: DefaultProductInfoConfig.highlightBestSellers,
    },
  ],
};

// ============================================================================
// 9. FIELD PRIORITY EXPLANATION
// ============================================================================

/**
 * Explanation of field priority behavior
 */
export const FieldPriorityInfo = {
  title: 'Field Priority',
  description: 'Fields are displayed in the order you set. Higher priority fields (at the top) are shown first and emphasized in responses.',
  examples: {
    highPriority: 'Price, Stock, Description',
    explanation: 'Price and stock are shown prominently, description follows',
    lowPriority: 'Description, Price, Stock',
  },
};

// ============================================================================
// 10. FIELD VISIBILITY RULES
// ============================================================================

/**
 * Rules for when fields are shown (system behavior, not user configurable)
 */
export const FieldVisibilityRules = {
  price: 'Always shown if product has a price',
  stock: 'Only shown for products (not services), hidden if stock tracking is disabled',
  description: 'Shown if product has a description',
  specifications: 'Shown if product has specifications data',
  ingredients: 'Shown if product has ingredients data',
  sizes: 'Shown if product has size variants',
  colors: 'Shown if product has color variants',
  dimensions: 'Shown if product has dimensions data',
  warranty: 'Shown if product has warranty information',
  
  note: 'Fields are only displayed if the data exists in your product catalog. Selecting a field does not guarantee it will always appear - it depends on your product data.',
};
