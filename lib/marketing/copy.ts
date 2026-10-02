import { platformChat } from '@/lib/ai/platform-chat';
import type { MarketingBrief } from '@/lib/marketing/brief';
import { bannedClaimHit } from '@/lib/marketing/claims';

export type MarketingCopy = { headline: string; caption: string };

function fallbackCopy(brief: MarketingBrief, angle: string): MarketingCopy {
  const headline = (angle || brief.offer || 'GST billing on your phone').slice(0, 40);
  const caption = [brief.offer, brief.audience ? `For ${brief.audience}.` : '', angle]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
  return { headline, caption: caption || headline };
}

function parseCopy(raw: string, brief: MarketingBrief, angle: string): MarketingCopy {
  const cleaned = raw.replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, '')).trim();
  const [first, ...rest] = cleaned.split(/\n+/);
  const headline = (first || '').replace(/^headline:\s*/i, '').trim().slice(0, 80);
  const caption = rest.join('\n').replace(/^caption:\s*/i, '').trim().slice(0, 500);
  if (!headline || !caption) return fallbackCopy(brief, angle);
  return { headline, caption };
}

export async function writeMarketingCopy(brief: MarketingBrief, angle: string): Promise<MarketingCopy> {
  const system = [
    'You write short Facebook and Instagram posts for Khatario, a GST billing app for Indian shopkeepers.',
    'First line is a headline of at most 40 characters.',
    'Then a blank line, then the caption in plain language, at most 300 characters.',
    'No hashtags, no quotes around the whole post, and no special symbols.',
    brief.bannedClaims ? `Never use these claims: ${brief.bannedClaims}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const prompt = [
    `Audience: ${brief.audience || 'shopkeepers'}`,
    `Offer: ${brief.offer || 'GST invoices and khata'}`,
    angle ? `Angle: ${angle}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await platformChat(system, prompt);
    const copy = parseCopy(raw, brief, angle);
    if (bannedClaimHit(`${copy.headline}\n${copy.caption}`, brief.bannedClaims)) {
      return fallbackCopy(brief, angle);
    }
    return copy;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message !== 'KHATARIO_AI_UNAVAILABLE' && message !== 'KHATARIO_AI_FAILED') {
      console.warn('[marketing-copy] falling back:', message.slice(0, 200));
    }
    return fallbackCopy(brief, angle);
  }
}
