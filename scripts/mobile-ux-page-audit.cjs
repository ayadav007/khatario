/**
 * Scans all Next.js app route page.tsx files and assigns a mobile UX sign-off tier.
 * Run: node scripts/mobile-ux-page-audit.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');

function walkPageFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.next') continue;
      walkPageFiles(p, acc);
    } else if (ent.name === 'page.tsx') acc.push(p);
  }
  return acc;
}

/** Next.js route from file path (omit route groups like (app)) */
function filePathToRoute(filePath) {
  const rel = path.relative(APP_DIR, filePath).replace(/\\/g, '/');
  const withoutPage = rel.replace(/\/page\.tsx$/i, '');
  if (!withoutPage || withoutPage === 'page.tsx') return '/';
  const segments = withoutPage.split('/').filter(Boolean);
  const urlSeg = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')')));
  return '/' + urlSeg.join('/');
}

function analyze(content) {
  const lines = content.split(/\r?\n/).length;
  const hasTable = /<table[\s>]/i.test(content);
  const overflowX = (content.match(/overflow-x-auto/g) || []).length;
  const hiddenMdBlock = /\bhidden\s+md:block\b/.test(content);
  const mdHidden = /\bmd:hidden\b/.test(content);
  const hiddenLgBlock = /\bhidden\s+lg:block\b/.test(content);
  const lgHidden = /\blg:hidden\b/.test(content);
  const responsiveHits = (content.match(/\b(sm|md|lg|xl|2xl):[a-z0-9[\]-]+/gi) || []).length;
  const maxBreakpointHits = (content.match(/\b(max-(sm|md|lg|xl)):/gi) || []).length;
  const flexResponsive =
    /flex-col\s+md:flex-row|md:flex-row|flex-col\s+lg:flex-row|lg:flex-row/.test(content);
  const gridResponsive = /grid-cols-1\s+(sm|md|lg):|grid-cols-1\s+gap/.test(content);
  const stackLayout =
    /\bflex-col\b/.test(content) ||
    /\bspace-y-\d/.test(content) ||
    /\bgrid-cols-1\b/.test(content);
  const fluidWidth =
    /\bw-full\b/.test(content) ||
    /\bmax-w-(sm|md|lg|xl|2xl|4xl|6xl|7xl)\b/.test(content) ||
    /\bmin-h-screen\b/.test(content);
  const minWArbitrary = (content.match(/min-w-\[[^\]]+\]/g) || []).length;
  const formControls = (
    content.match(/<input\b|<textarea\b|<select\b/gi) || []
  ).length;

  const dualTableLayoutMd =
    hasTable && hiddenMdBlock && mdHidden;
  const dualTableLayoutLg = hasTable && hiddenLgBlock && lgHidden;

  const hScrollTable =
    hasTable &&
    overflowX > 0 &&
    !(dualTableLayoutMd || dualTableLayoutLg);

  const denseForm = lines > 1100 || (lines > 650 && formControls > 35);

  return {
    lines,
    hasTable,
    overflowX,
    hiddenMdBlock,
    mdHidden,
    hiddenLgBlock,
    lgHidden,
    responsiveHits,
    maxBreakpointHits,
    flexResponsive,
    gridResponsive,
    stackLayout,
    fluidWidth,
    minWArbitrary,
    formControls,
    dualTableLayoutMd,
    dualTableLayoutLg,
    hScrollTable,
    denseForm,
  };
}

/** Effective responsive signal: breakpoints + max-* + layout primitives */
function responsiveScore(m) {
  return (
    m.responsiveHits +
    m.maxBreakpointHits +
    (m.flexResponsive ? 3 : 0) +
    (m.gridResponsive ? 2 : 0)
  );
}

function signOff(m) {
  const rs = responsiveScore(m);

  if (m.dualTableLayoutMd || m.dualTableLayoutLg) {
    return {
      tier: 'PASS',
      reason: 'Desktop table + separate mobile block (responsive split)',
    };
  }
  if (!m.hasTable && m.responsiveHits >= 8 && m.lines < 500) {
    return {
      tier: 'PASS',
      reason: 'No data table; solid responsive utility usage',
    };
  }
  if (!m.hasTable && m.lines <= 120 && m.responsiveHits >= 2) {
    return { tier: 'PASS', reason: 'Small page; stack/card layout' };
  }
  if (!m.hasTable && m.lines <= 80) {
    return { tier: 'PASS', reason: 'Minimal/static page' };
  }
  if (m.denseForm) {
    return {
      tier: 'REVIEW',
      reason: 'Very long or field-heavy form; verify sections/sticky actions on phone',
    };
  }
  if (m.hScrollTable) {
    return {
      tier: 'REVIEW',
      reason: 'Data table relies on horizontal scroll (no md/lg split detected)',
    };
  }
  if (m.hasTable && !m.overflowX) {
    return {
      tier: 'REVIEW',
      reason: 'Table without overflow-x-auto — possible layout overflow on narrow screens',
    };
  }
  if (m.hasTable && (m.dualTableLayoutMd || m.dualTableLayoutLg) === false && m.mdHidden) {
    return {
      tier: 'REVIEW',
      reason: 'Table + md:hidden present but pattern differs — verify mobile list',
    };
  }

  // No wide HTML table: common stack / card / auth patterns
  if (!m.hasTable) {
    if (rs >= 4 && m.lines < 900) {
      return { tier: 'PASS', reason: 'Responsive/stack patterns; no wide table' };
    }
    if (m.stackLayout && m.fluidWidth && m.lines < 500) {
      return {
        tier: 'PASS',
        reason: 'Vertical stack + fluid width (typical mobile-first form/list)',
      };
    }
    if (m.stackLayout && m.lines < 320 && m.overflowX <= 1) {
      return {
        tier: 'PASS',
        reason: 'Compact stacked layout; unlikely to need horizontal page scroll',
      };
    }
    if (rs >= 2 && m.lines < 220) {
      return { tier: 'PASS', reason: 'Short page with some responsive/layout tokens' };
    }
  }

  if (!m.hasTable && m.responsiveHits >= 4) {
    return { tier: 'PASS', reason: 'Responsive patterns; no wide table' };
  }
  return {
    tier: 'REVIEW',
    reason: 'Mixed/uncertain — manual check on device',
  };
}

