import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { loadProviderSummary, saveProvider, validateProviderPatch, type ProviderPatch } from '@/lib/ai-agent/settings';
import { khatarioAvailable } from '@/lib/ai-agent/billing';

export const dynamic = 'force-dynamic';

/** Legacy shape kept for one release; the AI Agent page uses /api/ai-agent. Never returns the key. */
export const GET = withWhatsAppPremiumApi({ module: 'whatsapp', action: 'read' }, async ({ businessId }) => {
  try {
    const p = await loadProviderSummary(businessId, khatarioAvailable);
    return NextResponse.json({
      config: {
        provider: p.provider,
        key_source: p.keySource,
        has_api_key: p.hasKey,
        api_key_last4: p.keyLast4,
        api_base_url: p.apiBaseUrl || null,
        model: p.model || null,
        chatbot_enabled: p.chatbotEnabled,
        lead_analyzer_enabled: p.leadAnalyzerEnabled,
        temperature: p.temperature,
        max_tokens: p.maxTokens,
        mode: p.mode,
        dev_allowed_phones: p.devAllowedPhones,
      },
    });
  } catch (error) {
    console.error('Error loading AI config:', error);
    return NextResponse.json({ error: 'Failed to load AI config' }, { status: 500 });
  }
});

export const POST = withWhatsAppPremiumApi(
  { module: 'whatsapp', action: 'update', parseJsonBody: true },
  async ({ businessId, body }) => {
    try {
      const b = (body ?? {}) as Record<string, any>;
      const patch: ProviderPatch = {
        provider: typeof b.provider === 'string' ? b.provider : undefined,
        apiKey: typeof b.apiKey === 'string' ? b.apiKey : undefined,
        apiBaseUrl: typeof b.apiBaseUrl === 'string' ? b.apiBaseUrl : undefined,
        model: typeof b.model === 'string' ? b.model : undefined,
        chatbotEnabled: typeof b.chatbotEnabled === 'boolean' ? b.chatbotEnabled : undefined,
        leadAnalyzerEnabled: typeof b.leadAnalyzerEnabled === 'boolean' ? b.leadAnalyzerEnabled : undefined,
        temperature: b.temperature != null ? Number(b.temperature) : undefined,
        maxTokens: b.maxTokens != null ? Number(b.maxTokens) : undefined,
        mode: b.mode === 'dev' || b.mode === 'prod' ? b.mode : undefined,
        devAllowedPhones: Array.isArray(b.devAllowedPhones) ? b.devAllowedPhones.map(String) : undefined,
      };
      const invalid = validateProviderPatch(patch);
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
      await saveProvider(businessId, patch);
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('Error saving AI config:', error);
      return NextResponse.json({ error: 'Failed to save AI config' }, { status: 500 });
    }
  },
);
