import { query, queryOne } from '@/lib/db';
import { decryptSecret, encryptSecret } from '@/lib/secret-encryption';
import { dailyLimit } from '@/lib/whatsapp/customer-bot';
import {
  DEFAULT_AGENT_SETTINGS,
  MAX_TEST_NUMBERS,
  normalizeAgentSettings,
  type AgentKeySource,
  type AgentMode,
  type AgentProviderSummary,
  type AgentSettings,
} from './types';

interface AgentSettingsRow {
  agent_name: string | null;
  greeting_message: string | null;
  business_summary: string | null;
  instructions: string | null;
  behavior: unknown;
  fallback_message: string | null;
  after_hours_message: string | null;
  post_payment_message: string | null;
  handoff: unknown;
  lead_skill: unknown;
  skills: unknown;
  quick_replies_enabled: boolean | null;
  setup_completed_at: Date | string | null;
}

export interface ProviderRow {
  provider: string | null;
  api_key: string | null;
  api_key_encrypted: string | null;
  api_key_last4: string | null;
  key_source: AgentKeySource | null;
  api_base_url: string | null;
  model: string | null;
  temperature: string | number | null;
  max_tokens: number | null;
  chatbot_enabled: boolean | null;
  lead_analyzer_enabled: boolean | null;
  mode: AgentMode | null;
  dev_allowed_phones: unknown;
}

function rowToSettings(row: AgentSettingsRow): AgentSettings {
  return normalizeAgentSettings({
    agentName: row.agent_name ?? '',
    greetingMessage: row.greeting_message ?? '',
    businessSummary: row.business_summary ?? '',
    instructions: row.instructions ?? '',
    behavior: row.behavior,
    fallbackMessage: row.fallback_message ?? '',
    afterHoursMessage: row.after_hours_message ?? '',
    postPaymentMessage: row.post_payment_message ?? '',
    handoff: row.handoff,
    leadSkill: row.lead_skill,
    skills: row.skills,
    quickRepliesEnabled: row.quick_replies_enabled ?? false,
    setupCompletedAt: row.setup_completed_at ? new Date(row.setup_completed_at).toISOString() : null,
  });
}

/** Saved settings, or null when the shop has never saved the agent. */
export async function loadSavedAgentSettings(businessId: string): Promise<AgentSettings | null> {
  const row = await queryOne<AgentSettingsRow>(
    `SELECT agent_name, greeting_message, business_summary, instructions, behavior,
            fallback_message, after_hours_message, post_payment_message, handoff, lead_skill,
            skills, quick_replies_enabled, setup_completed_at
       FROM ai_agent_settings WHERE business_id = $1`,
    [businessId],
  ).catch(() => null);
  return row ? rowToSettings(row) : null;
}

export async function loadBusinessProfileBasics(
  businessId: string,
): Promise<{ name: string | null; company_introduction: string | null } | null> {
  return queryOne<{ name: string | null; company_introduction: string | null }>(
    `SELECT name, company_introduction FROM businesses WHERE id = $1`,
    [businessId],
  ).catch(() => null);
}

/** Settings for the runtime and editor: saved values, or defaults seeded from the business profile. */
export async function loadAgentSettings(businessId: string): Promise<AgentSettings> {
  const saved = await loadSavedAgentSettings(businessId);
  if (saved) return saved;
  const biz = await loadBusinessProfileBasics(businessId);
  return normalizeAgentSettings({
    ...DEFAULT_AGENT_SETTINGS,
    agentName: biz?.name ? `${biz.name} Assistant` : '',
    businessSummary: biz?.company_introduction ?? '',
  });
}

