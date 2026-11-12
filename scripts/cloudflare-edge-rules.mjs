#!/usr/bin/env node
/**
 * Khatario Cloudflare edge rules: rate limits on login/OTP routes, scanner and attack-pattern
 * blocks, and scripted-client blocks on pages. See deploy/cloudflare/README.md.
 *
 * Dry run (default): reads the zone's current rules and prints what would change. Writes nothing.
 * Apply:             node scripts/cloudflare-edge-rules.mjs --apply
 *
 * Env: CF_API_TOKEN (Zone > Zone WAF > Edit, for the khatario.com zone only), CF_ZONE_ID.
 * Rules are zone-wide, so they cover khatario.com, app., www. and staging.khatario.com.
 * Only rules whose description starts with "[khatario]" are replaced; rules added by hand in the
 * dashboard are kept, after ours.
 */

const TAG = '[khatario]';
const API = 'https://api.cloudflare.com/client/v4';

// ---- helpers for the Cloudflare rules language ------------------------------------------------
const str = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const anyContains = (field, list) => list.map((p) => `${field} contains ${str(p)}`).join(' or ');
const anyStarts = (field, list) => list.map((p) => `starts_with(${field}, ${str(p)})`).join(' or ');
const anyEnds = (field, list) => list.map((p) => `ends_with(${field}, ${str(p)})`).join(' or ');

const PATH = 'lower(http.request.uri.path)';
const URI = 'lower(url_decode(http.request.uri))';
const UA = 'lower(http.user_agent)';

// Server-to-server callers. They must never be challenged or pattern-blocked.
const WEBHOOK_PREFIXES = ['/api/webhooks/', '/api/payments/webhook', '/api/whatsapp/webhook'];

// Login, password reset and OTP routes (POST only in the app).
const AUTH_EXACT = [
  '/api/auth/login',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/admin/auth/login',
  '/api/partners/auth/login',
  '/api/public/platform-otp',
  '/api/attendance/send-otp',
  '/api/attendance/verify-otp',
];
// /api/public/employee/[slug]/login, /api/public/portal/[slug]/request-otp, /api/public/store/[sub]/otp, ...
const AUTH_PUBLIC_SUFFIXES = ['/login', '/forgot-password', '/reset-password', '/request-otp', '/verify-otp', '/otp'];

// Paths a Next.js app never serves. /.well-known/ stays open (Android asset links, Apple, ACME).
const PROBE_PREFIXES = [
  '/wp-admin', '/wp-login', '/wp-content', '/wp-includes', '/xmlrpc', '/phpmyadmin', '/pma',
  '/cgi-bin', '/vendor/', '/actuator', '/server-status', '/solr', '/boaform', '/owa/', '/autodiscover',
];
const PROBE_CONTAINS = ['.php', '/.env', '/.git', '/.aws', '/.ssh', '/.svn', '/.ds_store', 'web.config'];
const PROBE_SUFFIXES = ['.asp', '.aspx', '.jsp', '.cgi', '.sql', '.bak', '.old', '.swp'];
// Vulnerability scanners identify themselves often enough to be worth naming.
const SCANNER_UAS = ['sqlmap', 'nikto', 'nuclei', 'masscan', 'zgrab', 'nmap', 'wpscan', 'dirbuster', 'gobuster', 'acunetix', 'netsparker'];

// Checked against the decoded URL (path + query string). Request bodies need Enterprise.
const ATTACK_PATTERNS = [
  // path traversal / file read
  '../', '..%2f', '%2e%2e', '/etc/passwd', '/proc/self', 'c:/windows', 'file://',
  // SQL injection
  'union select', 'union all select', 'information_schema', 'sleep(', 'benchmark(', 'waitfor delay',
  'pg_sleep', "' or '1'='1", "' or 1=1", '" or 1=1', ' or 1=1--', 'xp_cmdshell',
  // XSS
  '<script', 'javascript:', 'onerror=', 'onload=', '<svg', '<iframe', 'document.cookie', 'alert(',
  // template / JNDI injection
  '${jndi:', '{{7*7}}',
];

// Scraping libraries. Browsers, the Capacitor webview and the Flutter app (Dart) never send these.
// Not listed on purpose: HeadlessChrome (our Playwright runs and Lighthouse), okhttp and dart (apps).
const SCRAPER_UAS = [
  'python-requests', 'python-urllib', 'aiohttp', 'httpx', 'curl/', 'wget/', 'scrapy', 'go-http-client',
  'java/', 'libwww-perl', 'node-fetch', 'axios/', 'guzzlehttp', 'phantomjs', 'colly', 'httpie',
];

const notWebhook = `not (${anyStarts(PATH, WEBHOOK_PREFIXES)})`;

