import { query, queryOne } from '@/lib/db';
import { loadLeadAnswers } from './leads';
import {
  CHAT_NAME_FIELD,
  cleanOrderLineName,
  isChargeLine,
  parseCreateOrderTag,
  parseCustomerTag,
  saveChatCustomerName,
  saveCollectedCustomerDetails,
  stripOrderTags,
  type AgentOrderLine,
  type CollectedCustomerDetails,
} from './order-items';

export interface AgentMemoryItem {
  name: string;
  quantity?: number;
}

export interface AgentMemoryFacts {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  items: AgentMemoryItem[];
}

/** Facts and a rolling summary kept for the whole WhatsApp chat with this number. */
export interface AgentMemory {
  summary: string;
  facts: AgentMemoryFacts;
  leadAnswers: Record<string, string>;
}

export interface MemoryTurn {
  userMessage: string;
  assistantReply?: string;
  priorMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  customerTag?: CollectedCustomerDetails | null;
  leadData?: Record<string, string>;
  orderLines?: AgentOrderLine[] | null;
}

const SUMMARY_MAX = 1800;
const TURN_CLIP = 240;
const ITEM_LIMIT = 8;

const NOT_A_NAME =
  /^(looking|interested|from|here|trying|going|searching|asking|calling|waiting|ready|not|just|also|still|very|really|good|fine|ok|okay|happy|sorry|ordering|buying|wanting)\b/i;

const NAME_STOP = new Set([
  'hi', 'hello', 'hey', 'ok', 'okay', 'yes', 'no', 'yeah', 'yep', 'nope', 'thanks', 'thank you',
  'sure', 'fine', 'good', 'haan', 'nahi', 'ji', 'hmm', 'price', 'order', 'help', 'menu', 'ha',
]);

