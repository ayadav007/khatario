import type { PeriodKey } from './period';
import type { ToolCall } from './tools';

/**
 * Keyword matcher for owner questions. Runs before the model (short WhatsApp commands like
 * "sales" or "dues") and is the whole router when no model key is configured.
 */

const PERIOD_PATTERNS: Array<[PeriodKey, RegExp]> = [
  ['yesterday', /\b(yesterday|kal\s+ki|kal\s+ka|kal\s+ke|kal)\b/i],
  ['last_week', /\b(last|pichh?le|pichh?la)\s+(week|hafte|hafta)\b/i],
  ['this_week', /\b(this|is)\s+(week|hafte|hafta)\b|\bweekly\b/i],
  ['last_month', /\b(last|pichh?le|pichh?la)\s+(month|mahine|mahina)\b/i],
  ['this_month', /\b(this|is)\s+(month|mahine|mahina)\b|\bmonthly\b|\bmonth\b/i],
  ['last_7_days', /\b(last|past|pichh?le)\s+7\s+days?\b/i],
  ['last_30_days', /\b(last|past|pichh?le)\s+30\s+days?\b/i],
  ['this_fy', /\b(this|is)\s+(year|saal|fy|financial\s+year)\b|\bfinancial\s+year\b|\byearly\b/i],
  ['today', /\b(today|aaj|aj|abhi\s+tak)\b/i],
];

export function detectPeriod(text: string): PeriodKey | null {
  for (const [key, re] of PERIOD_PATTERNS) if (re.test(text)) return key;
  return null;
}

const HOW_TO = /\b(how\s+(do|can|to|should)|kaise|kese|kaha(n)?|where\s+(is|do|can)|steps?|settings?|configure|enable|disable|setup|set\s+up)\b/i;
/** Weaker markers ("what is", "create") that lose to a period word or "my": "what is my sale today". */
const MAYBE_HOW_TO =
  /\b(what\s+(is|are|does)|kya\s+hota|meaning|explain|difference|create|add|delete|edit|print|export|download|import|record|enter|cancel|convert)\b/i;

/** "my sales", "mera udhaar": a question about their own figures even if it starts with "what is". */
const OWN_DATA = /\b(my|mera|meri|mere|hamara|hamari|our)\b/i;

type Rule = { tool: string; re: RegExp; defaultPeriod?: PeriodKey; args?: Record<string, unknown> };

/** Order matters: more specific questions first ("pending" before "sales"). */
const RULES: Rule[] = [
  { tool: 'daily_summary', re: /^\s*(summary|report|hisaab|hisab|status)\s*[.!?]*\s*$|\b(daily|business|day|din)\s+(summary|report)\b|\bhow\s+(is|was)\s+(the\s+)?(business|day)\b|\b(aaj|kal)\s+ka\s+(hisaab|hisab|summary)\b|\bkaisa\s+(raha|chal)\b/i },
  { tool: 'payables_due', re: /\b(payables?|pay\s+(to\s+)?suppliers?|suppliers?\s+(dues?|payments?|bills?|pending)|dena\s+hai|bills?\s+to\s+pay)\b/i },
  { tool: 'overdue_invoices', re: /\boverdue\b|\bunpaid\s+(bills?|invoices?)\b|\blate\s+payments?\b/i },
  { tool: 'top_debtors', re: /\b(pending|outstanding|udhaa?r|baaki|baki|owes?|owe\s+me|receivables?|dues?|lena|highest\s+(due|balance))\b/i },
  { tool: 'top_products', re: /\b(top|best|most|zyada)\b[^.?!]{0,30}\b(products?|items?|selling|sold|bik)\b|\bbest[\s-]?sell(ing|er)s?\b|\bfast[\s-]?moving\b/i, defaultPeriod: 'this_month' },
  { tool: 'top_customers', re: /\b(top|best|biggest|most|zyada)\b[^.?!]{0,30}\b(customers?|buyers?|clients?|grahak)\b/i, defaultPeriod: 'this_month' },
  { tool: 'low_stock', re: /\b(low|kam)\s+stock\b|\bstock\s+(kam|low|khatam)\b|\bout\s+of\s+stock\b|\breorder\b|\bstock\s+alerts?\b/i },
  { tool: 'gst_alerts', re: /\bgst\s+(alerts?|due|deadline|compliance|return\s+due)\b|\bgstr[-\s]?\w*\s+(due|deadline)\b|\bcompliance\b/i },
  { tool: 'payments_received', re: /\b(payments?\s+(received|aaya|aayi|aaye|came)|received\s+payments?|collections?|collected|cash\s+(received|aaya)|upi\s+(received|aaya)|kitna\s+aaya|paisa\s+aaya)\b/i },
  { tool: 'purchases_expenses', re: /\b(purchases?|kharid|khareed|expenses?|kharcha|kharche|spent|spend)\b/i },
  { tool: 'sales_summary', re: /\b(sales?|sold|sell|becha|bikri|bikaa?|revenue|turnover|business\s+kitna|kitna\s+business)\b/i },
];

export interface CommandMatch {
  calls: ToolCall[];
  /** True when the text looks like a how-to question rather than a data question. */
  howTo: boolean;
}

export function matchCommand(text: string): CommandMatch | null {
  const t = text.trim();
  if (!t) return null;
  const period = detectPeriod(t);
  const howTo = HOW_TO.test(t) || (MAYBE_HOW_TO.test(t) && !period && !OWN_DATA.test(t));
  for (const rule of RULES) {
    if (!rule.re.test(t)) continue;
    const args: Record<string, unknown> = { ...(rule.args ?? {}) };
    if (rule.tool === 'daily_summary') args.day = period === 'yesterday' ? 'yesterday' : 'today';
    else if (rule.tool === 'sales_summary' || rule.tool === 'payments_received' || rule.tool === 'purchases_expenses') {
      args.period = period ?? 'today';
    } else if (rule.defaultPeriod) args.period = period ?? rule.defaultPeriod;
    const top = t.match(/\btop\s+(\d{1,2})\b/i);
    if (top) args.limit = Math.min(10, Math.max(1, Number(top[1])));
    return { calls: [{ name: rule.tool, args }], howTo };
  }
  return null;
}

/** Short words that only mean "send me the summary" on WhatsApp. */
export function isSummaryCommand(text: string): boolean {
  return /^\s*(summary|report|hisaab|hisab|today|aaj)\s*[.!?]*\s*$/i.test(text);
}

export const OWNER_HELP_TEXT = [
  'You can ask me about your business, for example:',
  '- "How was sale today?" or "sales this month"',
  '- "Which customer has the highest pending amount?"',
  '- "Overdue invoices"',
  '- "Top products this month"',
  '- "Payments received yesterday"',
  '- "Supplier bills due this week"',
  '- "Low stock"',
  '- "GST alerts"',
  '- "Summary" for a one-screen view of the day',
].join('\n');
