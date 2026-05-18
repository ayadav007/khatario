/**
 * Communication Style Selection & Auto-Configuration
 * 
 * Provides preset communication style options that automatically configure
 * tone, response length, and greeting style.
 */

import { WhatsAppBotUIConfig } from './whatsapp-bot-config';

// ============================================================================
// 1. COMMUNICATION STYLE OPTIONS (User-Facing)
// ============================================================================

export type CommunicationStyleOption = 
  | 'friendly_casual' 
  | 'professional_formal' 
  | 'short_direct' 
  | 'detailed_explanatory';

export interface CommunicationStyleOptionConfig {
  value: CommunicationStyleOption;
  label: string;
  shortDescription: string;
  tooltip: string;
  examples: {
    greeting: string;
    productInquiry: string;
    orderConfirmation: string;
  };
}

/**
 * Communication style options with user-friendly labels and examples
 */
export const CommunicationStyleOptions: Record<CommunicationStyleOption, CommunicationStyleOptionConfig> = {
  friendly_casual: {
    value: 'friendly_casual',
    label: 'Friendly & Casual',
    shortDescription: 'Warm, conversational, and approachable',
    tooltip: 'Perfect for retail businesses, restaurants, and customer-facing services. Uses casual language, emojis when appropriate, and builds rapport with customers.',
    examples: {
      greeting: 'Hi! 👋 Welcome! How can I help you today?',
      productInquiry: 'Great choice! That\'s one of our bestsellers. It\'s ₹500 and we have it in stock. Want me to add it to your order?',
      orderConfirmation: 'Perfect! Your order for ₹1,200 is confirmed. We\'ll prepare it right away! 😊',
    },
  },
  professional_formal: {
    value: 'professional_formal',
    label: 'Professional & Formal',
    shortDescription: 'Polite, respectful, and business-appropriate',
    tooltip: 'Ideal for B2B, wholesale, and corporate clients. Uses formal language, proper grammar, and maintains professional boundaries.',
    examples: {
      greeting: 'Good day. Thank you for contacting us. How may I assist you?',
      productInquiry: 'Thank you for your inquiry. The product is priced at ₹500 per unit. We currently have stock available. Would you like to proceed with an order?',
      orderConfirmation: 'Your order has been confirmed. Order total: ₹1,200. We will process this order and send you the invoice shortly.',
    },
  },
  short_direct: {
    value: 'short_direct',
    label: 'Short & To-the-Point',
    shortDescription: 'Brief, clear, and efficient',
    tooltip: 'Best for busy customers who want quick answers. Gets straight to the point with minimal words while remaining polite.',
    examples: {
      greeting: 'Hi! How can I help?',
      productInquiry: '₹500. In stock. Add to order?',
      orderConfirmation: 'Order confirmed. ₹1,200. Processing now.',
    },
  },
  detailed_explanatory: {
    value: 'detailed_explanatory',
    label: 'Detailed & Explanatory',
    shortDescription: 'Comprehensive, informative, and thorough',
    tooltip: 'Perfect for complex products, technical services, or when customers need detailed information. Provides comprehensive answers and explanations.',
    examples: {
      greeting: 'Hello! Thank you for reaching out. I\'m here to help you with any questions about our products and services. What would you like to know?',
      productInquiry: 'That product is ₹500 per unit. It includes [features], suitable for [use cases], and comes with [warranty/guarantee]. We have [X] units in stock. Would you like me to explain any specific features or place an order?',
      orderConfirmation: 'Your order has been successfully confirmed. Total amount: ₹1,200. This includes [items]. Expected delivery: [timeframe]. We will send you the order confirmation and invoice via email. Thank you for your business!',
    },
  },
};

// ============================================================================
// 2. DEFAULT CONFIGURATIONS PER STYLE
// ============================================================================

/**
 * Default configuration presets for each communication style
 */
