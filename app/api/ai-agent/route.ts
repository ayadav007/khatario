import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import {
  loadAgentSettings,
  loadBusinessProfileBasics,
  loadProviderSummary,
  loadSavedAgentSettings,
  saveAgentSettings,
} from '@/lib/ai-agent/settings';
import { khatarioAvailable, loadUsage } from '@/lib/ai-agent/billing';
import { knowledgeReady } from '@/lib/ai-agent/knowledge-status';
import { loadShopFacts } from '@/lib/ai-agent/shop-facts';
import { goLiveChecklist, normalizeAgentSettings, validateAgentSettings } from '@/lib/ai-agent/types';

export const dynamic = 'force-dynamic';

async function snapshot(businessId: string) {
  const [saved, settings, provider, usage, ready, profile, facts] = await Promise.all([
    loadSavedAgentSettings(businessId),
    loadAgentSettings(businessId),
    loadProviderSummary(businessId, khatarioAvailable),
    loadUsage(businessId),
    knowledgeReady(businessId),
    loadBusinessProfileBasics(businessId),
    loadShopFacts(businessId),
  ]);
  return {
    settings,
    saved: !!saved,
    ...facts,
    businessName: profile?.name ?? '',
    companyIntroduction: profile?.company_introduction ?? '',
    provider,
    usage,
    knowledgeReady: ready,
    checklist: goLiveChecklist(settings, provider, ready),
  };
}

/** GET /api/ai-agent — settings, provider summary (never the key), usage and go-live checklist. */
export const GET = withWhatsAppPremiumApi({ module: 'whatsapp', action: 'read' }, async ({ businessId }) => {
  try {
    return NextResponse.json(await snapshot(businessId));
  } catch (error) {
    console.error('[ai-agent] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load AI agent' }, { status: 500 });
  }
});

/** PUT /api/ai-agent — save behaviour settings. `{ settings, completeSetup? }` */
export const PUT = withWhatsAppPremiumApi(
  { module: 'whatsapp', action: 'update', parseJsonBody: true },
  async ({ businessId, userId, body }) => {
    try {
      const input = (body ?? {}) as { settings?: unknown; completeSetup?: boolean };
      const settings = normalizeAgentSettings(input.settings);
      const errors = validateAgentSettings(settings);
      if (errors.length) {
        return NextResponse.json({ error: errors[0].message, errors }, { status: 400 });
      }
      await saveAgentSettings(businessId, settings, userId, { completeSetup: input.completeSetup === true });
      return NextResponse.json(await snapshot(businessId));
    } catch (error) {
      console.error('[ai-agent] PUT failed:', error);
      return NextResponse.json({ error: 'Failed to save AI agent' }, { status: 500 });
    }
  },
);
