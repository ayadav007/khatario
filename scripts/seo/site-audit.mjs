#!/usr/bin/env node
/**
 * Technical SEO audit of the public site.
 *
 * Usage:
 *   node scripts/seo/site-audit.mjs [--base https://khatario.com] [--max 300] [--no-psi]
 *
 * Crawls from robots.txt, sitemap.xml and the home page (same host only), checks every page for
 * status, redirects, title, description, canonical, robots meta, H1, structured data, image alt,
 * broken internal links and sitemap coverage, then runs Google PageSpeed (mobile) on key pages.
 * Writes docs/seo/audits/YYYY-MM-DD.json and .md. Optional PAGESPEED_API_KEY raises the PSI quota.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = arg('base', 'https://khatario.com').replace(/\/$/, '');
const HOST = new URL(BASE).host;
const MAX = Number(arg('max', '300'));
const PSI_PAGES = ['/', '/solution/accounting', '/solution/inventory', '/blog'];
const UA = 'Mozilla/5.0 (compatible; KhatarioSEOAudit/1.0; +https://khatario.com)';
// App screens and token links are not meant for search; skip them like robots.txt does.
const SKIP = /^\/(api|admin|i|r|track|pay|print|offline|_next|dashboard|invoices|items|purchases|settings|customers|reports)(\/|$)/;

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? decode(m[2] ?? m[3] ?? '') : null;
};
const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? [];
const meta = (html, key) => {
  for (const t of tags(html, 'meta')) {
    if ((attr(t, 'name') || attr(t, 'property') || '').toLowerCase() === key) return attr(t, 'content');
  }
  return null;
};

function normalize(href, from) {
  try {
    const u = new URL(href, from);
    if (u.host !== HOST || !/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    if (SKIP.test(u.pathname)) return null;
    return u.toString().replace(/\/$/, '') || BASE;
  } catch {
    return null;
  }
}

async function get(url, redirect = 'manual') {
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect, headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
    const type = res.headers.get('content-type') || '';
    const body = type.includes('html') || type.includes('xml') || type.includes('text') ? await res.text() : '';
    return { status: res.status, location: res.headers.get('location'), type, body, ms: Date.now() - started, xRobots: res.headers.get('x-robots-tag') };
  } catch (error) {
    return { status: 0, error: String(error.message || error), body: '', ms: Date.now() - started };
  }
}

const issues = [];
const issue = (severity, url, code, detail = '') => issues.push({ severity, url, code, detail });

// robots.txt + sitemap
const robots = await get(`${BASE}/robots.txt`, 'follow');
if (robots.status !== 200) issue('high', '/robots.txt', 'robots_missing', `status ${robots.status}`);
else {
  if (/^\s*disallow:\s*\/\s*$/im.test(robots.body)) issue('high', '/robots.txt', 'robots_blocks_all');
  if (!/^\s*sitemap:/im.test(robots.body)) issue('medium', '/robots.txt', 'robots_no_sitemap');
}
const sitemap = await get(`${BASE}/sitemap.xml`, 'follow');
const sitemapUrls = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1].trim()).replace(/\/$/, '') || BASE);
if (sitemap.status !== 200) issue('high', '/sitemap.xml', 'sitemap_missing', `status ${sitemap.status}`);
else if (!sitemapUrls.length) issue('high', '/sitemap.xml', 'sitemap_empty');

// www / http canonical host checks
for (const variant of [`https://www.${HOST}/`, `http://${HOST}/`]) {
  if (HOST.startsWith('www.') || HOST.split('.').length > 2) break;
  const r = await get(variant);
  if (![301, 308].includes(r.status)) issue('medium', variant, 'host_not_redirected', `status ${r.status}`);
}

// crawl
const queue = [BASE, ...sitemapUrls.filter((u) => normalize(u, BASE))];
const seen = new Set();
const pages = [];
const inlinks = new Map();
while (queue.length && pages.length < MAX) {
  const url = queue.shift();
  if (seen.has(url)) continue;
  seen.add(url);
  const chain = [];
  let res = await get(url);
  let current = url;
  while ([301, 302, 307, 308].includes(res.status) && res.location && chain.length < 5) {
    chain.push(`${res.status} ${current}`);
    current = new URL(res.location, current).toString();
    res = await get(current);
  }
  const p = { url, status: res.status, ms: res.ms, finalUrl: current, redirects: chain.length };
  pages.push(p);
  const rel = (new URL(url).pathname || '/') + new URL(url).search;
  if (res.status === 0) { issue('high', rel, 'fetch_failed', res.error); continue; }
  if (res.status >= 400) { issue('high', rel, `http_${res.status}`); continue; }
  if (chain.length > 1) issue('medium', rel, 'redirect_chain', chain.join(' -> '));
  if (chain.length && sitemapUrls.includes(url)) issue('medium', rel, 'sitemap_url_redirects', current);
  if (!res.type.includes('html')) continue;
  if (res.ms > 3000) issue('low', rel, 'slow_response', `${res.ms} ms server response`);

  const html = res.body;
  const head = html.split(/<\/head>/i)[0];
  const titles = [...head.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map((m) => decode(m[1].trim()));
  p.title = titles[0] ?? '';
  p.description = meta(head, 'description') ?? '';
  p.robots = (meta(head, 'robots') ?? '') + (res.xRobots ? ` x:${res.xRobots}` : '');
  const canonTag = tags(head, 'link').find((t) => (attr(t, 'rel') || '').toLowerCase() === 'canonical');
  p.canonical = canonTag ? attr(canonTag, 'href') : '';
  const body = html.slice(head.length);
  p.h1 = (body.match(/<h1\b/gi) ?? []).length;
  p.jsonLd = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].flatMap((m) => {
    try {
      const data = JSON.parse(m[1]);
      return (Array.isArray(data) ? data : data['@graph'] ?? [data]).map((d) => d['@type']).flat();
    } catch {
      issue('medium', rel, 'jsonld_invalid');
      return [];
    }
  });
  p.og = { title: meta(head, 'og:title'), image: meta(head, 'og:image') };
  p.lang = (html.match(/<html[^>]*\slang="([^"]+)"/i) ?? [])[1] ?? '';
  const imgs = tags(body, 'img');
  p.imagesNoAlt = imgs.filter((t) => attr(t, 'alt') === null).length;
  p.words = body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  const noindex = /noindex/i.test(p.robots);

  if (titles.length > 1) issue('medium', rel, 'multiple_titles', titles.join(' | '));
  if (!p.title) issue('high', rel, 'title_missing');
  else if (p.title.length > 65) issue('low', rel, 'title_long', `${p.title.length} chars: ${p.title}`);
  else if (p.title.length < 25) issue('low', rel, 'title_short', p.title);
  if (/khatario.*khatario/i.test(p.title)) issue('low', rel, 'title_brand_repeated', p.title);
  if (!p.description) issue('medium', rel, 'description_missing');
  else if (p.description.length > 165) issue('low', rel, 'description_long', `${p.description.length} chars`);
  else if (p.description.length < 70) issue('low', rel, 'description_short', p.description);
  if (!p.canonical && !noindex) {
    const variant = !!new URL(url).search;
    issue(variant ? 'medium' : 'low', rel, 'canonical_missing', variant ? 'query-string variant with no canonical is a duplicate page' : '');
  }
  if (p.canonical) {
    let c = '';
    try {
      c = new URL(p.canonical, url).toString().replace(/\/$/, '') || BASE;
    } catch {
      issue('high', rel, 'canonical_invalid', p.canonical);
    }
    const bare = url.split('?')[0].replace(/\/$/, '') || BASE;
    if (!/^https?:\/\//i.test(p.canonical)) issue('low', rel, 'canonical_relative', p.canonical);
    if (c && !c.startsWith(BASE)) issue('high', rel, 'canonical_off_site', p.canonical);
    else if (c && c !== url && c !== bare) issue('medium', rel, 'canonical_points_elsewhere', p.canonical);
    // A ?plan= style variant pointing at its clean URL is consolidated, not a duplicate.
    p.consolidated = !!c && c !== url;
  }
  if (noindex && sitemapUrls.includes(url)) issue('high', rel, 'noindex_in_sitemap', p.robots);
  if (p.h1 === 0 && !noindex) issue('medium', rel, 'h1_missing');
  if (p.h1 > 1) issue('low', rel, 'h1_multiple', `${p.h1} H1 tags`);
  if (p.imagesNoAlt) issue('low', rel, 'images_missing_alt', `${p.imagesNoAlt} of ${imgs.length}`);
  if (!p.og.image) issue('low', rel, 'og_image_missing');
  if (!p.lang) issue('low', rel, 'html_lang_missing');
  if (p.words < 300 && !noindex && !/\/(privacy|terms|login|signup)$/.test(url)) issue('low', rel, 'thin_content', `${p.words} words`);

  for (const a of tags(body, 'a')) {
    const href = attr(a, 'href');
    if (!href || /^(mailto|tel|javascript|whatsapp):/i.test(href)) continue;
    const target = normalize(href, url);
    if (!target) continue;
    if (!inlinks.has(target)) inlinks.set(target, new Set());
    inlinks.get(target).add(rel);
    if (!seen.has(target) && !queue.includes(target)) queue.push(target);
  }
}

const show = (u) => new URL(u).pathname + new URL(u).search;

// Query-string variants that canonicalise to their clean URL inherit its issues; report only the clean URL.
const consolidated = new Set(pages.filter((p) => p.consolidated && new URL(p.url).search).map((p) => show(p.url)));
for (let i = issues.length - 1; i >= 0; i--) {
  if (consolidated.has(issues[i].url) && !issues[i].code.startsWith('canonical')) issues.splice(i, 1);
}

// cross-page checks
const byStatus = new Map(pages.map((p) => [p.url, p.status]));
for (const [target, from] of inlinks) {
  const s = byStatus.get(target);
  if (s && s >= 400) issue('high', new URL(target).pathname, 'broken_internal_link', `linked from ${[...from].slice(0, 5).join(', ')}`);
}
const indexable = pages.filter((p) => p.status === 200 && p.title !== undefined && !p.consolidated && !/noindex/i.test(p.robots || ''));
for (const p of indexable) {
  if (!sitemapUrls.includes(p.url)) issue('low', show(p.url), 'not_in_sitemap');
}
for (const u of sitemapUrls) {
  if (u !== BASE && !inlinks.has(u)) issue('medium', new URL(u).pathname, 'orphan_page', 'in sitemap but no internal links point to it');
}
for (const key of ['title', 'description']) {
  const groups = new Map();
  for (const p of indexable) if (p[key]) groups.set(p[key], [...(groups.get(p[key]) ?? []), show(p.url)]);
  for (const [value, urls] of groups) if (urls.length > 1) issue('medium', urls.join(', '), `duplicate_${key}`, value.slice(0, 120));
}
const home = pages.find((p) => p.url === BASE);
if (home && !(home.jsonLd ?? []).some((t) => /Organization|SoftwareApplication|WebSite/.test(String(t)))) {
  issue('medium', '/', 'home_structured_data_missing', 'no Organization / SoftwareApplication / WebSite JSON-LD');
}

// PageSpeed Insights (mobile)
const psi = [];
if (!args.includes('--no-psi')) {
  for (const p of PSI_PAGES) {
    const q = new URLSearchParams({ url: `${BASE}${p === '/' ? '/' : p}`, strategy: 'mobile' });
    for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) q.append('category', c);
    if (process.env.PAGESPEED_API_KEY) q.set('key', process.env.PAGESPEED_API_KEY);
    try {
      const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: AbortSignal.timeout(120000) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || r.status);
      const cat = j.lighthouseResult.categories;
      const a = j.lighthouseResult.audits;
      const field = j.loadingExperience?.metrics ?? {};
      const row = {
        page: p,
        performance: Math.round(cat.performance.score * 100),
        seo: Math.round(cat.seo.score * 100),
        accessibility: Math.round(cat.accessibility.score * 100),
        bestPractices: Math.round(cat['best-practices'].score * 100),
        lcp: a['largest-contentful-paint']?.displayValue,
        cls: a['cumulative-layout-shift']?.displayValue,
        tbt: a['total-blocking-time']?.displayValue,
        fieldLcpMs: field.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
        fieldInpMs: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
        failedSeoAudits: Object.values(cat.seo.auditRefs ?? [])
          .map((ref) => a[ref.id])
          .filter((x) => x && x.score === 0)
          .map((x) => x.title),
      };
      psi.push(row);
      if (row.performance < 50) issue('high', p, 'mobile_performance_poor', `score ${row.performance}, LCP ${row.lcp}`);
      else if (row.performance < 80) issue('medium', p, 'mobile_performance_needs_work', `score ${row.performance}, LCP ${row.lcp}`);
      for (const t of row.failedSeoAudits) issue('medium', p, 'lighthouse_seo', t);
    } catch (error) {
      psi.push({ page: p, error: String(error.message || error).slice(0, 200) });
    }
  }
}

// output
const order = { high: 0, medium: 1, low: 2 };
issues.sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code));
const today = new Date().toISOString().slice(0, 10);
const outDir = path.resolve('docs/seo/audits');
fs.mkdirSync(outDir, { recursive: true });
const report = { generatedAt: new Date().toISOString(), base: BASE, sitemapUrls, pages, psi, issues };
fs.writeFileSync(path.join(outDir, `${today}.json`), JSON.stringify(report, null, 2));

const count = (s) => issues.filter((i) => i.severity === s).length;
const md = [
  `# SEO audit ${today} — ${BASE}`,
  '',
  `Crawled ${pages.length} URLs, ${sitemapUrls.length} in sitemap. Issues: ${count('high')} high, ${count('medium')} medium, ${count('low')} low.`,
  '',
  '## PageSpeed (mobile)',
  '',
  '| Page | Perf | SEO | A11y | BP | LCP | CLS | TBT |',
  '|---|---|---|---|---|---|---|---|',
  ...psi.map((r) => r.error ? `| ${r.page} | error: ${r.error} |||||||` : `| ${r.page} | ${r.performance} | ${r.seo} | ${r.accessibility} | ${r.bestPractices} | ${r.lcp} | ${r.cls} | ${r.tbt} |`),
  '',
  '## Issues',
  '',
  '| Severity | URL | Issue | Detail |',
  '|---|---|---|---|',
  ...issues.map((i) => `| ${i.severity} | ${i.url} | ${i.code} | ${String(i.detail).replace(/\|/g, '/').slice(0, 160)} |`),
  '',
  '## Pages',
  '',
  '| URL | Status | Title | Desc len | H1 | JSON-LD | Words |',
  '|---|---|---|---|---|---|---|',
  ...pages.map((p) => `| ${show(p.url)} | ${p.status} | ${(p.title ?? '').replace(/\|/g, '/').slice(0, 70)} | ${p.description?.length ?? ''} | ${p.h1 ?? ''} | ${(p.jsonLd ?? []).join(', ')} | ${p.words ?? ''} |`),
  '',
].join('\n');
fs.writeFileSync(path.join(outDir, `${today}.md`), md);
console.log(md.split('\n## Pages')[0]);
console.log(`Saved docs/seo/audits/${today}.md and .json`);