export function emptyAgentMemory(): AgentMemory {
  return { summary: '', facts: { items: [] }, leadAnswers: {} };
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function cleanName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const name = value
    .replace(/\s+(hai|hu|hoon|hun|here|please|thanks)$/i, '')
    .replace(/[.!,].*$/, '')
    .trim();
  const words = name.split(/\s+/).slice(0, 4).join(' ');
  if (words.length < 2 || words.length > 40) return undefined;
  if (/[0-9@]/.test(words)) return undefined;
  if (!/^[\p{L}][\p{L} .'-]*$/u.test(words)) return undefined;
  if (NAME_STOP.has(words.toLowerCase())) return undefined;
  return words;
}

function lastAssistant(prior?: Array<{ role: 'user' | 'assistant'; content: string }>): string {
  if (!prior?.length) return '';
  for (let i = prior.length - 1; i >= 0; i--) {
    if (prior[i].role === 'assistant' && prior[i].content.trim()) return prior[i].content;
  }
  return '';
}

function askedFor(prior: string, topic: RegExp): boolean {
  return topic.test(prior);
}

function extractName(message: string, asked: boolean, tagName?: string): string | undefined {
  const fromTag = cleanName(tagName);
  if (fromTag) return fromTag;
  const intro = message.match(
    /(?:my name is|mera naam(?:\s+hai)?|मेरा नाम|call me|i am|i'm|this is)\s+([\p{L}][\p{L} .'-]{1,60})/iu,
  );
  if (intro) {
    const matched = intro[0];
    const weak = /^(?:i am|i'm|this is)\b/i.test(matched);
    const candidate = cleanName(intro[1]);
    if (candidate && !NOT_A_NAME.test(candidate)) {
      const extraClause = /\b(for|to|a|the|some|your|price|order|about)\b/i.test(message);
      if (!weak || (!extraClause && candidate.split(/\s+/).length <= 3)) return candidate;
    }
  }
  if (!asked) return undefined;
  return cleanName(message.replace(/[.!]+$/, ''));
}

function extractEmail(message: string, asked: boolean, tag?: string): string | undefined {
  if (tag && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tag)) return tag.toLowerCase();
  const match = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (!match) return undefined;
  const email = match[0].toLowerCase();
  if (asked || message.trim().length < 60 || /\b(my email|email is|email:|mail is)\b/i.test(message)) return email;
  return undefined;
}

function normalizePhone(raw: string): string | undefined {
  const digits = raw.replace(/[^\d+]/g, '');
  if (!/^\+?\d{10,13}$/.test(digits)) return undefined;
  return digits;
}

function extractPhone(message: string, asked: boolean): string | undefined {
  const explicit = message.match(
    /(?:my )?(?:phone|mobile|contact|whatsapp)(?: number)?\s*(?:is|:)?\s*(\+?\d[\d\s-]{8,18}\d)/i,
  );
  if (explicit) return normalizePhone(explicit[1]);
  if (!asked) return undefined;
  if (message.trim().length > 24) return undefined;
  return normalizePhone(message);
}

function extractAddress(message: string, asked: boolean, tag?: string): string | undefined {
  if (tag && tag.trim().length >= 8) return clip(tag, 180);
  const explicit =
    message.match(/(?:my )?address(?: is|:)?\s+(.{10,180})/i) ||
    message.match(/(?:deliver(?:y)? to|ship to)\s+(.{10,180})/i);
  if (explicit) return clip(explicit[1], 180);
  if (!asked) return undefined;
  const text = message.trim();
  if (text.length < 12 || text.length > 200) return undefined;
  if (/\d{6}/.test(text) || text.includes(',')) return text;
  return undefined;
}

function extractInterest(message: string): AgentMemoryItem | null {
  const match = message.match(
    /\b(?:i(?:'d| would)? like|i want|i need|mujhe chahiye|order(?!\s+(?:number|no|id|status)\b))\s+(?:(\d+)\s+)?([A-Za-z][^,.!?\n]{2,40})/i,
  );
  if (!match) return null;
  let name = match[2].replace(/\s+(please|thanks)$/i, '').trim();
  if (/^(to|the|a|an|some|know|order|buy|this|that|it|more)\b/i.test(name)) return null;
  if (name.length < 3 || isChargeLine(name)) return null;
  const quantity = match[1] ? Number(match[1]) : undefined;
  return quantity ? { name, quantity } : { name };
}

function itemsFromLines(lines?: AgentOrderLine[] | null): AgentMemoryItem[] {
  if (!lines?.length) return [];
  const out: AgentMemoryItem[] = [];
  for (const line of lines) {
    const name = cleanOrderLineName(String(line?.name ?? ''));
    if (!name || isChargeLine(name)) continue;
    const quantity = Math.max(1, Number(line?.qty ?? line?.quantity ?? 1) || 1);
    out.push({ name, quantity });
  }
  return out;
}

function mergeItems(current: AgentMemoryItem[], incoming: AgentMemoryItem[]): AgentMemoryItem[] {
  const map = new Map<string, AgentMemoryItem>();
  for (const item of [...current, ...incoming]) {
    const key = item.name.toLowerCase();
    const prev = map.get(key);
    map.set(key, {
      name: item.name,
      quantity: item.quantity ?? prev?.quantity,
    });
  }
  return [...map.values()].slice(-ITEM_LIMIT);
}

function appendSummary(prev: string, user: string, assistant: string): string {
  const parts = [prev.trim()];
  if (user.trim()) parts.push(`Customer: ${clip(user, TURN_CLIP)}`);
  const reply = stripOrderTags(assistant);
  if (reply.trim()) parts.push(`Agent: ${clip(reply, TURN_CLIP)}`);
  let text = parts.filter(Boolean).join('\n');
  if (text.length <= SUMMARY_MAX) return text;
  text = text.slice(text.length - SUMMARY_MAX);
  const breakAt = text.indexOf('\n');
  return (breakAt >= 0 ? text.slice(breakAt + 1) : text).trim();
}

function cleanLead(data?: Record<string, string>): Record<string, string> {
  if (!data) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    const k = key.trim().slice(0, 40);
    const v = value.trim().slice(0, 200);
    if (!k || !v || k === CHAT_NAME_FIELD) continue;
    out[k] = v;
    if (Object.keys(out).length >= 12) break;
  }
  return out;
}

/** Facts learned from this turn. A missing CUSTOMER tag does not drop a name the customer wrote. */
export function factsFromTurn(turn: MemoryTurn): {
  facts: Partial<AgentMemoryFacts>;
  items: AgentMemoryItem[];
  leadAnswers: Record<string, string>;
} {
  const prior = lastAssistant(turn.priorMessages);
  const reply = turn.assistantReply ?? '';
  const tag = turn.customerTag === undefined ? parseCustomerTag(reply) : turn.customerTag;
  const orderLines = turn.orderLines === undefined ? parseCreateOrderTag(reply) : turn.orderLines;
  const askedName = askedFor(prior, /your name|may i know your name|have your name|naam/i);
  const askedPhone = askedFor(prior, /phone|mobile number|contact number/i);
  const askedEmail = askedFor(prior, /e-?mail/i);
  const askedAddress = askedFor(prior, /address|pincode|pin code|deliver/i);
  const name = extractName(turn.userMessage, askedName, tag?.name);
  const email = extractEmail(turn.userMessage, askedEmail, tag?.email);
  const phone = extractPhone(turn.userMessage, askedPhone);
  const address = extractAddress(turn.userMessage, askedAddress, tag?.address);
  const interest = extractInterest(turn.userMessage);
  const items = [...itemsFromLines(orderLines), ...(interest ? [interest] : [])];
  const facts: Partial<AgentMemoryFacts> = {};
  if (name) facts.name = name;
  if (email) facts.email = email;
  if (phone) facts.phone = phone;
  if (address) facts.address = address;
  return { facts, items, leadAnswers: cleanLead(turn.leadData) };
}

export function mergeAgentMemory(prev: AgentMemory, turn: MemoryTurn): AgentMemory {
  const learned = factsFromTurn(turn);
  return {
    summary: appendSummary(prev.summary, turn.userMessage, turn.assistantReply ?? ''),
    facts: {
      name: learned.facts.name ?? prev.facts.name,
      phone: learned.facts.phone ?? prev.facts.phone,
      email: learned.facts.email ?? prev.facts.email,
      address: learned.facts.address ?? prev.facts.address,
      items: mergeItems(prev.facts.items, learned.items),
    },
    leadAnswers: { ...prev.leadAnswers, ...learned.leadAnswers },
  };
}

/** Fold custom-field answers into memory. The chat name stays a fact, not a lead answer. */
export function applyStoredAnswers(memory: AgentMemory, fields: Record<string, string>): AgentMemory {
  const leadAnswers = { ...memory.leadAnswers };
  let name = memory.facts.name;
  for (const [key, value] of Object.entries(fields)) {
    const v = value.trim();
    if (!v) continue;
    if (key === CHAT_NAME_FIELD) {
      if (!name) name = v;
      continue;
    }
    if (!leadAnswers[key]) leadAnswers[key] = v;
  }
  return { ...memory, facts: { ...memory.facts, name }, leadAnswers };
}

export function combineMemory(base: AgentMemory, overlay: AgentMemory): AgentMemory {
  return {
    summary: overlay.summary.trim() || base.summary,
    facts: {
      name: overlay.facts.name || base.facts.name,
      phone: overlay.facts.phone || base.facts.phone,
      email: overlay.facts.email || base.facts.email,
      address: overlay.facts.address || base.facts.address,
      items: mergeItems(base.facts.items, overlay.facts.items),
    },
    leadAnswers: { ...base.leadAnswers, ...overlay.leadAnswers },
  };
}

/** Rebuild memory from messages already on screen (test chat, or the first live turn after this ships). */
export function memoryFromTranscript(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): AgentMemory {
  let memory = emptyAgentMemory();
  history.forEach((msg, index) => {
    if (msg.role !== 'user') return;
    const assistantReply = history.slice(index + 1).find((m) => m.role === 'assistant')?.content ?? '';
    const customerTag = parseCustomerTag(assistantReply);
    memory = mergeAgentMemory(memory, {
      userMessage: msg.content,
      assistantReply,
      priorMessages: history.slice(0, index),
      customerTag,
    });
  });
  return memory;
}

export function parseAgentMemory(raw: unknown): AgentMemory {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return emptyAgentMemory();
    }
  }
  if (!value || typeof value !== 'object') return emptyAgentMemory();
  const row = value as Partial<AgentMemory> & { facts?: Partial<AgentMemoryFacts> };
  const items = Array.isArray(row.facts?.items)
    ? row.facts.items
        .filter((item): item is AgentMemoryItem => !!item && typeof item.name === 'string' && item.name.trim().length > 0)
        .slice(-ITEM_LIMIT)
        .map((item) => ({
          name: item.name.trim().slice(0, 80),
          quantity: typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : undefined,
        }))
    : [];
  const leadAnswers: Record<string, string> = {};
  if (row.leadAnswers && typeof row.leadAnswers === 'object') {
    for (const [key, val] of Object.entries(row.leadAnswers)) {
      if (typeof val === 'string' && val.trim()) leadAnswers[key.slice(0, 40)] = val.trim().slice(0, 200);
    }
  }
  const fact = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  return {
    summary: typeof row.summary === 'string' ? row.summary.slice(0, SUMMARY_MAX) : '',
    facts: {
      name: fact(row.facts?.name, 80),
      phone: fact(row.facts?.phone, 20),
      email: fact(row.facts?.email, 120),
      address: fact(row.facts?.address, 180),
      items,
    },
    leadAnswers,
  };
}

