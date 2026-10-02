import { query, queryOne, queryRows } from '@/lib/db';
import { assertWithinDailyCap, rupeesToPaise } from '@/lib/marketing/brief';
import { assertNoBannedClaims } from '@/lib/marketing/claims';
import { writeMarketingCopy } from '@/lib/marketing/copy';
import { readCreative, renderCreative } from '@/lib/marketing/creative';
import {
  MarketingGraphError,
  createAdCreative,
  createPausedAd,
  createPausedAdSet,
  createPausedCampaign,
  fetchAdInsights,
  fetchAdReview,
  resolveTargeting,
  setMetaStatus,
  uploadAdImage,
  type AdInsights,
  type ResolvedTargeting,
} from '@/lib/marketing/meta-graph';
import { loadMarketingSecrets } from '@/lib/marketing/settings';

export type MarketingAdStatus =
  | 'draft'
  | 'paused'
  | 'pending_review'
  | 'active'
  | 'rejected'
  | 'paused_by_rule'
  | 'failed';

export type MarketingAdRow = {
  id: string;
  name: string;
  headline: string;
  primary_text: string;
  image_path: string;
  daily_budget_paise: number;
  targeting: ResolvedTargeting | Record<string, unknown>;
  status: MarketingAdStatus;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  meta_creative_id: string | null;
  meta_ad_id: string | null;
  last_insights: AdInsights | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const AD_COLUMNS = `id, name, headline, primary_text, image_path, daily_budget_paise, targeting, status,
  meta_campaign_id, meta_adset_id, meta_creative_id, meta_ad_id, last_insights, last_error,
  created_by, created_at, updated_at`;

export async function listMarketingAds(): Promise<MarketingAdRow[]> {
  return queryRows<MarketingAdRow>(`SELECT ${AD_COLUMNS} FROM marketing_ads ORDER BY created_at DESC LIMIT 100`);
}

export async function generateMarketingAd(input: {
  adminId: string;
  angle: string;
  dailyBudgetRupees?: number;
}): Promise<MarketingAdRow> {
  const secrets = await loadMarketingSecrets();
  const rupees = input.dailyBudgetRupees && input.dailyBudgetRupees > 0
    ? input.dailyBudgetRupees
    : secrets.brief.dailyAdCapRupees;
  const paise = rupeesToPaise(rupees);
  assertWithinDailyCap(paise, secrets.brief.dailyAdCapRupees);
  const copy = await writeMarketingCopy(secrets.brief, input.angle.trim());
  assertNoBannedClaims(`${copy.headline}\n${copy.caption}`, secrets.brief.bannedClaims);
  const creative = await renderCreative(copy.headline);
  const row = await queryOne<MarketingAdRow>(
    `INSERT INTO marketing_ads (name, headline, primary_text, image_path, daily_budget_paise, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'draft', $6)
     RETURNING ${AD_COLUMNS}`,
    [`Khatario ${copy.headline}`.slice(0, 120), copy.headline, copy.caption, creative.imagePath, paise, input.adminId],
  );
  if (!row) throw new Error('Could not save the ad draft');
  return row;
}

async function loadAd(id: string): Promise<MarketingAdRow> {
  const row = await queryOne<MarketingAdRow>(`SELECT ${AD_COLUMNS} FROM marketing_ads WHERE id = $1`, [id]);
  if (!row) throw new Error('Ad not found');
  return row;
}

export async function updateMarketingAdDraft(input: {
  id: string;
  headline?: string;
  primaryText?: string;
  dailyBudgetRupees?: number;
}): Promise<MarketingAdRow> {
  const existing = await loadAd(input.id);
  if (existing.status !== 'draft' && existing.status !== 'failed') {
    throw new Error('Only a draft can be edited');
  }
  const secrets = await loadMarketingSecrets();
  const headline = input.headline?.trim() || existing.headline;
  const primary = input.primaryText?.trim() || existing.primary_text;
  assertNoBannedClaims(`${headline}\n${primary}`, secrets.brief.bannedClaims);
  const paise = input.dailyBudgetRupees ? rupeesToPaise(input.dailyBudgetRupees) : existing.daily_budget_paise;
  assertWithinDailyCap(paise, secrets.brief.dailyAdCapRupees);
  const row = await queryOne<MarketingAdRow>(
    `UPDATE marketing_ads
     SET headline = $2, primary_text = $3, daily_budget_paise = $4, updated_at = NOW()
     WHERE id = $1
     RETURNING ${AD_COLUMNS}`,
    [input.id, headline, primary, paise],
  );
  if (!row) throw new Error('Ad not found');
  return row;
}

async function saveAdProgress(id: string, patch: Partial<MarketingAdRow> & { status?: MarketingAdStatus; last_error?: string | null }): Promise<void> {
  await query(
    `UPDATE marketing_ads SET
       status = COALESCE($2, status),
       meta_campaign_id = COALESCE($3, meta_campaign_id),
       meta_adset_id = COALESCE($4, meta_adset_id),
       meta_creative_id = COALESCE($5, meta_creative_id),
       meta_ad_id = COALESCE($6, meta_ad_id),
       targeting = COALESCE($7::jsonb, targeting),
       last_error = $8,
       updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      patch.status ?? null,
      patch.meta_campaign_id ?? null,
      patch.meta_adset_id ?? null,
      patch.meta_creative_id ?? null,
      patch.meta_ad_id ?? null,
      patch.targeting ? JSON.stringify(patch.targeting) : null,
      patch.last_error === undefined ? null : patch.last_error,
    ],
  );
}

export async function createPausedMarketingAd(id: string): Promise<MarketingAdRow> {
  const secrets = await loadMarketingSecrets();
  if (!secrets.accessToken || !secrets.pageId || !secrets.adAccountId) {
    throw new Error('Add the token, Page id, and ad account id in Setup');
  }
  if (!secrets.brief.landingUrl) throw new Error('Add a landing URL in Setup');
  let ad = await loadAd(id);
  if (ad.status !== 'draft' && ad.status !== 'failed' && ad.status !== 'paused') {
    throw new Error('This ad has already been sent to Meta');
  }
  if (ad.meta_ad_id && ad.status === 'paused') return ad;
  assertWithinDailyCap(ad.daily_budget_paise, secrets.brief.dailyAdCapRupees);
  assertNoBannedClaims(`${ad.headline}\n${ad.primary_text}`, secrets.brief.bannedClaims);

  try {
    const targeting = await resolveTargeting(secrets.accessToken, {
      cities: secrets.brief.cities,
      interestKeywords: secrets.brief.interestKeywords,
      ageMin: secrets.brief.ageMin,
      ageMax: secrets.brief.ageMax,
    });
    let campaignId = ad.meta_campaign_id;
    if (!campaignId) {
      campaignId = await createPausedCampaign(secrets.accessToken, secrets.adAccountId, ad.name);
      await saveAdProgress(id, { meta_campaign_id: campaignId, targeting, last_error: null });
    }
    let adSetId = ad.meta_adset_id;
    if (!adSetId) {
      adSetId = await createPausedAdSet({
        token: secrets.accessToken,
        adAccountId: secrets.adAccountId,
        campaignId,
        name: ad.name,
        dailyBudgetPaise: ad.daily_budget_paise,
        targeting,
      });
      await saveAdProgress(id, { meta_adset_id: adSetId, targeting, last_error: null });
    }
    let creativeId = ad.meta_creative_id;
    if (!creativeId) {
      const bytes = await readCreative(ad.image_path);
      const imageHash = await uploadAdImage(secrets.accessToken, secrets.adAccountId, bytes);
      creativeId = await createAdCreative({
        token: secrets.accessToken,
        adAccountId: secrets.adAccountId,
        pageId: secrets.pageId,
        instagramUserId: secrets.instagramUserId,
        name: ad.name,
        headline: ad.headline,
        message: ad.primary_text,
        link: secrets.brief.landingUrl,
        imageHash,
      });
      await saveAdProgress(id, { meta_creative_id: creativeId, last_error: null });
    }
    let metaAdId = ad.meta_ad_id;
    if (!metaAdId) {
      metaAdId = await createPausedAd({
        token: secrets.accessToken,
        adAccountId: secrets.adAccountId,
        adSetId,
        creativeId,
        name: ad.name,
      });
    }
    await saveAdProgress(id, {
      status: 'paused',
      meta_campaign_id: campaignId,
      meta_adset_id: adSetId,
      meta_creative_id: creativeId,
      meta_ad_id: metaAdId,
      targeting,
      last_error: null,
    });
  } catch (error) {
    const message = error instanceof MarketingGraphError || error instanceof Error ? error.message : 'Meta rejected the ad';
    await query(`UPDATE marketing_ads SET status = 'failed', last_error = $2, updated_at = NOW() WHERE id = $1`, [
      id,
      message.slice(0, 500),
    ]);
    throw new Error(message);
  }
  return loadAd(id);
}

async function setDelivery(id: string, status: 'ACTIVE' | 'PAUSED', local: MarketingAdStatus): Promise<MarketingAdRow> {
  const secrets = await loadMarketingSecrets();
  if (!secrets.accessToken) throw new Error('Marketing token is missing');
  const ad = await loadAd(id);
  if (!ad.meta_campaign_id || !ad.meta_adset_id || !ad.meta_ad_id) {
    throw new Error('Create the paused ad in Meta before changing delivery');
  }
  await setMetaStatus(secrets.accessToken, ad.meta_campaign_id, status);
  await setMetaStatus(secrets.accessToken, ad.meta_adset_id, status);
  await setMetaStatus(secrets.accessToken, ad.meta_ad_id, status);
  await query(`UPDATE marketing_ads SET status = $2, last_error = NULL, updated_at = NOW() WHERE id = $1`, [id, local]);
  return loadAd(id);
}

export async function launchMarketingAd(id: string): Promise<MarketingAdRow> {
  const ad = await loadAd(id);
  if (ad.status === 'rejected') throw new Error('This ad was rejected. Create a new draft after changing the claim or image');
  if (ad.status !== 'paused' && ad.status !== 'paused_by_rule') {
    throw new Error('Only a paused ad can be launched');
  }
  return setDelivery(id, 'ACTIVE', 'active');
}

export async function pauseMarketingAd(id: string, local: MarketingAdStatus = 'paused'): Promise<MarketingAdRow> {
  return setDelivery(id, 'PAUSED', local);
}

function statusFromEffective(current: MarketingAdStatus, effective: string): MarketingAdStatus {
  const code = effective.toUpperCase();
  if (current === 'paused_by_rule' && (code === 'PAUSED' || code === 'CAMPAIGN_PAUSED' || code === 'ADSET_PAUSED')) {
    return 'paused_by_rule';
  }
  if (code === 'ACTIVE') return 'active';
  if (code === 'DISAPPROVED' || code === 'WITH_ISSUES') return 'rejected';
  if (code.includes('PENDING') || code === 'IN_PROCESS' || code === 'PREAPPROVED') return 'pending_review';
  if (code === 'PAUSED' || code === 'CAMPAIGN_PAUSED' || code === 'ADSET_PAUSED') return 'paused';
  return current;
}

export function shouldStopAd(insights: AdInsights, minSpend: number, maxCost: number): boolean {
  if (!(minSpend > 0) || !(maxCost > 0)) return false;
  if (insights.spend < minSpend) return false;
  if (insights.results <= 0) return true;
  return insights.spend / insights.results > maxCost;
}

export async function syncMarketingInsights(): Promise<{ synced: number; paused: number }> {
  const secrets = await loadMarketingSecrets();
  if (!secrets.accessToken) return { synced: 0, paused: 0 };
  const ads = await queryRows<MarketingAdRow>(
    `SELECT ${AD_COLUMNS} FROM marketing_ads
     WHERE meta_ad_id IS NOT NULL AND status <> 'draft'
     ORDER BY updated_at DESC
     LIMIT 20`,
  );
  let synced = 0;
  let paused = 0;
  for (const ad of ads) {
    if (!ad.meta_ad_id) continue;
    try {
      const [insights, review] = await Promise.all([
        fetchAdInsights(secrets.accessToken, ad.meta_ad_id, { datePreset: 'last_7d' }),
        fetchAdReview(secrets.accessToken, ad.meta_ad_id),
      ]);
      let status = statusFromEffective(ad.status, review.effective_status);
      let lastError = status === 'rejected' ? review.reason : null;
      if (status === 'active' && shouldStopAd(insights, secrets.brief.stopMinSpendRupees, secrets.brief.stopMaxCostPerResultRupees)) {
        if (ad.meta_campaign_id) await setMetaStatus(secrets.accessToken, ad.meta_campaign_id, 'PAUSED');
        if (ad.meta_adset_id) await setMetaStatus(secrets.accessToken, ad.meta_adset_id, 'PAUSED');
        await setMetaStatus(secrets.accessToken, ad.meta_ad_id, 'PAUSED');
        status = 'paused_by_rule';
        lastError = `Paused: cost per result crossed ₹${secrets.brief.stopMaxCostPerResultRupees} after ₹${secrets.brief.stopMinSpendRupees} spend`;
        paused += 1;
      }
      await query(
        `UPDATE marketing_ads
         SET status = $2, last_insights = $3::jsonb, last_error = $4, updated_at = NOW()
         WHERE id = $1`,
        [ad.id, status, JSON.stringify(insights), lastError],
      );
      synced += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Insights sync failed';
      await query(`UPDATE marketing_ads SET last_error = $2, updated_at = NOW() WHERE id = $1`, [ad.id, message.slice(0, 500)]);
    }
  }
  return { synced, paused };
}

export async function liveAdPerformance(since: string, until: string): Promise<Array<MarketingAdRow & { range_insights: AdInsights | null }>> {
  const secrets = await loadMarketingSecrets();
  const ads = await listMarketingAds();
  if (!secrets.accessToken) {
    return ads.map((ad) => ({ ...ad, range_insights: ad.last_insights }));
  }
  const rows = [];
  for (const ad of ads) {
    if (!ad.meta_ad_id) {
      rows.push({ ...ad, range_insights: null });
      continue;
    }
    try {
      const range_insights = await fetchAdInsights(secrets.accessToken, ad.meta_ad_id, { since, until });
      rows.push({ ...ad, range_insights });
    } catch {
      rows.push({ ...ad, range_insights: ad.last_insights });
    }
  }
  return rows;
}
