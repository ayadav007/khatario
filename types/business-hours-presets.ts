/**
 * Business Hours & Availability Configuration
 * 
 * Provides configuration for business hours, timezone, and after-hours messaging.
 */

import { WhatsAppBotUIConfig } from './whatsapp-bot-config';

// ============================================================================
// 1. DAY OF WEEK DEFINITIONS
// ============================================================================

export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface DayOfWeekConfig {
  value: DayOfWeek;
  label: string;
  shortLabel: string;
  order: number; // 0-6 for sorting
}

/**
 * Day of week definitions
 */
export const DaysOfWeek: Record<DayOfWeek, DayOfWeekConfig> = {
  monday: { value: 'monday', label: 'Monday', shortLabel: 'Mon', order: 1 },
  tuesday: { value: 'tuesday', label: 'Tuesday', shortLabel: 'Tue', order: 2 },
  wednesday: { value: 'wednesday', label: 'Wednesday', shortLabel: 'Wed', order: 3 },
  thursday: { value: 'thursday', label: 'Thursday', shortLabel: 'Thu', order: 4 },
  friday: { value: 'friday', label: 'Friday', shortLabel: 'Fri', order: 5 },
  saturday: { value: 'saturday', label: 'Saturday', shortLabel: 'Sat', order: 6 },
  sunday: { value: 'sunday', label: 'Sunday', shortLabel: 'Sun', order: 0 },
};

// ============================================================================
// 2. TIMEZONE OPTIONS
// ============================================================================

export interface TimezoneOption {
  value: string; // IANA timezone identifier
  label: string; // User-friendly label
  offset: string; // UTC offset (e.g., "+05:30")
}

/**
 * Common timezone options (focused on India, expandable)
 */
export const TimezoneOptions: TimezoneOption[] = [
  { value: 'Asia/Kolkata', label: 'Indian Standard Time (IST)', offset: '+05:30' },
  { value: 'Asia/Dubai', label: 'Gulf Standard Time (GST)', offset: '+04:00' },
  { value: 'Asia/Singapore', label: 'Singapore Time (SGT)', offset: '+08:00' },
  { value: 'America/New_York', label: 'Eastern Time (ET)', offset: '-05:00' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)', offset: '-08:00' },
  { value: 'Europe/London', label: 'Greenwich Mean Time (GMT)', offset: '+00:00' },
  { value: 'Asia/Dhaka', label: 'Bangladesh Standard Time (BST)', offset: '+06:00' },
  { value: 'Asia/Karachi', label: 'Pakistan Standard Time (PKT)', offset: '+05:00' },
];

// ============================================================================
// 3. BUSINESS HOURS SCHEDULE
// ============================================================================

export interface DaySchedule {
  day: DayOfWeek;
  isOpen: boolean;
  openTime?: string; // HH:mm format (24-hour)
  closeTime?: string; // HH:mm format (24-hour)
}

export interface BusinessHoursConfig {
  timezone: string;
  schedule: DaySchedule[];
  afterHoursEnabled: boolean;
  afterHoursMessage?: string;
}

// ============================================================================
// 4. DEFAULT CONFIGURATIONS
// ============================================================================

/**
 * Default business hours configuration
 */
