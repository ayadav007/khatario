import { query, queryOne } from '@/lib/db';
import { decryptSecret, encryptSecret } from '@/lib/secret-encryption';
import { DEFAULT_MARKETING_BRIEF, normalizeBrief, type MarketingBrief } from '@/lib/marketing/brief';

export type MarketingSecrets = {
  accessToken: string;
  pageId: string;
  instagramUserId: string;
  adAccountId: string;
  pixelId: string;
  brief: MarketingBrief;
};

export type MarketingPublicSettings = {
  has_access_token: boolean;
  page_id: string;
  instagram_user_id: string;
  ad_account_id: string;
  pixel_id: string;
  brief: MarketingBrief;
  missing: string[];
  ready_for_posts: boolean;
  ready_for_ads: boolean;
};

function decryptOptional(blob: string | null | undefined): string {
  if (!blob?.trim()) return '';
  try {
    return decryptSecret(blob).trim();
  } catch {
    return '';
  }
}

export function toPublicMarketingSettings(secrets: MarketingSecrets): MarketingPublicSettings {
  const missing: string[] = [];
  if (!secrets.accessToken) missing.push('Access token');
  if (!secrets.pageId) missing.push('Facebook Page id');
  if (!secrets.adAccountId) missing.push('Ad account id');
  const readyForPosts = Boolean(secrets.accessToken && secrets.pageId);
  const readyForAds = Boolean(readyForPosts && secrets.adAccountId && secrets.brief.landingUrl);
  return {
    has_access_token: Boolean(secrets.accessToken),
    page_id: secrets.pageId,
    instagram_user_id: secrets.instagramUserId,
    ad_account_id: secrets.adAccountId,
    pixel_id: secrets.pixelId,
    brief: secrets.brief,
    missing,
    ready_for_posts: readyForPosts,
    ready_for_ads: readyForAds,
  };
}

export async function loadMarketingSecrets(): Promise<MarketingSecrets> {
  const empty: MarketingSecrets = {
    accessToken: '',
    pageId: '',
    instagramUserId: '',
    adAccountId: '',
    pixelId: '',
    brief: DEFAULT_MARKETING_BRIEF,
  };
  try {
    const row = await queryOne<{
      encrypted_marketing_access_token: string | null;
      marketing_page_id: string | null;
      marketing_instagram_user_id: string | null;
      marketing_ad_account_id: string | null;
      marketing_pixel_id: string | null;
      marketing_brief: unknown;
    }>(
      `SELECT encrypted_marketing_access_token, marketing_page_id, marketing_instagram_user_id,
              marketing_ad_account_id, marketing_pixel_id, marketing_brief
       FROM platform_settings WHERE id = 'default'`,
    );
    if (!row) return empty;
    return {
      accessToken: decryptOptional(row.encrypted_marketing_access_token),
      pageId: row.marketing_page_id?.trim() || '',
      instagramUserId: row.marketing_instagram_user_id?.trim() || '',
      adAccountId: row.marketing_ad_account_id?.trim() || '',
      pixelId: row.marketing_pixel_id?.trim() || '',
      brief: normalizeBrief(row.marketing_brief),
    };
  } catch {
    return empty;
  }
}

export async function loadMarketingPixelId(): Promise<string> {
  try {
    const row = await queryOne<{ marketing_pixel_id: string | null }>(
      `SELECT marketing_pixel_id FROM platform_settings WHERE id = 'default'`,
    );
    return row?.marketing_pixel_id?.trim() || '';
  } catch {
    return '';
  }
}

export async function saveMarketingSettings(input: {
  access_token?: string;
  page_id: string;
  instagram_user_id: string;
  ad_account_id: string;
  pixel_id: string;
  brief: unknown;
}): Promise<MarketingPublicSettings> {
  const existing = await loadMarketingSecrets();
  const nextToken = input.access_token?.trim() || existing.accessToken;
  const brief = normalizeBrief(input.brief);
  const tokenCipher = input.access_token?.trim() ? encryptSecret(input.access_token.trim()) : null;

  await query(
    `INSERT INTO platform_settings (
       id, encrypted_marketing_access_token, marketing_page_id, marketing_instagram_user_id,
       marketing_ad_account_id, marketing_pixel_id, marketing_brief, updated_at
     ) VALUES ('default', $1, $2, $3, $4, $5, $6::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       encrypted_marketing_access_token = COALESCE($1, platform_settings.encrypted_marketing_access_token),
       marketing_page_id = EXCLUDED.marketing_page_id,
       marketing_instagram_user_id = EXCLUDED.marketing_instagram_user_id,
       marketing_ad_account_id = EXCLUDED.marketing_ad_account_id,
       marketing_pixel_id = EXCLUDED.marketing_pixel_id,
       marketing_brief = EXCLUDED.marketing_brief,
       updated_at = NOW()`,
    [
      tokenCipher,
      input.page_id.trim() || null,
      input.instagram_user_id.trim() || null,
      input.ad_account_id.trim() || null,
      input.pixel_id.trim() || null,
      JSON.stringify(brief),
    ],
  );

  return toPublicMarketingSettings({
    accessToken: nextToken,
    pageId: input.page_id.trim(),
    instagramUserId: input.instagram_user_id.trim(),
    adAccountId: input.ad_account_id.trim(),
    pixelId: input.pixel_id.trim(),
    brief,
  });
}
