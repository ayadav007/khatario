import type { RetrievedChunk } from './types';

export type LawSignal = 'strong' | 'topical' | 'none';

/** The user is explicitly asking what the law says. */
const STRONG = [
  /\b(section|sec\.?|rule|schedule)\s*\d{1,3}[a-z]{0,2}\b/i,
  /\b(c|s|i|ut)gst\s*(act|rules?)\b/i,
  /\bgst\s*(act|law|rules?|kanoon|niyam)\b/i,
  /\b(law|legal(ly)?|kanoo?n|kanooni|niyam|provision|statute|bare act|as per (the )?(act|law|rules?))\b/i,
  /\b(penalt(y|ies)|late fee|interest on|time limit|limitation|prosecution|offen[cs]e|jurmana)\b/i,
  /\b(who (is|are) liable|liable to (pay|register)|is it (mandatory|compulsory|required)|mandatory|compulsory|blocked credit|eligib(le|ility) (for|of) (itc|input tax credit|credit))\b/i,
];

/** GST concepts where the law may add useful context to a product answer. */
const TOPICAL = [
  /\b(input tax credit|itc|reverse charge|rcm|place of supply|time of supply|value of (taxable )?supply|aggregate turnover)\b/i,
  /\b(composition (scheme|levy|dealer|limit)|registration (limit|threshold)|threshold (limit)?|cancell?ation of registration|casual taxable|non-resident taxable)\b/i,
  /\b(zero[- ]rated|exempt(ed)? supply|export (of|under) lut|\blut\b|job work|isd|input service distributor|tds|tcs|e-?commerce operator)\b/i,
  /\b(credit note|debit note|bill of supply|tax invoice|e-?invoice|e-?way bill|annual return|gstr-?\s*9c?|refund|advance ruling|appeal|assessment|audit|demand notice|show cause)\b/i,
];

export function gstLawSignal(...texts: Array<string | null | undefined>): LawSignal {
  const text = texts.filter(Boolean).join(' ');
  if (!text) return 'none';
  if (STRONG.some((p) => p.test(text))) return 'strong';
  if (TOPICAL.some((p) => p.test(text))) return 'topical';
  return 'none';
}

/**
 * Question topics whose answer sits in a provision named for that topic. Keyword ranking alone lets
 * a common word win ("penalty for not issuing an invoice" pulls the invoice rules, not Section 122).
 */
const LAW_TOPICS: Array<{ question: RegExp; heading: RegExp }> = [
  // Headings must be *about* the topic: "Refund of tax, interest, penalty…" lists it in passing.
  {
    question: /\b(penalt(y|ies)|fine[ds]?|jurmana|punish(ment|able)?|prosecution|offen[cs]es?)\b/i,
    heading: /offences and penalties|:\s*(general\s+)?penalt|penalty for|:\s*(punishment|prosecution)/i,
  },
  { question: /\blate fees?\b/i, heading: /late fee/i },
  { question: /\binterest\b|\bbyaj\b/i, heading: /:\s*interest\b|interest on delayed/i },
  { question: /\brefunds?\b/i, heading: /\brefunds?\b/i },
  { question: /\be-?way ?bills?\b/i, heading: /e-way bill/i },
  { question: /\b(register|registration)\b/i, heading: /\bregistration\b/i },
];

export const LAW_TOPIC_BOOST = 0.02;

/** Extra rank for a law chunk whose heading names the topic the question is about. */
export function lawTopicBoost(question: string, headingPath: string): number {
  return LAW_TOPICS.some((t) => t.question.test(question) && t.heading.test(headingPath)) ? LAW_TOPIC_BOOST : 0;
}

/**
 * Merge Khatario guide chunks with GST law chunks. Explicit law questions lead with the law;
 * otherwise the product guide leads and the law only adds context.
 */
export function mergeWithLaw(
  guide: RetrievedChunk[],
  law: RetrievedChunk[],
  signal: LawSignal,
  topK: number,
): RetrievedChunk[] {
  const tagged = law.map((c) => ({ ...c, corpus: 'law' as const }));
  if (signal === 'strong') return [...tagged.slice(0, 3), ...guide].slice(0, topK);
  if (signal === 'topical') return [...guide.slice(0, Math.max(topK - 2, 1)), ...tagged.slice(0, 2)].slice(0, topK);
  return tagged.slice(0, 3);
}

export function hasLawSources(chunks: RetrievedChunk[]): boolean {
  return chunks.some((c) => c.corpus === 'law');
}
