#!/usr/bin/env node
/**
 * Daily Google Search Console snapshot for khatario.com.
 *
 * Usage:
 *   GSC_KEY_FILE=C:\path\to\service-account.json node scripts/seo/gsc-report.mjs [--days 28] [--site sc-domain:khatario.com]
 *
 * Writes docs/seo/reports/YYYY-MM-DD.json (queries, pages, sitemaps, index status of key URLs)
 * and prints a short summary. The key file is read locally and never printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SignJWT, importPKCS8 } from 'jose';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const KEY_FILE = process.env.GSC_KEY_FILE;
const DAYS = Number(arg('days', '28'));
const OUT_DIR = path.resolve('docs/seo/reports');
const KEY_URLS = ['/', '/solution/accounting', '/solution/inventory', '/guides', '/blog', '/book-demo'];

if (!KEY_FILE || !fs.existsSync(KEY_FILE)) {
  console.error('Set GSC_KEY_FILE to the service account JSON path.');
  process.exit(1);
}
const key = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: 'https://www.googleapis.com/auth/webmasters' })
    .setProtectedHeader({ alg: 'RS256', kid: key.private_key_id })
    .setIssuer(key.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(await importPKCS8(key.private_key, 'RS256'));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

const token = await accessToken();
const api = async (url, body) => {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${url} ${res.status}: ${await res.text()}`);
  return res.json();
};

async function resolveSite() {
  const wanted = arg('site', process.env.GSC_SITE);
  if (wanted) return wanted;
  const { siteEntry = [] } = await api('https://www.googleapis.com/webmasters/v3/sites');
  const site = siteEntry.find((s) => /khatario\.com/.test(s.siteUrl));
  if (!site) {
    throw new Error(
      `Service account ${key.client_email} has no khatario.com property. Add it under Search Console > Settings > Users and permissions.`
    );
  }
  return site.siteUrl;
}

const site = await resolveSite();
const enc = encodeURIComponent(site);
const day = (offset) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
// Search Console data lags ~2-3 days.
const endDate = day(2);
const startDate = day(DAYS + 1);

const query = (dimensions, rowLimit = 500) =>
  api(`https://www.googleapis.com/webmasters/v3/sites/${enc}/searchAnalytics/query`, {
    startDate,
    endDate,
    dimensions,
    rowLimit,
    dataState: 'all',
  }).then((r) => r.rows ?? []);

const [queries, pages, daily, sitemaps] = await Promise.all([
  query(['query']),
  query(['page']),
  query(['date'], 100),
  api(`https://www.googleapis.com/webmasters/v3/sites/${enc}/sitemaps`).then((r) => r.sitemap ?? []),
]);

const origin = site.startsWith('sc-domain:') ? `https://${site.slice(10)}` : site.replace(/\/$/, '');

// --submit-sitemap: (re)submit the sitemap once production serves it.
if (args.includes('--submit-sitemap')) {
  const feed = `${origin}/sitemap.xml`;
  const live = await fetch(feed).then((r) => r.ok, () => false);
  if (!live) {
    console.log(`Sitemap not submitted: ${feed} is not live yet.`);
  } else {
    const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${enc}/sitemaps/${encodeURIComponent(feed)}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}` },
    });
    console.log(res.ok ? `Submitted ${feed}` : `Sitemap submit failed ${res.status}: ${await res.text()}`);
  }
}
const inspections = [];
for (const p of KEY_URLS) {
  try {
    const r = await api('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      inspectionUrl: `${origin}${p === '/' ? '/' : p}`,
      siteUrl: site,
    });
    const s = r.inspectionResult?.indexStatusResult ?? {};
    inspections.push({
      url: p,
      verdict: s.verdict,
      coverage: s.coverageState,
      lastCrawl: s.lastCrawlTime,
      googleCanonical: s.googleCanonical,
      userCanonical: s.userCanonical,
    });
  } catch (error) {
    inspections.push({ url: p, error: String(error.message).slice(0, 200) });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  site,
  range: { startDate, endDate },
  totals: daily.reduce(
    (t, r) => ({ clicks: t.clicks + r.clicks, impressions: t.impressions + r.impressions }),
    { clicks: 0, impressions: 0 }
  ),
  daily,
  queries,
  pages,
  sitemaps,
  inspections,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const file = path.join(OUT_DIR, `${day(0)}.json`);
fs.writeFileSync(file, JSON.stringify(report, null, 2));

const fmt = (r) => `${r.keys[0]} | pos ${r.position.toFixed(1)} | ${r.impressions} impr | ${r.clicks} clicks`;
console.log(`Site ${site}, ${startDate}..${endDate}`);
console.log(`Totals: ${report.totals.clicks} clicks, ${report.totals.impressions} impressions`);
console.log('Index status:', inspections.map((i) => `${i.url}=${i.coverage ?? i.error}`).join('; '));
console.log('Sitemaps:', sitemaps.map((s) => `${s.path} (${s.lastDownloaded ?? 'not read'})`).join('; ') || 'none submitted');
console.log('Top queries:');
for (const r of [...queries].sort((a, b) => b.impressions - a.impressions).slice(0, 25)) console.log('  ' + fmt(r));
console.log('Page-2 queries (pos 8-20, best to push):');
for (const r of queries.filter((q) => q.position >= 8 && q.position <= 20).slice(0, 25)) console.log('  ' + fmt(r));
console.log(`Saved ${file}`);
