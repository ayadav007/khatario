// Lead Analyzer - AI-powered lead profiling and scoring
// Analyzes conversations to identify lead quality, behavior patterns, and purchase intent

import { getAIProvider, ChatMessage } from './ai-provider-factory';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface LeadAnalysisRequest {
  messages: ConversationMessage[];
  companyInfo?: {
    name: string;
    industry?: string;
  };
}

interface LeadAnalysisResponse {
  leadScore: number; // 0-100
  leadStatus: 'hot' | 'warm' | 'cold' | 'not_interested';
  interestLevel: 'high' | 'medium' | 'low' | 'none';
  behaviorTags: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  keyTopics: string[];
  purchaseIntent: number; // 0-100
  urgencyLevel: 'high' | 'medium' | 'low';
  aiSummary: string;
  insights: {
    priceSensitivity?: boolean;
    discountSeeking?: boolean;
    comparisonShopping?: boolean;
    urgentBuyer?: boolean;
    loyalCustomer?: boolean;
    specificConcerns?: string[];
    recommendedActions?: string[];
  };
}

export class LeadAnalyzer {
  async analyzeLead(
    businessId: string,
    request: LeadAnalysisRequest
  ): Promise<LeadAnalysisResponse | null> {
    const provider = await getAIProvider(businessId);
    if (!provider) {
      return null;
    }

    try {
      // Pre-filter: Check if conversation appears irrelevant before sending to AI
      const preCheck = this.preFilterIrrelevant(request);
      if (preCheck.isIrrelevant) {
        console.log('[LeadAnalyzer] Pre-filtered as irrelevant conversation:', preCheck.reason);
        return {
          leadScore: Math.min(preCheck.score || 15, 30), // Max 30 for irrelevant
          leadStatus: 'not_interested',
          interestLevel: 'none',
          behaviorTags: ['irrelevant_chat'],
          sentiment: 'neutral',
          keyTopics: ['irrelevant'],
          purchaseIntent: 5,
          urgencyLevel: 'low',
          aiSummary: `Conversation appears to be ${preCheck.reason}. No business-related context detected.`,
          insights: {
            priceSensitivity: false,
            discountSeeking: false,
            comparisonShopping: false,
            urgentBuyer: false,
            loyalCustomer: false,
            specificConcerns: [],
            recommendedActions: ['Determine if this is a valid business inquiry']
          }
        };
      }

      const prompt = this.buildAnalysisPrompt(request);
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: 'You are an expert sales analyst. Always respond with valid JSON only, no additional text. Be STRICT with scoring - irrelevant chats should score 0-30.'
        },
        {
          role: 'user',
          content: prompt
        }
      ];

      const response = await provider.chatJSON(messages);
      const parsed = this.parseResponse(response);
      
