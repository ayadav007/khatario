#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const raw = JSON.parse(fs.readFileSync('docs/BUSINESS_ID_RAW_QUERY_ONLY.json', 'utf8'));

const enriched = raw.map(({ route, file }) => {
  const c = fs.readFileSync(file, 'utf8');
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((m) =>
    new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(c)
  );
  const hasAuthorize = /\bauthorize\s*\(/.test(c);
  const hasPortalSession = /requirePortalSession\s*\(/.test(c);
  const hasUserCheck = /getUserIdFromRequest|user_id is required|Authentication required/.test(c);
  const hasAssertFeature = /assertFeatureAccess|assertReportAccess|enforceAccess/.test(c);
  const isMutation = methods.some((m) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m));
  const isPublic = route.startsWith('/api/cron/') || route.startsWith('/api/admin/');

  let severity = 5;
  let crossTenant = 'YES — query business_id used directly in handler';
  let notes = [];

  if (isPublic) {
    severity = 3;
    crossTenant = 'Varies — admin/cron scope';
  } else if (!hasAuthorize && !hasPortalSession && !hasUserCheck) {
    severity = isMutation ? 10 : 9;
    notes.push('No user/RBAC check in handler — JWT middleware only');
  } else if (hasAuthorize && !/context\s*\?\.\s*businessId|businessId:\s*business/.test(c)) {
    severity = isMutation ? 8 : 7;
    notes.push('authorize() present but businessId may not be passed — RBAC uses user DB business_id for resource loads');
  } else if (hasAuthorize) {
    severity = isMutation ? 7 : 6;
    notes.push('authorize() with client businessId in context — verify mismatch handling');
  } else if (hasPortalSession) {
    severity = 6;
    notes.push('Session validated but tenant not bound to query param');
  }

  if (/backup|ledger|journal|settings\/users|employees|payroll|salary|bank-statement|gst|invoice|customer|items|search|features\/enabled|recurring|cloud-storage|notifications|documents|tds|budget|commission|opening-balance|financial-year|depreciation|provisions|payment-method|warehouse|location|inventory|purchases|suppliers|payments|bulk|extract|import|restore|debug/.test(route)) {
    if (severity >= 7) severity = Math.min(10, severity + 1);
    notes.push('Sensitive domain');
  }

  return { route, file, methods, hasAuthorize, hasPortalSession, hasUserCheck, hasAssertFeature, isMutation, severity, crossTenant, notes: notes.join('; ') };
});

enriched.sort((a, b) => b.severity - a.severity || a.route.localeCompare(b.route));

const bySeverity = {
  critical: enriched.filter((e) => e.severity >= 9),
  high: enriched.filter((e) => e.severity >= 7 && e.severity < 9),
  medium: enriched.filter((e) => e.severity >= 5 && e.severity < 7),
};

fs.writeFileSync('docs/BUSINESS_ID_IDOR_RANKED.json', JSON.stringify({ summary: { total: enriched.length, critical: bySeverity.critical.length, high: bySeverity.high.length, medium: bySeverity.medium.length }, ...bySeverity, all: enriched }, null, 2));

console.log('Critical (no user check):', bySeverity.critical.filter((e) => !e.hasAuthorize && !e.hasPortalSession).length);
bySeverity.critical.filter((e) => !e.hasAuthorize && !e.hasPortalSession).slice(0, 35).forEach((e) => console.log(e.severity, e.methods.join(','), e.route));
