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

const routes = walk('app/api');
const rawQueryOnly = [];
const rawBodyOnly = [];
const helperOnly = [];
const tenantGuard = [];
const mixed = [];
const pathBizId = [];

for (const { f, route } of routes) {
  const c = fs.readFileSync(f, 'utf8');
  if (!/business_id|businessId/.test(c)) continue;
  const rawQ = /searchParams\.get\s*\(\s*['"]business_id['"]\s*\)/.test(c);
  const rawB = /body\.business_id|body\?\.business_id/.test(c);
  const helper = /getBusinessIdFromRequest\s*\(/.test(c);
  const session = /requireTenantBusinessId\s*\(|getSessionScopedBusinessId\s*\(/.test(c);
  const pathSeg = /\[businessId\]|\[business_id\]|businesses\/\[id\]|profile\/\[businessId\]/.test(route);

  if (session) tenantGuard.push({ route, file: f.replace(/\\/g, '/') });
  else if (pathSeg) pathBizId.push({ route, file: f.replace(/\\/g, '/') });
  else if (rawQ && !helper) rawQueryOnly.push({ route, file: f.replace(/\\/g, '/') });
  else if (rawB && !helper && !rawQ) rawBodyOnly.push({ route, file: f.replace(/\\/g, '/') });
  else if (helper && !rawQ && !rawB) helperOnly.push({ route, file: f.replace(/\\/g, '/') });
  else if (helper && (rawQ || rawB)) mixed.push({ route, file: f.replace(/\\/g, '/') });
}

console.log(JSON.stringify({
  tenantGuard: tenantGuard.length,
  rawQueryOnly: rawQueryOnly.length,
  rawBodyOnly: rawBodyOnly.length,
  helperOnly: helperOnly.length,
  mixed: mixed.length,
  pathBizId: pathBizId.length,
}, null, 2));

console.log('\nRAW QUERY ONLY (first 80):');
rawQueryOnly.slice(0, 80).forEach((x) => console.log(x.route));

fs.writeFileSync('docs/BUSINESS_ID_RAW_QUERY_ONLY.json', JSON.stringify(rawQueryOnly, null, 2));
fs.writeFileSync('docs/BUSINESS_ID_RAW_BODY_ONLY.json', JSON.stringify(rawBodyOnly, null, 2));
fs.writeFileSync('docs/BUSINESS_ID_PATH_PARAM.json', JSON.stringify(pathBizId, null, 2));
