// Sales Agent Chatbot - AI-powered sales agent for WhatsApp conversations
// Acts as a professional sales representative with product knowledge

import { resolveAgentProvider, ChatMessage } from './ai-provider-factory';
import { ProductDataService } from './product-data-service';
import {
  customerBotAllowed,
  orderStatusContext,
  recordCustomerBotReply,
  shopKnowledgeContext,
} from '@/lib/whatsapp/customer-bot';
import { buildAgentPrompt, type AgentCompanyInfo } from '@/lib/ai-agent/prompt';
import { matchFaqs } from '@/lib/ai-agent/knowledge';
import { loadAgentSettings } from '@/lib/ai-agent/settings';
import { notifyQuotaExhaustedOnce, recordTrialReply } from '@/lib/ai-agent/billing';
import type { AgentSettings } from '@/lib/ai-agent/types';

export interface SalesAgentRequest {
  message: string;
  companyInfo: AgentCompanyInfo;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  customerInfo?: {
    name?: string;
    previousOrders?: number;
    totalSpent?: number;
  };
  conversationState?: {
    state?: string;
    context?: any;
  };
  pendingOrder?: {
    orderNumber?: string;
    items?: Array<{ name: string; quantity: number; price: number }>;
    totalAmount?: number;
    createdAt?: Date;
  };
  /** Second attempt after provider returned empty content — prompts model to answer non-empty */
  retryAfterEmpty?: boolean;
  /** Sender's WhatsApp number: order status is looked up only for this number. */
  customerPhone?: string;
  /** Real customers in Live mode (the Khatario AI trial covers Test mode only). */
  live?: boolean;
  /** Editor test chat: unsaved settings, no daily cap, nothing recorded as a customer reply. */
  test?: boolean;
  settingsOverride?: AgentSettings;
}

export type SalesAgentFailure =
  | 'daily_limit'
  | 'not_configured'
  | 'disabled'
  | 'no_key'
  | 'quota_exhausted'
  | 'trial_exhausted'
  | 'live_needs_addon'
  | 'empty'
  | 'error';

export interface SalesAgentResult {
  content: string | null;
  failure?: SalesAgentFailure;
  via?: 'own' | 'khatario_addon' | 'khatario_trial';
  /** Titles of the shop knowledge used (test chat shows them as source chips). */
  sources: string[];
  /** Provider error text on `failure: 'error'`; may name the upstream service, never shown to customers. */
  errorMessage?: string;
}

export class SalesAgentChatbot {
  private productService: ProductDataService;

  constructor() {
    this.productService = new ProductDataService();
  }

  /** Kept for existing callers: the reply text, or null on any failure. */
  async generateResponse(businessId: string, request: SalesAgentRequest): Promise<string | null> {
    return (await this.generate(businessId, request)).content;
  }

