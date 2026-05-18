/**
 * Example WhatsApp Bot Configurations
 * 
 * These are example UI configurations for different business types.
 * Use these as templates or starting points.
 */

import { WhatsAppBotUIConfig } from './whatsapp-bot-config';

// ============================================================================
// EXAMPLE 1: RESTAURANT (B2C, Food Service)
// ============================================================================

export const RestaurantExampleConfig: WhatsAppBotUIConfig = {
  communicationStyle: {
    tone: 'friendly_casual',
    responseLength: 'brief',
    useCustomerName: true,
  },
  businessType: {
    customerType: 'individual',
  },
  productInfo: {
    showFields: ['price', 'description', 'ingredients'],
    showOutOfStock: false, // Don't show unavailable items
    highlightBestSellers: true,
  },
  orderingProcess: {
    collectCustomerInfo: {
      name: true,
      phone: true,
      email: false,
      address: true, // Delivery address
    },
    requireConfirmation: true,
    allowBulkOrders: true,
    minimumQuantity: undefined, // No minimum
  },
  promotions: {
    autoMentionActiveOffers: true,
    highlightDiscounts: true,
    showExpiryDates: true, // Show promo expiry
  },
  customerExperience: {
    enableUpselling: true,
    upsellingStyle: 'moderate', // Suggest sides, drinks
    personalizeForReturningCustomers: true,
    enableTimeBasedGreetings: true,
  },
  businessHours: {
    timezone: 'Asia/Kolkata',
    schedule: [
      { day: 'monday', isOpen: true, openTime: '11:00', closeTime: '23:00' },
      { day: 'tuesday', isOpen: true, openTime: '11:00', closeTime: '23:00' },
      { day: 'wednesday', isOpen: true, openTime: '11:00', closeTime: '23:00' },
      { day: 'thursday', isOpen: true, openTime: '11:00', closeTime: '23:00' },
      { day: 'friday', isOpen: true, openTime: '11:00', closeTime: '23:30' },
      { day: 'saturday', isOpen: true, openTime: '11:00', closeTime: '23:30' },
      { day: 'sunday', isOpen: true, openTime: '12:00', closeTime: '23:00' },
    ],
    afterHoursMessage: 'We\'re currently closed. Our next delivery slot is tomorrow at 11:00 AM. You can place your order now and we\'ll prepare it when we open!',
  },
  policies: {
    cancellationPolicy: 'Orders can be cancelled within 15 minutes of placing. No refunds after preparation starts.',
    shippingPolicy: 'Free delivery on orders above ₹300. Delivery time: 30-45 minutes.',
  },
  advanced: {
    industryTemplate: 'restaurant',
    customInstructions: 'Focus on freshness, delivery time, and popular items. Always confirm delivery address and preferred delivery time slot.',
  },
};

// ============================================================================
// EXAMPLE 2: WHOLESALE BUSINESS (B2B, Bulk Sales)
// ============================================================================

export const WholesaleExampleConfig: WhatsAppBotUIConfig = {
  communicationStyle: {
    tone: 'professional_formal',
    responseLength: 'detailed',
    useCustomerName: true,
  },
  businessType: {
    customerType: 'business',
    requiresCreditTerms: true,
    minimumOrderAmount: 5000, // Minimum ₹5000 order
  },
  productInfo: {
    showFields: ['price', 'stock', 'description', 'specifications'],
    showOutOfStock: true, // Show for backorder planning
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
    minimumQuantity: 10, // Minimum 10 units per item
  },
  promotions: {
    autoMentionActiveOffers: true,
    highlightDiscounts: true,
    showExpiryDates: true,
  },
  customerExperience: {
    enableUpselling: false, // Less aggressive for B2B
    upsellingStyle: 'subtle',
    personalizeForReturningCustomers: true,
    enableTimeBasedGreetings: true,
  },
  businessHours: {
    timezone: 'Asia/Kolkata',
    schedule: [
      { day: 'monday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
      { day: 'tuesday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
      { day: 'wednesday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
      { day: 'thursday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
      { day: 'friday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
      { day: 'saturday', isOpen: true, openTime: '09:00', closeTime: '14:00' },
      { day: 'sunday', isOpen: false },
    ],
    afterHoursMessage: 'Our business hours are Monday-Friday 9 AM - 6 PM, Saturday 9 AM - 2 PM. We\'ll respond to your inquiry during business hours.',
  },
  policies: {
    shippingPolicy: 'Bulk orders shipped within 3-5 business days. GST invoice provided. Payment terms: Net 30 days for approved accounts.',
    cancellationPolicy: 'Orders can be modified within 24 hours. Cancellation charges apply after dispatch.',
  },
  advanced: {
    industryTemplate: 'wholesale',
    customInstructions: 'Emphasize bulk pricing, credit terms, and GST compliance. Always confirm GSTIN for tax invoice. Provide detailed product specifications. Focus on building long-term business relationships.',
  },
};

// ============================================================================
// EXAMPLE 3: RETAIL CLOTHING STORE (B2C, Fashion)
// ============================================================================

export const RetailClothingExampleConfig: WhatsAppBotUIConfig = {
  communicationStyle: {
    tone: 'helpful_expert',
    responseLength: 'moderate',
    useCustomerName: true,
  },
  businessType: {
    customerType: 'individual',
  },
  productInfo: {
    showFields: ['price', 'stock', 'description', 'sizes', 'colors'],
    showOutOfStock: true, // Show for size/color alternatives
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
  },
  promotions: {
    autoMentionActiveOffers: true,
    highlightDiscounts: true,
    showExpiryDates: true,
  },
  customerExperience: {
    enableUpselling: true,
    upsellingStyle: 'moderate', // Suggest accessories, matching items
    personalizeForReturningCustomers: true,
    enableTimeBasedGreetings: true,
  },
  businessHours: {
    timezone: 'Asia/Kolkata',
    schedule: [
      { day: 'monday', isOpen: true, openTime: '10:00', closeTime: '21:00' },
      { day: 'tuesday', isOpen: true, openTime: '10:00', closeTime: '21:00' },
      { day: 'wednesday', isOpen: true, openTime: '10:00', closeTime: '21:00' },
      { day: 'thursday', isOpen: true, openTime: '10:00', closeTime: '21:00' },
      { day: 'friday', isOpen: true, openTime: '10:00', closeTime: '21:00' },
      { day: 'saturday', isOpen: true, openTime: '10:00', closeTime: '22:00' },
      { day: 'sunday', isOpen: true, openTime: '10:00', closeTime: '21:00' },
    ],
    afterHoursMessage: 'We\'re currently closed. Shop online 24/7! Orders placed after hours will be processed when we open at 10:00 AM.',
  },
  policies: {
    returnPolicy: '7-day return policy. Items must be unworn with tags attached. Free returns within city limits.',
    shippingPolicy: 'Free shipping on orders above ₹999. Standard delivery: 2-3 business days.',
  },
  advanced: {
    industryTemplate: 'retail',
    customInstructions: 'Always ask for size and color preferences. Suggest size guide if customer is unsure. Highlight fabric, care instructions, and styling tips.',
  },
};
