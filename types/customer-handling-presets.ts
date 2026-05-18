/**
 * Customer Handling Configuration
 * 
 * Provides configuration for different customer groups:
 * - First-time customers
 * - Regular customers
 * - Important customers (VIP)
 * 
 * Each group can have different greeting styles, offer visibility, and priority handling.
 */

import { WhatsAppBotUIConfig } from './whatsapp-bot-config';

// ============================================================================
// 1. CUSTOMER GROUP DEFINITIONS
// ============================================================================

export type CustomerGroup = 'first_time' | 'regular' | 'vip';

export interface CustomerGroupConfig {
  value: CustomerGroup;
  label: string;
  description: string;
  icon?: string;
}

/**
 * Customer group definitions with user-friendly labels
 */
export const CustomerGroups: Record<CustomerGroup, CustomerGroupConfig> = {
  first_time: {
    value: 'first_time',
    label: 'First-time Customers',
    description: 'Customers who haven\'t placed an order yet',
  },
  regular: {
    value: 'regular',
    label: 'Regular Customers',
    description: 'Customers with previous orders',
  },
  vip: {
    value: 'vip',
    label: 'Important Customers',
    description: 'VIP customers (marked with VIP tag)',
  },
};

// ============================================================================
// 2. GREETING STYLE OPTIONS
// ============================================================================

export type GreetingStyle = 'standard' | 'warm_welcome' | 'personalized' | 'quick';

export interface GreetingStyleOption {
  value: GreetingStyle;
  label: string;
  description: string;
  example: string;
}

/**
 * Greeting style options for customer groups
 */
export const GreetingStyles: Record<GreetingStyle, GreetingStyleOption> = {
  standard: {
    value: 'standard',
    label: 'Standard Greeting',
    description: 'Use the default communication style greeting',
    example: 'Hi! How can I help you?',
  },
  warm_welcome: {
    value: 'warm_welcome',
    label: 'Warm Welcome',
    description: 'Extra friendly greeting for new or VIP customers',
    example: 'Hello! Welcome! We\'re so happy to have you here. How can I assist you today?',
  },
  personalized: {
    value: 'personalized',
    label: 'Personalized',
    description: 'Use customer name and reference their history',
    example: 'Hi John! Welcome back. How can I help you today?',
  },
  quick: {
    value: 'quick',
    label: 'Quick Greeting',
    description: 'Brief, efficient greeting',
    example: 'Hi! How can I help?',
  },
};

// ============================================================================
// 3. OFFER VISIBILITY OPTIONS
// ============================================================================

export type OfferVisibility = 'always' | 'only_promotions' | 'never';

export interface OfferVisibilityOption {
  value: OfferVisibility;
  label: string;
  description: string;
}

/**
 * Offer visibility options
 */
export const OfferVisibilityOptions: Record<OfferVisibility, OfferVisibilityOption> = {
  always: {
    value: 'always',
    label: 'Show All Offers',
    description: 'Show all available promotions and discounts',
  },
  only_promotions: {
    value: 'only_promotions',
    label: 'Show Promotions Only',
    description: 'Show only active promotions, not regular discounts',
  },
  never: {
    value: 'never',
    label: 'Don\'t Show Offers',
    description: 'Don\'t automatically show offers to this group',
  },
};

// ============================================================================
// 4. CUSTOMER HANDLING CONFIGURATION
// ============================================================================

export interface CustomerGroupHandling {
  greetingStyle: GreetingStyle;
  offerVisibility: OfferVisibility;
  priorityHandling: boolean;
}

export interface CustomerHandlingConfig {
  first_time: CustomerGroupHandling;
  regular: CustomerGroupHandling;
  vip: CustomerGroupHandling;
}

// ============================================================================
// 5. DEFAULT CONFIGURATIONS
// ============================================================================

/**
 * Default customer handling configurations
 */
export const DefaultCustomerHandlingConfig: CustomerHandlingConfig = {
  first_time: {
    greetingStyle: 'warm_welcome',
    offerVisibility: 'always',
    priorityHandling: false,
  },
  regular: {
    greetingStyle: 'personalized',
    offerVisibility: 'only_promotions',
    priorityHandling: false,
  },
  vip: {
    greetingStyle: 'warm_welcome',
    offerVisibility: 'always',
    priorityHandling: true,
  },
};

