#!/usr/bin/env node
/**
 * Cross-tenant business_id audit
 * Usage: node scripts/audit-business-id-sources.js
 */
const fs = require('fs');
const path = require('path');

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

const PUBLIC_PREFIXES = [
  '/api/auth/login', '/api/auth/logout', '/api/auth/refresh', '/api/signup',
  '/api/admin/auth/login', '/api/admin/auth/logout', '/api/cron/', '/api/webhooks/',
  '/api/payments/webhook', '/api/health', '/api/public/',
];
const PUBLIC_EXACT = new Set(['/api/admin/subscriptions/plans', '/api/admin/reports']);

function isPublic(route) {
  if (PUBLIC_EXACT.has(route)) return true;
  return PUBLIC_PREFIXES.some((p) => route.startsWith(p));
}

function extractMethods(content) {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((m) =>
    new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(content)
  );
}

function analyze(content, route, filePath) {
  const methods = extractMethods(content);
  if (!methods.length) return null;

  const sources = [];
  if (/getSessionScopedBusinessId\s*\(/.test(content)) sources.push('session:getSessionScopedBusinessId');
  if (/requireTenantBusinessId\s*\(/.test(content)) sources.push('session:requireTenantBusinessId');
  if (/getBusinessIdFromRequest\s*\(/.test(content)) sources.push('helper:getBusinessIdFromRequest (session first, then body/query)');
  if (/searchParams\.get\s*\(\s*['"]business_id['"]\s*\)/.test(content)) sources.push('raw:query business_id');
  if (/searchParams\.get\s*\(\s*['"]businessId['"]\s*\)/.test(content)) sources.push('raw:query businessId');
  if (/body\.business_id|body\?\.business_id/.test(content)) sources.push('raw:body business_id');
  if (/headers\.get\s*\(\s*['"]x-business-id['"]\s*\)/.test(content)) sources.push('raw:header x-business-id');
  if (/headers\.get\s*\(\s*['"]x-authenticated-business-id['"]\s*\)/.test(content) && !sources.some((s) => s.startsWith('session'))) {
    sources.push('raw:header x-authenticated-business-id (direct read)');
  }
  if (/\[businessId\]|\[business_id\]|businesses\/\[id\]|profile\/\[businessId\]|hub\/profile\/\[businessId\]/.test(route)) {
    sources.push('path:dynamic business id segment');
  }
  if (/params\.businessId|params\.business_id|params\.id/.test(content) && /business/i.test(route)) {
    sources.push('path:params used in handler');
  }
  if (/getUserFromRequest\s*\(/.test(content)) sources.push('user:getUserFromRequest (loads user.business_id from DB)');

  const hasTenantGuard =
    /requireTenantBusinessId\s*\(/.test(content) ||
    (/getSessionScopedBusinessId\s*\(/.test(content) && !/getBusinessIdFromRequest\s*\(/.test(content)) ||
    (/business_id\s*!==\s*sessionBusinessId|Business scope mismatch|does not match your session|claimed.*businessId/i.test(content));

  const usesRawOnly =
    (sources.some((s) => s.startsWith('raw:')) || sources.some((s) => s.startsWith('path:'))) &&
    !sources.some((s) => s.startsWith('session:')) &&
    !/getBusinessIdFromRequest\s*\(/.test(content);

  const usesHelperWithoutTenantGuard =
    /getBusinessIdFromRequest\s*\(/.test(content) &&
    !/requireTenantBusinessId\s*\(/.test(content) &&
    !/getSessionScopedBusinessId\s*\(/.test(content);

  const hasAuthorize = /\bauthorize\s*\(/.test(content);
  const hasAuthCheck = hasAuthorize || /requirePortalSession\s*\(/.test(content);

  // Cross-tenant risk classification
  let crossTenantRisk = 'LOW';
  let crossTenantNote = '';
  let severity = 1;

  if (isPublic(route)) {
    crossTenantRisk = 'N/A (public)';
    crossTenantNote = 'Public route; tenant model differs';
  } else if (route.startsWith('/api/admin/')) {
    crossTenantRisk = 'ADMIN';
    crossTenantNote = 'Platform admin scope';
  } else if (usesRawOnly) {
    crossTenantRisk = 'HIGH';
    crossTenantNote = 'Uses client business_id without session helper — IDOR if JWT present for tenant A but query/body says tenant B';
    severity = 9;
  } else if (usesHelperWithoutTenantGuard) {
    // When middleware sets header, getBusinessIdFromRequest ignores client override — safe for normal portal
    crossTenantRisk = 'LOW-MEDIUM';
    crossTenantNote = 'getBusinessIdFromRequest prefers session header; client param ignored when middleware JWT present. Risk: offline passthrough / missing header paths';
    severity = 3;
    if (!hasAuthCheck) {
      crossTenantRisk = 'MEDIUM';
      crossTenantNote += '; no authorize() — defense is session header only';
      severity = 6;
    }
  } else if (hasTenantGuard) {
    crossTenantRisk = 'LOW';
    crossTenantNote = 'Explicit session tenant binding or mismatch rejection';
    severity = 1;
  } else if (sources.some((s) => s.startsWith('path:'))) {
    crossTenantRisk = 'MEDIUM-HIGH';
    crossTenantNote = 'Path includes foreign businessId; verify handler checks membership';
    severity = 7;
  } else if (sources.length === 0 && /business_id/.test(content)) {
    crossTenantRisk = 'MEDIUM';
    crossTenantNote = 'business_id in SQL/variables; manual trace needed';
    severity = 5;
  } else if (!/business_id|businessId/.test(content)) {
    crossTenantRisk = 'NONE';
    crossTenantNote = 'No business_id in handler';
    severity = 0;
  }

  // Elevate known bad patterns
  if (/searchParams\.get\s*\(\s*['"]business_id['"]\s*\)/.test(content) && !/requireTenantBusinessId|getSessionScopedBusinessId|getBusinessIdFromRequest/.test(content)) {
    crossTenantRisk = 'CRITICAL';
    crossTenantNote = 'Raw query business_id only — classic cross-tenant IDOR';
    severity = 10;
  }
  if (/body\.business_id/.test(content) && !/requireTenantBusinessId|getSessionScopedBusinessId|getBusinessIdFromRequest|business_id\s*!==/.test(content)) {
    crossTenantRisk = 'CRITICAL';
    crossTenantNote = 'Raw body business_id without session binding';
    severity = 10;
  }

  // Offline catalog passthrough
  if (route.includes('/offline-sync/catalog/')) {
    crossTenantRisk = 'HIGH';
    crossTenantNote = 'Middleware can inject headers from query user_id/business_id when JWT expired (LOCAL_SESSION_COOKIE)';
    severity = 8;
  }

  // Hub profile by businessId in path
  if (route.includes('/suppliers/hub/profile/')) {
    crossTenantRisk = 'MEDIUM';
    crossTenantNote = 'Cross-business supplier hub read — may be intentional marketplace';
    severity = 5;
  }

  return {
    route,
    file: path.relative(process.cwd(), filePath).replace(/\\/g, '/'),
    methods,
    sources: [...new Set(sources)],
    crossTenantRisk,
    crossTenantNote,
    severity,
    hasTenantGuard,
    hasAuthCheck,
    usesRawOnly,
  };
}

const apiDir = path.join(process.cwd(), 'app', 'api');
const routes = walkRoutes(apiDir);
const findings = [];

for (const { fullPath, route } of routes) {
  const content = fs.readFileSync(fullPath, 'utf8');
  const a = analyze(content, route, fullPath);
  if (!a) continue;
  if (a.crossTenantRisk === 'NONE' || a.crossTenantRisk === 'N/A (public)' || a.crossTenantRisk === 'ADMIN') continue;
  if (a.severity >= 3) findings.push(a);
}

findings.sort((a, b) => b.severity - a.severity || a.route.localeCompare(b.route));

const critical = findings.filter((f) => f.severity >= 9);
const high = findings.filter((f) => f.severity >= 7 && f.severity < 9);
const medium = findings.filter((f) => f.severity >= 5 && f.severity < 7);
const lowMed = findings.filter((f) => f.severity >= 3 && f.severity < 5);

const out = {
  generatedAt: new Date().toISOString(),
  summary: {
    routesScanned: routes.length,
    flagged: findings.length,
    critical: critical.length,
    high: high.length,
    medium: medium.length,
    lowMedium: lowMed.length,
  },
  critical,
  high,
  medium,
  lowMed,
  all: findings,
};

fs.writeFileSync('docs/BUSINESS_ID_TENANT_AUDIT.json', JSON.stringify(out, null, 2));

// Also list ALL routes that mention business_id with source breakdown
const allBiz = [];
for (const { fullPath, route } of routes) {
  const content = fs.readFileSync(fullPath, 'utf8');
  if (!/business_id|businessId|getBusinessIdFromRequest|requireTenantBusinessId|getSessionScopedBusinessId/.test(content)) continue;
  const a = analyze(content, route, fullPath);
  if (!a) continue;
  allBiz.push(a);
}
fs.writeFileSync('docs/BUSINESS_ID_ALL_ROUTES.json', JSON.stringify({ count: allBiz.length, routes: allBiz }, null, 2));

console.log(JSON.stringify(out.summary, null, 2));
console.log('CRITICAL sample:', critical.slice(0, 20).map((f) => ({ route: f.route, file: f.file, sources: f.sources })));