      // Post-process: Validate and clamp scores if they seem too high for low-engagement conversations
      return this.postProcessScore(parsed, request);
    } catch (error) {
      console.error('Lead Analyzer Error:', error);
      return null;
    }
  }

  private preFilterIrrelevant(request: LeadAnalysisRequest): { isIrrelevant: boolean; reason?: string; score?: number } {
    const allMessages = request.messages.map(m => m.content.toLowerCase()).join(' ');
    const customerMessages = request.messages
      .filter(m => m.role === 'user')
      .map(m => m.content.toLowerCase())
      .join(' ');

    // CRITICAL: Check for purchase intent FIRST - if present, NEVER mark as irrelevant
    const purchaseIntentPatterns = [
      /\b(want to buy|ready to buy|place order|make purchase|would like to purchase|like to buy)\b/i,
      /\b(want.*\d+.*bottles?|want.*\d+.*pieces?|want.*\d+.*units?|want.*\d+.*items?)\b/i, // "I want 5 bottles"
      /\b(interested.*purchase|interested.*buy|interested.*order)\b/i,
      /\b(give.*total.*price|calculate.*price|what.*total|how much.*total)\b/i,
      /\b(yes.*purchase|yes.*buy|yes.*order|confirm.*order|proceed.*order)\b/i,
      /\b(payment|pay|invoice|bill|delivery address)\b/i
    ];

    const hasPurchaseIntent = purchaseIntentPatterns.some(pattern => pattern.test(customerMessages));
    if (hasPurchaseIntent) {
      console.log('[LeadAnalyzer] Purchase intent detected - skipping irrelevant filter');
      return { isIrrelevant: false }; // NEVER mark as irrelevant if purchase intent detected
    }

    // Check for very short conversations (just greetings) - but ONLY if no purchase intent
    if (request.messages.length <= 2 && customerMessages.trim().length < 50) {
      const greetingWords = ['hi', 'hello', 'hey', 'good morning', 'good evening', 'namaste', 'namaskar'];
      const businessKeywords = /\b(product|price|order|buy|purchase|service|delivery|available|stock|cost|amount|want|need)\b/i;
      const isJustGreeting = greetingWords.some(word => customerMessages.includes(word)) && 
                             !businessKeywords.test(customerMessages);
      if (isJustGreeting) {
        return { isIrrelevant: true, reason: 'just greetings with no business context', score: 10 };
      }
    }

    // Check for common irrelevant patterns
    const irrelevantPatterns = [
      /\b(wrong number|wrong person|sorry wrong|not intended|not for me|you have.*wrong number)\b/i,
      /\b(spam|scam|fraud|cheat)\b/i,
      /^(\s*(hi|hello|hey)\s*)+$/i, // Only greetings, nothing else
    ];

    for (const pattern of irrelevantPatterns) {
      if (pattern.test(customerMessages)) {
        return { isIrrelevant: true, reason: 'wrong number or spam', score: 5 };
      }
    }

    // Check if there's any business/product/service related content
    const businessKeywords = [
      'product', 'service', 'price', 'cost', 'order', 'buy', 'purchase', 'delivery',
      'available', 'stock', 'quantity', 'payment', 'invoice', 'bill', 'catalog',
      'menu', 'offer', 'discount', 'deal', 'quote', 'quotation', 'want', 'need',
      'bottle', 'piece', 'item', 'unit', 'total', 'calculate'
    ];

    const hasBusinessContext = businessKeywords.some(keyword => 
      allMessages.includes(keyword.toLowerCase())
    );

    // If very short conversation and no business keywords, likely irrelevant
    // BUT: Only if we've already confirmed there's no purchase intent above
    if (request.messages.length <= 3 && !hasBusinessContext && customerMessages.length < 100) {
      return { isIrrelevant: true, reason: 'casual chat with no business context', score: 20 };
    }

    return { isIrrelevant: false };
  }

  private postProcessScore(
    response: LeadAnalysisResponse,
    request: LeadAnalysisRequest
  ): LeadAnalysisResponse {
    // Check for clear purchase intent in customer messages
    const customerMessages = request.messages
      .filter(m => m.role === 'user')
      .map(m => m.content.toLowerCase())
      .join(' ');

    const purchaseIntentKeywords = [
      'want to buy', 'ready to buy', 'place order', 'make purchase', 'would like to purchase',
      'want.*bottles', 'want.*pieces', 'want.*units', 'want.*items',
      'give.*total.*price', 'calculate.*price', 'what.*total', 'how much.*total',
      'yes.*purchase', 'yes.*buy', 'yes.*order', 'confirm.*order'
    ];

    const hasClearPurchaseIntent = purchaseIntentKeywords.some(pattern => {
      const regex = new RegExp(pattern, 'i');
      return regex.test(customerMessages);
    });

    // Count customer messages (actual engagement)
    const customerMessageCount = request.messages.filter(m => m.role === 'user').length;
    const totalMessageLength = request.messages
      .filter(m => m.role === 'user')
      .map(m => m.content.length)
      .reduce((a, b) => a + b, 0);

    // CRITICAL: If clear purchase intent detected, DO NOT clamp the score
    // Examples: "I want 5 bottles", "Yes I would like to purchase", "give me the total price"
    if (hasClearPurchaseIntent) {
      console.log('[LeadAnalyzer] Clear purchase intent detected - NOT clamping score');
      // Ensure minimum scores for purchase intent conversations
      if (response.leadScore < 60) {
        response.leadScore = Math.max(response.leadScore, 60);
      }
      if (response.purchaseIntent < 50) {
        response.purchaseIntent = Math.max(response.purchaseIntent, 50);
      }
      if (response.leadStatus === 'cold' || response.leadStatus === 'not_interested') {
        response.leadStatus = 'warm'; // Upgrade to at least warm
      }
      if (response.interestLevel === 'low' || response.interestLevel === 'none') {
        response.interestLevel = 'medium'; // Upgrade interest level
      }
      // Remove irrelevant_chat tag if present
      response.behaviorTags = response.behaviorTags.filter(tag => tag !== 'irrelevant_chat');
      // Add purchase_intent tag
      if (!response.behaviorTags.includes('purchase_intent')) {
        response.behaviorTags.push('purchase_intent');
      }
    }

    // If very low engagement (few messages, short content) AND no purchase intent, clamp the score
    if (customerMessageCount <= 2 && totalMessageLength < 50 && !hasClearPurchaseIntent) {
      // Cap at 40 for very short conversations unless explicitly high intent
      if (response.leadScore > 40 && response.purchaseIntent < 50) {
        response.leadScore = Math.min(response.leadScore, 40);
        if (response.leadStatus === 'warm' || response.leadStatus === 'hot') {
          response.leadStatus = 'cold';
        }
      }
    }

    // If marked as irrelevant in tags but score is high OR purchase intent detected, correct it
    if (response.behaviorTags.includes('irrelevant_chat')) {
      if (hasClearPurchaseIntent) {
        // Remove irrelevant tag if purchase intent is present
        response.behaviorTags = response.behaviorTags.filter(tag => tag !== 'irrelevant_chat');
        console.log('[LeadAnalyzer] Removed irrelevant_chat tag due to purchase intent');
      } else {
        // Only clamp if truly irrelevant (no purchase intent)
        response.leadScore = Math.min(response.leadScore, 30);
        response.purchaseIntent = Math.min(response.purchaseIntent, 20);
        if (response.leadStatus !== 'not_interested') {
          response.leadStatus = 'cold';
        }
      }
    }

    // Ensure consistency: if score is very low AND no purchase intent, other metrics should align
    if (response.leadScore < 30 && !hasClearPurchaseIntent) {
      response.purchaseIntent = Math.min(response.purchaseIntent, response.leadScore + 10);
      if (response.leadStatus === 'hot' || response.leadStatus === 'warm') {
        response.leadStatus = 'cold';
      }
      if (response.interestLevel === 'high') {
        response.interestLevel = 'low';
      }
    }

    return response;
  }

  private buildAnalysisPrompt(request: LeadAnalysisRequest): string {
    const conversationText = request.messages
      .map(msg => `${msg.role === 'user' ? 'Customer' : 'Business'}: ${msg.content}`)
      .join('\n');

    return `You are an expert sales and lead qualification analyst. Analyze the following WhatsApp conversation between a customer and ${request.companyInfo?.name || 'a business'} to determine lead quality, interest level, and behavior patterns.

**CRITICAL SCORING RULES - BE STRICT:**
- **Score 0-20**: Irrelevant chats (random greetings, casual conversation with no business context, spam, wrong number, just "hi/hello" with no follow-up, personal chat unrelated to business)
- **Score 21-40**: Casual inquiry (just asking "what do you sell" or "tell me about your company" without specific interest, one-time question with no engagement)
- **Score 41-60**: Basic interest (asked about products/services but no purchase intent, gathering information only, comparison shopping with no commitment)
- **Score 61-75**: Genuine interest (asking specific product questions, pricing details, availability, but not ready to buy yet)
- **Score 76-90**: Strong purchase intent (discussing order details, asking about payment, delivery options, ready to purchase but finalizing details)
- **Score 91-100**: Ready to buy NOW (explicitly asking to place order, providing payment info, urgent purchase need, ready to complete transaction)

**IMPORTANT**: If the conversation is just greetings, casual chat, irrelevant topics, or has no clear business/product/service context, the score MUST be below 30. Only score 70+ if there's genuine purchase intent or specific product/service inquiries.

Conversation:
${conversationText}

Analyze and provide:
1. **Lead Score (0-100)**: Overall quality score - BE STRICT. Use the scoring rules above. Irrelevant chats = 0-30.
2. **Lead Status**: 
   - hot: Ready to buy now, discussing order/payment details
   - warm: Shows genuine interest in products/services, asking specific questions
   - cold: Minimal interest, just browsing, or only casual inquiry
   - not_interested: Explicitly declined, wrong number, spam, or completely irrelevant conversation
3. **Interest Level**: 
   - high: Asking about specific products, pricing, ordering process
   - medium: General interest, gathering information
   - low: Casual inquiry, just browsing
   - none: No business-related interest, irrelevant chat
4. **Behavior Tags**: Identify patterns like:
   - price_sensitive: Frequently asks about prices, compares costs, negotiates
   - discount_seeker: Asks for discounts, deals, offers, promotions
   - urgent_buyer: Needs product/service urgently, time-sensitive requirement
   - comparison_shopper: Comparing with competitors, evaluating options
   - loyal_customer: Repeat customer, positive history, returning buyer
   - inquirer: Just gathering information, not ready to buy
   - complainer: Has complaints or issues, negative experience
   - irrelevant_chat: Conversation is not related to business/products/services
5. **Sentiment**: positive, neutral, negative
6. **Key Topics**: Main topics discussed (e.g., pricing, delivery, features, support, warranty, OR "irrelevant", "casual_chat", "greeting_only")
7. **Purchase Intent (0-100)**: How likely they are to make a purchase - BE CONSERVATIVE. Only 70+ if actively discussing purchase.
8. **Urgency Level**: high (wants to buy now), medium (interested, needs time), low (just browsing, no urgency)
9. **AI Summary**: 2-3 sentence summary - mention if conversation is irrelevant or has no business context
10. **Insights**: Specific observations and recommended actions - flag if conversation is irrelevant

**If the conversation is irrelevant (no business context, just greetings, casual chat, wrong number, spam), the leadScore MUST be 0-30, leadStatus MUST be "not_interested" or "cold", and purchaseIntent MUST be 0-20.**

Respond with JSON only:
{
  "leadScore": 25,
  "leadStatus": "cold",
  "interestLevel": "none",
  "behaviorTags": ["irrelevant_chat"],
  "sentiment": "neutral",
  "keyTopics": ["irrelevant"],
  "purchaseIntent": 5,
  "urgencyLevel": "low",
  "aiSummary": "Conversation appears to be irrelevant or casual chat with no business context.",
  "insights": {
    "priceSensitivity": false,
    "discountSeeking": false,
    "comparisonShopping": false,
    "urgentBuyer": false,
    "loyalCustomer": false,
    "specificConcerns": [],
    "recommendedActions": ["Determine if this is a valid business inquiry"]
  }
}`;
  }

  private parseResponse(response: any): LeadAnalysisResponse {
    try {
      return {
        leadScore: Math.max(0, Math.min(100, response.leadScore || 0)),
        leadStatus: this.validateLeadStatus(response.leadStatus),
        interestLevel: this.validateInterestLevel(response.interestLevel),
        behaviorTags: Array.isArray(response.behaviorTags) ? response.behaviorTags : [],
        sentiment: this.validateSentiment(response.sentiment),
        keyTopics: Array.isArray(response.keyTopics) ? response.keyTopics : [],
        purchaseIntent: Math.max(0, Math.min(100, response.purchaseIntent || 0)),
        urgencyLevel: this.validateUrgencyLevel(response.urgencyLevel),
        aiSummary: response.aiSummary || '',
        insights: response.insights || {}
      };
    } catch (error) {
      console.error('Error parsing lead analysis response:', error);
      throw new Error('Failed to parse AI response');
    }
  }

  private validateLeadStatus(status: string): 'hot' | 'warm' | 'cold' | 'not_interested' {
    const valid = ['hot', 'warm', 'cold', 'not_interested'];
    return valid.includes(status) ? status as any : 'cold';
  }

  private validateInterestLevel(level: string): 'high' | 'medium' | 'low' | 'none' {
    const valid = ['high', 'medium', 'low', 'none'];
    return valid.includes(level) ? level as any : 'low';
  }

  private validateSentiment(sentiment: string): 'positive' | 'neutral' | 'negative' {
    const valid = ['positive', 'neutral', 'negative'];
    return valid.includes(sentiment) ? sentiment as any : 'neutral';
  }

  private validateUrgencyLevel(level: string): 'high' | 'medium' | 'low' {
    const valid = ['high', 'medium', 'low'];
    return valid.includes(level) ? level as any : 'low';
  }
}
