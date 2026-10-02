/**
 * Marketing Graph client for Khatario's own Page and ad account.
 * Graph v25.0. Do not reuse the WhatsApp client.
 */

const GRAPH_VERSION = 'v25.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class MarketingGraphError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'MarketingGraphError';
  }
}

export type AdInsights = {
  impressions: number;
  reach: number;
  clicks: number;
  spend: number;
  ctr: number;
  cpc: number;
  results: number;
  result_action: string | null;
};

export type ResolvedTargeting = {
  age_min: number;
  age_max: number;
  countries: string[];
  cities: Array<{ key: string; name: string }>;
  interests: Array<{ id: string; name: string }>;
};

const RESULT_TYPES = [
  'offsite_conversion.fb_pixel_complete_registration',
  'omni_complete_registration',
  'complete_registration',
  'landing_page_view',
];

async function readGraph(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { error: { message: text.slice(0, 300) } };
  }
  const err = body.error as { message?: string; error_user_msg?: string } | undefined;
  if (!res.ok || err) {
    throw new MarketingGraphError(err?.error_user_msg || err?.message || `Meta request failed (${res.status})`, res.status);
  }
  return body;
}

async function graphJson(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown; search?: Record<string, string> },
): Promise<Record<string, unknown>> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  if (init?.search) {
    for (const [key, value] of Object.entries(init.search)) url.searchParams.set(key, value);
  }
  const res = await fetch(url, {
    method: init?.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(25_000),
  });
  return readGraph(res);
}

async function graphForm(token: string, path: string, form: FormData): Promise<Record<string, unknown>> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(40_000),
  });
  return readGraph(res);
}

export async function testMarketingConnection(input: {
  token: string;
  pageId: string;
  instagramUserId: string;
  adAccountId: string;
}): Promise<{
  page_name: string | null;
  instagram_name: string | null;
  ad_account_name: string | null;
  errors: string[];
}> {
  const errors: string[] = [];
  let page_name: string | null = null;
  let instagram_name: string | null = null;
  let ad_account_name: string | null = null;

  if (input.pageId) {
    try {
      const page = await graphJson(input.token, `/${input.pageId}`, { search: { fields: 'name' } });
      page_name = typeof page.name === 'string' ? page.name : null;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Page check failed');
    }
  }
  if (input.instagramUserId) {
    try {
      const ig = await graphJson(input.token, `/${input.instagramUserId}`, { search: { fields: 'username,name' } });
      instagram_name = (typeof ig.username === 'string' && ig.username) || (typeof ig.name === 'string' ? ig.name : null);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Instagram check failed');
    }
  }
  if (input.adAccountId) {
    const act = input.adAccountId.startsWith('act_') ? input.adAccountId : `act_${input.adAccountId}`;
    try {
      const account = await graphJson(input.token, `/${act}`, { search: { fields: 'name' } });
      ad_account_name = typeof account.name === 'string' ? account.name : null;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Ad account check failed');
    }
  }
  if (!input.pageId && !input.instagramUserId && !input.adAccountId) {
    errors.push('Add a Page id, Instagram id, or ad account id first');
  }
  return { page_name, instagram_name, ad_account_name, errors };
}

