/**
 * WhatsApp Bot Configuration Schema
 * 
 * This file contains:
 * 1. UIConfigSchema - Customer-facing, user-friendly configuration
 * 2. WhatsAppBotConfig - Internal technical configuration
 * 3. Mapping functions between UI and internal configs
 * 4. Validation schemas
 */

// ============================================================================
// 1. UI CONFIGURATION SCHEMA (Customer-Facing)
// ============================================================================

/**
 * User-friendly configuration schema for WhatsApp Bot
 * All fields are human-readable and validation-safe
 */
export interface WhatsAppBotUIConfig {
  // Communication Style
  communicationStyle: {
    tone: 'friendly_casual' | 'professional_formal' | 'helpful_expert' | 'efficient_direct';
    responseLength: 'brief' | 'moderate' | 'detailed';
    useCustomerName: boolean;
  };

  // Business Type
  businessType: {
    customerType: 'individual' | 'business' | 'both';
    requiresCreditTerms?: boolean;
    minimumOrderAmount?: number;
  };

  // Product Information
  productInfo: {
    showFields: Array<
      'price' | 
      'stock' | 
      'description' | 
      'specifications' | 
      'ingredients' | 
      'sizes' | 
      'colors' | 
      'dimensions' | 
      'warranty'
    >;
    showOutOfStock: boolean;
    highlightBestSellers: boolean;
  };

  // Ordering Process
  orderingProcess: {
    collectCustomerInfo: {
      name: boolean;
      phone: boolean;
      email: boolean;
      address: boolean;
    };
    requireConfirmation: boolean;
    allowBulkOrders: boolean;
    minimumQuantity?: number;
  };

  // Promotions & Offers
  promotions: {
    autoMentionActiveOffers: boolean;
    highlightDiscounts: boolean;
    showExpiryDates: boolean;
  };

  // Customer Experience
  customerExperience: {
    enableUpselling: boolean;
    upsellingStyle: 'subtle' | 'moderate' | 'aggressive';
    personalizeForReturningCustomers: boolean;
    enableTimeBasedGreetings: boolean;
  };

  // Business Hours
  businessHours?: {
    timezone: string;
    schedule: Array<{
      day: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
      isOpen: boolean;
      openTime?: string; // HH:mm format
      closeTime?: string; // HH:mm format
    }>;
    afterHoursMessage?: string;
  };

  // Policies (Optional)
  policies?: {
    returnPolicy?: string;
    refundPolicy?: string;
    shippingPolicy?: string;
    cancellationPolicy?: string;
  };

  // Advanced Settings (Optional)
  advanced?: {
    customInstructions?: string; // Free-form text for business-specific guidance
    industryTemplate?: 'restaurant' | 'retail' | 'wholesale' | 'services' | 'manufacturing' | 'custom';
  };
}

// ============================================================================
// 2. INTERNAL TECHNICAL CONFIGURATION
// ============================================================================

/**
 * Internal technical configuration used by the AI system
 * This is NOT exposed to users - it's derived from UIConfig
 */
export interface WhatsAppBotConfig {
  // System prompts and AI behavior
  systemPrompt: {
    tone: 'friendly_casual' | 'professional_formal' | 'helpful_expert' | 'efficient_direct';
    responseLength: 'brief' | 'moderate' | 'detailed';
    useCustomerName: boolean;
    customInstructions?: string;
  };

  // Business model configuration
  businessModel: {
    isB2B: boolean;
    isB2C: boolean;
    requiresCreditTerms: boolean;
    minimumOrderAmount?: number;
    accountBasedOrdering: boolean;
  };

  // Product context configuration
  productContext: {
    fieldsToInclude: string[];
    showOutOfStock: boolean;
    highlightBestSellers: boolean;
    searchLimit: number;
    topProductsLimit: number;
  };

  // Ordering workflow
  orderingWorkflow: {
    collectFields: {
      name: boolean;
      phone: boolean;
      email: boolean;
      address: boolean;
    };
    requireConfirmation: boolean;
    allowBulkOrders: boolean;
    minimumQuantity?: number;
  };

  // Promotion handling
  promotions: {
    autoMention: boolean;
    highlightDiscounts: boolean;
    showExpiryDates: boolean;
  };

  // Upselling configuration
  upselling: {
    enabled: boolean;
    strategy: 'subtle' | 'moderate' | 'aggressive';
    personalizeForReturningCustomers: boolean;
  };