export const DefaultBusinessHoursConfig: BusinessHoursConfig = {
  timezone: 'Asia/Kolkata',
  schedule: [
    { day: 'monday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
    { day: 'tuesday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
    { day: 'wednesday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
    { day: 'thursday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
    { day: 'friday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
    { day: 'saturday', isOpen: false },
    { day: 'sunday', isOpen: false },
  ],
  afterHoursEnabled: true,
  afterHoursMessage: 'We\'re currently closed. Our business hours are Monday-Friday, 9 AM - 6 PM. We\'ll respond to your message during business hours. Thank you!',
};

// ============================================================================
// 5. SAFE DEFAULT AFTER-HOURS MESSAGES
// ============================================================================

/**
 * Safe default after-hours messages (no promises, no delivery commitments)
 */
export const SafeAfterHoursMessages = {
  generic: 'We\'re currently closed. Our business hours are Monday-Friday, 9 AM - 6 PM. We\'ll respond to your message during business hours. Thank you!',
  
  restaurant: 'We\'re currently closed. Our next delivery slot is tomorrow at 11:00 AM. You can place your order now and we\'ll prepare it when we open. Thank you!',
  
  retail: 'We\'re currently closed. Our store hours are Monday-Saturday, 10 AM - 9 PM. We\'ll respond to your inquiry when we open. Thank you!',
  
  wholesale: 'Our business hours are Monday-Friday, 9 AM - 6 PM. We\'ll respond to your inquiry during business hours. Thank you for your patience.',
  
  service: 'We\'re currently closed. Our office hours are Monday-Friday, 9 AM - 6 PM. We\'ll get back to you during business hours. Thank you!',
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
 * Forbidden phrases that indicate promises or delivery commitments
 */
const FORBIDDEN_PHRASES = [
  'will deliver',
  'guaranteed delivery',
  'promise to',
  'assured',
  'guarantee',
  'will arrive',
  'definitely',
  'certainly will',
  'will be ready',
  'will ship',
  'will process',
];

/**
 * Validate business hours configuration
 */
export function validateBusinessHoursConfig(config: Partial<BusinessHoursConfig>): ValidationResult {
  const errors: Array<{ field: string; message: string }> = [];
  const warnings: Array<{ field: string; message: string }> = [];

  // Validate timezone
  if (!config.timezone) {
    errors.push({
      field: 'businessHours.timezone',
      message: 'Timezone is required',
    });
  } else if (!TimezoneOptions.some(tz => tz.value === config.timezone)) {
    errors.push({
      field: 'businessHours.timezone',
      message: 'Invalid timezone selected',
    });
  }

  // Validate schedule
  if (!config.schedule || config.schedule.length !== 7) {
    errors.push({
      field: 'businessHours.schedule',
      message: 'Schedule must include all 7 days of the week',
    });
  } else {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

    config.schedule.forEach((daySchedule, index) => {
      if (daySchedule.isOpen) {
        if (!daySchedule.openTime || !daySchedule.closeTime) {
          errors.push({
            field: `businessHours.schedule[${index}]`,
            message: `${DaysOfWeek[daySchedule.day].label}: Opening and closing times are required when business is open`,
          });
        } else {
          // Validate time format
          if (!timeRegex.test(daySchedule.openTime)) {
            errors.push({
              field: `businessHours.schedule[${index}].openTime`,
              message: `${DaysOfWeek[daySchedule.day].label}: Invalid opening time format (use HH:mm, e.g., 09:00)`,
            });
          }

          if (!timeRegex.test(daySchedule.closeTime)) {
            errors.push({
              field: `businessHours.schedule[${index}].closeTime`,
              message: `${DaysOfWeek[daySchedule.day].label}: Invalid closing time format (use HH:mm, e.g., 18:00)`,
            });
          }

          // Validate close time is after open time
          if (daySchedule.openTime && daySchedule.closeTime) {
            const [openHour, openMin] = daySchedule.openTime.split(':').map(Number);
            const [closeHour, closeMin] = daySchedule.closeTime.split(':').map(Number);
            const openMinutes = openHour * 60 + openMin;
            const closeMinutes = closeHour * 60 + closeMin;

            if (closeMinutes <= openMinutes) {
              errors.push({
                field: `businessHours.schedule[${index}]`,
                message: `${DaysOfWeek[daySchedule.day].label}: Closing time must be after opening time`,
              });
            }
          }
        }
      }
    });

    // Warning if no days are open
    const openDays = config.schedule.filter(day => day.isOpen);
    if (openDays.length === 0) {
      warnings.push({
        field: 'businessHours.schedule',
        message: 'No business hours configured. Business appears to be closed all week.',
      });
    }
  }

  // Validate after-hours message if enabled
  if (config.afterHoursEnabled) {
    if (!config.afterHoursMessage || config.afterHoursMessage.trim().length === 0) {
      errors.push({
        field: 'businessHours.afterHoursMessage',
        message: 'After-hours message is required when after-hours auto-reply is enabled',
      });
    } else {
      const message = config.afterHoursMessage.toLowerCase();

      // Check message length (max 300 characters)
      if (config.afterHoursMessage.length > 300) {
        errors.push({
          field: 'businessHours.afterHoursMessage',
          message: 'After-hours message must be 300 characters or less',
        });
      }

      // Check for forbidden phrases (promises/delivery commitments)
      const foundPhrases = FORBIDDEN_PHRASES.filter(phrase => message.includes(phrase.toLowerCase()));
      if (foundPhrases.length > 0) {
        errors.push({
          field: 'businessHours.afterHoursMessage',
          message: `Message cannot include promises or delivery commitments. Found: "${foundPhrases.join('", "')}"`,
        });
      }

      // Warning if message is too short
      if (config.afterHoursMessage.trim().length < 20) {
        warnings.push({
          field: 'businessHours.afterHoursMessage',
          message: 'After-hours message seems too short. Consider providing more helpful information.',
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Sanitize after-hours message to ensure safety
 * Removes or flags problematic content
 */
export function sanitizeAfterHoursMessage(message: string): {
  sanitized: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  let sanitized = message.trim();

  // Check length
  if (sanitized.length > 300) {
    sanitized = sanitized.substring(0, 300);
    warnings.push('Message was truncated to 300 characters');
  }

  // Check for forbidden phrases (case-insensitive)
  const messageLower = sanitized.toLowerCase();
  FORBIDDEN_PHRASES.forEach(phrase => {
    if (messageLower.includes(phrase.toLowerCase())) {
      warnings.push(`Message contains "${phrase}" which may imply a promise or delivery commitment`);
    }
  });

  return { sanitized, warnings };
}

// ============================================================================
// 7. MAPPING TO INTERNAL CONFIG
// ============================================================================

/**
 * Map business hours config to internal WhatsApp bot config format
 */
export function mapBusinessHoursToInternalConfig(
  config: BusinessHoursConfig
): Partial<WhatsAppBotUIConfig> {
  // Map day names to numbers (0 = Sunday, 1 = Monday, etc.)
  const dayMap: Record<DayOfWeek, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  const schedule = config.schedule.map(daySchedule => ({
    day: daySchedule.day, // Keep as DayOfWeek, don't convert to number
    isOpen: daySchedule.isOpen,
    openTime: daySchedule.openTime,
    closeTime: daySchedule.closeTime,
  }));

  return {
    businessHours: {
      timezone: config.timezone,
      schedule: schedule,
      afterHoursMessage: config.afterHoursEnabled ? config.afterHoursMessage : undefined,
    },
  };
}

/**
 * Map internal config to business hours config format
 */
export function mapInternalConfigToBusinessHours(
  config: Partial<WhatsAppBotUIConfig>
): Partial<BusinessHoursConfig> {
  if (!config.businessHours) {
    return {};
  }

  const dayReverseMap: Record<number, DayOfWeek> = {
    0: 'sunday',
    1: 'monday',
    2: 'tuesday',
    3: 'wednesday',
    4: 'thursday',
    5: 'friday',
    6: 'saturday',
  };

  const schedule = config.businessHours.schedule?.map(hour => {
    const dayNum = typeof hour.day === 'number' ? hour.day : (typeof hour.day === 'string' ? parseInt(hour.day) : 0);
    return {
      day: (dayNum in dayReverseMap ? dayReverseMap[dayNum] : 'monday') as DayOfWeek,
      isOpen: hour.isOpen,
      openTime: hour.openTime,
      closeTime: hour.closeTime,
    };
  }) || [];

  return {
    timezone: config.businessHours.timezone,
    schedule: schedule,
    afterHoursEnabled: !!config.businessHours.afterHoursMessage,
    afterHoursMessage: config.businessHours.afterHoursMessage,
  };
}

// ============================================================================
// 8. UI FIELD DEFINITION
// ============================================================================

export interface BusinessHoursUIField {
  key: 'businessHours';
  type: 'section';
  label: string;
  description: string;
  fields: Array<{
    key: string;
    type: 'timezone-select' | 'schedule-table' | 'toggle' | 'textarea';
    label: string;
    description: string;
    required?: boolean;
    validation?: {
      maxLength?: number;
      minLength?: number;
    };
    default?: any;
  }>;
}

/**
 * Complete UI field definition for business hours section
 */
export const BusinessHoursField: BusinessHoursUIField = {
  key: 'businessHours',
  type: 'section',
  label: 'Business Hours & Availability',
  description: 'Set your business hours and configure automatic after-hours responses.',
  fields: [
    {
      key: 'timezone',
      type: 'timezone-select',
      label: 'Timezone',
      description: 'Select your business timezone for accurate hours calculation',
      required: true,
      default: DefaultBusinessHoursConfig.timezone,
    },
    {
      key: 'schedule',
      type: 'schedule-table',
      label: 'Weekly Schedule',
      description: 'Set your business hours for each day of the week',
      required: true,
    },
    {
      key: 'afterHoursEnabled',
      type: 'toggle',
      label: 'Enable After-Hours Auto-Reply',
      description: 'Automatically send a message when customers contact you outside business hours',
      default: DefaultBusinessHoursConfig.afterHoursEnabled,
    },
    {
      key: 'afterHoursMessage',
      type: 'textarea',
      label: 'After-Hours Message',
      description: 'Message to send when customers contact you outside business hours. Keep it brief and avoid making promises about delivery or service.',
      required: false,
      validation: {
        maxLength: 300,
        minLength: 20,
      },
      default: DefaultBusinessHoursConfig.afterHoursMessage,
    },
  ],
};

// ============================================================================
// 9. EXAMPLE AFTER-HOURS RESPONSES
// ============================================================================

/**
 * Example after-hours responses for different business types
 * All examples follow safety rules (no promises, no delivery commitments)
 */
export const ExampleAfterHoursResponses = {
  generic: {
    label: 'Generic Business',
    message: 'We\'re currently closed. Our business hours are Monday-Friday, 9 AM - 6 PM. We\'ll respond to your message during business hours. Thank you!',
  },
  
  restaurant: {
    label: 'Restaurant/Food Delivery',
    message: 'We\'re currently closed. Our next delivery slot is tomorrow at 11:00 AM. You can place your order now and we\'ll prepare it when we open. Thank you!',
  },
  
  retail: {
    label: 'Retail Store',
    message: 'We\'re currently closed. Our store hours are Monday-Saturday, 10 AM - 9 PM. We\'ll respond to your inquiry when we open. Thank you!',
  },
  
  wholesale: {
    label: 'Wholesale/B2B',
    message: 'Our business hours are Monday-Friday, 9 AM - 6 PM. We\'ll respond to your inquiry during business hours. Thank you for your patience.',
  },
  
  service: {
    label: 'Service Business',
    message: 'We\'re currently closed. Our office hours are Monday-Friday, 9 AM - 6 PM. We\'ll get back to you during business hours. Thank you!',
  },
  
  custom: {
    label: 'Custom Message',
    message: 'Thank you for contacting us. We\'re currently closed and will respond to your message during our business hours. Have a great day!',
  },
};