  async generate(businessId: string, request: SalesAgentRequest): Promise<SalesAgentResult> {
    if (!request.test && !(await customerBotAllowed(businessId))) {
      console.warn('[Sales Agent] Daily AI reply limit reached for business:', businessId);
      return { content: null, failure: 'daily_limit', sources: [] };
    }

    const resolved = await resolveAgentProvider(businessId, {
      live: !!request.live && !request.test,
      ignoreDisabled: !!request.test,
    });
    if (!resolved.provider) {
      console.warn('[Sales Agent] No AI provider for business:', businessId, resolved.reason);
      if (resolved.reason === 'quota_exhausted') await notifyQuotaExhaustedOnce(businessId);
      return { content: null, failure: resolved.reason, sources: [] };
    }

    try {
      const settings = request.settingsOverride ?? (await loadAgentSettings(businessId));
      const sources: string[] = [];
      let productContext = '';
      // The shop's indexed catalog, policies and FAQs (this business only). Until the first
      // index is built, fall back to the keyword product search below.
      const shopContext = await shopKnowledgeContext(businessId, request.message);
      if (shopContext) {
        productContext = `Shop information relevant to this message (products, prices, availability, policies, FAQs). Answer from this; if it isn't covered, say you'll check with the shop:\n${shopContext}`;
        for (const m of shopContext.matchAll(/^### (.+)$/gm)) sources.push(m[1].trim());
      } else {
        const productQuery = this.detectProductQuery(request.message);
        const showOut = settings.behavior.productInfo.showOutOfStock;
        let products = productQuery ? await this.productService.searchProducts(businessId, productQuery, 5) : [];
        if (!showOut) products = products.filter((p) => Number(p.currentStock) > 0);
        if (products.length) {
          productContext = `Available Products Matching "${productQuery}":\n${this.productService.formatProductsForAI(products)}`;
          sources.push('Product catalogue');
        } else {
          // Questions about a kind of product ("non-food items", "what do you sell") name no product,
          // so give the catalogue list rather than a "nothing matched" note the model fills in by guessing.
          const topProducts = await this.productService.getTopProducts(businessId, 30);
          if (topProducts.length > 0) {
            productContext = `Our Products/Services (the full list the shop has given you; use only the category and description shown, never guess what an item is):\n${this.productService.formatProductsForAI(topProducts)}`;
            sources.push('Product catalogue');
          }
        }
      }

      const faqs = await matchFaqs(businessId, request.message);
      if (faqs.length) {
        const block = faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');
        productContext = `The shop owner's FAQ answers for this question. If one matches, reply with that answer word for word (you may add a short greeting):\n${block}\n\n${productContext}`;
        sources.unshift(...faqs.map((f) => `FAQ: ${f.question.slice(0, 60)}`));
      }

      if (request.customerPhone && settings.skills.orderStatus) {
        const orders = await orderStatusContext(businessId, request.customerPhone, request.message);
        if (orders) {
          productContext += `\n\nThis customer's orders (looked up by their WhatsApp number; share only these, and include the order status link when there is one):\n${orders}`;
          sources.push('Orders');
        }
      }

      let systemPrompt = buildAgentPrompt(settings, request.companyInfo, productContext);
      if (request.retryAfterEmpty) {
        systemPrompt += `\n\nIMPORTANT: Your previous attempt produced no text. You MUST reply with at least one complete, helpful sentence addressing the customer's message. Never return an empty response.`;
      }
      const messages = this.buildMessages(
        systemPrompt,
        request.message,
        request.conversationHistory,
        settings.behavior.communicationStyle.useCustomerName || settings.behavior.customerExperience.personalizeForReturningCustomers
          ? request.customerInfo
          : undefined,
        request.conversationState,
        request.pendingOrder,
      );

      const response = await resolved.provider.chat(messages);
      const content = response?.content?.trim() ? response.content : null;
      if (content) {
        if (resolved.via === 'khatario_trial') await recordTrialReply(businessId);
        if (!request.test) await recordCustomerBotReply(businessId, request.customerPhone ?? '');
      }
      return { content, failure: content ? undefined : 'empty', via: resolved.via, sources: [...new Set(sources)] };
    } catch (error) {
      console.error('[Sales Agent] Sales Agent Chatbot Error:', {
        message: error instanceof Error ? error.message : String(error),
        businessId,
      });
      return {
        content: null,
        failure: 'error',
        via: resolved.via,
        sources: [],
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Detect if the message is asking about a specific product
   */
  private detectProductQuery(message: string): string | null {
    const lowerMessage = message.toLowerCase();

    const productKeywords = [
      'price of', 'cost of', 'how much', 'price for',
      'do you have', 'do you sell', 'available', 'stock',
      'product', 'item', 'service', 'catalog', 'menu'
    ];

    if (!productKeywords.some(keyword => lowerMessage.includes(keyword))) {
      return null;
    }

    const words = message.split(/\s+/);
    const stopWords = ['the', 'a', 'an', 'is', 'are', 'do', 'you', 'have', 'sell', 'price', 'of', 'for', 'how', 'much', 'what', 'is', 'cost'];
    const productWords = words.filter(w => !stopWords.includes(w.toLowerCase()));

    if (productWords.length > 0) {
      // Last 2-3 words are usually the product name
      return productWords.slice(-3).join(' ').replace(/[?!.,;:()]/g, '').trim();
    }
    return null;
  }

  private buildMessages(
    systemPrompt: string,
    userMessage: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    customerInfo?: any,
    conversationState?: { state?: string; context?: any },
    pendingOrder?: { orderNumber?: string; items?: Array<{ name: string; quantity: number; price: number }>; totalAmount?: number; createdAt?: Date }
  ): ChatMessage[] {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: systemPrompt
      }
    ];

    let stateContext = '';
    if (conversationState?.state) {
      stateContext += `\nCURRENT CONVERSATION STATE: ${conversationState.state}\n`;

      const context = conversationState.context || {};

      if (conversationState.state === 'waiting_customer_name') {
        stateContext += `You are currently collecting customer information:\n`;
        stateContext += `- Status: Waiting for customer name\n`;
        if (context.items && context.items.length > 0) {
          stateContext += `- Items being ordered: ${context.items.map((i: any) => `${i.name} x${i.quantity || 1}`).join(', ')}\n`;
        }
      } else if (conversationState.state === 'waiting_customer_phone') {
        stateContext += `You are currently collecting customer information:\n`;
        stateContext += `- Status: Waiting for customer phone number\n`;
        if (context.customer_name) {
          stateContext += `- Customer name collected: ${context.customer_name}\n`;
        }
        if (context.items && context.items.length > 0) {
          stateContext += `- Items being ordered: ${context.items.map((i: any) => `${i.name} x${i.quantity || 1}`).join(', ')}\n`;
        }
      } else if (conversationState.state === 'waiting_customer_address') {
        stateContext += `You are currently collecting customer information:\n`;
        stateContext += `- Status: Waiting for delivery address\n`;
        if (context.customer_name) {
          stateContext += `- Customer name: ${context.customer_name}\n`;
        }
        if (context.customer_phone) {
          stateContext += `- Customer phone: ${context.customer_phone}\n`;
        }
        if (context.items && context.items.length > 0) {
          stateContext += `- Items being ordered: ${context.items.map((i: any) => `${i.name} x${i.quantity || 1}`).join(', ')}\n`;
        }
      } else if (conversationState.state === 'waiting_confirm') {
        stateContext += `You are waiting for customer confirmation:\n`;
        if (context.items && context.items.length > 0) {
          stateContext += `- Items: ${context.items.map((i: any) => `${i.name} x${i.quantity || 1} @ ₹${i.price || 0}`).join(', ')}\n`;
          const total = context.items.reduce((sum: number, i: any) => sum + ((i.price || 0) * (i.quantity || 1)), 0);
          stateContext += `- Total: ₹${total}\n`;
        }
      } else if (conversationState.state !== 'idle') {
        stateContext += `- Additional context: ${JSON.stringify(context).substring(0, 200)}\n`;
      }
    }

    if (pendingOrder) {
      stateContext += `\n⚠️ PENDING ORDER EXISTS:\n`;
      stateContext += `- Order Number: ${pendingOrder.orderNumber || 'N/A'}\n`;
      if (pendingOrder.items && pendingOrder.items.length > 0) {
        stateContext += `- Items: ${pendingOrder.items.map(i => `${i.name} x${i.quantity}`).join(', ')}\n`;
      }
      if (pendingOrder.totalAmount) {
        stateContext += `- Total Amount: ₹${pendingOrder.totalAmount.toLocaleString('en-IN')}\n`;
      }
      if (pendingOrder.createdAt) {
        stateContext += `- Created: ${new Date(pendingOrder.createdAt).toLocaleString('en-IN')}\n`;
      }
      stateContext += `\nIMPORTANT INSTRUCTIONS FOR PENDING ORDER:\n`;
      stateContext += `- Do NOT create a new order. There is already a pending order waiting for payment.\n`;
      stateContext += `- If the customer asks about their order, refer to order number ${pendingOrder.orderNumber || 'the pending order'}.\n`;
      stateContext += `- If they want to pay, provide the payment link using [insert payment link] placeholder.\n`;
      stateContext += `- Do NOT use the CREATE_ORDER tag - the order already exists.\n`;
      stateContext += `- Focus on payment collection, order status, or order modifications only.\n`;
    }

    if (stateContext) {
      messages.push({
        role: 'system',
        content: stateContext.trim()
      });
    }

    if (customerInfo) {
      const who = customerInfo.name
        ? `Name: ${customerInfo.name}. `
        : `Customer name: not known yet.${customerInfo.profileName ? ` WhatsApp profile name (unconfirmed): ${customerInfo.profileName}.` : ''} `;
      messages.push({
        role: 'system',
        content: `Customer Information: ${who}${customerInfo.previousOrders ? `Previous Orders: ${customerInfo.previousOrders}. ` : ''}${customerInfo.totalSpent ? `Total Spent: ₹${customerInfo.totalSpent}. ` : ''}`.trim()
      });
    }

    if (history && history.length > 0) {
      history.slice(-10).forEach(msg => {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        });
      });
    }

    messages.push({
      role: 'user',
      content: userMessage
    });

    return messages;
  }
}
