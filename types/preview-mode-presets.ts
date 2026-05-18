/**
 * Preview Mode Configuration for AI Assistant Settings
 * 
 * Provides preview functionality to test AI responses without sending real messages
 */

import { WhatsAppBotUIConfig } from './whatsapp-bot-config';

// ============================================================================
// 1. PREVIEW MESSAGE TYPES
// ============================================================================

export interface PreviewMessage {
  id: string;
  type: 'customer' | 'ai';
  content: string;
  timestamp: Date;
  isLoading?: boolean;
}

export interface SampleQuestion {
  id: string;
  text: string;
  category: 'greeting' | 'product_inquiry' | 'pricing' | 'order' | 'support' | 'general';
  description?: string;
}

// ============================================================================
// 2. SAMPLE QUESTIONS
// ============================================================================

/**
 * Pre-defined sample questions for preview
 */
export const SampleQuestions: SampleQuestion[] = [
  {
    id: 'greeting-1',
    text: 'Hello, I need help',
    category: 'greeting',
    description: 'Test greeting response',
  },
  {
    id: 'product-1',
    text: 'What products do you have?',
    category: 'product_inquiry',
    description: 'Test product listing',
  },
  {
    id: 'product-2',
    text: 'Do you have [product name]?',
    category: 'product_inquiry',
    description: 'Test product search',
  },
  {
    id: 'pricing-1',
    text: 'What are your prices?',
    category: 'pricing',
    description: 'Test pricing response',
  },
  {
    id: 'pricing-2',
    text: 'Any discounts available?',
    category: 'pricing',
    description: 'Test offers/promotions',
  },
  {
    id: 'order-1',
    text: 'I want to place an order',
    category: 'order',
    description: 'Test order initiation',
  },
  {
    id: 'order-2',
    text: 'What is my order status?',
    category: 'order',
    description: 'Test order status check',
  },
  {
    id: 'support-1',
    text: 'I have a complaint',
    category: 'support',
    description: 'Test support response',
  },
  {
    id: 'general-1',
    text: 'Tell me about your business',
    category: 'general',
    description: 'Test business information',
  },
];

// ============================================================================
// 3. PREVIEW STATE MANAGEMENT
// ============================================================================

export interface PreviewState {
  messages: PreviewMessage[];
  isGenerating: boolean;
  currentConfig: Partial<WhatsAppBotUIConfig> | null;
  selectedQuestion: string | null;
  hasInteracted: boolean;
}

export interface PreviewActions {
  addCustomerMessage: (text: string) => void;
  generateAIResponse: (config: Partial<WhatsAppBotUIConfig>) => Promise<void>;
  resetPreview: () => void;
  selectQuestion: (questionId: string) => void;
  clearMessages: () => void;
}

// ============================================================================
// 4. PREVIEW MODE CONFIGURATION
// ============================================================================

export interface PreviewModeConfig {
  enabled: boolean;
  showSampleQuestions: boolean;
  allowCustomInput: boolean;
  maxMessages: number;
  safeMode: boolean;
}

/**
 * Default preview mode configuration
 */
export const DefaultPreviewConfig: PreviewModeConfig = {
  enabled: true,
  showSampleQuestions: true,
  allowCustomInput: true,
  maxMessages: 20, // Maximum messages in preview conversation
  safeMode: true, // Safe mode: no real API calls, no data modification
};

// ============================================================================
// 5. SAFE MODE EXPLANATION
// ============================================================================

export interface SafeModeInfo {
  title: string;
  description: string;
  points: string[];
  warnings: string[];
}

/**
 * Safe mode information for users
 */
export const SafeModeInfo: SafeModeInfo = {
  title: 'Preview Mode - Safe Testing',
  description: 'Preview mode allows you to test how your AI assistant responds without sending real messages or modifying data.',
  points: [
    'No messages are sent to customers',
    'No data is modified or saved',
    'No API costs are incurred (uses simulated responses)',
    'Preview responses are based on your current settings',
    'You can test different configurations safely',
  ],
  warnings: [
    'Preview responses are simulated and may differ from actual AI responses',
    'Product data shown is from your actual catalog (read-only)',
    'Preview does not include real-time data like inventory or pricing',
  ],
};