export const CommunicationStylePresets: Record<CommunicationStyleOption, Partial<WhatsAppBotUIConfig>> = {
  friendly_casual: {
    communicationStyle: {
      tone: 'friendly_casual',
      responseLength: 'brief',
      useCustomerName: true,
    },
    customerExperience: {
      enableUpselling: true,
      upsellingStyle: 'moderate',
      personalizeForReturningCustomers: true,
      enableTimeBasedGreetings: true, // "Good morning!" style
    },
  },
  professional_formal: {
    communicationStyle: {
      tone: 'professional_formal',
      responseLength: 'moderate',
      useCustomerName: true,
    },
    customerExperience: {
      enableUpselling: true,
      upsellingStyle: 'subtle',
      personalizeForReturningCustomers: true,
      enableTimeBasedGreetings: true, // "Good day" style
    },
  },
  short_direct: {
    communicationStyle: {
      tone: 'efficient_direct',
      responseLength: 'brief',
      useCustomerName: false, // Skip names for brevity
    },
    customerExperience: {
      enableUpselling: false,
      upsellingStyle: 'subtle',
      personalizeForReturningCustomers: false, // Keep it minimal
      enableTimeBasedGreetings: false, // Just "Hi" not "Good morning"
    },
  },
  detailed_explanatory: {
    communicationStyle: {
      tone: 'helpful_expert',
      responseLength: 'detailed',
      useCustomerName: true,
    },
    customerExperience: {
      enableUpselling: true,
      upsellingStyle: 'moderate',
      personalizeForReturningCustomers: true,
      enableTimeBasedGreetings: true, // "Good day" style
    },
  },
};

// ============================================================================
// 3. UX COPY (Labels & Descriptions for UI)
// ============================================================================

export interface CommunicationStyleFieldCopy {
  label: string;
  description: string;
  helperText?: string;
}

/**
 * User-facing copy for Communication Style selection field
 */
export const CommunicationStyleFieldCopy: CommunicationStyleFieldCopy = {
  label: 'How should your assistant talk?',
  description: 'Choose the communication style that matches your brand and customer expectations. This affects how the bot greets customers, responds to questions, and confirms orders.',
  helperText: 'You can see examples of each style below. This setting affects tone, response length, and greeting style.',
};

// ============================================================================
// 4. CONFIGURATION MAPPING LOGIC
// ============================================================================

/**
 * Apply communication style preset to existing configuration
 * Merges preset values with existing config (preset takes priority for selected fields)
 */