  // Time-based behavior
  timeAwareness?: {
    timezone: string;
    businessHours: Array<{
      day: number; // 0-6 (Sunday-Saturday)
      isOpen: boolean;
      openTime?: string;
      closeTime?: string;
    }>;
    afterHoursMessage?: string;
    enableTimeBasedGreetings: boolean;
  };

  // Policies
  policies?: {
    returnPolicy?: string;
    refundPolicy?: string;
    shippingPolicy?: string;
    cancellationPolicy?: string;
  };
}

// ============================================================================
// 3. FIELD DEFINITIONS (For UI Generation)
// ============================================================================

/**
 * Field metadata for UI rendering and validation
 */
export interface UIConfigField {
  key: string;
  label: string;
  description: string;
  type: 'select' | 'boolean' | 'number' | 'text' | 'multiselect' | 'array' | 'object';
  allowedValues?: string[];
  default: any;
  required?: boolean;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
  conditional?: {
    dependsOn: string;
    values: any[];
  };
}

/**
 * Complete field definitions for UI generation
 */
export const UIConfigFields: Record<string, UIConfigField[]> = {
  communicationStyle: [
    {
      key: 'tone',
      label: 'Communication Tone',
      description: 'How your bot should communicate with customers',
      type: 'select',
      allowedValues: ['friendly_casual', 'professional_formal', 'helpful_expert', 'efficient_direct'],
      default: 'friendly_casual',
      required: true,
    },
    {
      key: 'responseLength',
      label: 'Response Length',
      description: 'How detailed should bot responses be',
      type: 'select',
      allowedValues: ['brief', 'moderate', 'detailed'],
      default: 'moderate',
      required: true,
    },
    {
      key: 'useCustomerName',
      label: 'Use Customer Names',
      description: 'Address customers by name when available',
      type: 'boolean',
      default: true,
    },
  ],
  businessType: [
    {
      key: 'customerType',
      label: 'Customer Type',
      description: 'Who are your primary customers?',
      type: 'select',
      allowedValues: ['individual', 'business', 'both'],
      default: 'individual',
      required: true,
    },
    {
      key: 'requiresCreditTerms',
      label: 'Offer Credit Terms',
      description: 'Allow customers to order on credit (typically for B2B)',
      type: 'boolean',
      default: false,
      conditional: {
        dependsOn: 'businessType.customerType',
        values: ['business', 'both'],
      },
    },
    {
      key: 'minimumOrderAmount',
      label: 'Minimum Order Amount',
      description: 'Minimum order value in your currency (leave empty for no minimum)',
      type: 'number',
      default: undefined,
      validation: {
        min: 0,
        message: 'Minimum order amount must be positive',
      },
      conditional: {
        dependsOn: 'businessType.customerType',
        values: ['business', 'both'],
      },
    },
  ],
  productInfo: [
    {
      key: 'showFields',
      label: 'Product Information to Show',
      description: 'What product details should the bot share with customers?',
      type: 'multiselect',
      allowedValues: ['price', 'stock', 'description', 'specifications', 'ingredients', 'sizes', 'colors', 'dimensions', 'warranty'],
      default: ['price', 'stock', 'description'],
      required: true,
    },
    {
      key: 'showOutOfStock',
      label: 'Show Out of Stock Products',
      description: 'Display products even when out of stock',
      type: 'boolean',
      default: true,
    },
    {
      key: 'highlightBestSellers',
      label: 'Highlight Best Sellers',
      description: 'Emphasize popular products in responses',
      type: 'boolean',
      default: false,
    },
  ],
  orderingProcess: [
    {
      key: 'collectCustomerInfo.name',
      label: 'Collect Customer Name',
      description: 'Ask for customer name during order placement',
      type: 'boolean',
      default: true,
    },
    {
      key: 'collectCustomerInfo.phone',
      label: 'Collect Phone Number',
      description: 'Ask for customer phone number during order placement',
      type: 'boolean',
      default: true,
    },
    {
      key: 'collectCustomerInfo.email',
      label: 'Collect Email Address',
      description: 'Ask for customer email address during order placement',
      type: 'boolean',
      default: false,
    },
    {
      key: 'collectCustomerInfo.address',
      label: 'Collect Delivery Address',
      description: 'Ask for delivery address during order placement',
      type: 'boolean',
      default: true,
    },
    {
      key: 'requireConfirmation',
      label: 'Require Order Confirmation',
      description: 'Ask customers to confirm before creating order',
      type: 'boolean',
      default: true,
    },
    {
      key: 'allowBulkOrders',
      label: 'Allow Bulk Orders',
      description: 'Enable ordering multiple quantities or items',
      type: 'boolean',
      default: true,
    },
    {
      key: 'minimumQuantity',
      label: 'Minimum Order Quantity',
      description: 'Minimum quantity per item (leave empty for no minimum)',
      type: 'number',
      default: undefined,
      validation: {
        min: 1,
        message: 'Minimum quantity must be at least 1',
      },
    },
  ],
  promotions: [
    {
      key: 'autoMentionActiveOffers',
      label: 'Auto-Mention Active Offers',
      description: 'Automatically mention promotions and discounts',
      type: 'boolean',
      default: true,
    },
    {
      key: 'highlightDiscounts',
      label: 'Highlight Discounts',
      description: 'Emphasize discounted products in responses',
      type: 'boolean',
      default: true,
    },
    {
      key: 'showExpiryDates',
      label: 'Show Offer Expiry Dates',
      description: 'Display when promotions expire',
      type: 'boolean',
      default: false,
    },
  ],
  customerExperience: [
    {
      key: 'enableUpselling',
      label: 'Enable Product Recommendations',
      description: 'Suggest related or complementary products',
      type: 'boolean',
      default: false,
    },
    {
      key: 'upsellingStyle',
      label: 'Recommendation Style',
      description: 'How often to suggest additional products',
      type: 'select',
      allowedValues: ['subtle', 'moderate', 'aggressive'],
      default: 'subtle',
      conditional: {
        dependsOn: 'customerExperience.enableUpselling',
        values: [true],
      },
    },
    {
      key: 'personalizeForReturningCustomers',
      label: 'Personalize for Returning Customers',
      description: 'Use purchase history to personalize responses',
      type: 'boolean',
      default: true,
    },
    {
      key: 'enableTimeBasedGreetings',
      label: 'Time-Based Greetings',
      description: 'Use "Good morning" / "Good evening" based on time',
      type: 'boolean',
      default: true,
    },
  ],
};

