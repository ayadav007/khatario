import type { WhatsAppBotUIConfig } from '@/types/whatsapp-bot-config';
import type { AgentSettings } from './types';

export interface AgentCompanyInfo {
  name: string;
  introduction?: string;
  industry?: string;
  businessType?: string;
  phone?: string;
  email?: string;
  address?: string;
}

/** Markers the model may append; whatsapp-crm acts on them and strips them before sending. */
export const HANDOFF_MARKER = 'HANDOFF_TO_HUMAN';
export const QUICK_REPLIES_TAG = 'QUICK_REPLIES:';
export const LEAD_DATA_TAG = 'LEAD_DATA:';

const TONE: Record<WhatsAppBotUIConfig['communicationStyle']['tone'], string> = {
  friendly_casual: 'Warm, upbeat and conversational, like a helpful shop assistant. A light emoji now and then is fine.',
  professional_formal: 'Polished, polite and professional. No slang and no emoji.',
  helpful_expert: 'Knowledgeable and reassuring. Explain clearly and recommend confidently.',
  efficient_direct: 'Short and to the point. Lead with the answer or the next action.',
};

const LENGTH: Record<WhatsAppBotUIConfig['communicationStyle']['responseLength'], string> = {
  brief: 'Keep replies to one or two short sentences.',
  moderate: 'Keep replies to two to four sentences (this is WhatsApp).',
  detailed: 'Replies can run to six or eight sentences when the customer needs detail, but never pad.',
};

const FIELD_LABEL: Record<string, string> = {
  price: 'price',
  stock: 'availability',
  description: 'description and features',
  specifications: 'specifications',
  ingredients: 'ingredients',
  sizes: 'sizes',
  colors: 'colours',
  dimensions: 'dimensions',
  warranty: 'warranty',
};

const INDUSTRY_LABEL: Record<string, string> = {
  retail: 'retail shop',
  wholesale: 'wholesale / B2B supplier',
  restaurant: 'restaurant or food business',
  services: 'service business',
  manufacturing: 'manufacturer',
};

function lines(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).join('\n');
}

/** Greeting for the shop's local time (India). Late night still gets "Good evening"; "Good night" is a goodbye. */
export function timeOfDayGreeting(now: Date = new Date()): { greeting: string; clock: string } {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(now));
  const clock = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(now);
  const greeting = hour >= 4 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : 'Good evening';
  return { greeting, clock };
}

function businessRules(b: WhatsAppBotUIConfig, now: Date): string {
  const out: string[] = [];
  const industry = b.advanced?.industryTemplate;
  if (industry && industry !== 'custom') out.push(`- The business is a ${INDUSTRY_LABEL[industry]}.`);
  const who = b.businessType.customerType;
  out.push(
    who === 'business'
      ? '- Customers are mostly businesses (B2B). Ask for the business name when taking orders and talk about bulk quantities.'
      : who === 'both'
        ? '- Customers are both individuals and businesses. Adjust to whoever you are talking to.'
        : '- Customers are mostly individual shoppers.',
  );
  if (b.businessType.requiresCreditTerms) out.push('- Registered business customers can buy on credit; say the team confirms credit terms.');
  if (b.businessType.minimumOrderAmount) out.push(`- Minimum order value is ₹${b.businessType.minimumOrderAmount}.`);

  const fields = b.productInfo.showFields.map((f) => FIELD_LABEL[f] ?? f);
  if (fields.length) out.push(`- When describing a product, share its ${fields.join(', ')} when known.`);
  if (!b.productInfo.showFields.includes('stock')) out.push('- Do not mention exact stock levels.');
  if (!b.productInfo.showOutOfStock) out.push('- Do not recommend items that are out of stock; suggest an available alternative.');
  if (b.productInfo.highlightBestSellers) out.push('- Mention popular or best-selling items when the customer is unsure.');

  if (b.promotions.autoMentionActiveOffers) out.push('- Mention a relevant active offer or discount if the shop information lists one.');
  if (b.promotions.showExpiryDates) out.push('- When you mention an offer, include its end date if known.');

  if (b.customerExperience.enableUpselling) {
    const style =
      b.customerExperience.upsellingStyle === 'aggressive'
        ? 'Suggest a complementary product in most replies about buying.'
        : b.customerExperience.upsellingStyle === 'moderate'
          ? 'Suggest one complementary product when the customer is about to order.'
          : 'Occasionally suggest a complementary product, only when it clearly helps.';
    out.push(`- ${style}`);
  } else {
    out.push('- Do not push extra products the customer did not ask about.');
  }
  if (b.customerExperience.personalizeForReturningCustomers) {
    out.push('- If the customer has ordered before, acknowledge it warmly.');
  }
  if (b.customerExperience.enableTimeBasedGreetings) {
    const { greeting, clock } = timeOfDayGreeting(now);
    out.push(
      `- It is now ${clock} in India. When you open a conversation, greet with "${greeting}" (never a different time of day); don't repeat the greeting later in the chat.`,
    );
  }

  const p = b.policies;
  if (p?.returnPolicy) out.push(`- Return policy: ${p.returnPolicy}`);
  if (p?.refundPolicy) out.push(`- Refund policy: ${p.refundPolicy}`);
  if (p?.shippingPolicy) out.push(`- Shipping policy: ${p.shippingPolicy}`);
  if (p?.cancellationPolicy) out.push(`- Cancellation policy: ${p.cancellationPolicy}`);
  return out.join('\n');
}

