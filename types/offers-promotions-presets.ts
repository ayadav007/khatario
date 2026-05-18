/**
 * Offers & Promotions Display Configuration
 * 
 * Provides configuration for how and when to show offers and promotions.
 * Note: This controls DISPLAY behavior only - offers are managed elsewhere.
 */

import { WhatsAppBotUIConfig } from './whatsapp-bot-config';

// ============================================================================
// 1. OFFER VISIBILITY OPTIONS
// ============================================================================

export type OfferVisibilityMode = 'always' | 'on_price_inquiry';

export interface OfferVisibilityOption {
  value: OfferVisibilityMode;
  label: string;
  description: string;
  example: string;
}

/**
 * Offer visibility mode options
 */
export const OfferVisibilityModes: Record<OfferVisibilityMode, OfferVisibilityOption> = {
  always: {
    value: 'always',
    label: 'Always',
    description: 'Automatically mention offers in relevant conversations',
    example: 'Bot mentions offers proactively when discussing products or orders',
  },
  on_price_inquiry: {
    value: 'on_price_inquiry',
    label: 'Only when customer asks about price',
    description: 'Show offers only when customers ask about pricing or discounts',
    example: 'Bot mentions offers when customer asks "What\'s the price?" or "Any discounts?"',
  },
};

// ============================================================================
// 2. OFFERS CONFIGURATION
// ============================================================================

export interface OffersPromotionsConfig {
  autoMentionOffers: boolean;
  showOffersWhen: OfferVisibilityMode;
  highlightExpiringOffers: boolean;
}

// ============================================================================
// 3. DEFAULT CONFIGURATIONS
// ============================================================================

/**
 * Default offers and promotions configuration
 */
export const DefaultOffersConfig: OffersPromotionsConfig = {
  autoMentionOffers: true,
  showOffersWhen: 'always',
  highlightExpiringOffers: false,
};

// ============================================================================
// 4. VALIDATION RULES
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
}

/**
 * Validate offers and promotions configuration
 */