// ============================================================================
// 4. DEFAULT CONFIGURATIONS
// ============================================================================

export const DefaultUIConfig: WhatsAppBotUIConfig = {
  communicationStyle: {
    tone: 'friendly_casual',
    responseLength: 'moderate',
    useCustomerName: true,
  },
  businessType: {
    customerType: 'individual',
  },
  productInfo: {
    showFields: ['price', 'stock', 'description'],
    showOutOfStock: true,
    highlightBestSellers: false,
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
  },
  promotions: {
    autoMentionActiveOffers: true,
    highlightDiscounts: true,
    showExpiryDates: false,
  },
  customerExperience: {
    enableUpselling: false,
    upsellingStyle: 'subtle',
    personalizeForReturningCustomers: true,
    enableTimeBasedGreetings: true,
  },
};

// ============================================================================
// 5. VALIDATION SCHEMA
// ============================================================================

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate UI configuration
 */
export function validateUIConfig(config: Partial<WhatsAppBotUIConfig>): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate communication style
  if (config.communicationStyle) {
    const { tone, responseLength } = config.communicationStyle;
    if (tone && !['friendly_casual', 'professional_formal', 'helpful_expert', 'efficient_direct'].includes(tone)) {
      errors.push({ field: 'communicationStyle.tone', message: 'Invalid tone value' });
    }
    if (responseLength && !['brief', 'moderate', 'detailed'].includes(responseLength)) {
      errors.push({ field: 'communicationStyle.responseLength', message: 'Invalid response length value' });
    }
  }

  // Validate business type
  if (config.businessType) {
    const { customerType, minimumOrderAmount } = config.businessType;
    if (customerType && !['individual', 'business', 'both'].includes(customerType)) {
      errors.push({ field: 'businessType.customerType', message: 'Invalid customer type' });
    }
    if (minimumOrderAmount !== undefined && minimumOrderAmount < 0) {
      errors.push({ field: 'businessType.minimumOrderAmount', message: 'Minimum order amount must be positive' });
    }
  }

  // Validate product info
  if (config.productInfo?.showFields) {
    const validFields = ['price', 'stock', 'description', 'specifications', 'ingredients', 'sizes', 'colors', 'dimensions', 'warranty'];
    const invalidFields = config.productInfo.showFields.filter(f => !validFields.includes(f));
    if (invalidFields.length > 0) {
      errors.push({ field: 'productInfo.showFields', message: `Invalid fields: ${invalidFields.join(', ')}` });
    }
  }

  // Validate ordering process
  if (config.orderingProcess?.minimumQuantity !== undefined && config.orderingProcess.minimumQuantity < 1) {
    errors.push({ field: 'orderingProcess.minimumQuantity', message: 'Minimum quantity must be at least 1' });
  }

  // Validate upselling
  if (config.customerExperience?.upsellingStyle) {
    if (!['subtle', 'moderate', 'aggressive'].includes(config.customerExperience.upsellingStyle)) {
      errors.push({ field: 'customerExperience.upsellingStyle', message: 'Invalid upselling style' });
    }
  }

  // Validate business hours
  if (config.businessHours?.schedule) {
    const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    config.businessHours.schedule.forEach((schedule, index) => {
      if (schedule.day && !validDays.includes(schedule.day)) {
        errors.push({ field: `businessHours.schedule[${index}].day`, message: 'Invalid day' });
      }
      if (schedule.isOpen && schedule.openTime && schedule.closeTime) {
        // Validate time format (HH:mm)
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(schedule.openTime) || !timeRegex.test(schedule.closeTime)) {
          errors.push({ field: `businessHours.schedule[${index}]`, message: 'Invalid time format (use HH:mm)' });
        }
      }
    });
  }

  return errors;
}

