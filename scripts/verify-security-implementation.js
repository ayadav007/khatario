#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function walk(d, b = '') {
  let r = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const rel = b ? `${b}/${e.name}` : e.name;
    const f = path.join(d, e.name);
    if (e.isDirectory()) r = r.concat(walk(f, rel));
    else if (e.name === 'route.ts') r.push({ f, route: `/api/${rel.replace(/\\/g, '/').replace(/\/route\.ts$/, '')}` });
  }
  return r;
}

function methods(c) {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((m) =>
    new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b|export\\s+const\\s+${m}\\s*=`).test(c)
  );
}

const PREMIUM_PATTERNS = [
  { module: 'Work Orders', re: /^\/api\/work-orders/ },
  { module: 'Ledger', re: /^\/api\/ledger/ },
  { module: 'Accounts', re: /^\/api\/accounts/ },
  { module: 'Budgets', re: /^\/api\/budgets/ },
  { module: 'TDS', re: /^\/api\/tds/ },
  { module: 'GST', re: /^\/api\/gst/ },
  { module: 'Bank Statements', re: /^\/api\/bank-statements/ },
  { module: 'WhatsApp Premium', re: /^\/api\/whatsapp/ },
];

function analyzeRoute(f, route) {
  const c = fs.readFileSync(f, 'utf8');
  const m = methods(c);
  const hasWrapper =
    /\bwithPremiumSubscriptionApi\b/.test(c) ||
    /\bwithWhatsAppPremiumApi\b/.test(c) ||
    /\bwithBusinessApi\b/.test(c);
  const hasGstr2bGuard = /\bassertGstr2bApiAccess\b/.test(c);
  const hasCronAuth = /\bassertCronAuthorized\b/.test(c);
  const hasRequireOpSub = /\brequireOperationalSubscription\b/.test(c) ||
    /\bassertOperationalSubscription\b/.test(c);
  const hasTenantGuard =
    /\brequireTenantBusinessId\b/.test(c) ||
    /\bgetSessionScopedBusinessId\b/.test(c) ||
    hasWrapper ||
    hasGstr2bGuard;
  const hasAuth =
    /\bauthorize\s*\(/.test(c) ||
    /\benforceAccess\s*\(/.test(c) ||
    /\brequirePortalSession\b/.test(c) ||
    /\bgetUserIdFromRequest\b/.test(c) && /\bAuthentication required\b/.test(c) ||
    hasWrapper ||
    hasGstr2bGuard ||
    hasCronAuth;
  const hasSubscription =
    hasWrapper ||
    hasGstr2bGuard ||
    hasRequireOpSub ||
    /\benforceAccess\s*\(/.test(c) ||
    /\bassertFeatureAccess\b/.test(c) ||
    /\bassertReportAccess\b/.test(c) ||
    hasCronAuth;
  const hasFeature =
    /\bassertFeatureAccess\b/.test(c) ||
    /\bassertReportAccess\b/.test(c) ||
    /\benforceAccess\s*\([^)]*feature/.test(c) ||
    /\bhasWhatsAppBotAddon\b/.test(c) ||
    hasGstr2bGuard;
  const rawQuery = /searchParams\.get\s*\(\s*['"]business_id['"]\s*\)/.test(c);
  const rawBody = /body\.business_id|body\?\.business_id/.test(c);
  const usesHelper = /getBusinessIdFromRequest\s*\(/.test(c);
  const sqlUsesClientBiz =
    (rawQuery || rawBody) &&
    !hasTenantGuard &&
    !hasWrapper &&
    /WHERE[^;]*business_id\s*=\s*\$/.test(c);

  let tenantSource = 'none/session-wrapper';
  if (hasWrapper || hasGstr2bGuard) tenantSource = 'wrapper/guard → session tenant';
  else if (/\brequireTenantBusinessId\b/.test(c)) tenantSource = 'requireTenantBusinessId';
  else if (rawQuery && !usesHelper) tenantSource = 'raw query business_id';
  else if (rawBody && !usesHelper) tenantSource = 'raw body business_id';
  else if (usesHelper) tenantSource = 'getBusinessIdFromRequest (JWT-first)';

  let tenantSafe = 'SAFE';
  if (hasTenantGuard || hasWrapper || hasGstr2bGuard) tenantSafe = 'SAFE';
  else if (rawQuery && !usesHelper) tenantSafe = 'UNSAFE';
  else if (rawBody && !usesHelper && !/requireTenantBusinessId/.test(c)) tenantSafe = 'UNSAFE';
  else if (usesHelper) tenantSafe = 'SAFE (JWT-first when session present)';

  const mod = PREMIUM_PATTERNS.find((p) => p.re.test(route));
  let premiumPass = null;
  if (mod) {
    const authOk = hasWrapper || hasGstr2bGuard || hasCronAuth || (/\bauthorize\b/.test(c) || /\bgetUserIdFromRequest\b/.test(c));
    const tenantOk = hasWrapper || hasGstr2bGuard || /\brequireTenantBusinessId\b/.test(c);
    const subOk = hasSubscription;
    premiumPass = authOk && tenantOk && subOk ? 'PASS' : 'FAIL';
  }

  return {
    route,
    file: f.replace(/\\/g, '/'),
    methods: m,
    hasWrapper,
    hasGstr2bGuard,
    hasCronAuth,
    hasSubscription,
    hasFeature,
    tenantSource,
    tenantSafe,
    premiumModule: mod?.module || null,
    premiumPass,
    sqlUsesClientBiz,
  };
}

const routes = walk('app/api');
const analyzed = routes.map(({ f, route }) => analyzeRoute(f, route));

const premium = analyzed.filter((a) => a.premiumModule);
const premiumFail = premium.filter((a) => a.premiumPass === 'FAIL');
const tenantUnsafe = analyzed.filter((a) => a.tenantSafe === 'UNSAFE' || a.tenantSafe.startsWith('UNSAFE'));
const waPremium = premium.filter((a) => a.premiumModule === 'WhatsApp Premium');
const waNoWrapper = waPremium.filter((a) => !a.hasWrapper && !a.hasGstr2bGuard);

const subAudit = JSON.parse(fs.readFileSync('docs/SUBSCRIPTION_API_AUDIT.json', 'utf8'));
const pentest = JSON.parse(fs.readFileSync('docs/EXPIRED_SUB_PENTEST.json', 'utf8'));

function sev(risk) {
  const s = String(risk);
  if (s.includes('CRITICAL')) return 'CRITICAL';
  if (s.includes('HIGH')) return 'HIGH';
  if (s.includes('MEDIUM')) return 'MEDIUM';
  return 'LOW';
}
const crit = subAudit.rows.filter((r) => sev(r.risk) === 'CRITICAL').length;
const high = subAudit.rows.filter((r) => sev(r.risk) === 'HIGH').length;
const med = subAudit.rows.filter((r) => sev(r.risk) === 'MEDIUM').length;

const out = {
  foundation: {
    requireOperationalSubscription: fs.existsSync('lib/security/require-operational-subscription.ts'),
    withBusinessApi: fs.existsSync('lib/security/with-business-api.ts'),
    productionRefsWithBusinessApi: analyzed.filter((a) => /withBusinessApi|withPremiumSubscriptionApi|withWhatsAppPremiumApi/.test(fs.readFileSync(a.file, 'utf8'))).length,
    directWithBusinessApiRoutes: analyzed.filter((a) => /\bwithBusinessApi\b/.test(fs.readFileSync(a.file, 'utf8')) && !/\bwithPremiumSubscriptionApi\b/.test(fs.readFileSync(a.file, 'utf8'))).map((a) => a.route),
  },
  premiumSummary: {
    total: premium.length,
    pass: premium.filter((a) => a.premiumPass === 'PASS').length,
    fail: premiumFail.length,
    failRoutes: premiumFail.map((a) => ({ route: a.route, file: a.file, sub: a.hasSubscription, tenant: a.hasWrapper || /requireTenantBusinessId/.test(fs.readFileSync(a.file, 'utf8')) })),
  },
  whatsAppNotWrapped: waNoWrapper.map((a) => a.route),
  tenantUnsafeCount: tenantUnsafe.length,
  tenantUnsafeSample: tenantUnsafe.slice(0, 80).map((a) => ({ route: a.route, source: a.tenantSource })),
  auditFresh: { critical: crit, high, medium: med, pentestExposed: pentest.totalExposed },
  cronRoutes: analyzed.filter((a) => a.route.startsWith('/api/cron')).map((a) => ({ route: a.route, cronAuth: a.hasCronAuth })),
};

fs.writeFileSync('docs/_verify-data.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
