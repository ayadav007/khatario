// Sales Agent Chatbot - AI-powered sales agent for WhatsApp conversations
// Acts as a professional sales representative with product knowledge

import { getAIProvider, ChatMessage } from './ai-provider-factory';
import { ProductDataService, ProductInfo } from './product-data-service';

interface SalesAgentRequest {
  message: string;
  companyInfo: {
    name: string;
    introduction?: string;
    industry?: string;
    businessType?: string;
    phone?: string;
    email?: string;
    address?: string;
  };
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
}

export class SalesAgentChatbot {
  private productService: ProductDataService;

  constructor() {
    this.productService = new ProductDataService();
  }

  async generateResponse(
    businessId: string,
    request: SalesAgentRequest
  ): Promise<string | null> {
    console.log('[Sales Agent] 🚀 Starting AI response generation for business:', businessId);
    const provider = await getAIProvider(businessId);
    if (!provider) {
      console.error('[Sales Agent] ❌ AI provider not configured or failed to initialize for business:', businessId);
      return null;
    }
    console.log('[Sales Agent] ✅ AI provider initialized successfully');

    try {
      // Detect if message is asking about products
      const productQuery = this.detectProductQuery(request.message);
      console.log('[Sales Agent] Product query detection:', {
        originalMessage: request.message,
        detectedQuery: productQuery
      });
      
      let productContext = '';
      if (productQuery) {
        // Search for products
        console.log('[Sales Agent] Searching products with query:', productQuery);
        const products = await this.productService.searchProducts(businessId, productQuery, 5);
        console.log('[Sales Agent] Products found:', products.length);
        if (products.length > 0) {
          productContext = `\n\nAvailable Products Matching "${productQuery}":\n${this.productService.formatProductsForAI(products)}`;
        } else {
          productContext = `\n\nNo products found matching "${productQuery}". You can suggest the customer to browse our catalog or ask for more details.`;
        }
      } else {
        // Include top products in context for general inquiries
        const topProducts = await this.productService.getTopProducts(businessId, 10);
        console.log('[Sales Agent] Using top products:', topProducts.length);
        if (topProducts.length > 0) {
          productContext = `\n\nOur Products/Services:\n${this.productService.formatProductsForAI(topProducts)}`;
        }
      }

      let systemPrompt = this.buildSalesAgentPrompt(request.companyInfo, productContext);
      if (request.retryAfterEmpty) {
        systemPrompt += `\n\nIMPORTANT: Your previous attempt produced no text. You MUST reply with at least one complete, helpful sentence addressing the customer's message. Never return an empty response.`;
      }
      const messages = this.buildMessages(
        systemPrompt, 
        request.message, 
        request.conversationHistory, 
        request.customerInfo,
        request.conversationState,
        request.pendingOrder
      );
      
      console.log('[Sales Agent] 📤 Sending request to AI provider:', {
        provider: provider.constructor.name,
        messageLength: request.message.length,
        historyLength: request.conversationHistory?.length || 0,
        hasProductContext: !!productContext
      });
      
      const response = await provider.chat(messages);
      
      console.log('[Sales Agent] ✅ AI provider responded:', {
        hasResponse: !!response,
        responseLength: response?.content?.length || 0,
        responsePreview: response?.content?.substring(0, 100) || 'NO RESPONSE'
      });
      
      return response.content;
    } catch (error) {
      console.error('[Sales Agent] ❌ Sales Agent Chatbot Error:', error);
      console.error('[Sales Agent] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        businessId
      });
      return null;
    }
  }

  /**
   * Detect if the message is asking about a specific product
   */
  private detectProductQuery(message: string): string | null {
    const lowerMessage = message.toLowerCase();
    
    // Keywords that indicate product inquiry
    const productKeywords = [
      'price of', 'cost of', 'how much', 'price for',
      'do you have', 'do you sell', 'available', 'stock',
      'product', 'item', 'service', 'catalog', 'menu'
    ];

    // Check if message contains product keywords
    const hasProductKeyword = productKeywords.some(keyword => lowerMessage.includes(keyword));
    
    if (!hasProductKeyword) {
      console.log('[Sales Agent] No product keyword found in:', message);
      return null;
    }

    // Try to extract product name
    // Remove common words and extract potential product name
    const words = message.split(/\s+/);
    const stopWords = ['the', 'a', 'an', 'is', 'are', 'do', 'you', 'have', 'sell', 'price', 'of', 'for', 'how', 'much', 'what', 'is', 'cost'];
    const productWords = words.filter(w => !stopWords.includes(w.toLowerCase()));
    
    if (productWords.length > 0) {
      // Return last 2-3 words as potential product name
      // Remove punctuation from the query for better matching
      const rawQuery = productWords.slice(-3).join(' ');
      const cleanedQuery = rawQuery.replace(/[?!.,;:()]/g, '').trim();
      
      console.log('[Sales Agent] Query extraction:', {
        originalWords: words,
        afterFilteringStopWords: productWords,
        rawQuery: rawQuery,
        cleanedQuery: cleanedQuery
      });
      
      return cleanedQuery;
    }

    console.log('[Sales Agent] Query extraction: No product words found');
    return null;
  }

  private buildSalesAgentPrompt(companyInfo: any, productContext: string): string {
    let prompt = `You are a professional sales agent and customer service representative for ${companyInfo.name || 'the company'}. Your role is to:
- Help customers with their inquiries
- Provide product/service information including prices and availability
- Answer questions about pricing, delivery, and features
- Qualify leads and understand customer needs
- Guide customers through the sales process
- Be friendly, professional, and helpful
- Close sales when appropriate

About the company:
${companyInfo.introduction || 'No company introduction provided.'}

${companyInfo.industry ? `Industry: ${companyInfo.industry}\n` : ''}
${companyInfo.businessType ? `Business Type: ${companyInfo.businessType}\n` : ''}

${productContext}

FINANCIAL & PAYMENT CAPABILITIES:
- You HAVE a built-in automated UPI payment system.
- You can generate secure payment links for any amount.
- To send a link, you MUST use the placeholder: [insert payment link].
- You MUST NOT tell customers to pay via manual bank transfer or that you don't have a link.
- You are authorized to take payments and confirm orders.

Contact Information:
${companyInfo.phone ? `- Phone: ${companyInfo.phone}\n` : ''}
${companyInfo.email ? `- Email: ${companyInfo.email}\n` : ''}
${companyInfo.address ? `- Address: ${companyInfo.address}\n` : ''}

Guidelines:
- Keep responses concise (2-3 sentences max for WhatsApp)
- Be conversational and natural
- When customers ask about products, provide the exact prices and stock availability from the product list above
- **IMPORTANT: When describing products to customers, ALWAYS use the product description field if available. The description contains detailed information about features, benefits, specifications, and usage that will help customers make informed decisions.**
- **When a customer asks "What is this product?", "Tell me about [product]", or "What are the features?", provide a comprehensive answer using the description field along with price and availability.**
- If asked about pricing, provide the exact selling price from the product information
- Use the customer's name if available
- Be proactive in understanding their requirements
- NEVER say you don't have a payment link or that you need to process manually.
- You ALWAYS have a UPI payment link available via the "[insert payment link]" placeholder.
- If a customer says "Yes", "Ok", "Online", or confirms they want to pay, you MUST provide the link.

ORDERING & PAYMENT PROCESS:
1. If a customer expresses interest in buying (e.g., "I want to buy 5 bottles", "Place an order for..."):
   - FIRST, ask for customer information BEFORE creating the order:
     * Name: "May I please have your name for the order?"
     * Phone: "Could you confirm your phone number for the order?"
     * Delivery Address: "Please provide your delivery address (full address with city, state, and pincode)"
   - DO NOT include the CREATE_ORDER tag until you have asked for and received customer information.
   - Summarize the items, quantities, and individual prices.
   - Calculate the total amount.
   - Only after collecting name, phone, and address, ask for confirmation: "Should I proceed with this order for a total of ₹X?"
2. When the customer confirms AFTER providing all details (e.g., "Yes", "Ok", "Online", "Send link"):
   - You MUST include the "CREATE_ORDER" tag at the end of your message.
   - You MUST include the exact placeholder "[insert payment link]" in your message.
   - Example: "Perfect! I've created your order. Total: ₹300. Please pay here: [insert payment link]. Share the screenshot once done! CREATE_ORDER: [{"name":"Hair Oil", "qty":1, "price":300}]"
3. The "CREATE_ORDER" tag is MANDATORY for the system to work, but ONLY use it:
   - AFTER collecting customer name, phone, and address
   - AFTER customer confirms they want to proceed
   - ONLY ONCE per order - never create duplicate orders
4. If you've already created an order in this conversation:
   - DO NOT include the CREATE_ORDER tag again
   - DO NOT create another order
   - Simply say "Your order has already been created. Here's the payment link: [insert payment link]"
   - Just use the placeholder "[insert payment link]" without the CREATE_ORDER tag
5. ALWAYS instruct them to send a screenshot after payment.
6. IMPORTANT: Check the conversation history - if you already mentioned creating an order, do NOT create another one. Just provide the payment link.
`;

    return prompt;
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

    // Add conversation state and context awareness
    let stateContext = '';
    if (conversationState?.state) {
      stateContext += `\nCURRENT CONVERSATION STATE: ${conversationState.state}\n`;
      
      // Add context-specific information based on state
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

    // Add pending order information (if any)
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

    // Add customer context if available
    if (customerInfo) {
      messages.push({
        role: 'system',
        content: `Customer Information: ${customerInfo.name ? `Name: ${customerInfo.name}. ` : ''}${customerInfo.previousOrders ? `Previous Orders: ${customerInfo.previousOrders}. ` : ''}${customerInfo.totalSpent ? `Total Spent: ₹${customerInfo.totalSpent}. ` : ''}`
      });
    }

    // Add conversation history (last 10 messages)
    if (history && history.length > 0) {
      const recentHistory = history.slice(-10);
      recentHistory.forEach(msg => {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        });
      });
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: userMessage
    });

    return messages;
  }
}