// ============================================================================
// 6. MAPPING FUNCTION: UI Config → Internal Config
// ============================================================================

/**
 * Convert user-friendly UI configuration to internal technical configuration
 */
export function mapUIConfigToBotConfig(uiConfig: WhatsAppBotUIConfig): WhatsAppBotConfig {
  const { businessType, customerExperience, orderingProcess, productInfo, communicationStyle, promotions, businessHours, policies, advanced } = uiConfig;

  // Map business type
  const isB2B = businessType.customerType === 'business' || businessType.customerType === 'both';
  const isB2C = businessType.customerType === 'individual' || businessType.customerType === 'both';

  // Map product fields
  const productFieldsMap: Record<string, string> = {
    price: 'sellingPrice',
    stock: 'currentStock',
    description: 'description',
    specifications: 'specifications',
    ingredients: 'ingredients',
    sizes: 'sizes',
    colors: 'colors',
    dimensions: 'dimensions',
    warranty: 'warranty',
  };
  const fieldsToInclude = productInfo.showFields.map(field => productFieldsMap[field] || field);

  // Map business hours
  const dayMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  const mappedBusinessHours = businessHours?.schedule.map(schedule => ({
    day: dayMap[schedule.day],
    isOpen: schedule.isOpen,
    openTime: schedule.openTime,
    closeTime: schedule.closeTime,
  }));

  return {
    systemPrompt: {
      tone: communicationStyle.tone,
      responseLength: communicationStyle.responseLength,
      useCustomerName: communicationStyle.useCustomerName,
      customInstructions: advanced?.customInstructions,
    },
    businessModel: {
      isB2B,
      isB2C,
      requiresCreditTerms: businessType.requiresCreditTerms || false,
      minimumOrderAmount: businessType.minimumOrderAmount,
      accountBasedOrdering: isB2B && businessType.requiresCreditTerms || false,
    },
    productContext: {
      fieldsToInclude,
      showOutOfStock: productInfo.showOutOfStock,
      highlightBestSellers: productInfo.highlightBestSellers,
      searchLimit: 5, // Fixed system value
      topProductsLimit: 10, // Fixed system value
    },
    orderingWorkflow: {
      collectFields: orderingProcess.collectCustomerInfo,
      requireConfirmation: orderingProcess.requireConfirmation,
      allowBulkOrders: orderingProcess.allowBulkOrders,
      minimumQuantity: orderingProcess.minimumQuantity,
    },
    promotions: {
      autoMention: promotions.autoMentionActiveOffers,
      highlightDiscounts: promotions.highlightDiscounts,
      showExpiryDates: promotions.showExpiryDates,
    },
    upselling: {
      enabled: customerExperience.enableUpselling,
      strategy: customerExperience.upsellingStyle,
      personalizeForReturningCustomers: customerExperience.personalizeForReturningCustomers,
    },
    timeAwareness: businessHours ? {
      timezone: businessHours.timezone,
      businessHours: mappedBusinessHours || [],
      afterHoursMessage: businessHours.afterHoursMessage,
      enableTimeBasedGreetings: customerExperience.enableTimeBasedGreetings,
    } : undefined,
    policies: policies ? {
      returnPolicy: policies.returnPolicy,
      refundPolicy: policies.refundPolicy,
      shippingPolicy: policies.shippingPolicy,
      cancellationPolicy: policies.cancellationPolicy,
    } : undefined,
  };
}

