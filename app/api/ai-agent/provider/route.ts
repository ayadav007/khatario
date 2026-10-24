import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import {
  loadProviderSummary,
  saveProvider,
  validateProviderPatch,
  type ProviderPatch,
} from '@/lib/ai-agent/settings';
import { khatarioAccess, khatarioAvailable } from '@/lib/ai-agent/billing';
import { getAIProviderFromConfig } from '@/lib/services/ai-provider-factory';

export const dynamic = 'force-dynamic';

function pickPatch(body: Record<string, unknown>): ProviderPatch {
  const p: ProviderPatch = {};
  if (body.keySource === 'own' || body.keySource === 'khatario') p.keySource = body.keySource;
  if (typeof body.provider === 'string') p.provider = body.provider;
  if (typeof body.apiKey === 'string') p.apiKey = body.apiKey;
  if (typeof body.apiBaseUrl === 'string') p.apiBaseUrl = body.apiBaseUrl.trim();
  if (typeof body.model === 'string') p.model = body.model.trim();
  if (body.temperature != null) p.temperature = Number(body.temperature);
  if (body.maxTokens != null) p.maxTokens = Number(body.maxTokens);
  if (typeof body.chatbotEnabled === 'boolean') p.chatbotEnabled = body.chatbotEnabled;
  if (typeof body.leadAnalyzerEnabled === 'boolean') p.leadAnalyzerEnabled = body.leadAnalyzerEnabled;
  if (body.mode === 'dev' || body.mode === 'prod') p.mode = body.mode;
  if (Array.isArray(body.devAllowedPhones)) p.devAllowedPhones = body.devAllowedPhones.map(String);
  if (typeof body.typingEnabled === 'boolean') p.typingEnabled = body.typingEnabled;
  if (body.typingDelaySeconds != null) p.typingDelaySeconds = Number(body.typingDelaySeconds);
  if (body.dailyLimit != null) p.dailyLimit = Number(body.dailyLimit);
  return p;
}

/**
 * PUT /api/ai-agent/provider — key source, provider and key (encrypted), model, AI on/off,
 * Test/Live mode, test numbers, typing delay and daily cap.
 */
export const PUT = withWhatsAppPremiumApi(
  { module: 'whatsapp', action: 'update', parseJsonBody: true },
  async ({ businessId, body }) => {
    try {
      const patch = pickPatch((body ?? {}) as Record<string, unknown>);
      const invalid = validateProviderPatch(patch);
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

      const current = await loadProviderSummary(businessId, khatarioAvailable);
      const keySource = patch.keySource ?? current.keySource;
      if (keySource === 'own' && !current.hasKey && !patch.apiKey?.trim() && (patch.keySource === 'own' || patch.mode === 'prod')) {
        return NextResponse.json({ error: 'Enter your API key' }, { status: 400 });
      }
      if (patch.mode === 'prod' && keySource === 'khatario') {
        const access = await khatarioAccess(businessId, { live: true });
        if (!access.ok) {
          return NextResponse.json(
            { error: 'Going live on Khatario AI needs the Khatario AI add-on.', code: 'KHATARIO_AI_REQUIRED' },
            { status: 402 },
          );
        }
      }

      await saveProvider(businessId, patch);
      return NextResponse.json({ provider: await loadProviderSummary(businessId, khatarioAvailable) });
    } catch (error) {
      console.error('[ai-agent] provider PUT failed:', error);
      const msg = error instanceof Error && /SECRETS_ENCRYPTION_KEY/.test(error.message)
        ? 'Server is missing SECRETS_ENCRYPTION_KEY, so API keys cannot be stored securely.'
        : 'Failed to save AI provider';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  },
);

/** POST /api/ai-agent/provider — check a key works before saving. `{ provider, apiKey, model?, apiBaseUrl? }` */
export const POST = withWhatsAppPremiumApi(
  { module: 'whatsapp', action: 'update', parseJsonBody: true },
  async ({ body }) => {
    const b = (body ?? {}) as Record<string, unknown>;
    const apiKey = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
    const provider = typeof b.provider === 'string' ? b.provider : 'groq';
    if (!apiKey) return NextResponse.json({ ok: false, error: 'Enter an API key to test' }, { status: 400 });
    const client = getAIProviderFromConfig({
      provider: provider as 'groq',
      apiKey,
      model: typeof b.model === 'string' && b.model ? b.model : undefined,
      apiBaseUrl: typeof b.apiBaseUrl === 'string' && b.apiBaseUrl ? b.apiBaseUrl : undefined,
      maxTokens: 20,
      temperature: 0,
    });
    if (!client) return NextResponse.json({ ok: false, error: 'Unsupported provider' }, { status: 400 });
    try {
      const res = await client.chat([{ role: 'user', content: 'Reply with the single word OK.' }]);
      return NextResponse.json({ ok: !!res.content?.trim() });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : 'Key test failed';
      return NextResponse.json({ ok: false, error: message });
    }
  },
);