export async function saveAgentSettings(
  businessId: string,
  settings: AgentSettings,
  userId: string | null,
  opts: { completeSetup?: boolean } = {},
): Promise<AgentSettings> {
  const s = normalizeAgentSettings(settings);
  await query(
    `INSERT INTO ai_agent_settings (
        business_id, agent_name, greeting_message, business_summary, instructions, behavior,
        fallback_message, after_hours_message, post_payment_message, handoff, lead_skill, skills,
        quick_replies_enabled, setup_completed_at, updated_by, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13,
               CASE WHEN $14 THEN NOW() ELSE NULL END, $15, NOW())
     ON CONFLICT (business_id) DO UPDATE SET
        agent_name = EXCLUDED.agent_name,
        greeting_message = EXCLUDED.greeting_message,
        business_summary = EXCLUDED.business_summary,
        instructions = EXCLUDED.instructions,
        behavior = EXCLUDED.behavior,
        fallback_message = EXCLUDED.fallback_message,
        after_hours_message = EXCLUDED.after_hours_message,
        post_payment_message = EXCLUDED.post_payment_message,
        handoff = EXCLUDED.handoff,
        lead_skill = EXCLUDED.lead_skill,
        skills = EXCLUDED.skills,
        quick_replies_enabled = EXCLUDED.quick_replies_enabled,
        setup_completed_at = COALESCE(ai_agent_settings.setup_completed_at, EXCLUDED.setup_completed_at),
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()`,
    [
      businessId,
      s.agentName || null,
      s.greetingMessage || null,
      s.businessSummary || null,
      s.instructions || null,
      JSON.stringify(s.behavior),
      s.fallbackMessage || null,
      s.afterHoursMessage || null,
      s.postPaymentMessage || null,
      JSON.stringify(s.handoff),
      JSON.stringify(s.leadSkill),
      JSON.stringify(s.skills),
      s.quickRepliesEnabled,
      !!opts.completeSetup,
      userId,
    ],
  );
  return (await loadSavedAgentSettings(businessId)) ?? s;
}

export async function loadProviderRow(businessId: string): Promise<ProviderRow | null> {
  return queryOne<ProviderRow>(
    `SELECT provider, api_key, api_key_encrypted, api_key_last4, key_source, api_base_url, model,
            temperature, max_tokens, chatbot_enabled, lead_analyzer_enabled, mode, dev_allowed_phones
       FROM ai_provider_config WHERE business_id = $1`,
    [businessId],
  ).catch(async () =>
    // Before migration 347: no key_source / encrypted columns yet.
    queryOne<ProviderRow>(
      `SELECT provider, api_key, NULL AS api_key_encrypted, NULL AS api_key_last4, 'own' AS key_source,
              api_base_url, model, temperature, max_tokens, chatbot_enabled, lead_analyzer_enabled,
              mode, dev_allowed_phones
         FROM ai_provider_config WHERE business_id = $1`,
      [businessId],
    ).catch(() => null),
  );
}

/** Decrypted shop key: encrypted column first, legacy plain column as fallback. */
export function providerApiKey(row: ProviderRow | null): string | null {
  if (!row) return null;
  if (row.api_key_encrypted) {
    try {
      return decryptSecret(row.api_key_encrypted);
    } catch (err) {
      console.error('[ai-agent] could not decrypt provider key:', err instanceof Error ? err.message : err);
    }
  }
  return row.api_key?.trim() ? row.api_key : null;
}

function phones(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string' && p.length > 0) : [];
}

async function typingSettings(businessId: string): Promise<{ enabled: boolean; delay: number }> {
  const row = await queryOne<{ whatsapp_bot_typing_enabled: boolean | null; whatsapp_bot_typing_delay_seconds: number | null }>(
    `SELECT whatsapp_bot_typing_enabled, whatsapp_bot_typing_delay_seconds
       FROM business_settings WHERE business_id = $1`,
    [businessId],
  ).catch(() => null);
  return {
    enabled: !!row?.whatsapp_bot_typing_enabled,
    delay: row?.whatsapp_bot_typing_delay_seconds || 3,
  };
}

