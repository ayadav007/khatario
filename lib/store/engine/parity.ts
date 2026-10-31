// Server-only, pure (D36): the targets and the HTML page of the store engine parity report. The browser work lives in
// scripts/store-engine-parity.mjs; nothing here touches the network, the disk or a database.
import type { MigrationReportRow } from './migrate-runner';

export const PARITY_WIDTHS = [390, 1280] as const;

const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const STAGING_HOST = 'staging.khatario.com';
const DEMO_SUBDOMAINS = ['theme-studio', 'theme-khatario', 'theme-grocery', 'theme-quick'] as const;

export interface ParityTarget {
  label: string;
  oldUrl: string;
  newUrl: string;
}

export interface ParityRow extends ParityTarget {
  /** One entry per width; an empty `old` or `new` path means that shot failed. */
  shots: Array<{ width: number; old: string; new: string }>;
}

/**
 * The origin of one store under an allowed base. Only `http://localhost[:port]`, `http://127.0.0.1[:port]` and
 * `https://staging.khatario.com` are accepted (AGENTS.md: no browser automation on production); anything else throws.
 */
export function storeOrigin(base: string, subdomain: string): string {
  if (!SUBDOMAIN_RE.test(subdomain)) throw new Error(`Not a store subdomain: ${JSON.stringify(subdomain)}`);
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error('--base must be http://localhost:<port>, http://127.0.0.1:<port> or https://staging.khatario.com');
  }
  const bare = !url.username && !url.password && (url.pathname === '/' || url.pathname === '') && !url.search && !url.hash;
  if (bare && url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
    return `http://${subdomain}.localhost${url.port ? `:${url.port}` : ''}`;
  }
  if (bare && url.protocol === 'https:' && url.hostname === STAGING_HOST && !url.port) {
    return `https://${subdomain}.${STAGING_HOST}`;
  }
  throw new Error('--base must be http://localhost:<port>, http://127.0.0.1:<port> or https://staging.khatario.com');
}

/**
 * True when the parity browser may navigate to `url` under this base: the base's own host or one of its store
 * subdomains, on the base's protocol (and port, for localhost). Anything else (a redirect to a custom or
 * production domain, a bad URL) is false, so the script never drives a page outside localhost or staging.
 */
export function parityNavigationAllowed(base: string, url: string): boolean {
  let origin: URL;
  let target: URL;
  try {
    origin = new URL(storeOrigin(base, 'theme-studio'));
    target = new URL(url);
  } catch {
    return false;
  }
  if (target.protocol === 'about:' && target.href === 'about:blank') return true;
  if (target.protocol !== origin.protocol || target.username || target.password) return false;
  const root = origin.hostname.replace(/^theme-studio\./, '');
  if (root === 'localhost') {
    const hostOk = target.hostname === 'localhost' || target.hostname === '127.0.0.1' || target.hostname.endsWith('.localhost');
    return hostOk && target.port === origin.port;
  }
  return (target.hostname === root || target.hostname.endsWith(`.${root}`)) && !target.port;
}

/** A same-origin path (`/…`, not `//host…`), or null. */
function localPath(path: string | undefined): string | null {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  return path;
}

/**
 * D36 targets: with `demos`, the four theme demo stores at `/` (old) and `/?engine=1` (new); from a migration report,
 * each `migrated` row with a `preview_path`, at `/` (old) and that path (new). `only` keeps one subdomain.
 */
export function parityTargets(input: {
  base: string;
  demos: boolean;
  report?: { rows: MigrationReportRow[] };
  only?: string | null;
}): ParityTarget[] {
  storeOrigin(input.base, 'theme-studio'); // refuse a bad base even when there is nothing to shoot
  const out: Array<ParityTarget & { sub: string }> = [];
  if (input.demos) {
    for (const sub of DEMO_SUBDOMAINS) {
      const origin = storeOrigin(input.base, sub);
      out.push({ sub, label: `demo-${sub}`, oldUrl: `${origin}/`, newUrl: `${origin}/?engine=1` });
    }
  }
  for (const row of input.report?.rows ?? []) {
    if (row.status !== 'migrated') continue;
    const sub = row.subdomain ?? '';
    const path = localPath(row.preview_path);
    if (!path || !SUBDOMAIN_RE.test(sub)) continue;
    const origin = storeOrigin(input.base, sub);
    out.push({ sub, label: sub, oldUrl: `${origin}/`, newUrl: `${origin}${path}` });
  }
  return out
    .filter((t) => !input.only || t.sub === input.only || t.label === input.only)
    .map(({ label, oldUrl, newUrl }) => ({ label, oldUrl, newUrl }));
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A URL for display: a preview share token is replaced by `…`. */
function shownUrl(url: string): string {
  return url.replace(/([?&]pt=)[^&#]*/g, '$1…');
}

function shotCell(path: string, alt: string): string {
  if (!path) return '<td class="failed">failed</td>';
  const src = path.split('/').map(encodeURIComponent).join('/');
  return `<td><a href="${esc(src)}"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy"></a></td>`;
}

/** The report page: one section per target, old on the left and new on the right for each width. */
export function parityHtml(rows: ParityRow[]): string {
  const sections = rows.map((row) => {
    const widths = row.shots
      .map(
        (s) =>
          `<tr><th scope="row">${esc(String(s.width))} px</th>${shotCell(s.old, `${row.label} old ${s.width}`)}${shotCell(
            s.new,
            `${row.label} new ${s.width}`,
          )}</tr>`,
      )
      .join('\n');
    return `<section>
<h2>${esc(row.label)}</h2>
<p>Old: <code>${esc(shownUrl(row.oldUrl))}</code><br>New: <code>${esc(shownUrl(row.newUrl))}</code></p>
<table>
<thead><tr><th>Width</th><th>Old storefront</th><th>Engine</th></tr></thead>
<tbody>
${widths}
</tbody>
</table>
</section>`;
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Store engine parity</title>
<style>
body { font: 14px/1.4 system-ui, sans-serif; margin: 16px; background: #fff; color: #111; }
section { margin: 0 0 32px; }
table { border-collapse: collapse; width: 100%; table-layout: fixed; }
th, td { border: 1px solid #ddd; padding: 6px; vertical-align: top; text-align: left; }
thead th:first-child, tbody th { width: 72px; }
img { max-width: 100%; display: block; }
td.failed { background: #fde2e2; color: #b00020; font-weight: 600; }
code { word-break: break-all; }
</style>
</head>
<body>
<h1>Store engine parity</h1>
<p>${rows.length} store${rows.length === 1 ? '' : 's'}. Old storefront on the left, engine on the right. No pixel diff.</p>
${sections.join('\n')}
</body>
</html>
`;
}