export function validateOffersConfig(config: Partial<OffersPromotionsConfig>): ValidationResult {
  const errors: Array<{ field: string; message: string }> = [];
  const warnings: Array<{ field: string; message: string }> = [];

  // Validate autoMentionOffers (must be boolean)
  if (config.autoMentionOffers !== undefined && typeof config.autoMentionOffers !== 'boolean') {
    errors.push({
      field: 'offers.autoMentionOffers',
      message: 'Auto-mention offers must be enabled or disabled',
    });
  }

  // Validate showOffersWhen (must be valid option)
  if (config.showOffersWhen) {
    if (!Object.values(OfferVisibilityModes).some(mode => mode.value === config.showOffersWhen)) {
      errors.push({
        field: 'offers.showOffersWhen',
        message: 'Invalid offer visibility mode',
      });
    }
  }

  // Validate highlightExpiringOffers (must be boolean)
  if (config.highlightExpiringOffers !== undefined && typeof config.highlightExpiringOffers !== 'boolean') {
    errors.push({
      field: 'offers.highlightExpiringOffers',
      message: 'Highlight expiring offers must be enabled or disabled',
    });
  }

  // Warnings
  if (config.autoMentionOffers === false && config.showOffersWhen === 'always') {
    warnings.push({
      field: 'offers.showOffersWhen',
      message: 'Auto-mention is disabled, so "Always" setting will not have any effect',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// 5. GUARDRAILS
// ============================================================================

/**
 * Apply guardrails to ensure safe configuration
 */
export function applyOffersGuardrails(config: Partial<OffersPromotionsConfig>): OffersPromotionsConfig {
  // Start with defaults
  let safeConfig: OffersPromotionsConfig = {
    ...DefaultOffersConfig,
    ...config,
  };

  // Guardrail 1: If autoMentionOffers is false, showOffersWhen doesn't matter
  // But we keep the value as-is (user might enable it later)
  // No auto-correction needed here

  // Guardrail 2: Ensure showOffersWhen is valid
  if (!Object.values(OfferVisibilityModes).some(mode => mode.value === safeConfig.showOffersWhen)) {
    safeConfig.showOffersWhen = DefaultOffersConfig.showOffersWhen;
  }

  return safeConfig;
}

// ============================================================================
// 6. MAPPING LOGIC
// ============================================================================

/**
 * Map offers config to internal WhatsApp bot config (UI config format)
 */
export function mapOffersToInternalConfig(
  config: OffersPromotionsConfig
): Partial<WhatsAppBotUIConfig> {
  return {
    promotions: {
      autoMentionActiveOffers: config.autoMentionOffers,
      highlightDiscounts: config.autoMentionOffers && config.showOffersWhen === 'always',
      showExpiryDates: config.highlightExpiringOffers,
    },
  };
}

/**
 * Map internal config (UI config format) to offers config format
 */
export function mapInternalConfigToOffers(
  config: Partial<WhatsAppBotUIConfig>
): Partial<OffersPromotionsConfig> {
  if (!config.promotions) {
    return {};
  }

  // Determine showOffersWhen based on highlightDiscounts
  // If highlightDiscounts is true, it means "always" mode
  // If false but autoMentionActiveOffers is true, it means "on_price_inquiry" mode
  let showOffersWhen: OfferVisibilityMode = 'always';
  if (config.promotions.autoMentionActiveOffers && !config.promotions.highlightDiscounts) {
    showOffersWhen = 'on_price_inquiry';
  }

  return {
    autoMentionOffers: config.promotions.autoMentionActiveOffers ?? true,
    showOffersWhen: showOffersWhen,
    highlightExpiringOffers: config.promotions.showExpiryDates ?? false,
  };
}

// ============================================================================
// 7. UI FIELD DEFINITION
// ============================================================================

export interface OffersPromotionsUIField {
  key: 'offers';
  type: 'section';
  label: string;
  description: string;
  disclaimer?: string;
  fields: Array<{
    key: string;
    type: 'toggle' | 'select';
    label: string;
    description: string;
    options?: Array<{ value: string; label: string; description?: string }>;
    default?: any;
    conditional?: {
      dependsOn: string;
      values: any[];
    };
  }>;
}

/**
 * Complete UI field definition for offers and promotions section
 */
export const OffersPromotionsField: OffersPromotionsUIField = {
  key: 'offers',
  type: 'section',
  label: 'Offers & Promotions',
  description: 'Configure how the bot mentions and displays offers and promotions to customers.',
  disclaimer: 'Note: This controls when and how offers are shown. To create or manage offers, use the Promotions section in Settings.',
  fields: [
    {
      key: 'autoMentionOffers',
      type: 'toggle',
      label: 'Automatically Mention Current Offers',
      description: 'Enable the bot to automatically mention active offers and promotions in conversations',
      default: DefaultOffersConfig.autoMentionOffers,
    },
    {
      key: 'showOffersWhen',
      type: 'select',
      label: 'Show Offers',
      description: 'When should the bot show offers to customers?',
      options: [
        {
          value: 'always',
          label: OfferVisibilityModes.always.label,
          description: OfferVisibilityModes.always.description,
        },
        {
          value: 'on_price_inquiry',
          label: OfferVisibilityModes.on_price_inquiry.label,
          description: OfferVisibilityModes.on_price_inquiry.description,
        },
      ],
      default: DefaultOffersConfig.showOffersWhen,
      conditional: {
        dependsOn: 'autoMentionOffers',
        values: [true], // Only show this field when autoMentionOffers is enabled
      },
    },
    {
      key: 'highlightExpiringOffers',
      type: 'toggle',
      label: 'Highlight Expiring Offers',
      description: 'Emphasize offers that are expiring soon in bot responses',
      default: DefaultOffersConfig.highlightExpiringOffers,
    },
  ],
};

// ============================================================================
// 8. UX COPY & HELP TEXT
// ============================================================================

export interface OffersPromotionsFieldCopy {
  label: string;
  description: string;
  disclaimer: string;
  fieldLabels: {
    autoMention: string;
    autoMentionDescription: string;
    showOffersWhen: string;
    showOffersWhenDescription: string;
    highlightExpiring: string;
    highlightExpiringDescription: string;
  };
  helpText: {
    autoMention: string;
    showOffersWhenAlways: string;
    showOffersWhenPriceInquiry: string;
    highlightExpiring: string;
  };
}

/**
 * User-facing copy for Offers & Promotions section
 */
export const OffersPromotionsFieldCopy: OffersPromotionsFieldCopy = {
  label: 'Offers & Promotions',
  description: 'Configure how the bot mentions and displays offers and promotions to customers.',
  disclaimer: 'Note: This controls when and how offers are shown. To create or manage offers, use the Promotions section in Settings.',
  fieldLabels: {
    autoMention: 'Automatically Mention Current Offers',
    autoMentionDescription: 'Enable the bot to automatically mention active offers and promotions in conversations',
    showOffersWhen: 'Show Offers',
    showOffersWhenDescription: 'When should the bot show offers to customers?',
    highlightExpiring: 'Highlight Expiring Offers',
    highlightExpiringDescription: 'Emphasize offers that are expiring soon in bot responses',
  },
  helpText: {
    autoMention: 'When enabled, the bot will proactively mention relevant offers. When disabled, offers are only shown if explicitly asked.',
    showOffersWhenAlways: 'The bot will mention offers proactively in relevant conversations, such as when discussing products or orders.',
    showOffersWhenPriceInquiry: 'The bot will only mention offers when customers ask about pricing, discounts, or special deals.',
    highlightExpiring: 'When enabled, the bot will emphasize offers that are expiring soon, creating urgency for customers.',
  },
};

// ============================================================================
// 9. BEHAVIOR EXPLANATION
// ============================================================================

/**
 * Explanation of how offers are handled (read-only data)
 */
export const OffersBehaviorInfo = {
  title: 'How Offers Work',
  points: [
    'Offers and promotions are managed in the Promotions section of Settings',
    'This section only controls WHEN and HOW offers are mentioned',
    'You cannot create, edit, or delete offers from here',
    'The bot reads active offers from your promotions system',
    'Only active offers (within date range) are shown to customers',
    'Offers are automatically filtered based on your promotion settings',
  ],
  note: 'To create or manage offers: Go to Settings → Promotions',
};

// ============================================================================
// 10. EXAMPLE CONFIGURATIONS
// ============================================================================

/**
 * Example configurations for different scenarios
 */
export const ExampleOffersConfigs = {
  aggressive: {
    label: 'Aggressive Promotion',
    description: 'Always mention offers and highlight expiring ones',
    config: {
      autoMentionOffers: true,
      showOffersWhen: 'always' as OfferVisibilityMode,
      highlightExpiringOffers: true,
    },
  },
  moderate: {
    label: 'Moderate Promotion',
    description: 'Mention offers proactively but don\'t over-emphasize',
    config: {
      autoMentionOffers: true,
      showOffersWhen: 'always' as OfferVisibilityMode,
      highlightExpiringOffers: false,
    },
  },
  conservative: {
    label: 'Conservative Promotion',
    description: 'Only mention offers when customers ask about price',
    config: {
      autoMentionOffers: true,
      showOffersWhen: 'on_price_inquiry' as OfferVisibilityMode,
      highlightExpiringOffers: false,
    },
  },
  disabled: {
    label: 'Disabled',
    description: 'Don\'t automatically mention offers',
    config: {
      autoMentionOffers: false,
      showOffersWhen: 'always' as OfferVisibilityMode, // Doesn't matter when disabled
      highlightExpiringOffers: false,
    },
  },
};
