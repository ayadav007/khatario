#!/usr/bin/env node
/**
 * Subscription + Authentication API Protection Audit
 * Usage: node scripts/audit-subscription-protection.js
 */
const fs = require('fs');
const path = require('path');

const PUBLIC_API_PREFIXES = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/auth/impersonate',
  '/api/signup',
  '/api/admin/auth/login',
  '/api/admin/auth/logout',
  '/api/cron/',
  '/api/webhooks/',
  '/api/webhooks/platform-billing/',
  '/api/payments/webhook',
  '/api/health',
  '/api/public/',
];

const PUBLIC_API_EXACT = new Set([
  '/api/admin/subscriptions/plans', // GET only in middleware
  '/api/admin/reports', // GET only in middleware
]);

const PLATFORM_ADMIN_PREFIX = '/api/admin/';

const AUTH_PATTERNS = [
  { name: 'authorize()', re: /\bauthorize\s*\(/ },
  { name: 'enforceAccess()', re: /\benforceAccess\s*\(/ },
  { name: 'requirePortalSession()', re: /\brequirePortalSession\s*\(/ },
  { name: 'getUserFromRequest()', re: /\bgetUserFromRequest\s*\(/ },
  { name: 'requireTenantBusinessId()', re: /\brequireTenantBusinessId\s*\(/ },
  { name: 'assertSessionValidForCookieAuth()', re: /\bassertSessionValidForCookieAuth\s*\(/ },
  { name: 'checkUserPermission()', re: /\bcheckUserPermission\s*\(/ },
  { name: 'getPlatformSessionFromRequest/platform admin', re: /requirePlatformAdmin|getPlatformAdmin|x-platform-admin-id/ },
  { name: 'CRON_SECRET', re: /CRON_SECRET|cron.*secret|x-cron-secret/i },
  { name: 'webhook signature', re: /webhook.*secret|verifyWebhook|x-hub-signature|razorpay.*signature|phonepe/i },
  { name: 'attendance session', re: /attendance_sessions|session_token/ },
  { name: 'public token/link', re: /public_link|share_token|portal_token|guest/i },
];

const SUB_PATTERNS = [
  { name: 'assertFeatureAccess', re: /\bassertFeatureAccess\s*\(/ },
  { name: 'assertReportAccess', re: /\bassertReportAccess\s*\(/ },
  { name: 'enforceAccess (subscription gate)', re: /\benforceAccess\s*\(/ },
  { name: 'checkLimit', re: /\bcheckLimit\s*\(/ },
  { name: 'checkLimitInTransaction', re: /\bcheckLimitInTransaction\s*\(/ },
  { name: 'hasFeatureAccess', re: /\bhasFeatureAccess\s*\(/ },
  { name: 'hasWhatsAppBotAddon', re: /\bhasWhatsAppBotAddon\s*\(/ },
  { name: 'getBusinessSubscription + status check', re: /getBusinessSubscription[\s\S]{0,200}(isSubscriptionOperationalStatus|status\s*===|SUBSCRIPTION_INACTIVE|NO_SUBSCRIPTION)/ },
  { name: 'FeatureAccessDeniedError catch', re: /FeatureAccessDeniedError/ },
];

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const PAID_FEATURE_ROUTE_HINTS = [
  { hint: 'reports', sub: 'assertReportAccess or reports_* feature' },
  { hint: 'whatsapp', sub: 'WhatsApp addon / integration_whatsapp_*' },
  { hint: 'backup', sub: 'settings_backup feature' },
  { hint: 'recurring-invoices', sub: 'sales_recurring_invoices' },
  { hint: 'estimates', sub: 'sales_estimates' },
  { hint: 'credit-notes', sub: 'sales_credit_notes' },
  { hint: 'debit-notes', sub: 'sales_debit_notes' },
  { hint: 'sales-orders', sub: 'sales_sales_orders' },
  { hint: 'gst/', sub: 'reports_gst or GST module features' },
  { hint: 'journal-entries', sub: 'advanced_ledger' },
  { hint: 'ledger', sub: 'advanced_ledger' },
  { hint: 'cloud-storage', sub: 'settings_backup or integration' },
  { hint: 'label-templates', sub: 'template/plan feature' },
  { hint: 'employees', sub: 'HR/payroll plan limits' },
  { hint: 'work-orders', sub: 'plan feature' },
  { hint: 'purchase-orders', sub: 'purchase plan feature' },
  { hint: 'stock-transfers', sub: 'multi_branch / warehouse' },
  { hint: 'warehouses', sub: 'settings_multi_warehouse' },
  { hint: 'branches', sub: 'settings_multi_branch' },
  { hint: 'locations', sub: 'settings_multi_branch' },
  { hint: 'offline-sync/replay', sub: 'operational subscription' },
];

function walkRoutes(dir, base = '') {
  const routes = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${ent.name}` : ent.name;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) routes.push(...walkRoutes(full, rel));
    else if (ent.name === 'route.ts') routes.push({ fullPath: full, route: `/api/${rel.replace(/\\/g, '/').replace(/\/route\.ts$/, '')}` });
  }
  return routes;
}

function extractMethods(content) {
  const methods = [];
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    if (new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(content)) methods.push(m);
  }
  return methods;
}

function matchPatterns(content, patterns) {
  return patterns.filter((p) => p.re.test(content)).map((p) => p.name);
}

function isMiddlewarePublic(route) {
  if (PUBLIC_API_EXACT.has(route)) return true;
  return PUBLIC_API_PREFIXES.some((p) => route.startsWith(p));
}

function isPlatformAdmin(route) {
  if (route.startsWith(PLATFORM_ADMIN_PREFIX)) {
    if (route.startsWith('/api/admin/auth/login') || route.startsWith('/api/admin/auth/logout')) return false;
    return true;
  }
  return false;
}

function classifyAuth(route, content, methods) {
  if (isMiddlewarePublic(route)) {
    return { required: 'No (middleware public)', chain: ['middleware: PUBLIC_API'], risk: methods.some((m) => MUTATION_METHODS.has(m)) ? 'MEDIUM — public mutation endpoint' : 'LOW — intentional public' };
  }
  if (isPlatformAdmin(route)) {
    const hits = matchPatterns(content, AUTH_PATTERNS);
    return { required: 'Yes (platform admin JWT)', chain: ['middleware: platform-admin JWT', ...hits], risk: hits.length ? 'LOW' : 'MEDIUM — relies on middleware only' };
  }

  const hits = matchPatterns(content, AUTH_PATTERNS);
  const chain = ['middleware: business JWT (401 if missing)', ...hits];

  if (hits.length === 0) {
    const hasBusinessIdOnly = /business_id/.test(content) && !/x-authenticated-user-id|getUserIdFromRequest|requireTenantBusinessId/.test(content);
    return {
      required: 'Partial (middleware JWT only)',
      chain,
      risk: methods.some((m) => MUTATION_METHODS.has(m))
        ? 'HIGH — mutation without authorize/enforceAccess in handler'
        : hasBusinessIdOnly
          ? 'MEDIUM — reads business_id from client; middleware JWT present but no RBAC'
          : 'MEDIUM — handler lacks explicit auth/RBAC',
    };
  }

  return { required: 'Yes', chain, risk: 'LOW' };
}

function classifySubscription(route, content, methods, auth) {
  if (isMiddlewarePublic(route) || isPlatformAdmin(route)) {
    return { required: 'N/A', chain: [], risk: 'N/A' };
  }

  const hits = matchPatterns(content, SUB_PATTERNS);
  const chain = [...hits];

  // Core free features — subscription feature gate often not needed but operational sub may be implied
  const coreFreePatterns = [
    /^\/api\/customers(\/|$)/,
    /^\/api\/items(\/|$)/,
    /^\/api\/invoices(\/|$)/,
    /^\/api\/payments(\/|$)/,
    /^\/api\/subscriptions(\/|$)/,
    /^\/api\/dashboard(\/|$)/,
    /^\/api\/search$/,
    /^\/api\/notifications(\/|$)/,
    /^\/api\/auth(\/|$)/,
    /^\/api\/categories(\/|$)/,
  ];

  const isCore = coreFreePatterns.some((re) => re.test(route));
  const hasMutation = methods.some((m) => MUTATION_METHODS.has(m));

  if (hits.length > 0) {
    return { required: hits.includes('enforceAccess (subscription gate)') || hits.some((h) => h.startsWith('assert')) ? 'Yes' : 'Partial', chain, risk: 'LOW' };
  }

  // Paid feature route hints
  const paidHints = PAID_FEATURE_ROUTE_HINTS.filter(({ hint }) => route.includes(hint));
  if (paidHints.length > 0) {
    const sev = hasMutation ? 'CRITICAL' : 'HIGH';
    return {
      required: 'No',
      chain: [`expected: ${paidHints.map((h) => h.sub).join('; ')}`],
      risk: `${sev} — paid-feature route without server-side subscription check`,
    };
  }

  if (isCore) {
    // May still need checkLimit on POST
    const hasLimit = /\bcheckLimit\s*\(/.test(content) || /\benforceAccess\s*\([^)]*limitType/.test(content);
    if (hasMutation && !hasLimit && /\/api\/(customers|items|invoices|employees)\b/.test(route)) {
      return { required: 'Partial (feature N/A; limit missing)', chain: ['core entitlement — no feature gate'], risk: 'MEDIUM — mutation may bypass usage limits' };
    }
    return { required: 'Partial (core/free; operational sub via middleware only)', chain: ['no assertFeatureAccess — core feature'], risk: 'LOW–MEDIUM — expired trial may still access if only JWT auth' };
  }

  if (hasMutation) {
    return { required: 'No', chain: [], risk: 'HIGH — mutation without subscription enforcement' };
  }

  return { required: 'No', chain: [], risk: 'MEDIUM — read endpoint without subscription check' };
}

function main() {
  const apiDir = path.join(process.cwd(), 'app', 'api');
  const routes = walkRoutes(apiDir);
  const rows = [];

  for (const { fullPath, route } of routes) {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const methods = extractMethods(content);
    if (!methods.length) continue;

    const relFile = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
    const auth = classifyAuth(route, content, methods);
    const sub = classifySubscription(route, content, methods, auth);

    for (const method of methods) {
      rows.push({
        method,
        route,
        file: relFile,
        authRequired: auth.required,
        subRequired: sub.required,
        middlewareChain: [...new Set([...auth.chain, ...sub.chain.filter((c) => !c.startsWith('expected'))])].join(' → ') || 'middleware JWT only',
        risk: sub.risk !== 'N/A' && sub.risk !== 'LOW' ? sub.risk : auth.risk,
        authChain: auth.chain.join(', '),
        subChain: sub.chain.join(', '),
      });
    }
  }

  const unprotectedSub = rows.filter((r) => r.subRequired === 'No' && !r.route.startsWith('/api/admin') && !isMiddlewarePublic(r.route));
  const partialAuth = rows.filter((r) => r.authRequired.includes('Partial'));
  const critical = rows.filter((r) => String(r.risk).startsWith('CRITICAL') || r.risk === 'HIGH — mutation without subscription enforcement' || r.risk.includes('paid-feature'));

  const outPath = path.join(process.cwd(), 'docs', 'SUBSCRIPTION_API_AUDIT.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), totalRoutes: routes.length, totalHandlers: rows.length, rows }, null, 2));

  console.log(JSON.stringify({
    summary: {
      routeFiles: routes.length,
      handlerRows: rows.length,
      fullyProtectedSub: rows.filter((r) => r.subRequired === 'Yes').length,
      partialSub: rows.filter((r) => r.subRequired.startsWith('Partial')).length,
      noSub: unprotectedSub.length,
      partialAuth: partialAuth.length,
      criticalOrHighSub: critical.length,
    },
    criticalSample: critical.slice(0, 40).map((r) => ({ method: r.method, route: r.route, file: r.file, risk: r.risk })),
    unprotectedSubSample: unprotectedSub.slice(0, 40).map((r) => ({ method: r.method, route: r.route, file: r.file })),
  }, null, 2));
}

main();