// ============================================================================
// 6. FOOD BUSINESS EXAMPLE
// ============================================================================

/**
 * Example configuration for a food business (restaurant)
 */
export const FoodBusinessCustomerHandlingExample: CustomerHandlingConfig = {
  first_time: {
    greetingStyle: 'warm_welcome',
    offerVisibility: 'always',
    priorityHandling: false,
  },
  regular: {
    greetingStyle: 'personalized',
    offerVisibility: 'only_promotions',
    priorityHandling: false,
  },
  vip: {
    greetingStyle: 'warm_welcome',
    offerVisibility: 'always',
    priorityHandling: true,
  },
};

// ============================================================================
// 7. VALIDATION RULES
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
}

/**
 * Validate customer handling configuration
 */
export function validateCustomerHandlingConfig(
  config: Partial<CustomerHandlingConfig>
): ValidationResult {
  const errors: Array<{ field: string; message: string }> = [];
  const warnings: Array<{ field: string; message: string }> = [];

  const groups: CustomerGroup[] = ['first_time', 'regular', 'vip'];

  groups.forEach(group => {
    const groupConfig = config[group];
    if (!groupConfig) {
      errors.push({
        field: `customerHandling.${group}`,
        message: `${CustomerGroups[group].label} configuration is required`,
      });
      return;
    }

    // Validate greeting style
    if (!Object.values(GreetingStyles).some(style => style.value === groupConfig.greetingStyle)) {
      errors.push({
        field: `customerHandling.${group}.greetingStyle`,
        message: `Invalid greeting style for ${CustomerGroups[group].label}`,
      });
    }

    // Validate offer visibility
    if (!Object.values(OfferVisibilityOptions).some(option => option.value === groupConfig.offerVisibility)) {
      errors.push({
        field: `customerHandling.${group}.offerVisibility`,
        message: `Invalid offer visibility for ${CustomerGroups[group].label}`,
      });
    }

    // Validate priority handling (must be boolean)
    if (typeof groupConfig.priorityHandling !== 'boolean') {
      errors.push({
        field: `customerHandling.${group}.priorityHandling`,
        message: `Priority handling must be enabled or disabled for ${CustomerGroups[group].label}`,
      });
    }

    // Warnings
    if (group === 'first_time' && groupConfig.priorityHandling) {
      warnings.push({
        field: `customerHandling.${group}.priorityHandling`,
        message: 'First-time customers typically don\'t need priority handling',
      });
    }

    if (group === 'vip' && !groupConfig.priorityHandling) {
      warnings.push({
        field: `customerHandling.${group}.priorityHandling`,
        message: 'VIP customers usually benefit from priority handling',
      });
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// 8. MAPPING TO INTERNAL CONFIG
// ============================================================================

/**
 * Map customer handling config to internal WhatsApp bot config
 * Note: This is a simplified mapping - actual implementation would integrate
 * with the full WhatsAppBotUIConfig structure
 */
export function mapCustomerHandlingToInternalConfig(
  customerHandling: CustomerHandlingConfig
): Partial<WhatsAppBotUIConfig> {
  // For now, we map VIP priority handling to customer experience settings
  // In a full implementation, this would integrate with conversation routing
  // and greeting generation logic

  return {
    customerExperience: {
      enableUpselling: true,
      upsellingStyle: 'moderate' as const,
      personalizeForReturningCustomers: customerHandling.regular.greetingStyle === 'personalized',
      enableTimeBasedGreetings: true,
    },
    promotions: {
      // Offer visibility is handled at runtime based on customer group
      // This mapping is for reference only
      autoMentionActiveOffers: true, // Controlled by offerVisibility at runtime
      highlightDiscounts: true,
      showExpiryDates: false,
    },
  };
}

// ============================================================================
// 9. UI FIELD DEFINITIONS
// ============================================================================

export interface CustomerHandlingUIField {
  key: 'customerHandling';
  type: 'section-group';
  label: string;
  description: string;
  groups: Array<{
    group: CustomerGroup;
    label: string;
    description: string;
    fields: Array<{
      key: string;
      type: 'select' | 'toggle';
      label: string;
      description: string;
      options?: Array<{ value: string; label: string }>;
      default: any;
    }>;
  }>;
}

/**
 * Complete UI field definition for customer handling section
 */
export const CustomerHandlingField: CustomerHandlingUIField = {
  key: 'customerHandling',
  type: 'section-group',
  label: 'Customer Handling',
  description: 'Configure how the bot handles different customer groups. Set greeting styles, offer visibility, and priority handling for each group.',
  groups: [
    {
      group: 'first_time',
      label: CustomerGroups.first_time.label,
      description: CustomerGroups.first_time.description,
      fields: [
        {
          key: 'greetingStyle',
          type: 'select',
          label: 'Greeting Style',
          description: 'How should the bot greet first-time customers?',
          options: [
            { value: 'standard', label: GreetingStyles.standard.label },
            { value: 'warm_welcome', label: GreetingStyles.warm_welcome.label },
            { value: 'personalized', label: GreetingStyles.personalized.label },
            { value: 'quick', label: GreetingStyles.quick.label },
          ],
          default: DefaultCustomerHandlingConfig.first_time.greetingStyle,
        },
        {
          key: 'offerVisibility',
          type: 'select',
          label: 'Show Offers',
          description: 'When should the bot show promotions and discounts?',
          options: [
            { value: 'always', label: OfferVisibilityOptions.always.label },
            { value: 'only_promotions', label: OfferVisibilityOptions.only_promotions.label },
            { value: 'never', label: OfferVisibilityOptions.never.label },
          ],
          default: DefaultCustomerHandlingConfig.first_time.offerVisibility,
        },
        {
          key: 'priorityHandling',
          type: 'toggle',
          label: 'Priority Handling',
          description: 'Give first-time customers priority in responses (not recommended)',
          default: DefaultCustomerHandlingConfig.first_time.priorityHandling,
        },
      ],
    },
    {
      group: 'regular',
      label: CustomerGroups.regular.label,
      description: CustomerGroups.regular.description,
      fields: [
        {
          key: 'greetingStyle',
          type: 'select',
          label: 'Greeting Style',
          description: 'How should the bot greet regular customers?',
          options: [
            { value: 'standard', label: GreetingStyles.standard.label },
            { value: 'warm_welcome', label: GreetingStyles.warm_welcome.label },
            { value: 'personalized', label: GreetingStyles.personalized.label },
            { value: 'quick', label: GreetingStyles.quick.label },
          ],
          default: DefaultCustomerHandlingConfig.regular.greetingStyle,
        },
        {
          key: 'offerVisibility',
          type: 'select',
          label: 'Show Offers',
          description: 'When should the bot show promotions and discounts?',
          options: [
            { value: 'always', label: OfferVisibilityOptions.always.label },
            { value: 'only_promotions', label: OfferVisibilityOptions.only_promotions.label },
            { value: 'never', label: OfferVisibilityOptions.never.label },
          ],
          default: DefaultCustomerHandlingConfig.regular.offerVisibility,
        },
        {
          key: 'priorityHandling',
          type: 'toggle',
          label: 'Priority Handling',
          description: 'Give regular customers priority in responses',
          default: DefaultCustomerHandlingConfig.regular.priorityHandling,
        },
      ],
    },
    {
      group: 'vip',
      label: CustomerGroups.vip.label,
      description: CustomerGroups.vip.description,
      fields: [
        {
          key: 'greetingStyle',
          type: 'select',
          label: 'Greeting Style',
          description: 'How should the bot greet VIP customers?',
          options: [
            { value: 'standard', label: GreetingStyles.standard.label },
            { value: 'warm_welcome', label: GreetingStyles.warm_welcome.label },
            { value: 'personalized', label: GreetingStyles.personalized.label },
            { value: 'quick', label: GreetingStyles.quick.label },
          ],
          default: DefaultCustomerHandlingConfig.vip.greetingStyle,
        },
        {
          key: 'offerVisibility',
          type: 'select',
          label: 'Show Offers',
          description: 'When should the bot show promotions and discounts?',
          options: [
            { value: 'always', label: OfferVisibilityOptions.always.label },
            { value: 'only_promotions', label: OfferVisibilityOptions.only_promotions.label },
            { value: 'never', label: OfferVisibilityOptions.never.label },
          ],
          default: DefaultCustomerHandlingConfig.vip.offerVisibility,
        },
        {
          key: 'priorityHandling',
          type: 'toggle',
          label: 'Priority Handling',
          description: 'Give VIP customers priority in responses (recommended)',
          default: DefaultCustomerHandlingConfig.vip.priorityHandling,
        },
      ],
    },
  ],
};
