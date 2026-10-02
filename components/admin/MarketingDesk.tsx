'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, ImageIcon, Megaphone, Settings } from 'lucide-react';
import type { MarketingBrief } from '@/lib/marketing/brief';
import { DEFAULT_MARKETING_BRIEF } from '@/lib/marketing/brief';

type Tab = 'setup' | 'queue' | 'ads' | 'performance';

type PublicSettings = {
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

type PostRow = {
  id: string;
  caption: string;
  headline: string;
  image_path: string;
  scheduled_for: string;
  status: string;
  error: string | null;
  fb_post_id: string | null;
  ig_media_id: string | null;
};

type Insights = {
  impressions: number;
  reach: number;
  clicks: number;
  spend: number;
  ctr: number;
  cpc: number;
  results: number;
};

type AdRow = {
  id: string;
  name: string;
  headline: string;
  primary_text: string;
  image_path: string;
  daily_budget_paise: number;
  status: string;
  last_error: string | null;
  last_insights: Insights | null;
  meta_ad_id: string | null;
};

type PerfAd = AdRow & { range_insights: Insights | null };

const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900';
const label = 'block text-sm font-medium text-gray-700 mb-1';

function todayInKolkata(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function rupees(paise: number): string {
  return (paise / 100).toFixed(0);
}

export function MarketingDesk() {
  const [tab, setTab] = useState<Tab>('setup');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Marketing</h1>
        <p className="mt-2 text-gray-600">Drafts for Khatario’s Facebook Page, Instagram, and website-click ads. Nothing publishes until you approve it.</p>
      </div>

      <div className="mb-6 flex space-x-1 border-b border-gray-200">
        {(
          [
            { id: 'setup', label: 'Setup', icon: Settings },
            { id: 'queue', label: 'Queue', icon: ImageIcon },
            { id: 'ads', label: 'Ads', icon: Megaphone },
            { id: 'performance', label: 'Performance', icon: BarChart3 },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex items-center space-x-2 border-b-2 px-4 py-3 ${
                tab === item.id ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>

      {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}

      <div className="admin-light-surface rounded-xl border border-gray-200 bg-white p-6 text-gray-900">
        {tab === 'setup' && <SetupTab busy={busy} run={run} onSaved={() => setNotice('Setup saved.')} />}
        {tab === 'queue' && <QueueTab busy={busy} run={run} />}
        {tab === 'ads' && <AdsTab busy={busy} run={run} />}
        {tab === 'performance' && <PerformanceTab busy={busy} run={run} />}
      </div>
    </div>
  );
}

function SetupTab({
  busy,
  run,
  onSaved,
}: {
  busy: boolean;
  run: (work: () => Promise<void>) => Promise<void>;
  onSaved: () => void;
}) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [token, setToken] = useState('');
  const [pageId, setPageId] = useState('');
  const [igId, setIgId] = useState('');
  const [adAccountId, setAdAccountId] = useState('');
  const [pixelId, setPixelId] = useState('');
  const [brief, setBrief] = useState<MarketingBrief>(DEFAULT_MARKETING_BRIEF);
  const [test, setTest] = useState('');

  useEffect(() => {
    void api<{ settings: PublicSettings }>('/api/admin/marketing/desk/settings').then((data) => {
      setSettings(data.settings);
      setPageId(data.settings.page_id);
      setIgId(data.settings.instagram_user_id);
      setAdAccountId(data.settings.ad_account_id);
      setPixelId(data.settings.pixel_id);
      setBrief(data.settings.brief);
    }).catch((err: unknown) => setTest(err instanceof Error ? err.message : 'Could not load setup'));
  }, []);

  const setBriefField = (key: keyof MarketingBrief, value: string) => {
    setBrief((current) => ({
      ...current,
      [key]: key === 'audience' || key === 'offer' || key === 'cities' || key === 'bannedClaims' || key === 'landingUrl' || key === 'interestKeywords'
        ? value
        : Number(value),
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Connection</h2>
        <p className="mt-1 text-sm text-gray-600">
          Create the Facebook Page, Instagram professional account, Business Manager, developer app, system user, and ad account card in Meta. Paste the token and ids here once. The token is stored encrypted and is never shown again.
        </p>
        {settings && (
          <p className="mt-3 text-sm">
            Token: {settings.has_access_token ? 'saved' : 'missing'}
            {settings.missing.length > 0 ? ` · Still needed: ${settings.missing.join(', ')}` : ' · Page and ad account ids are filled in'}
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label>
          <span className={label}>Access token</span>
          <input className={field} type="password" autoComplete="off" value={token} placeholder={settings?.has_access_token ? 'Leave blank to keep the saved token' : 'Paste the system user token'} onChange={(e) => setToken(e.target.value)} />
        </label>
        <label>
          <span className={label}>Facebook Page id</span>
          <input className={field} value={pageId} onChange={(e) => setPageId(e.target.value)} />
        </label>
        <label>
          <span className={label}>Instagram user id</span>
          <input className={field} value={igId} onChange={(e) => setIgId(e.target.value)} />
        </label>
        <label>
          <span className={label}>Ad account id</span>
          <input className={field} value={adAccountId} placeholder="act_123" onChange={(e) => setAdAccountId(e.target.value)} />
        </label>
        <label>
          <span className={label}>Pixel id</span>
          <input className={field} value={pixelId} onChange={(e) => setPixelId(e.target.value)} />
        </label>
        <label>
          <span className={label}>Landing URL</span>
          <input className={field} value={brief.landingUrl} onChange={(e) => setBriefField('landingUrl', e.target.value)} />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label>
          <span className={label}>Audience</span>
          <textarea className={field} rows={3} value={brief.audience} onChange={(e) => setBriefField('audience', e.target.value)} />
        </label>
        <label>
          <span className={label}>Offer</span>
          <textarea className={field} rows={3} value={brief.offer} onChange={(e) => setBriefField('offer', e.target.value)} />
        </label>
        <label>
          <span className={label}>Cities</span>
          <input className={field} value={brief.cities} placeholder="Jaipur, Kota" onChange={(e) => setBriefField('cities', e.target.value)} />
        </label>
        <label>
          <span className={label}>Interest keywords</span>
          <input className={field} value={brief.interestKeywords} onChange={(e) => setBriefField('interestKeywords', e.target.value)} />
        </label>
        <label className="md:col-span-2">
          <span className={label}>Banned claims</span>
          <input className={field} value={brief.bannedClaims} placeholder="Comma-separated phrases that cannot be approved" onChange={(e) => setBriefField('bannedClaims', e.target.value)} />
        </label>
        <label>
          <span className={label}>Daily ad cap (₹)</span>
          <input className={field} type="number" min={0} value={brief.dailyAdCapRupees} onChange={(e) => setBriefField('dailyAdCapRupees', e.target.value)} />
        </label>
        <label>
          <span className={label}>Age range</span>
          <div className="flex gap-2">
            <input className={field} type="number" value={brief.ageMin} onChange={(e) => setBriefField('ageMin', e.target.value)} />
            <input className={field} type="number" value={brief.ageMax} onChange={(e) => setBriefField('ageMax', e.target.value)} />
          </div>
        </label>
        <label>
          <span className={label}>Stop after spend (₹)</span>
          <input className={field} type="number" min={0} value={brief.stopMinSpendRupees} onChange={(e) => setBriefField('stopMinSpendRupees', e.target.value)} />
        </label>
        <label>
          <span className={label}>Max cost per result (₹)</span>
          <input className={field} type="number" min={0} value={brief.stopMaxCostPerResultRupees} onChange={(e) => setBriefField('stopMaxCostPerResultRupees', e.target.value)} />
          <span className="mt-1 block text-xs text-gray-500">Set this to 0 to turn the stop rule off. The rule uses the last 7 days.</span>
        </label>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          onClick={() =>
            void run(async () => {
              const data = await api<{ settings: PublicSettings }>('/api/admin/marketing/desk/settings', {
                method: 'PUT',
                body: JSON.stringify({
                  access_token: token,
                  page_id: pageId,
                  instagram_user_id: igId,
                  ad_account_id: adAccountId,
                  pixel_id: pixelId,
                  brief,
                }),
              });
              setSettings(data.settings);
              setToken('');
              onSaved();
            })
          }
        >
          Save setup
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium"
          onClick={() =>
            void run(async () => {
              const data = await api<{ page_name: string | null; instagram_name: string | null; ad_account_name: string | null; errors: string[] }>(
                '/api/admin/marketing/desk/test-connection',
                { method: 'POST' },
              );
              const parts = [
                data.page_name ? `Page: ${data.page_name}` : '',
                data.instagram_name ? `Instagram: ${data.instagram_name}` : '',
                data.ad_account_name ? `Ad account: ${data.ad_account_name}` : '',
                data.errors.length ? data.errors.join(' ') : '',
              ].filter(Boolean);
              setTest(parts.join(' · ') || 'Connected');
            })
          }
        >
          Test connection
        </button>
      </div>
      {test && <p className="text-sm text-gray-700">{test}</p>}
    </div>
  );
}

function QueueTab({ busy, run }: { busy: boolean; run: (work: () => Promise<void>) => Promise<void> }) {
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [status, setStatus] = useState('all');
  const [date, setDate] = useState(todayInKolkata());
  const [angle, setAngle] = useState('');
  const [captions, setCaptions] = useState<Record<string, string>>({});

  const load = useCallback(async (next = status) => {
    const data = await api<{ posts: PostRow[] }>(`/api/admin/marketing/desk/posts?status=${encodeURIComponent(next)}`);
    setPosts(data.posts);
    setCaptions(Object.fromEntries(data.posts.map((post) => [post.id, post.caption])));
  }, [status]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className={label}>Date</span>
          <input className={field} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="min-w-[240px] flex-1">
          <span className={label}>Angle (optional)</span>
          <input className={field} value={angle} placeholder="GST invoice in Hindi" onChange={(e) => setAngle(e.target.value)} />
        </label>
        <button
          type="button"
          disabled={busy}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          onClick={() => void run(async () => { await api('/api/admin/marketing/desk/posts/generate', { method: 'POST', body: JSON.stringify({ scheduled_for: date, angle }) }); await load(); })}
        >
          Generate draft
        </button>
        <label>
          <span className={label}>Status</span>
          <select className={field} value={status} onChange={(e) => { setStatus(e.target.value); void load(e.target.value).catch(() => undefined); }}>
            {['all', 'draft', 'approved', 'posted', 'failed'].map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
      </div>

      {posts.length === 0 && <p className="text-sm text-gray-600">No posts in this filter. Generate a draft to start the queue.</p>}

      <div className="space-y-4">
        {posts.map((post) => (
          <article key={post.id} className="grid gap-4 rounded-lg border border-gray-200 p-4 md:grid-cols-[160px_1fr]">
            <img src={post.image_path} alt="" className="h-40 w-40 rounded-md object-cover" />
            <div className="space-y-2">
              <p className="text-sm font-medium">{post.headline} · {post.scheduled_for} · {post.status}</p>
              <textarea
                className={field}
                rows={4}
                value={captions[post.id] ?? post.caption}
                disabled={post.status === 'posted' || post.status === 'approved'}
                onChange={(e) => setCaptions((current) => ({ ...current, [post.id]: e.target.value }))}
              />
              {post.error && <p className="text-sm text-red-700">{post.error}</p>}
              <div className="flex flex-wrap gap-2">
                {post.status !== 'posted' && post.status !== 'approved' && (
                  <button type="button" disabled={busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" onClick={() => void run(async () => { await api(`/api/admin/marketing/desk/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify({ caption: captions[post.id] }) }); await load(); })}>Save caption</button>
                )}
                {(post.status === 'draft' || post.status === 'failed') && (
                  <button type="button" disabled={busy} className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm text-white" onClick={() => void run(async () => { await api(`/api/admin/marketing/desk/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'approve', caption: captions[post.id] }) }); await load(); })}>Approve</button>
                )}
                {post.status !== 'posted' && post.status !== 'draft' && (
                  <button type="button" disabled={busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" onClick={() => void run(async () => { await api(`/api/admin/marketing/desk/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'revert' }) }); await load(); })}>Back to draft</button>
                )}
              </div>
              {post.fb_post_id && <p className="text-xs text-gray-500">Facebook post {post.fb_post_id}{post.ig_media_id ? ` · Instagram ${post.ig_media_id}` : ''}</p>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function AdsTab({ busy, run }: { busy: boolean; run: (work: () => Promise<void>) => Promise<void> }) {
  const [ads, setAds] = useState<AdRow[]>([]);
  const [angle, setAngle] = useState('');
  const [budget, setBudget] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { headline: string; primary_text: string; budget: string }>>({});

  const load = useCallback(async () => {
    const data = await api<{ ads: AdRow[] }>('/api/admin/marketing/desk/ads');
    setAds(data.ads);
    setDrafts(Object.fromEntries(data.ads.map((ad) => [ad.id, { headline: ad.headline, primary_text: ad.primary_text, budget: rupees(ad.daily_budget_paise) }])));
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">New ads are saved as drafts. Create paused sends them to Meta still paused. Launch is a separate button and is the only way an ad can spend.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[240px] flex-1">
          <span className={label}>Angle (optional)</span>
          <input className={field} value={angle} onChange={(e) => setAngle(e.target.value)} />
        </label>
        <label>
          <span className={label}>Daily budget (₹)</span>
          <input className={field} type="number" min={1} value={budget} placeholder="Uses the cap if empty" onChange={(e) => setBudget(e.target.value)} />
        </label>
        <button
          type="button"
          disabled={busy}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          onClick={() => void run(async () => {
            await api('/api/admin/marketing/desk/ads/generate', {
              method: 'POST',
              body: JSON.stringify({ angle, daily_budget_rupees: budget ? Number(budget) : undefined }),
            });
            await load();
          })}
        >
          New ad
        </button>
      </div>
      {ads.length === 0 && <p className="text-sm text-gray-600">No ads yet.</p>}
      <div className="space-y-4">
        {ads.map((ad) => {
          const draft = drafts[ad.id] || { headline: ad.headline, primary_text: ad.primary_text, budget: rupees(ad.daily_budget_paise) };
          const editable = ad.status === 'draft' || ad.status === 'failed';
          return (
            <article key={ad.id} className="grid gap-4 rounded-lg border border-gray-200 p-4 md:grid-cols-[160px_1fr]">
              <img src={ad.image_path} alt="" className="h-40 w-40 rounded-md object-cover" />
              <div className="space-y-2">
                <p className="text-sm font-medium">{ad.name} · {ad.status} · ₹{rupees(ad.daily_budget_paise)} / day</p>
                <input className={field} value={draft.headline} disabled={!editable} onChange={(e) => setDrafts((current) => ({ ...current, [ad.id]: { ...draft, headline: e.target.value } }))} />
                <textarea className={field} rows={3} value={draft.primary_text} disabled={!editable} onChange={(e) => setDrafts((current) => ({ ...current, [ad.id]: { ...draft, primary_text: e.target.value } }))} />
                {editable && (
                  <input className={field} type="number" value={draft.budget} onChange={(e) => setDrafts((current) => ({ ...current, [ad.id]: { ...draft, budget: e.target.value } }))} />
                )}
                {ad.last_error && <p className="text-sm text-red-700">{ad.last_error}</p>}
                <div className="flex flex-wrap gap-2">
                  {editable && (
                    <>
                      <button type="button" disabled={busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" onClick={() => void run(async () => { await api(`/api/admin/marketing/desk/ads/${ad.id}`, { method: 'PATCH', body: JSON.stringify({ headline: draft.headline, primary_text: draft.primary_text, daily_budget_rupees: Number(draft.budget) }) }); await load(); })}>Save</button>
                      <button type="button" disabled={busy} className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm text-white" onClick={() => void run(async () => { await api(`/api/admin/marketing/desk/ads/${ad.id}/create-paused`, { method: 'POST' }); await load(); })}>Create paused</button>
                    </>
                  )}
                  {(ad.status === 'paused' || ad.status === 'paused_by_rule') && (
                    <button type="button" disabled={busy} className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm text-white" onClick={() => void run(async () => { await api(`/api/admin/marketing/desk/ads/${ad.id}/launch`, { method: 'POST' }); await load(); })}>Launch</button>
                  )}
                  {(ad.status === 'active' || ad.status === 'pending_review') && (
                    <button type="button" disabled={busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" onClick={() => void run(async () => { await api(`/api/admin/marketing/desk/ads/${ad.id}/pause`, { method: 'POST' }); await load(); })}>Pause</button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function PerformanceTab({ busy, run }: { busy: boolean; run: (work: () => Promise<void>) => Promise<void> }) {
  const [since, setSince] = useState(daysAgo(7));
  const [until, setUntil] = useState(todayInKolkata());
  const [note, setNote] = useState('');
  const [ads, setAds] = useState<PerfAd[]>([]);

  const load = useCallback(async (from = since, to = until) => {
    const data = await api<{ ads: PerfAd[]; note: string }>(`/api/admin/marketing/desk/performance?since=${from}&until=${to}`);
    setAds(data.ads);
    setNote(data.note);
  }, [since, until]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const totals = ads.reduce(
    (sum, ad) => {
      const stats = ad.range_insights;
      if (!stats) return sum;
      sum.spend += stats.spend || 0;
      sum.reach += stats.reach || 0;
      sum.clicks += stats.clicks || 0;
      sum.results += stats.results || 0;
      return sum;
    },
    { spend: 0, reach: 0, clicks: 0, results: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className={label}>From</span>
          <input className={field} type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </label>
        <label>
          <span className={label}>To</span>
          <input className={field} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <button type="button" disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm" onClick={() => void run(() => load())}>Refresh</button>
      </div>
      <p className="text-sm text-gray-600">{note || 'Numbers come from Meta and can lag.'}</p>
      <p className="text-sm">
        Total spend ₹{totals.spend.toFixed(2)} · reach {totals.reach} · clicks {totals.clicks} · results {totals.results}
        {totals.clicks > 0 ? ` · CPC ₹${(totals.spend / totals.clicks).toFixed(2)}` : ''}
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b text-gray-500">
              {['Ad', 'Status', 'Spend', 'Reach', 'Clicks', 'CTR', 'CPC', 'Results'].map((heading) => (
                <th key={heading} className="px-2 py-2 font-medium">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ads.filter((ad) => ad.meta_ad_id).map((ad) => {
              const stats = ad.range_insights;
              return (
                <tr key={ad.id} className="border-b">
                  <td className="px-2 py-2">{ad.name}</td>
                  <td className="px-2 py-2">{ad.status}</td>
                  <td className="px-2 py-2">{stats ? `₹${stats.spend.toFixed(2)}` : '—'}</td>
                  <td className="px-2 py-2">{stats?.reach ?? '—'}</td>
                  <td className="px-2 py-2">{stats?.clicks ?? '—'}</td>
                  <td className="px-2 py-2">{stats ? `${stats.ctr.toFixed(2)}%` : '—'}</td>
                  <td className="px-2 py-2">{stats ? `₹${stats.cpc.toFixed(2)}` : '—'}</td>
                  <td className="px-2 py-2">{stats?.results ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {ads.every((ad) => !ad.meta_ad_id) && <p className="text-sm text-gray-600">Create a paused ad before there is anything to measure.</p>}
    </div>
  );
}