function orderingBlock(s: AgentSettings): string {
  if (!s.skills.takeOrders) {
    return lines(
      'ORDERS:',
      '- You do not take orders in chat. If the customer wants to buy, tell them how to order (visit the shop, online store or call) and offer to connect them to the team.',
    );
  }
  const o = s.behavior.orderingProcess;
  const ask: string[] = [];
  if (o.collectCustomerInfo.name) ask.push('* Name: "May I please have your name for the order?"');
  if (o.collectCustomerInfo.phone) ask.push('* Phone: "Could you confirm your phone number for the order?"');
  if (o.collectCustomerInfo.email) ask.push('* Email: "What email should we send the order confirmation to?"');
  if (o.collectCustomerInfo.address) ask.push('* Delivery Address: "Please share your full delivery address with city, state and pincode."');
  const collected = ask.length ? ask.map((a) => `     ${a}`).join('\n') : '     * (no details needed)';
  const tagKeys = [
    o.collectCustomerInfo.name ? '"name":"..."' : null,
    o.collectCustomerInfo.email ? '"email":"..."' : null,
    o.collectCustomerInfo.address ? '"address":"..."' : null,
  ].filter(Boolean);
  const pay = s.skills.paymentLinks;

  return lines(
    pay
      ? lines(
          'FINANCIAL & PAYMENT CAPABILITIES:',
          '- You HAVE a built-in automated UPI payment system and can generate secure payment links.',
          '- To send a link, you MUST use the placeholder: [insert payment link].',
          '- Never tell customers to pay by manual bank transfer and never say you have no link.',
        )
      : lines(
          'PAYMENT:',
          '- Do not send payment links. After the order is confirmed, say the team will share payment details shortly.',
        ),
    '',
    'ORDERING PROCESS:',
    '1. If a customer wants to buy:',
    '   - FIRST, collect these details BEFORE creating the order:',
    collected,
    '   - DO NOT include the CREATE_ORDER tag until you have the details above.',
    '   - Summarise items, quantities and individual prices, and calculate the total.',
    o.minimumQuantity ? `   - Minimum quantity per item is ${o.minimumQuantity}.` : null,
    o.allowBulkOrders ? null : '   - Only one unit per item per order.',
    o.requireConfirmation ? '   - Then ask: "Should I proceed with this order for a total of ₹X?"' : null,
    `2. When the customer confirms${o.requireConfirmation ? ' after giving all details' : ''}:`,
    '   - You MUST include the "CREATE_ORDER" tag at the end of your message.',
    pay ? '   - You MUST include the exact placeholder "[insert payment link]" in your message.' : null,
    pay
      ? '   - Example: "Perfect! I\'ve created your order. Total: ₹300. Please pay here: [insert payment link]. Share the screenshot once done! CREATE_ORDER: [{"name":"Hair Oil", "qty":1, "price":300}]"'
      : '   - Example: "Perfect! Your order is placed. Total: ₹300. Our team will share payment details shortly. CREATE_ORDER: [{"name":"Hair Oil", "qty":1, "price":300}]"',
    '   - In CREATE_ORDER list only products from the shop information, with "name" spelled exactly as listed there (no pack size, price or code added). Never put delivery charges, fees, taxes or discounts in CREATE_ORDER; mention them in the message only.',
    tagKeys.length
      ? `   - Right before CREATE_ORDER, add the details the customer gave as CUSTOMER: {${tagKeys.join(',')}} (only keys you actually have, exactly as the customer wrote them), e.g. CUSTOMER: {"name":"Asha Rao"} CREATE_ORDER: [...]`
      : null,
    '3. Use CREATE_ORDER only ONCE per order, never for an order that already exists.',
    pay
      ? '4. If an order already exists in this conversation, just say "Your order has already been created. Here\'s the payment link: [insert payment link]" without the CREATE_ORDER tag.'
      : '4. If an order already exists in this conversation, do not create another one.',
    pay ? '5. Ask them to send a screenshot after paying.' : null,
  );
}

