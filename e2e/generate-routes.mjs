import fs from 'fs';
import path from 'path';

const APP = path.join(process.cwd(), 'app');
const SAMPLE = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'demo',
  token: 'sample-token',
  reportType: 'summary',
  businessId: '00000000-0000-4000-8000-000000000001',
  taskId: '00000000-0000-4000-8000-000000000002',
};

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name === 'page.tsx') acc.push(full);
  }
  return acc;
}

function toRoute(file) {
  const rel = path.relative(APP, path.dirname(file)).split(path.sep);
  const segments = rel
    .filter((segment) => segment && !segment.startsWith('('))
    .map((segment) => {
      const dynamic = segment.match(/^\[(?:\.\.\.)?(.+)\]$/);
      if (!dynamic) return segment;
      const name = dynamic[1];
      if (!SAMPLE[name]) {
        throw new Error(`No sample id for dynamic segment [${name}] in ${file}`);
      }
      return SAMPLE[name];
    });
  return '/' + segments.join('/');
}

function excludedForBusinessUser(route) {
  return (
    route === '/offline' ||
    route === '/admin' ||
    route.startsWith('/admin/') ||
    route === '/partners' ||
    route.startsWith('/partners/') ||
    route === '/demo/employees' ||
    route.startsWith('/demo/employees/')
  );
}

const routes = [...new Set(walk(APP).map(toRoute))]
  .filter((route) => !excludedForBusinessUser(route))
  .sort((a, b) => a.localeCompare(b));
const out = path.join(process.cwd(), 'e2e', 'routes.json');
fs.writeFileSync(out, JSON.stringify(routes, null, 2) + '\n');
console.log(`Wrote ${routes.length} routes to ${out}`);