// ============================================================================
// 7. REVERSE MAPPING: Internal Config → UI Config (for editing existing configs)
// ============================================================================

/**
 * Convert internal technical configuration back to UI-friendly format
 * Used when loading existing configurations
 */
export function mapBotConfigToUIConfig(botConfig: WhatsAppBotConfig): WhatsAppBotUIConfig {
  const reverseFieldMap: Record<string, string> = {
    sellingPrice: 'price',
    currentStock: 'stock',
    description: 'description',
    specifications: 'specifications',
    ingredients: 'ingredients',
    sizes: 'sizes',
    colors: 'colors',
    dimensions: 'dimensions',
    warranty: 'warranty',
  };

  const showFields = botConfig.productContext.fieldsToInclude
    .map(field => reverseFieldMap[field] || field)
    .filter(field => ['price', 'stock', 'description', 'specifications', 'ingredients', 'sizes', 'colors', 'dimensions', 'warranty'].includes(field)) as any[];

  const dayReverseMap: Record<number, string> = {
    0: 'sunday',
    1: 'monday',
    2: 'tuesday',
    3: 'wednesday',
    4: 'thursday',
    5: 'friday',
    6: 'saturday',
  };

  const schedule = botConfig.timeAwareness?.businessHours.map(hour => ({
    day: dayReverseMap[hour.day] as any,
    isOpen: hour.isOpen,
    openTime: hour.openTime,
    closeTime: hour.closeTime,
  }));

  const customerType = botConfig.businessModel.isB2B && botConfig.businessModel.isB2C
    ? 'both'
    : botConfig.businessModel.isB2B
    ? 'business'
    : 'individual';

  return {
    communicationStyle: {
      tone: botConfig.systemPrompt.tone,
      responseLength: botConfig.systemPrompt.responseLength,
      useCustomerName: botConfig.systemPrompt.useCustomerName,
    },
    businessType: {
      customerType,
      requiresCreditTerms: botConfig.businessModel.requiresCreditTerms,
      minimumOrderAmount: botConfig.businessModel.minimumOrderAmount,
    },
    productInfo: {
      showFields,
      showOutOfStock: botConfig.productContext.showOutOfStock,
      highlightBestSellers: botConfig.productContext.highlightBestSellers,
    },
    orderingProcess: {
      collectCustomerInfo: botConfig.orderingWorkflow.collectFields,
      requireConfirmation: botConfig.orderingWorkflow.requireConfirmation,
      allowBulkOrders: botConfig.orderingWorkflow.allowBulkOrders,
      minimumQuantity: botConfig.orderingWorkflow.minimumQuantity,
    },
    promotions: {
      autoMentionActiveOffers: botConfig.promotions.autoMention,
      highlightDiscounts: botConfig.promotions.highlightDiscounts,
      showExpiryDates: botConfig.promotions.showExpiryDates,
    },
    customerExperience: {
      enableUpselling: botConfig.upselling.enabled,
      upsellingStyle: botConfig.upselling.strategy,
      personalizeForReturningCustomers: botConfig.upselling.personalizeForReturningCustomers,
      enableTimeBasedGreetings: botConfig.timeAwareness?.enableTimeBasedGreetings || false,
    },
    businessHours: botConfig.timeAwareness ? {
      timezone: botConfig.timeAwareness.timezone,
      schedule: schedule || [],
      afterHoursMessage: botConfig.timeAwareness.afterHoursMessage,
    } : undefined,
    policies: botConfig.policies,
    advanced: {
      customInstructions: botConfig.systemPrompt.customInstructions,
    },
  };
}