const CUSTOM_RULES = [
  {
    description: `${TAG} Skip the remaining Khatario rules for payment and WhatsApp webhooks`,
    expression: anyStarts(PATH, WEBHOOK_PREFIXES),
    action: 'skip',
    action_parameters: { ruleset: 'current' },
    enabled: true,
  },
  {
    description: `${TAG} Block scanner probes for paths the app never serves`,
    expression: [
      anyStarts(PATH, PROBE_PREFIXES),
      anyContains(PATH, PROBE_CONTAINS),
      anyEnds(PATH, PROBE_SUFFIXES),
      anyContains(UA, SCANNER_UAS),
    ].join(' or '),
    action: 'block',
    enabled: true,
  },
  {
    description: `${TAG} Block SQL injection, XSS and path traversal in the URL`,
    expression: `${notWebhook} and (${anyContains(URI, ATTACK_PATTERNS)} or http.request.uri contains "%00" or lower(http.request.uri) contains "%252e")`,
    action: 'block',
    enabled: true,
  },
  {
    description: `${TAG} Block scraping libraries and empty user agents on pages (pricing, marketing, stores)`,
    expression:
      // HEAD is exempt so `curl -sI https://khatario.com/login` (deploy check) still works.
      `not cf.client.bot and http.request.method ne "HEAD" and not starts_with(http.request.uri.path, "/api/") ` +
      `and not starts_with(http.request.uri.path, "/_next/") and not starts_with(http.request.uri.path, "/.well-known/") ` +
      `and (http.user_agent eq "" or ${anyContains(UA, SCRAPER_UAS)})`,
    action: 'block',
    enabled: true,
  },
];

// Free plan: one rule, 10 s period, 10 s block, counted per IP per Cloudflare data centre.
// 10 per 10 s leaves room for many shop staff behind one mobile-carrier NAT IP, and stops a
// 200-per-minute stuffing run within seconds. The app's own 5-per-15-minute login limit
// still handles slow attacks. On Pro, see README for the 60 s / 10 min variant.
const RATE_LIMIT_RULES = [
  {
    description: `${TAG} Rate limit login, password reset and OTP routes per IP`,
    expression:
      `http.request.uri.path in {${AUTH_EXACT.map(str).join(' ')}} or ` +
      `(starts_with(http.request.uri.path, "/api/public/") and (${anyEnds('http.request.uri.path', AUTH_PUBLIC_SUFFIXES)}))`,
    action: 'block',
    ratelimit: {
      characteristics: ['cf.colo.id', 'ip.src'],
      period: Number(process.env.CF_RL_PERIOD || 10),
      requests_per_period: Number(process.env.CF_RL_REQUESTS || 10),
      mitigation_timeout: Number(process.env.CF_RL_TIMEOUT || 10),
    },
    enabled: true,
  },
];

const PHASES = [
  { phase: 'http_request_firewall_custom', rules: CUSTOM_RULES, label: 'Custom WAF rules' },
  { phase: 'http_ratelimit', rules: RATE_LIMIT_RULES, label: 'Rate limiting rules' },
];

// ---- API --------------------------------------------------------------------------------------
async function cf(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 404) return null;
  if (!res.ok || json.success === false) {
    const errs = (json.errors || []).map((e) => `${e.code}: ${e.message}`).join('; ');
    throw new Error(`${method} ${path} -> HTTP ${res.status} ${errs}`);
  }
  return json.result;
}

const keep = ({ id, ref, description, expression, action, action_parameters, ratelimit, enabled, logging }) =>
  Object.fromEntries(
    Object.entries({ id, ref, description, expression, action, action_parameters, ratelimit, enabled, logging }).filter(
      ([, v]) => v !== undefined,
    ),
  );

async function main() {
  const apply = process.argv.includes('--apply');
  const print = process.argv.includes('--print');

  if (print) {
    console.log(JSON.stringify(Object.fromEntries(PHASES.map((p) => [p.phase, p.rules])), null, 2));
    return;
  }
  if (!process.env.CF_API_TOKEN || !process.env.CF_ZONE_ID) {
    console.error('Set CF_API_TOKEN and CF_ZONE_ID (or run with --print to see the rules offline).');
    process.exit(1);
  }
  const zone = process.env.CF_ZONE_ID;

  for (const { phase, rules, label } of PHASES) {
    const current = await cf('GET', `/zones/${zone}/rulesets/phases/${phase}/entrypoint`);
    const existing = current?.rules || [];
    const ours = existing.filter((r) => (r.description || '').startsWith(TAG));
    const theirs = existing.filter((r) => !(r.description || '').startsWith(TAG));

    console.log(`\n== ${label} (${phase})`);
    console.log(`   now: ${existing.length} rule(s), ${ours.length} ours, ${theirs.length} added by hand (kept)`);
    for (const r of theirs) console.log(`   keep   ${r.action.padEnd(16)} ${r.description || r.id}`);
    for (const r of ours) console.log(`   remove ${r.action.padEnd(16)} ${r.description}`);
    for (const r of rules) console.log(`   add    ${r.action.padEnd(16)} ${r.description}`);

    if (!apply) continue;
    const next = [...rules, ...theirs.map(keep)];
    await cf('PUT', `/zones/${zone}/rulesets/phases/${phase}/entrypoint`, { rules: next });
    console.log(`   applied: ${next.length} rule(s)`);
  }
  if (!apply) console.log('\nDry run. Nothing changed. Re-run with --apply to write these rules.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