/** Text placed in the prompt. Empty when this chat has nothing saved yet. */
export function formatMemoryBlock(memory: AgentMemory): string {
  const lines: string[] = [];
  const { facts } = memory;
  if (facts.name) lines.push(`Name: ${facts.name}`);
  if (facts.phone) lines.push(`Phone: ${facts.phone}`);
  if (facts.email) lines.push(`Email: ${facts.email}`);
  if (facts.address) lines.push(`Address: ${facts.address}`);
  if (facts.items.length) {
    lines.push(
      `Items discussed: ${facts.items
        .map((item) => (item.quantity ? `${item.name} x${item.quantity}` : item.name))
        .join(', ')}`,
    );
  }
  for (const [key, value] of Object.entries(memory.leadAnswers)) {
    if (value.trim()) lines.push(`${key}: ${value.trim()}`);
  }
  const summary = memory.summary.trim();
  if (!lines.length && !summary) return '';
  return [
    'CONVERSATION MEMORY (already known for this chat; never ask for these again):',
    lines.length ? lines.map((line) => `- ${line}`).join('\n') : '',
    summary ? `Earlier in this chat:\n${summary}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function loadAgentMemory(businessId: string, conversationId: string): Promise<AgentMemory> {
  const row = await queryOne<{ agent_memory: unknown }>(
    `SELECT agent_memory FROM whatsapp_conversations WHERE id = $1 AND business_id = $2`,
    [conversationId, businessId],
  ).catch(() => null);
  return parseAgentMemory(row?.agent_memory);
}

export async function saveAgentMemory(
  businessId: string,
  conversationId: string,
  memory: AgentMemory,
): Promise<void> {
  await query(
    `UPDATE whatsapp_conversations
        SET agent_memory = $3::jsonb, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND business_id = $2`,
    [conversationId, businessId, JSON.stringify(memory)],
  );
}

/**
 * Load this chat's memory, merge what was just said, and save it.
 * Also keeps the chat name and placeholder customer record in step with those facts.
 */
export async function rememberAgentTurn(
  businessId: string,
  conversationId: string,
  turn: MemoryTurn,
  opts: {
    customerId?: string | null;
    placeholderNames?: Array<string | null | undefined>;
    /** Prompt memory, including a summary rebuilt from recent messages when nothing is saved yet. */
    base?: AgentMemory;
  } = {},
): Promise<AgentMemory> {
  const [prev, fields] = await Promise.all([
    loadAgentMemory(businessId, conversationId),
    loadLeadAnswers(businessId, conversationId),
  ]);
  const loaded = applyStoredAnswers(prev, fields);
  const starting = opts.base ? combineMemory(opts.base, loaded) : loaded;
  const next = mergeAgentMemory(starting, turn);
  await saveAgentMemory(businessId, conversationId, next);
  if (next.facts.name) {
    await saveChatCustomerName(businessId, conversationId, next.facts.name).catch((err) =>
      console.error('[ai-agent] saving chat name from memory failed:', err),
    );
  }
  if (opts.customerId && (next.facts.name || next.facts.email || next.facts.address)) {
    await saveCollectedCustomerDetails(
      businessId,
      opts.customerId,
      { name: next.facts.name, email: next.facts.email, address: next.facts.address },
      opts.placeholderNames ?? [],
    ).catch((err) => console.error('[ai-agent] saving customer details from memory failed:', err));
  }
  return next;
}