export async function publishFacebookPhoto(token: string, pageId: string, caption: string, bytes: Buffer): Promise<string> {
  const form = new FormData();
  form.append('caption', caption);
  form.append('published', 'true');
  form.append('source', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'creative.png');
  const body = await graphForm(token, `/${pageId}/photos`, form);
  const postId = typeof body.post_id === 'string' ? body.post_id : typeof body.id === 'string' ? body.id : '';
  if (!postId) throw new MarketingGraphError('Facebook did not return a post id', 502);
  return postId;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function publishInstagramPhoto(
  token: string,
  igUserId: string,
  caption: string,
  imageUrl: string,
): Promise<string> {
  const created = await graphJson(token, `/${igUserId}/media`, {
    method: 'POST',
    body: { image_url: imageUrl, caption },
  });
  const creationId = typeof created.id === 'string' ? created.id : '';
  if (!creationId) throw new MarketingGraphError('Instagram did not return a media container', 502);

  for (let attempt = 0; attempt < 8; attempt++) {
    const status = await graphJson(token, `/${creationId}`, { search: { fields: 'status_code' } });
    const code = typeof status.status_code === 'string' ? status.status_code : '';
    if (code === 'FINISHED') break;
    if (code === 'ERROR' || code === 'EXPIRED') {
      throw new MarketingGraphError(`Instagram could not process the image (${code})`, 502);
    }
    await sleep(2000);
    if (attempt === 7) throw new MarketingGraphError('Instagram image processing timed out', 504);
  }

  const published = await graphJson(token, `/${igUserId}/media_publish`, {
    method: 'POST',
    body: { creation_id: creationId },
  });
  const mediaId = typeof published.id === 'string' ? published.id : '';
  if (!mediaId) throw new MarketingGraphError('Instagram did not return a media id', 502);
  return mediaId;
}

export async function searchCities(token: string, names: string[]): Promise<Array<{ key: string; name: string }>> {
  const cities: Array<{ key: string; name: string }> = [];
  for (const name of names.slice(0, 8)) {
    const body = await graphJson(token, '/search', {
      search: {
        type: 'adgeolocation',
        q: name,
        location_types: '["city"]',
        country_code: 'IN',
        limit: '1',
      },
    });
    const data = Array.isArray(body.data) ? body.data : [];
    const first = data[0] as { key?: string; name?: string } | undefined;
    if (first?.key && first.name) cities.push({ key: String(first.key), name: first.name });
  }
  return cities;
}

export async function searchInterests(token: string, keywords: string[]): Promise<Array<{ id: string; name: string }>> {
  const interests: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();
  for (const keyword of keywords.slice(0, 5)) {
    const body = await graphJson(token, '/search', {
      search: { type: 'adinterest', q: keyword, limit: '1' },
    });
    const data = Array.isArray(body.data) ? body.data : [];
    const first = data[0] as { id?: string; name?: string } | undefined;
    if (first?.id && !seen.has(String(first.id))) {
      seen.add(String(first.id));
      interests.push({ id: String(first.id), name: first.name || keyword });
    }
  }
  return interests;
}

export async function resolveTargeting(
  token: string,
  input: { cities: string; interestKeywords: string; ageMin: number; ageMax: number },
): Promise<ResolvedTargeting> {
  const cityNames = input.cities
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const keywords = input.interestKeywords
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const [cities, interests] = await Promise.all([
    cityNames.length ? searchCities(token, cityNames) : Promise.resolve([]),
    keywords.length ? searchInterests(token, keywords) : Promise.resolve([]),
  ]);
  return {
    age_min: input.ageMin,
    age_max: input.ageMax,
    countries: ['IN'],
    cities,
    interests,
  };
}

function adAccountPath(adAccountId: string): string {
  return adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
}

export async function uploadAdImage(token: string, adAccountId: string, bytes: Buffer): Promise<string> {
  const form = new FormData();
  form.append('filename', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'creative.png');
  const body = await graphForm(token, `/${adAccountPath(adAccountId)}/adimages`, form);
  const images = body.images as Record<string, { hash?: string }> | undefined;
  const hash = images && Object.values(images).map((item) => item?.hash).find((value) => typeof value === 'string');
  if (!hash) throw new MarketingGraphError('Meta did not return an image hash', 502);
  return hash;
}

export async function createPausedCampaign(token: string, adAccountId: string, name: string): Promise<string> {
  const body = await graphJson(token, `/${adAccountPath(adAccountId)}/campaigns`, {
    method: 'POST',
    body: {
      name,
      objective: 'OUTCOME_TRAFFIC',
      status: 'PAUSED',
      special_ad_categories: [],
      buying_type: 'AUCTION',
      is_adset_budget_sharing_enabled: false,
    },
  });
  if (typeof body.id !== 'string') throw new MarketingGraphError('Meta did not return a campaign id', 502);
  return body.id;
}

export async function createPausedAdSet(input: {
  token: string;
  adAccountId: string;
  campaignId: string;
  name: string;
  dailyBudgetPaise: number;
  targeting: ResolvedTargeting;
}): Promise<string> {
  const geo = input.targeting.cities.length
    ? { cities: input.targeting.cities.map((city) => ({ key: city.key })) }
    : { countries: input.targeting.countries };
  const targeting: Record<string, unknown> = {
    age_min: input.targeting.age_min,
    age_max: input.targeting.age_max,
    geo_locations: geo,
    publisher_platforms: ['facebook', 'instagram'],
    targeting_automation: { advantage_audience: 0 },
  };
  if (input.targeting.interests.length) {
    targeting.flexible_spec = [{ interests: input.targeting.interests }];
  }
  const body = await graphJson(input.token, `/${adAccountPath(input.adAccountId)}/adsets`, {
    method: 'POST',
    body: {
      name: input.name,
      campaign_id: input.campaignId,
      daily_budget: String(input.dailyBudgetPaise),
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'LINK_CLICKS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      destination_type: 'WEBSITE',
      status: 'PAUSED',
      targeting,
    },
  });
  if (typeof body.id !== 'string') throw new MarketingGraphError('Meta did not return an ad set id', 502);
  return body.id;
}

export async function createAdCreative(input: {
  token: string;
  adAccountId: string;
  pageId: string;
  instagramUserId: string;
  name: string;
  headline: string;
  message: string;
  link: string;
  imageHash: string;
}): Promise<string> {
  const objectStory: Record<string, unknown> = {
    page_id: input.pageId,
    link_data: {
      message: input.message,
      name: input.headline,
      link: input.link,
      image_hash: input.imageHash,
      call_to_action: { type: 'SIGN_UP', value: { link: input.link } },
    },
  };
  if (input.instagramUserId) objectStory.instagram_user_id = input.instagramUserId;
  const body = await graphJson(input.token, `/${adAccountPath(input.adAccountId)}/adcreatives`, {
    method: 'POST',
    body: { name: input.name, object_story_spec: objectStory },
  });
  if (typeof body.id !== 'string') throw new MarketingGraphError('Meta did not return a creative id', 502);
  return body.id;
}

export async function createPausedAd(input: {
  token: string;
  adAccountId: string;
  adSetId: string;
  creativeId: string;
  name: string;
}): Promise<string> {
  const body = await graphJson(input.token, `/${adAccountPath(input.adAccountId)}/ads`, {
    method: 'POST',
    body: {
      name: input.name,
      adset_id: input.adSetId,
      creative: { creative_id: input.creativeId },
      status: 'PAUSED',
    },
  });
  if (typeof body.id !== 'string') throw new MarketingGraphError('Meta did not return an ad id', 502);
  return body.id;
}

export async function setMetaStatus(token: string, id: string, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
  await graphJson(token, `/${id}`, { method: 'POST', body: { status } });
}

export function parseInsights(row: Record<string, unknown> | undefined): AdInsights {
  const num = (key: string) => {
    const value = Number(row?.[key] ?? 0);
    return Number.isFinite(value) ? value : 0;
  };
  const actions = Array.isArray(row?.actions) ? (row?.actions as Array<{ action_type?: string; value?: string }>) : [];
  let results = 0;
  let result_action: string | null = null;
  for (const type of RESULT_TYPES) {
    const match = actions.find((action) => action.action_type === type);
    const value = Number(match?.value ?? 0);
    if (value > 0) {
      results = value;
      result_action = type;
      break;
    }
  }
  return {
    impressions: num('impressions'),
    reach: num('reach'),
    clicks: num('clicks'),
    spend: num('spend'),
    ctr: num('ctr'),
    cpc: num('cpc'),
    results,
    result_action,
  };
}

export async function fetchAdInsights(
  token: string,
  adId: string,
  range: { since: string; until: string } | { datePreset: string },
): Promise<AdInsights> {
  const search: Record<string, string> = { fields: 'impressions,reach,clicks,spend,ctr,cpc,actions' };
  if ('datePreset' in range) search.date_preset = range.datePreset;
  else search.time_range = JSON.stringify({ since: range.since, until: range.until });
  const body = await graphJson(token, `/${adId}/insights`, { search });
  const data = Array.isArray(body.data) ? body.data : [];
  return parseInsights(data[0] as Record<string, unknown> | undefined);
}

export async function fetchAdReview(token: string, adId: string): Promise<{ effective_status: string; reason: string | null }> {
  const body = await graphJson(token, `/${adId}`, { search: { fields: 'effective_status,ad_review_feedback' } });
  const effective = typeof body.effective_status === 'string' ? body.effective_status : '';
  const feedback = body.ad_review_feedback as { global?: Record<string, unknown> } | undefined;
  const reason = feedback?.global
    ? Object.values(feedback.global)
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .slice(0, 500) || null
    : null;
  return { effective_status: effective, reason };
}