function leadBlock(s: AgentSettings): string | null {
  const lead = s.leadSkill;
  if (!lead.enabled || !lead.questions.length) return null;
  const qs = lead.questions
    .map((q, i) => `${i + 1}. ${q.text}${q.required ? ' (required)' : ''} → field "${q.fieldKey}"`)
    .join('\n');
  return lines(
    'LEAD QUALIFICATION:',
    '- When a customer wants a quote, a call, a visit or bulk pricing, ask these questions one at a time, naturally, skipping any already answered:',
    qs,
    `- Whenever the customer answers one or more of them, add on a new last line: ${LEAD_DATA_TAG} {"field":"answer"} using the field names above. Only include answers the customer actually gave.`,
  );
}

/**
 * System prompt for the shop's WhatsApp agent, built from the owner's saved settings.
 * `knowledgeContext` is the retrieved shop information (catalogue, policies, FAQs).
 */
export function buildAgentPrompt(
  settings: AgentSettings,
  company: AgentCompanyInfo,
  knowledgeContext: string,
  now: Date = new Date(),
): string {
  const s = settings;
  const style = s.behavior.communicationStyle;
  const agentName = s.agentName.trim() || `${company.name || 'the shop'}'s assistant`;
  const summary = s.businessSummary.trim() || company.introduction?.trim() || 'No business description provided.';

  return lines(
    `You are ${agentName}, the WhatsApp sales and support assistant for ${company.name || 'the shop'}. You help customers with questions, products, prices, orders and order status.`,
    '',
    'ABOUT THE BUSINESS:',
    summary,
    company.industry ? `Industry: ${company.industry}` : null,
    company.businessType ? `Business type: ${company.businessType}` : null,
    '',
    'TONE AND LENGTH:',
    `- ${TONE[style.tone] ?? TONE.friendly_casual}`,
    `- ${LENGTH[style.responseLength] ?? LENGTH.moderate}`,
    style.useCustomerName ? "- Use the customer's name when you know it." : "- Don't address the customer by name.",
    style.useCustomerName && style.askNameEarly !== false
      ? lines(
          "- If no customer name is given to you below, answer the customer's message first and, in that same first reply, politely ask their name (e.g. \"May I know your name?\"). Ask only once; if they skip it, carry on and ask again only when taking an order. Never ask someone whose name you already know.",
          '- A WhatsApp profile name is only a hint: you may use it to greet if it is clearly a real first name, but still ask for their name once.',
        )
      : null,
    '- When the customer tells you their name, add on a new last line: CUSTOMER: {"name":"..."} exactly as they wrote it.',
    '- Reply in the language the customer writes in (English, Hindi or Hinglish).',
    '',
    'BUSINESS RULES:',
    businessRules(s.behavior, now),
    s.instructions.trim()
      ? lines('', "OWNER'S INSTRUCTIONS (always follow these, they override the rules above):", s.instructions.trim())
      : null,
    knowledgeContext ? `\n${knowledgeContext}` : null,
    '',
    'ACCURACY:',
    '- Answer only from the shop information above and this conversation. Use exact prices from the shop information.',
    "- If the answer isn't there, say you'll check with the team instead of guessing. Never invent products, prices, offers or policies.",
    "- Describe an item only with its name, category and description from the shop information. Never make up what an item is, what it is used for or which group it belongs to.",
    '- When asked for a kind of item (food, non-food, for hair, for kids…), group items by their listed category. If no category is listed, go by what the name plainly is in everyday knowledge (Parle-G is a biscuit, so it is food); if you are unsure, say you will check with the team.',
    "- If the customer corrects you, don't argue: thank them, accept it unless the shop information clearly says otherwise, and give the corrected answer.",
    s.skills.orderStatus
      ? "- For order status, use only the customer's own orders listed above."
      : "- You can't look up order status; offer to connect the customer to the team.",
    '',
    'CONTACT:',
    company.phone ? `- Phone: ${company.phone}` : null,
    company.email ? `- Email: ${company.email}` : null,
    company.address ? `- Address: ${company.address}` : null,
    '',
    orderingBlock(s),
    leadBlock(s) ? `\n${leadBlock(s)}` : null,
    s.handoff.enabled
      ? lines(
          '',
          'HANDOFF:',
          `- If the customer asks for a person, is upset, or you cannot help after one attempt, reply briefly that you're connecting them to the team and put ${HANDOFF_MARKER} on its own last line.`,
          '- Never hand off for a greeting, thanks or small talk; just reply normally and ask how you can help.',
        )
      : null,
    s.quickRepliesEnabled
      ? lines(
          '',
          'QUICK REPLIES:',
          `- When the question has a few natural answers (e.g. sizes, yes/no, options), you may add on the last line: ${QUICK_REPLIES_TAG} ["Option 1","Option 2"] with at most 3 short options (max 20 characters each).`,
        )
      : null,
  );
}

