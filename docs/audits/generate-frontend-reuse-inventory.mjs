/**
 * Read-only frontend reuse inventory.
 * Run from the repo root: node docs/audits/generate-frontend-reuse-inventory.mjs
 *
 * Does not modify application source. Writes JSON beside this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'docs', 'audits');

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'phone',
  'android',
  'ios',
  'coverage',
  'dist',
  'out',
  'brag-output',
  '.git',
  'playwright-report',
  'test-results',
  'worker',
]);

const SCAN_ROOTS = ['app', 'components', 'hooks', 'contexts', 'lib'];

const UI_BUSINESS = new Set([
  'HSNLookup.tsx',
  'BarcodeScanner.tsx',
  'ContinuousBarcodeScanner.tsx',
  'ItemAutocomplete.tsx',
  'IntlPhoneInput.tsx',
  'GSTStatusIndicator.tsx',
  'SyncStatusBadge.tsx',
  'StatusBadge.tsx',
  'CelebrationOverlay.tsx',
]);

const SHARED_PREFIXES = [
  'components/layout/',
  'components/navigation/',
  'components/tables/',
  'components/filters/',
  'components/notifications/',
  'components/theme/',
  'components/common/',
  'components/guards/',
  'components/accessibility/',
  'components/system/',
];

function walk(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function rel(full) {
  return path.relative(root, full).replace(/\\/g, '/');
}

function isTest(file) {
  return /\.(test|spec)\.[jt]sx?$/.test(file) || file.includes('/tests/') || file.startsWith('tests/');
}

function isStory(file) {
  return file.includes('.stories.') || file.includes('/stories/');
}

const sourceFiles = [];
for (const name of SCAN_ROOTS) {
  const dir = path.join(root, name);
  if (!fs.existsSync(dir)) continue;
  for (const full of walk(dir)) {
    if (!/\.[jt]sx?$/.test(full)) continue;
    const r = rel(full);
    if (isTest(r) || isStory(r)) continue;
    sourceFiles.push(r);
  }
}

const fileSet = new Set(sourceFiles);
const existsCache = new Map();

function fileExists(r) {
  if (existsCache.has(r)) return existsCache.get(r);
  const ok = fs.existsSync(path.join(root, r));
  existsCache.set(r, ok);
  return ok;
}

function resolveImport(fromFile, spec) {
  let target;
  if (spec.startsWith('@/')) target = spec.slice(2);
  else if (spec.startsWith('.')) {
    target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  } else return null;
  const candidates = [
    target,
    `${target}.tsx`,
    `${target}.ts`,
    `${target}.jsx`,
    `${target}.js`,
    `${target}/index.tsx`,
    `${target}/index.ts`,
    `${target}/index.jsx`,
    `${target}/index.js`,
  ];
  for (const c of candidates) {
    if (fileSet.has(c) || fileExists(c)) return c;
  }
  return null;
}

const importFromRe =
  /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const valueImportRe =
  /import\s+(?!type\b)([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
const reexportRe =
  /export\s+(?!type\b)(?:\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]/g;
const dynamicImportRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
const exportFnRe = /export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/g;
const exportConstRe = /export\s+const\s+([A-Z][A-Za-z0-9_]*)\s*=/g;

const directConsumers = new Map();
const reexports = new Map();
const texts = new Map();

function addConsumer(target, from) {
  if (!target || target === from) return;
  if (!directConsumers.has(target)) directConsumers.set(target, new Set());
  directConsumers.get(target).add(from);
}

for (const file of sourceFiles) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  texts.set(file, text);
  for (const match of text.matchAll(valueImportRe)) {
    addConsumer(resolveImport(file, match[2]), file);
  }
  for (const match of text.matchAll(dynamicImportRe)) {
    addConsumer(resolveImport(file, match[1]), file);
  }
  const outs = [];
  for (const match of text.matchAll(reexportRe)) {
    const target = resolveImport(file, match[1]);
    if (target) outs.push(target);
  }
  if (outs.length) reexports.set(file, outs);
}

function transitiveConsumers(file) {
  const seen = new Set();
  const stack = [file];
  const importersOf = new Map();
  for (const [target, set] of directConsumers) {
    importersOf.set(target, set);
  }
  const reverseReexport = new Map();
  for (const [from, targets] of reexports) {
    for (const t of targets) {
      if (!reverseReexport.has(t)) reverseReexport.set(t, new Set());
      reverseReexport.get(t).add(from);
    }
  }
  while (stack.length) {
    const current = stack.pop();
    for (const importer of importersOf.get(current) || []) {
      if (seen.has(importer)) continue;
      seen.add(importer);
    }
    for (const barrel of reverseReexport.get(current) || []) {
      if (seen.has(barrel)) continue;
      seen.add(barrel);
      stack.push(barrel);
    }
  }
  seen.delete(file);
  return seen;
}

function routeFromPage(file) {
  let route = file.replace(/^app\//, '').replace(/\/page\.tsx$/, '');
  route = route
    .split('/')
    .filter((seg) => !(seg.startsWith('(') && seg.endsWith(')')))
    .join('/');
  if (route === '') return '/';
  return `/${route}`;
}

function kindOf(file) {
  const base = path.posix.basename(file);
  if (file.startsWith('app/api/') && base === 'route.ts') return 'api-route';
  if (base === 'page.tsx') return 'page';
  if (base === 'layout.tsx' || base === 'template.tsx') return 'layout';
  if (['loading.tsx', 'error.tsx', 'not-found.tsx', 'default.tsx'].includes(base)) return 'route-special';
  if (file.startsWith('hooks/')) return 'hook';
  if (file.startsWith('contexts/')) return 'provider';
  if (file.startsWith('components/ui/')) {
    return UI_BUSINESS.has(base) ? 'shared-business' : 'ui-primitive';
  }
  if (SHARED_PREFIXES.some((p) => file.startsWith(p))) return 'shared-business';
  if (file.startsWith('components/')) return 'feature-component';
  if (file.startsWith('app/') && file.endsWith('.tsx')) return 'page-local-component';
  if (file.startsWith('lib/') && file.endsWith('.tsx')) return 'lib-ui';
  return 'other';
}

function exportsOf(text) {
  const names = new Set();
  for (const match of text.matchAll(exportFnRe)) names.add(match[1]);
  for (const match of text.matchAll(exportConstRe)) names.add(match[1]);
  return [...names];
}

function isPageFile(file) {
  return file.endsWith('/page.tsx') || file === 'app/page.tsx';
}

const componentKinds = new Set([
  'ui-primitive',
  'shared-business',
  'feature-component',
  'page-local-component',
  'lib-ui',
]);

const components = [];
for (const file of sourceFiles) {
  if (!file.endsWith('.tsx')) continue;
  const kind = kindOf(file);
  if (!componentKinds.has(kind)) continue;
  const text = texts.get(file);
  const direct = directConsumers.get(file) || new Set();
  const trans = transitiveConsumers(file);
  const pages = [...trans].filter(isPageFile);
  components.push({
    file,
    kind,
    exports: exportsOf(text),
    hasVariantProp: /variant\??:/.test(text),
    hasSizeProp: /size\??:/.test(text),
    lines: text.split(/\n/).length,
    directConsumers: direct.size,
    consumers: trans.size,
    pageConsumers: pages.length,
    consumerFiles: [...trans].sort(),
  });
}

const pages = sourceFiles.filter(isPageFile).map((file) => {
  const text = texts.get(file);
  const uiImports = [...text.matchAll(/from\s+['"](@\/components\/ui\/[^'"]+)['"]/g)].map((m) => m[1]);
  const layoutImports = [...text.matchAll(/from\s+['"](@\/components\/layout\/[^'"]+)['"]/g)].map((m) => m[1]);
  const rawButtons = (text.match(/<button[\s>]/g) || []).length;
  const usesSharedButton = /from\s+['"]@\/components\/ui\/Button['"]/.test(text);
  const classCount = (text.match(/className=/g) || []).length;
  return {
    file,
    route: routeFromPage(file),
    group: file.split('/')[1]?.startsWith('(') ? file.split('/')[1] : '(root)',
    lines: text.split(/\n/).length,
    uiImports: [...new Set(uiImports)],
    layoutImports: [...new Set(layoutImports)],
    usesDesignSystem: uiImports.length > 0 || layoutImports.length > 0,
    rawButtons,
    usesSharedButton,
    classCount,
    independentStyling: uiImports.length === 0 && layoutImports.length === 0 && classCount >= 12,
  };
});

const routeSet = new Map();
for (const page of pages) {
  if (!routeSet.has(page.route)) routeSet.set(page.route, []);
  routeSet.get(page.route).push(page.file);
}

const layouts = sourceFiles.filter((f) => f.endsWith('/layout.tsx') || f.endsWith('/template.tsx'));
const apiRoutes = sourceFiles.filter((f) => f.startsWith('app/api/') && f.endsWith('/route.ts'));

const byName = new Map();
for (const c of components) {
  for (const name of c.exports) {
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(c.file);
  }
}
const duplicateNames = [...byName.entries()]
  .filter(([, files]) => new Set(files).size > 1)
  .map(([name, files]) => ({ name, files: [...new Set(files)].sort() }))
  .sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name));

function countMatches(re) {
  let files = 0;
  let hits = 0;
  const sample = [];
  for (const [file, text] of texts) {
    const found = text.match(re);
    if (!found) continue;
    files += 1;
    hits += found.length;
    if (sample.length < 8) sample.push(file);
  }
  return { files, hits, sample };
}

const patterns = {
  rawButton: countMatches(/<button[\s>]/g),
  sharedButtonImport: countMatches(/from\s+['"]@\/components\/ui\/Button['"]/g),
  rawTextInput: countMatches(/<input[\s>]/g),
  sharedInputImport: countMatches(/from\s+['"]@\/components\/ui\/Input['"]/g),
  nativeSelect: countMatches(/<select[\s>]/g),
  datePickerImport: countMatches(/from\s+['"]@\/components\/ui\/DatePicker['"]/g),
  dateTimePickerImport: countMatches(/from\s+['"]@\/components\/ui\/DateTimePicker['"]/g),
  reactDayPicker: countMatches(/from\s+['"]react-day-picker['"]/g),
  statusBadgeImport: countMatches(/from\s+['"]@\/components\/ui\/StatusBadge['"]/g),
  localStatusBadge: countMatches(/function\s+StatusBadge\s*\(/g),
  windowConfirm: countMatches(/window\.confirm\s*\(/g),
  radixDialog: countMatches(/@radix-ui\/react-dialog/g),
  slideOver: countMatches(/from\s+['"]@\/components\/ui\/SlideOverPanel['"]/g),
  listPageHeader: countMatches(/from\s+['"]@\/components\/layout\/ListPageHeader['"]/g),
  pageHeader: countMatches(/from\s+['"]@\/components\/layout\/PageHeader['"]/g),
  formPageScaffold: countMatches(/from\s+['"]@\/components\/ui\/FormPageScaffold['"]/g),
  reactHotToast: countMatches(/from\s+['"]react-hot-toast['"]/g),
  useToast: countMatches(/from\s+['"]@\/hooks\/useToast['"]/g),
  uiToast: countMatches(/from\s+['"]@\/components\/ui\/Toast['"]/g),
  localFormatInr: countMatches(/function\s+formatInr\s*\(/g),
  localFormatINR: countMatches(/function\s+formatINR\s*\(/g),
  localFormatMoney: countMatches(/function\s+formatMoney\s*\(/g),
  enInLocale: countMatches(/toLocaleString\(\s*['"]en-IN['"]/g),
  quantityDisplayImport: countMatches(/from\s+['"]@\/lib\/quantity-display['"]/g),
  useEntityList: countMatches(/from\s+['"]@\/hooks\/useEntityList['"]/g),
  zodImport: countMatches(/from\s+['"]zod['"]/g),
  skeletonClass: countMatches(/animate-pulse/g),
  emptyCopy: countMatches(/No [\w ]{0,40} yet/g),
};

const buckets = { one: 0, twoToFive: 0, moreThanFive: 0, zero: 0 };
for (const c of components) {
  if (c.consumers === 0) buckets.zero += 1;
  else if (c.consumers === 1) buckets.one += 1;
  else if (c.consumers <= 5) buckets.twoToFive += 1;
  else buckets.moreThanFive += 1;
}

const kindCounts = {};
for (const c of components) kindCounts[c.kind] = (kindCounts[c.kind] || 0) + 1;

const summary = {
  generatedAt: new Date().toISOString(),
  method:
    'Static scan of app, components, hooks, contexts, and lib. Tests, stories, phone/, and API implementation bodies are excluded from the component graph. Consumers follow value imports, dynamic import(), and re-export barrels. import type is ignored.',
  scannedFiles: sourceFiles.length,
  pageFiles: pages.length,
  distinctRoutes: routeSet.size,
  duplicateRoutePaths: [...routeSet.entries()].filter(([, files]) => files.length > 1),
  layoutFiles: layouts.length,
  apiRouteFiles: apiRoutes.length,
  componentFiles: components.length,
  kindCounts,
  consumerBuckets: buckets,
  pagesUsingDesignSystem: pages.filter((p) => p.usesDesignSystem).length,
  pagesWithIndependentStyling: pages.filter((p) => p.independentStyling).length,
  pagesWithRawButtons: pages.filter((p) => p.rawButtons > 0).length,
  pagesUsingSharedButton: pages.filter((p) => p.usesSharedButton).length,
  patterns,
  duplicateExportNames: duplicateNames.length,
};

const top = [...components].sort((a, b) => b.consumers - a.consumers || a.file.localeCompare(b.file)).slice(0, 40);

fs.writeFileSync(path.join(outDir, 'frontend-reuse-summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(
  path.join(outDir, 'frontend-routes.json'),
  JSON.stringify(
    pages.map(({ consumerFiles, ...p }) => p),
    null,
    2,
  ),
);
fs.writeFileSync(
  path.join(outDir, 'frontend-components.json'),
  JSON.stringify(
    components
      .map(({ consumerFiles, ...c }) => ({
        ...c,
        consumersSample: consumerFiles.slice(0, 12),
      }))
      .sort((a, b) => b.consumers - a.consumers || a.file.localeCompare(b.file)),
    null,
    2,
  ),
);
fs.writeFileSync(path.join(outDir, 'frontend-duplicate-names.json'), JSON.stringify(duplicateNames, null, 2));
fs.writeFileSync(
  path.join(outDir, 'frontend-top-components.json'),
  JSON.stringify(
    top.map(({ consumerFiles, ...c }) => c),
    null,
    2,
  ),
);

console.log(JSON.stringify({ ...summary, patterns: Object.fromEntries(Object.entries(patterns).map(([k, v]) => [k, { files: v.files, hits: v.hits }])) }, null, 2));
