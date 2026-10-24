import { queryOne } from '@/lib/db';
import { ragConfig } from './config';
import type { Channel } from './types';

export interface PlatformAssistantSettings {
  channels: Partial<Record<Channel, boolean>>;
}

const DEFAULTS: PlatformAssistantSettings = { channels: { web: true, signup: true, trial_app: true, in_app: true, whatsapp: true } };

let cache: { value: PlatformAssistantSettings; at: number } | null = null;
const CACHE_MS = 30_000;

export async function getPlatformAssistantSettings(): Promise<PlatformAssistantSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value = DEFAULTS;
  try {
    const row = await queryOne<{ settings: PlatformAssistantSettings }>(
      `SELECT settings FROM assistant_settings WHERE scope = 'platform'`,
    );
    if (row?.settings) value = { ...DEFAULTS, ...row.settings, channels: { ...DEFAULTS.channels, ...row.settings.channels } };
  } catch {
    // Table missing before migration 302: behave as defaults.
  }
  cache = { value, at: Date.now() };
  return value;
}

export async function savePlatformAssistantSettings(next: PlatformAssistantSettings): Promise<void> {
  await queryOne(
    `INSERT INTO assistant_settings (scope, settings, updated_at) VALUES ('platform', $1::jsonb, NOW())
     ON CONFLICT (scope) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`,
    [JSON.stringify(next)],
  );
  cache = null;
}

export async function isChannelEnabled(channel: Channel): Promise<boolean> {
  if (!ragConfig().enabled) return false;
  const settings = await getPlatformAssistantSettings();
  return settings.channels[channel] === true;
}

let budgetCache: { used: number; at: number } | null = null;

/** Tokens spent today (IST) on platform audiences. Cached briefly so each turn doesn't scan. */
export async function tokensUsedToday(): Promise<number> {
  if (budgetCache && Date.now() - budgetCache.at < 60_000) return budgetCache.used;
  const row = await queryOne<{ used: string | null }>(
    `SELECT COALESCE(SUM(m.tokens_in + m.tokens_out), 0)::bigint AS used
       FROM kb_messages m
       JOIN kb_conversations c ON c.id = m.conversation_id
      WHERE m.created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
        AND c.audience <> 'tenant_customer'`,
  );
  const used = Number(row?.used ?? 0);
  budgetCache = { used, at: Date.now() };
  return used;
}

export async function withinDailyBudget(): Promise<boolean> {
  const budget = ragConfig().dailyTokenBudget;
  if (budget <= 0) return true;
  return (await tokensUsedToday()) < budget;
}