export interface ParsedAgentReply {
  text: string;
  handoff: boolean;
  quickReplies: string[];
  leadData: Record<string, string>;
}

/** Pull HANDOFF / QUICK_REPLIES / LEAD_DATA markers out of a model reply. */
export function parseAgentReply(raw: string): ParsedAgentReply {
  let text = raw;
  let handoff = false;
  let quickReplies: string[] = [];
  const leadData: Record<string, string> = {};

  if (text.includes(HANDOFF_MARKER)) {
    handoff = true;
    text = text.split(HANDOFF_MARKER).join('');
  }

  text = text.replace(/QUICK_REPLIES:\s*(\[[^\n]*\])/g, (_m, json: string) => {
    try {
      const arr = JSON.parse(json);
      if (Array.isArray(arr)) {
        quickReplies = arr
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.trim().slice(0, 20))
          .filter(Boolean)
          .slice(0, 3);
      }
    } catch {
      /* malformed: drop it */
    }
    return '';
  });

  text = text.replace(/LEAD_DATA:\s*(\{[^\n]*\})/g, (_m, json: string) => {
    try {
      const obj = JSON.parse(json);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj)) {
          if ((typeof v === 'string' || typeof v === 'number') && String(v).trim()) {
            leadData[k.slice(0, 40)] = String(v).trim().slice(0, 500);
          }
        }
      }
    } catch {
      /* malformed: drop it */
    }
    return '';
  });

  return {
    text: text.replace(/\n{3,}/g, '\n\n').trim(),
    handoff,
    quickReplies,
    leadData,
  };
}