// ============================================================================
// 6. PREVIEW UI CONFIGURATION
// ============================================================================

export interface PreviewUIProps {
  config: Partial<WhatsAppBotUIConfig>;
  onConfigChange?: (config: Partial<WhatsAppBotUIConfig>) => void;
  onResetToDefaults?: () => void;
  defaultConfig?: Partial<WhatsAppBotUIConfig>;
  businessId?: string;
}

// ============================================================================
// 7. PREVIEW RESPONSE GENERATOR (MOCK)
// ============================================================================

/**
 * Generate a mock/preview AI response based on configuration
 * This is a simplified version that doesn't call the real API
 */
export function generatePreviewResponse(
  customerMessage: string,
  config: Partial<WhatsAppBotUIConfig>
): string {
  // This is a mock response generator for preview
  // NOTE: These are SIMPLIFIED mock responses for preview only
  // Real AI responses will be contextually aware and understand conversation flow
  
  const tone = config.communicationStyle?.tone || 'friendly_casual';
  const responseLength = config.communicationStyle?.responseLength || 'moderate';
  
  // Simulate different responses based on message content and config
  const messageLower = customerMessage.toLowerCase();
  
  // Check for specific intents first (more specific patterns)
  
  // Order status queries
  if (messageLower.includes('order status') || messageLower.includes('status of my order') || 
      messageLower.includes('where is my order') || messageLower.includes('track my order')) {
    return generateOrderStatusResponse(tone, responseLength, config);
  }
  
  // Complaints/issues
  if (messageLower.includes('complaint') || messageLower.includes('not working') || 
      messageLower.includes('problem') || messageLower.includes('issue') ||
      messageLower.includes('defective') || messageLower.includes('broken') ||
      messageLower.includes('wrong')) {
    return generateComplaintResponse(tone, responseLength, config);
  }
  
  // Refunds/returns
  if (messageLower.includes('refund') || messageLower.includes('return') || 
      messageLower.includes('cancel order')) {
    return generateRefundResponse(tone, responseLength, config);
  }
  
  // Greetings (check early to avoid false matches)
  if ((messageLower.includes('hello') || messageLower.includes('hi')) && 
      messageLower.split(' ').length <= 3) {
    return generateGreetingResponse(tone, responseLength, config);
  }
  
  // Product inquiries
  if (messageLower.includes('product') || messageLower.includes('item') || 
      messageLower.includes('what do you sell') || messageLower.includes('what products')) {
    return generateProductResponse(tone, responseLength, config);
  }
  
  // Pricing queries
  if (messageLower.includes('price') || messageLower.includes('cost') || 
      messageLower.includes('discount') || messageLower.includes('how much')) {
    return generatePricingResponse(tone, responseLength, config);
  }
  
  // Place order (but not status)
  if (messageLower.includes('place order') || messageLower.includes('buy') || 
      messageLower.includes('purchase') || messageLower.includes('want to order')) {
    return generateOrderResponse(tone, responseLength, config);
  }
  
  // Default response
  return generateDefaultResponse(tone, responseLength, config);
}

function generateGreetingResponse(
  tone: string,
  responseLength: string,
  config: Partial<WhatsAppBotUIConfig>
): string {
  const responses: Record<string, Record<string, string>> = {
    friendly_casual: {
      brief: "Hi! 👋 How can I help you today?",
      moderate: "Hi there! 👋 Thanks for reaching out. I'm here to help with any questions about our products or services. What can I do for you?",
      detailed: "Hello! 👋 Welcome to our store. I'm here to assist you with any questions you might have about our products, services, pricing, or anything else. Feel free to ask me anything, and I'll do my best to help you. What would you like to know?",
    },
    professional_formal: {
      brief: "Hello. How may I assist you?",
      moderate: "Good day. Thank you for contacting us. I am here to assist you with any inquiries regarding our products and services. How may I help you today?",
      detailed: "Good day. Thank you for reaching out to us. I am available to assist you with any questions or concerns you may have regarding our products, services, pricing, ordering process, or any other matter. Please let me know how I can be of service to you today.",
    },
  };
  
  return responses[tone]?.[responseLength] || responses.friendly_casual.moderate;
}