export async function loadProviderSummary(
  businessId: string,
  khatarioAvailable: (businessId: string) => Promise<boolean>,
): Promise<AgentProviderSummary> {
  const [row, typing, limit] = await Promise.all([
    loadProviderRow(businessId),
    typingSettings(businessId),
    dailyLimit(businessId),
  ]);
  const keySource: AgentKeySource = row?.key_source === 'khatario' ? 'khatario' : 'own';
  const hasKey = !!(row?.api_key_encrypted || row?.api_key?.trim());
  const configured = keySource === 'khatario' ? await khatarioAvailable(businessId) : hasKey;
  const keyLast4 = row?.api_key_last4 ?? (row?.api_key ? row.api_key.slice(-4) : null);
  return {
    keySource,
    provider: row?.provider || 'groq',
    model: row?.model || '',
    apiBaseUrl: row?.api_base_url || '',
    hasKey,
    keyLast4: hasKey ? keyLast4 : null,
    temperature: row?.temperature != null ? Number(row.temperature) : 0.7,
    maxTokens: row?.max_tokens || 500,
    chatbotEnabled: row ? row.chatbot_enabled !== false : false,
    leadAnalyzerEnabled: row ? row.lead_analyzer_enabled !== false : true,
    mode: row?.mode === 'prod' ? 'prod' : 'dev',
    devAllowedPhones: phones(row?.dev_allowed_phones).slice(0, MAX_TEST_NUMBERS),
    typingEnabled: typing.enabled,
    typingDelaySeconds: typing.delay,
    dailyLimit: limit,
    configured,
  };
}

export interface ProviderPatch {
  keySource?: AgentKeySource;
  provider?: string;
  /** New key; empty string or undefined keeps the saved key. */
  apiKey?: string;
  apiBaseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  chatbotEnabled?: boolean;
  leadAnalyzerEnabled?: boolean;
  mode?: AgentMode;
  devAllowedPhones?: string[];
  typingEnabled?: boolean;
  typingDelaySeconds?: number;
  dailyLimit?: number;
}

export const SUPPORTED_PROVIDERS = ['groq', 'openai', 'gemini', 'custom'] as const;

export function validateProviderPatch(p: ProviderPatch): string | null {
  if (p.keySource && p.keySource !== 'own' && p.keySource !== 'khatario') return 'Invalid key source';
  if (p.provider && !(SUPPORTED_PROVIDERS as readonly string[]).includes(p.provider)) return 'Unsupported provider';
  if (p.temperature != null && (!Number.isFinite(p.temperature) || p.temperature < 0 || p.temperature > 2)) {
    return 'Temperature must be between 0 and 2';
  }
  if (p.maxTokens != null && (!Number.isInteger(p.maxTokens) || p.maxTokens < 100 || p.maxTokens > 2000)) {
    return 'Max tokens must be between 100 and 2000';
  }
  if (p.typingDelaySeconds != null && (p.typingDelaySeconds < 1 || p.typingDelaySeconds > 10)) {
    return 'Typing delay must be between 1 and 10 seconds';
  }
  if (p.dailyLimit != null && (!Number.isInteger(p.dailyLimit) || p.dailyLimit < 0 || p.dailyLimit > 10000)) {
    return 'Daily reply cap must be between 0 and 10000';
  }
  if (p.mode && p.mode !== 'dev' && p.mode !== 'prod') return 'Invalid mode';
  if (p.provider === 'custom' && p.apiBaseUrl != null && p.apiBaseUrl && !/^https:\/\//i.test(p.apiBaseUrl)) {
    return 'Custom API base URL must start with https://';
  }
  return null;
}