function main() {
  const files = walkPageFiles(APP_DIR).sort((a, b) =>
    filePathToRoute(a).localeCompare(filePathToRoute(b))
  );

  const rows = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const metrics = analyze(content);
    const { tier, reason } = signOff(metrics);
    rows.push({
      route: filePathToRoute(file),
      file: path.relative(ROOT, file).replace(/\\/g, '/'),
      ...metrics,
      responsiveScore: responsiveScore(metrics),
      tier,
      reason,
    });
  }

  const outJson = path.join(ROOT, 'docs', 'mobile-ux-audit-data.json');
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify(rows, null, 2), 'utf8');

  const pass = rows.filter((r) => r.tier === 'PASS').length;
  const review = rows.filter((r) => r.tier === 'REVIEW').length;

  const md = [];
  md.push('# Mobile UX — page-by-page sign-off');
  md.push('');
  md.push(
    `Generated by \`scripts/mobile-ux-page-audit.cjs\` (${new Date().toISOString().slice(0, 10)}).`
  );
  md.push('');
  md.push('## How to read this');
  md.push('');
  md.push(
    '- **PASS**: Automated heuristics indicate a mobile-friendly pattern (split layouts, small pages, or strong responsive utilities without problematic tables).'
  );
  md.push(
    '- **REVIEW**: Needs a real device or DevTools device mode check — often table-heavy screens, huge forms, or ambiguous patterns.'
  );
  md.push(
    '- This is a **sign-off aid**, not a substitute for QA on target phones (safe areas, touch targets, keyboard overlap).'
  );
  md.push('');
  md.push('## Methodology (automation)');
  md.push('');
  md.push(
    '- **Resp. score** = `sm|md|lg|xl|2xl` token count + `max-*` tokens + 3 if flex row/column breakpoint pattern + 2 if responsive grid pattern.'
  );
  md.push(
    '- **PASS** examples: `hidden md:block` table + `md:hidden` mobile list; or no `<table>` with sufficient layout tokens / vertical stack + fluid width; or small static pages.'
  );
  md.push(
    '- **REVIEW** triggers: horizontal-scroll table without split layout; very long or field-heavy forms; tables without `overflow-x-auto`; or layouts that do not match PASS rules.'
  );
  md.push(
    '- Re-run after UI changes: `npm run audit:mobile-ux`'
  );
  md.push('');
  md.push('## Summary');
  md.push('');
  md.push(`| Total pages | PASS | REVIEW |`);
  md.push(`|------------:|-----:|-------:|`);
  md.push(`| ${rows.length} | ${pass} | ${review} |`);
  md.push('');

  md.push('## All routes');
  md.push('');
  md.push(
    '| Route | Tier | Sign-off basis | Lines | Table | overflow-x | Resp. score | md/lg tokens |'
  );
  md.push(
    '|-------|------|----------------|------:|------:|-----------:|------------:|-------------:|'
  );

  for (const r of rows) {
    const safeRoute = r.route.replace(/\|/g, '\\|');
    const safeReason = r.reason.replace(/\|/g, '/');
    md.push(
      `| \`${safeRoute}\` | **${r.tier}** | ${safeReason} | ${r.lines} | ${r.hasTable ? 'yes' : 'no'} | ${r.overflowX} | ${r.responsiveScore} | ${r.responsiveHits} |`
    );
  }

  md.push('');
  md.push('## REVIEW pages only (quick queue)');
  md.push('');
  for (const r of rows.filter((x) => x.tier === 'REVIEW')) {
    md.push(`- \`${r.route}\` — ${r.reason} (\`${r.file}\`)`);
  }

  md.push('');
  md.push('## Machine-readable data');
  md.push('');
  md.push('Full metrics: `docs/mobile-ux-audit-data.json`');

  const outMd = path.join(ROOT, 'docs', 'mobile-ux-page-signoff.md');
  fs.writeFileSync(outMd, md.join('\n'), 'utf8');

  console.log(`Wrote ${outMd}`);
  console.log(`Wrote ${outJson}`);
  console.log(`PASS: ${pass}, REVIEW: ${review}, total: ${rows.length}`);
}

main();