function generateProductResponse(
  tone: string,
  responseLength: string,
  config: Partial<WhatsAppBotUIConfig>
): string {
  const baseResponses: Record<string, Record<string, string>> = {
    friendly_casual: {
      brief: "We have a great selection! What are you looking for?",
      moderate: "We offer a variety of products! I'd be happy to help you find what you need. Could you tell me what you're looking for?",
      detailed: "We have an extensive range of products available. I'd love to help you find exactly what you're looking for. Could you please let me know what type of product or service you're interested in? I can then provide you with more specific details, pricing, and availability.",
    },
  };
  
  const response = baseResponses[tone]?.[responseLength] || baseResponses.friendly_casual.moderate;
  
  // Add offer mention if configured
  if (config.promotions?.autoMentionActiveOffers) {
    return `${response} ${config.promotions.highlightDiscounts ? 'By the way, we have some great offers running right now!' : ''}`;
  }
  
  return response;
}

function generatePricingResponse(
  tone: string,
  responseLength: string,
  config: Partial<WhatsAppBotUIConfig>
): string {
  const baseResponses: Record<string, Record<string, string>> = {
    friendly_casual: {
      brief: "Prices vary by product. Which item are you interested in?",
      moderate: "Our prices vary depending on the product. I'd be happy to provide specific pricing for any items you're interested in. What would you like to know more about?",
      detailed: "We offer competitive pricing across our product range. Prices vary based on the specific product, quantity, and any applicable promotions. I'd be delighted to provide you with detailed pricing information for any items you're interested in. Which products would you like pricing for?",
    },
  };
  
  const response = baseResponses[tone]?.[responseLength] || baseResponses.friendly_casual.moderate;
  
  // Add offer mention if configured
  if (config.promotions?.autoMentionActiveOffers) {
    return `${response} ${config.promotions.highlightDiscounts ? "We also have special discounts available - let me know if you'd like to hear about them!" : ''}`;
  }
  
  return response;
}

function generateOrderResponse(
  tone: string,
  responseLength: string,
  config: Partial<WhatsAppBotUIConfig>
): string {
  const baseResponses: Record<string, Record<string, string>> = {
    friendly_casual: {
      brief: "Great! I'll help you place an order. What would you like?",
      moderate: "Excellent! I'd be happy to help you place an order. Could you tell me what products you'd like to order? I'll guide you through the process.",
      detailed: "That's wonderful! I'm here to help you place your order. To get started, could you please tell me which products you'd like to order and the quantities? I'll then guide you through the ordering process, which includes collecting your details and confirming the order before processing.",
    },
    professional_formal: {
      brief: "I can assist you with placing an order. Which products would you like?",
      moderate: "Thank you for your interest. I'd be happy to help you place an order. Could you please specify which products you'd like to order?",
      detailed: "Thank you for choosing us. I'm here to assist you with placing your order. Please let me know which products you'd like to order and the quantities. I'll guide you through the process, including order confirmation and payment details.",
    },
  };
  
  return baseResponses[tone]?.[responseLength] || baseResponses.friendly_casual.moderate;
}

function generateOrderStatusResponse(
  tone: string,
  responseLength: string,
  config: Partial<WhatsAppBotUIConfig>
): string {
  const baseResponses: Record<string, Record<string, string>> = {
    friendly_casual: {
      brief: "I'll check your order status. Can you share your order number?",
      moderate: "I'd be happy to help you check your order status. Could you please share your order number? I'll look it up for you.",
      detailed: "I'd be happy to help you check the status of your order. To look this up, I'll need your order number. Once you share it, I can provide you with the current status, expected delivery date, and any updates on your order.",
    },
    professional_formal: {
      brief: "I can check your order status. Please provide your order number.",
      moderate: "Thank you for contacting us. I can check your order status. Please provide your order number so I can assist you.",
      detailed: "Thank you for your inquiry. I can check the status of your order. Please provide your order number, and I'll retrieve the current status, shipping information, and expected delivery timeline for you.",
    },
  };
  
  return baseResponses[tone]?.[responseLength] || baseResponses.friendly_casual.moderate;
}