export async function saveProvider(businessId: string, p: ProviderPatch): Promise<void> {
  const existing = await loadProviderRow(businessId);
  const newKey = p.apiKey?.trim() || null;
  const encrypted = newKey ? encryptSecret(newKey) : null;
  const normalizedPhones = p.devAllowedPhones
    ? p.devAllowedPhones.map((x) => String(x).replace(/\D/g, '')).filter((x) => x.length >= 10).slice(0, MAX_TEST_NUMBERS)
    : null;

  if (!existing) {
    await query(
      `INSERT INTO ai_provider_config (
          business_id, provider, api_key, api_key_encrypted, api_key_last4, key_source, api_base_url,
          model, temperature, max_tokens, chatbot_enabled, lead_analyzer_enabled, mode, dev_allowed_phones
       ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
      [
        businessId,
        p.provider || 'groq',
        encrypted,
        newKey ? newKey.slice(-4) : null,
        p.keySource || 'own',
        p.apiBaseUrl || null,
        p.model || null,
        p.temperature ?? 0.7,
        p.maxTokens ?? 500,
        p.chatbotEnabled ?? true,
        p.leadAnalyzerEnabled ?? true,
        p.mode || 'dev',
        JSON.stringify(normalizedPhones ?? []),
      ],
    );
  } else {
    await query(
      `UPDATE ai_provider_config SET
          provider = COALESCE($2, provider),
          api_key = CASE WHEN $3::text IS NOT NULL THEN NULL ELSE api_key END,
          api_key_encrypted = COALESCE($3, api_key_encrypted),
          api_key_last4 = COALESCE($4, api_key_last4),
          key_source = COALESCE($5, key_source),
          api_base_url = CASE WHEN $6::boolean THEN $7 ELSE api_base_url END,
          model = CASE WHEN $8::boolean THEN $9 ELSE model END,
          temperature = COALESCE($10, temperature),
          max_tokens = COALESCE($11, max_tokens),
          chatbot_enabled = COALESCE($12, chatbot_enabled),
          lead_analyzer_enabled = COALESCE($13, lead_analyzer_enabled),
          mode = COALESCE($14, mode),
          dev_allowed_phones = COALESCE($15::jsonb, dev_allowed_phones),
          updated_at = NOW()
        WHERE business_id = $1`,
      [
        businessId,
        p.provider ?? null,
        encrypted,
        newKey ? newKey.slice(-4) : null,
        p.keySource ?? null,
        p.apiBaseUrl !== undefined,
        p.apiBaseUrl || null,
        p.model !== undefined,
        p.model || null,
        p.temperature ?? null,
        p.maxTokens ?? null,
        p.chatbotEnabled ?? null,
        p.leadAnalyzerEnabled ?? null,
        p.mode ?? null,
        normalizedPhones ? JSON.stringify(normalizedPhones) : null,
      ],
    );
  }

  if (p.typingEnabled !== undefined || p.typingDelaySeconds !== undefined) {
    await query(
      `INSERT INTO business_settings (business_id, whatsapp_bot_typing_enabled, whatsapp_bot_typing_delay_seconds)
       VALUES ($1, COALESCE($2, false), COALESCE($3, 3))
       ON CONFLICT (business_id) DO UPDATE SET
         whatsapp_bot_typing_enabled = COALESCE($2, business_settings.whatsapp_bot_typing_enabled),
         whatsapp_bot_typing_delay_seconds = COALESCE($3, business_settings.whatsapp_bot_typing_delay_seconds),
         updated_at = CURRENT_TIMESTAMP`,
      [businessId, p.typingEnabled ?? null, p.typingDelaySeconds ?? null],
    );
  }

  if (p.dailyLimit !== undefined) {
    await patchBusinessAssistantSettings(businessId, { customerBotDailyLimit: p.dailyLimit });
  }
}

export async function getBusinessAssistantSettings(businessId: string): Promise<Record<string, unknown>> {
  const row = await queryOne<{ settings: Record<string, unknown> }>(
    `SELECT settings FROM assistant_settings WHERE scope = $1`,
    [`business:${businessId}`],
  ).catch(() => null);
  return row?.settings ?? {};
}

export async function patchBusinessAssistantSettings(
  businessId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await query(
    `INSERT INTO assistant_settings (scope, settings, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (scope) DO UPDATE SET settings = assistant_settings.settings || EXCLUDED.settings, updated_at = NOW()`,
    [`business:${businessId}`, JSON.stringify(patch)],
  );
}
