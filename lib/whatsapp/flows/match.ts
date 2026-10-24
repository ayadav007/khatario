import type { FlowDefinition, FlowTriggers } from './schema';
import { extractTriggers } from './schema';

function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function matchesHardPhrases(message: string, phrases: string[]): boolean {
  const t = norm(message);
  if (!t) return false;
  return phrases.some((p) => norm(p) === t);
}

export function matchesHardRegex(message: string, patterns: string[], caseSensitive = false): boolean {
  const original = message.trim();
  const flags = caseSensitive ? '' : 'i';
  for (const p of patterns) {
    try {
      if (new RegExp(p, flags).test(original)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export function isHardStartMatch(
  triggers: FlowTriggers,
  input: { text: string; isFirstMessage: boolean },
): boolean {
  if (input.isFirstMessage && triggers.firstMessage) return true;
  if (matchesHardPhrases(input.text, triggers.hardPhrases)) return true;
  if (matchesHardRegex(input.text, triggers.hardRegex, triggers.regexCaseSensitive)) return true;
  return false;
}

export function matchHardStart(
  definition: FlowDefinition,
  input: { text: string; isFirstMessage: boolean },
): boolean {
  return isHardStartMatch(extractTriggers(definition), input);
}

export type OptionMatch = { optionId: string } | null;

/** Match a button/list reply id, or typed title / 1-based index. */
export function matchOption(
  options: Array<{ id: string; title: string }>,
  input: { text: string; replyId?: string | null },
): OptionMatch {
  const reply = input.replyId?.trim();
  if (reply) {
    const byId = options.find((o) => o.id === reply);
    if (byId) return { optionId: byId.id };
  }
  const t = norm(input.text);
  if (!t) return null;
  const byTitle = options.find((o) => norm(o.title) === t);
  if (byTitle) return { optionId: byTitle.id };
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= options.length) {
    return { optionId: options[n - 1].id };
  }
  return null;
}

export function validateAsk(input: string, kind: 'text' | 'number' | 'phone' | 'email'): boolean {
  const t = input.trim();
  if (!t) return false;
  if (kind === 'text') return t.length <= 500;
  if (kind === 'number') return /^\d+([.]\d+)?$/.test(t);
  if (kind === 'phone') return t.replace(/\D/g, '').length >= 10;
  if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
  return false;
}