function generateComplaintResponse(
  tone: string,
  responseLength: string,
  config: Partial<WhatsAppBotUIConfig>
): string {
  const baseResponses: Record<string, Record<string, string>> = {
    friendly_casual: {
      brief: "I'm sorry to hear that. Let me help resolve this. Can you share more details?",
      moderate: "I'm sorry to hear about the issue. I'd like to help resolve this for you. Could you please share more details about what's not working?",
      detailed: "I'm sorry to hear you're experiencing an issue. I want to help resolve this for you. Could you please share more details about the problem? For example, what product is affected, when did you notice the issue, and any other relevant information? This will help me assist you better.",
    },
    professional_formal: {
      brief: "I apologize for the inconvenience. Please share details so I can assist.",
      moderate: "I apologize for the inconvenience. I'd like to help resolve this issue. Could you please provide more details about the problem?",
      detailed: "I sincerely apologize for the inconvenience. I'm here to help resolve this issue. Please provide details such as the product name, order number if applicable, a description of the problem, and when it occurred. This information will help me assist you effectively.",
    },
  };
  
  return baseResponses[tone]?.[responseLength] || baseResponses.friendly_casual.moderate;
}

function generateRefundResponse(
  tone: string,
  responseLength: string,
  config: Partial<WhatsAppBotUIConfig>
): string {
  const baseResponses: Record<string, Record<string, string>> = {
    friendly_casual: {
      brief: "I can help with that. Can you share your order number?",
      moderate: "I'd be happy to help you with a refund or return. Could you please share your order number and the reason?",
      detailed: "I understand you'd like a refund or return. I'm here to help. Could you please share your order number and let me know the reason for the return or refund? I'll guide you through the process.",
    },
    professional_formal: {
      brief: "I can assist with refunds/returns. Please provide your order number.",
      moderate: "I can assist you with a refund or return request. Please provide your order number and the reason for the return.",
      detailed: "I can assist you with your refund or return request. To process this, I'll need your order number and the reason for the return or refund. Please provide these details, and I'll guide you through the process according to our return policy.",
    },
  };
  
  return baseResponses[tone]?.[responseLength] || baseResponses.friendly_casual.moderate;
}

function generateDefaultResponse(
  tone: string,
  responseLength: string,
  config: Partial<WhatsAppBotUIConfig>
): string {
  const responses: Record<string, Record<string, string>> = {
    friendly_casual: {
      brief: "I'm here to help! What do you need?",
      moderate: "I'm here to assist you! Could you tell me a bit more about what you're looking for? I can help with products, pricing, orders, or any questions you have.",
      detailed: "I'm here to help you with anything you need! Whether you have questions about our products, services, pricing, placing orders, or anything else, I'm ready to assist. Please feel free to share more details about what you're looking for, and I'll provide you with the information you need.",
    },
  };
  
  return responses[tone]?.[responseLength] || responses.friendly_casual.moderate;
}

// ============================================================================
// 8. DEFAULT CONFIGURATION
// ============================================================================

/**
 * Get default WhatsApp bot configuration for preview
 */
export function getDefaultPreviewConfig(): Partial<WhatsAppBotUIConfig> {
  return {
    communicationStyle: {
      tone: 'friendly_casual',
      responseLength: 'moderate',
      useCustomerName: false,
    },
    businessType: {
      customerType: 'individual',
    },
    promotions: {
      autoMentionActiveOffers: true,
      highlightDiscounts: true,
      showExpiryDates: false,
    },
    customerExperience: {
      enableUpselling: false,
      upsellingStyle: 'subtle',
      personalizeForReturningCustomers: false,
      enableTimeBasedGreetings: false,
    },
  };
}
