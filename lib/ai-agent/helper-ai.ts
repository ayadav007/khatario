import { resolveAgentProvider } from '@/lib/services/ai-provider-factory';
import { recordTrialReply } from './billing';

export class HelperAiError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const REASON_MESSAGE: Record<string, string> = {
  not_configured: 'Set up how your agent is powered first (Advanced section).',
  no_key: 'Add your API key in the Advanced section first.',
  trial_exhausted: 'Your free Khatario AI replies are used up. Get the Khatario AI add-on or use your own key.',
  quota_exhausted: "This month's Khatario AI replies are used up.",
  live_needs_addon: 'Khatario AI needs the add-on.',
  disabled: 'The AI agent is switched off.',
};

/** One editor helper call (suggest FAQs or questions) on the shop's agent provider. */
export async function helperCompletion(businessId: string, system: string, user: string): Promise<string> {
  const resolved = await resolveAgentProvider(businessId, { live: false, ignoreDisabled: true });
  if (!resolved.provider) {
    throw new HelperAiError(REASON_MESSAGE[resolved.reason] ?? 'AI is not available right now.', 402);
  }
  const res = await resolved.provider.chat([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);
  if (resolved.via === 'khatario_trial') await recordTrialReply(businessId);
  return res.content?.trim() ?? '';
}

/** Pull the first JSON array out of a model reply. */
export function parseJsonArray<T = unknown>(raw: string): T[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