export function applyCommunicationStylePreset(
  style: CommunicationStyleOption,
  existingConfig?: Partial<WhatsAppBotUIConfig>
): Partial<WhatsAppBotUIConfig> {
  const preset = CommunicationStylePresets[style];

  // Deep merge: preset values override existing, but nested objects are merged
  return {
    ...existingConfig,
    communicationStyle: {
      tone: existingConfig?.communicationStyle?.tone ?? preset.communicationStyle?.tone ?? 'friendly_casual',
      responseLength: existingConfig?.communicationStyle?.responseLength ?? preset.communicationStyle?.responseLength ?? 'brief',
      useCustomerName: existingConfig?.communicationStyle?.useCustomerName ?? preset.communicationStyle?.useCustomerName ?? true,
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
 * Get the current communication style from configuration
 */
export function getCommunicationStyleFromConfig(config: Partial<WhatsAppBotUIConfig>): CommunicationStyleOption {
  const tone = config.communicationStyle?.tone;
  const responseLength = config.communicationStyle?.responseLength;
  
  // Map internal config to user-facing option
  if (tone === 'friendly_casual') return 'friendly_casual';
  if (tone === 'professional_formal') return 'professional_formal';
  if (tone === 'efficient_direct' && responseLength === 'brief') return 'short_direct';
  if (tone === 'helpful_expert' && responseLength === 'detailed') return 'detailed_explanatory';
  
  // Fallback: try to infer from response length only
  if (responseLength === 'brief') return 'short_direct';
  if (responseLength === 'detailed') return 'detailed_explanatory';
  // Note: tone can only be 'helpful_expert' | 'efficient_direct' | undefined in this context
  // 'professional_formal' is handled above, so this condition is unreachable but kept for type safety
  if (responseLength === 'moderate') return 'friendly_casual';
  
  // Default to friendly_casual if cannot determine
  return 'friendly_casual';
}

/**
 * Check if configuration matches a communication style preset
 */
export function isUsingCommunicationStylePreset(
  style: CommunicationStyleOption,
  currentConfig: Partial<WhatsAppBotUIConfig>
): boolean {
  const preset = CommunicationStylePresets[style];
  const currentStyle = getCommunicationStyleFromConfig(currentConfig);

  // Must match the selected style
  if (currentStyle !== style) return false;

  // Check key fields match preset
  const checks = [
    currentConfig.communicationStyle?.tone === preset.communicationStyle?.tone,
    currentConfig.communicationStyle?.responseLength === preset.communicationStyle?.responseLength,
    currentConfig.communicationStyle?.useCustomerName === preset.communicationStyle?.useCustomerName,
    currentConfig.customerExperience?.enableTimeBasedGreetings === preset.customerExperience?.enableTimeBasedGreetings,
  ];

  // Return true if all key fields match
  return checks.every(check => check === true);
}

// ============================================================================
// 5. GUARDRAILS & VALIDATION
// ============================================================================

/**
 * Validate communication style configuration for safety
 * Prevents unsafe combinations and ensures consistency
 */
export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export function validateCommunicationStyleConfig(
  style: CommunicationStyleOption,
  config: Partial<WhatsAppBotUIConfig>
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  
  const preset = CommunicationStylePresets[style];
  const appliedConfig = applyCommunicationStylePreset(style, config);

  // Guardrail 1: Ensure tone and responseLength are consistent
  const tone = appliedConfig.communicationStyle?.tone;
  const responseLength = appliedConfig.communicationStyle?.responseLength;

  // Valid combinations
  const validCombinations: Array<{ tone: string; responseLength: string; style: CommunicationStyleOption }> = [
    { tone: 'friendly_casual', responseLength: 'brief', style: 'friendly_casual' },
    { tone: 'professional_formal', responseLength: 'moderate', style: 'professional_formal' },
    { tone: 'efficient_direct', responseLength: 'brief', style: 'short_direct' },
    { tone: 'helpful_expert', responseLength: 'detailed', style: 'detailed_explanatory' },
  ];

  const isValidCombination = validCombinations.some(
    combo => combo.tone === tone && combo.responseLength === responseLength && combo.style === style
  );

  if (!isValidCombination && tone && responseLength) {
    errors.push(`Invalid combination: tone "${tone}" with response length "${responseLength}". Using preset defaults.`);
  }

  // Guardrail 2: Warn if business type doesn't match style
  const businessType = config.businessType?.customerType;
  if (style === 'professional_formal' && businessType === 'individual') {
    warnings.push('Professional & Formal style is typically used for B2B businesses. Consider if this matches your customer base.');
  }
  if (style === 'short_direct' && businessType === 'business') {
    warnings.push('Short & To-the-Point style may be too brief for B2B customers who expect detailed information.');
  }

  // Guardrail 3: Ensure greeting style matches tone
  const enableTimeBasedGreetings = appliedConfig.customerExperience?.enableTimeBasedGreetings;
  if (style === 'short_direct' && enableTimeBasedGreetings === true) {
    warnings.push('Short & To-the-Point style typically uses simple greetings. Time-based greetings may add unnecessary length.');
  }

  // Guardrail 4: Validate useCustomerName consistency
  const useCustomerName = appliedConfig.communicationStyle?.useCustomerName;
  if (style === 'short_direct' && useCustomerName === true) {
    warnings.push('Short & To-the-Point style typically omits customer names for brevity. Consider disabling this for consistency.');
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Apply guardrails to enforce safe configuration
 * Returns corrected configuration if validation fails
 */
export function applyCommunicationStyleGuardrails(
  style: CommunicationStyleOption,
  config: Partial<WhatsAppBotUIConfig>
): Partial<WhatsAppBotUIConfig> {
  const validation = validateCommunicationStyleConfig(style, config);
  
  // If valid, return as-is
  if (validation.valid && validation.warnings.length === 0) {
    return applyCommunicationStylePreset(style, config);
  }

  // If errors, apply preset strictly (ignore custom overrides that conflict)
  if (!validation.valid) {
    const preset = CommunicationStylePresets[style];
    return {
      ...config,
      communicationStyle: {
        tone: config.communicationStyle?.tone ?? preset.communicationStyle?.tone ?? 'friendly_casual',
        responseLength: config.communicationStyle?.responseLength ?? preset.communicationStyle?.responseLength ?? 'brief',
        useCustomerName: config.communicationStyle?.useCustomerName ?? preset.communicationStyle?.useCustomerName ?? true,
      },
      customerExperience: {
        enableUpselling: config.customerExperience?.enableUpselling ?? preset.customerExperience?.enableUpselling ?? true,
        upsellingStyle: config.customerExperience?.upsellingStyle ?? preset.customerExperience?.upsellingStyle ?? 'moderate',
        personalizeForReturningCustomers: config.customerExperience?.personalizeForReturningCustomers ?? preset.customerExperience?.personalizeForReturningCustomers ?? true,
        enableTimeBasedGreetings: config.customerExperience?.enableTimeBasedGreetings ?? preset.customerExperience?.enableTimeBasedGreetings ?? true,
      },
    };
  }

  // If only warnings, apply preset but keep other customizations
  return applyCommunicationStylePreset(style, config);
}

// ============================================================================
// 6. UI FIELD DEFINITION
// ============================================================================

export interface CommunicationStyleUIField {
  key: 'communicationStyle';
  type: 'radio-group';
  label: string;
  description: string;
  helperText?: string;
  required: boolean;
  options: Array<{
    value: CommunicationStyleOption;
    label: string;
    shortDescription: string;
    tooltip: string;
    examples: {
      greeting: string;
      productInquiry: string;
      orderConfirmation: string;
    };
  }>;
}

/**
 * Complete field definition for UI rendering
 */
export const CommunicationStyleField: CommunicationStyleUIField = {
  key: 'communicationStyle',
  type: 'radio-group',
  label: CommunicationStyleFieldCopy.label,
  description: CommunicationStyleFieldCopy.description,
  helperText: CommunicationStyleFieldCopy.helperText,
  required: true,
  options: [
    {
      value: 'friendly_casual',
      label: CommunicationStyleOptions.friendly_casual.label,
      shortDescription: CommunicationStyleOptions.friendly_casual.shortDescription,
      tooltip: CommunicationStyleOptions.friendly_casual.tooltip,
      examples: CommunicationStyleOptions.friendly_casual.examples,
    },
    {
      value: 'professional_formal',
      label: CommunicationStyleOptions.professional_formal.label,
      shortDescription: CommunicationStyleOptions.professional_formal.shortDescription,
      tooltip: CommunicationStyleOptions.professional_formal.tooltip,
      examples: CommunicationStyleOptions.professional_formal.examples,
    },
    {
      value: 'short_direct',
      label: CommunicationStyleOptions.short_direct.label,
      shortDescription: CommunicationStyleOptions.short_direct.shortDescription,
      tooltip: CommunicationStyleOptions.short_direct.tooltip,
      examples: CommunicationStyleOptions.short_direct.examples,
    },
    {
      value: 'detailed_explanatory',
      label: CommunicationStyleOptions.detailed_explanatory.label,
      shortDescription: CommunicationStyleOptions.detailed_explanatory.shortDescription,
      tooltip: CommunicationStyleOptions.detailed_explanatory.tooltip,
      examples: CommunicationStyleOptions.detailed_explanatory.examples,
    },
  ],
};

// ============================================================================
// 7. INTERNAL CONFIG MAPPING
// ============================================================================

/**
 * Mapping from user-facing options to internal config values
 */
export const CommunicationStyleMapping = {
  friendly_casual: {
    tone: 'friendly_casual' as const,
    responseLength: 'brief' as const,
    useCustomerName: true,
    enableTimeBasedGreetings: true,
  },
  professional_formal: {
    tone: 'professional_formal' as const,
    responseLength: 'moderate' as const,
    useCustomerName: true,
    enableTimeBasedGreetings: true,
  },
  short_direct: {
    tone: 'efficient_direct' as const,
    responseLength: 'brief' as const,
    useCustomerName: false,
    enableTimeBasedGreetings: false,
  },
  detailed_explanatory: {
    tone: 'helpful_expert' as const,
    responseLength: 'detailed' as const,
    useCustomerName: true,
    enableTimeBasedGreetings: true,
  },
} as const;
