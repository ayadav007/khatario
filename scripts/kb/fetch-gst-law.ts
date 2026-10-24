/**
 * Download the GST Acts and Rules from the CBIC Tax Information Portal into knowledge/gst-law/.
 *
 *   npm run kb:fetch-gst-law
 *
 * The output is committed so deploys never depend on CBIC being reachable. Re-run after a
 * Finance Act or rules amendment, review the diff, then `npm run kb:reindex -- --source=markdown`.
 * Amendment footnotes are dropped on purpose: they quote superseded wording that the assistant
 * could otherwise present as current law.
 *
 * The CBIC server omits its intermediate certificate, so the npm script runs Node with
 * --use-system-ca (Node 22.15+) instead of disabling TLS verification.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const PORTAL = 'https://taxinformation.cbic.gov.in/';
const OUT_DIR = join(process.cwd(), 'knowledge', 'gst-law');
const CONCURRENCY = 3;
const DELAY_MS = 150;

interface LawSource {
  slug: string;
  kind: 'act' | 'rules';
  id: number;
  title: string;
  short: string;
}

const SOURCES: LawSource[] = [
  { slug: 'cgst-act', kind: 'act', id: 1000006, title: 'Central Goods and Services Tax Act, 2017', short: 'CGST Act' },
  { slug: 'igst-act', kind: 'act', id: 1000015, title: 'Integrated Goods and Services Tax Act, 2017', short: 'IGST Act' },
  { slug: 'utgst-act', kind: 'act', id: 1000016, title: 'Union Territory Goods and Services Tax Act, 2017', short: 'UTGST Act' },
  {
    slug: 'gst-compensation-act',
    kind: 'act',
    id: 1000013,
    title: 'Goods and Services Tax (Compensation to States) Act, 2017',
    short: 'GST Compensation Act',
  },
  { slug: 'cgst-rules', kind: 'rules', id: 1000006, title: 'Central Goods and Services Tax Rules, 2017', short: 'CGST Rules' },
  { slug: 'igst-rules', kind: 'rules', id: 1000028, title: 'Integrated Goods and Services Tax Rules, 2017', short: 'IGST Rules' },
];

interface Chapter {
  id: number;
  chapterNo: string | null;
  chapterName: string | null;
  orderId: number | null;
}

interface Entry {
  sectionNo: string | null;
  sectionName: string | null;
  contentFilePath: string | null;
  isActive: string | null;
  orderId: number | null;
  chapterId?: { id: number } | null;
  cbicRuleChapterMst?: { id: number } | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getText(path: string, attempt = 1): Promise<string> {
  const res = await fetch(PORTAL + path, { headers: { 'User-Agent': 'Khatario-KB/1.0 (help@khatario.com)' } });
  if (!res.ok) {
    if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
      await sleep(1000 * 2 ** attempt);
      return getText(path, attempt + 1);
    }
    throw new Error(`${res.status} ${res.statusText} for ${path}`);
  }
  return res.text();
}

async function getJson<T>(path: string): Promise<T> {
  const body = await getText(path);
  if (!body.trimStart().startsWith('[') && !body.trimStart().startsWith('{')) {
    throw new Error(`Expected JSON from ${path}; the CBIC API may have changed.`);
  }
  return JSON.parse(body) as T;
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

const FOOTNOTE_START =
  /^(\*{1,3}\s*)?(Enforced|Brought into force|Came into force)\b|^\*{0,3}\s*\d{1,2}\s*\.\s*(Substituted|Inserted|Omitted|Added|Renumbered|Re-numbered|Amended|Deleted|Rule|Words|The words|In rule|In section|Clause|Sub-rule|Sub-section|Proviso|Explanation|Vide)\b/i;

/** CBIC section HTML → plain paragraphs, without amendment footnotes or footnote markers. */
export function htmlToLawText(html: string): string {
  const body = html
    .replace(/<head[\s\S]*?<\/head>/i, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<sup[^>]*>\s*(st|nd|rd|th)\s*<\/sup>/gi, '$1')
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|table)>|<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '');
  const paragraphs = decodeEntities(body)
    .split('\n')
    .map((p) => p.replace(/\s+/g, ' ').replace(/\s*\|\s*$/, '').trim())
    .filter((p) => p && !/^[|\s*]+$/.test(p));

  const cut = paragraphs.findIndex((p, i) => i > 0 && FOOTNOTE_START.test(p));
  const kept = cut > 0 ? paragraphs.slice(0, cut) : paragraphs;
  return kept
    .map((p) => p.replace(/^\*+\s*/, ''))
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function entryHeading(src: LawSource, e: Entry): string {
  const no = (e.sectionNo ?? '').replace(/\s+/g, ' ').trim();
  const name = (e.sectionName ?? '').replace(/\s+/g, ' ').replace(/[.\s-]+$/, '').trim();
  return `${src.short}, ${no}${name ? `: ${name}` : ''}`;
}

/** Drops the repeated "Section 31. Tax invoice.-" line, since the heading already carries it. */
function stripLeadingTitle(text: string, e: Entry): string {
  const no = (e.sectionNo ?? '').replace(/^(Section|Rule)\s+/i, '').trim();
  if (!no) return text;
  const first = text.split('\n\n', 1)[0];
  const pattern = new RegExp(`^(\\[)?(Section|Rule)?\\s*${no.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\.`, 'i');
  if (pattern.test(first) && first.length < 220) {
    const rest = first.replace(/^.*?[.:]\s*-\s*|^.*?\.-/, '');
    const remaining = text.slice(first.length).trim();
    return rest && rest !== first ? `${rest}\n\n${remaining}`.trim() : remaining;
  }
  return text;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
        await sleep(DELAY_MS);
      }
    }),
  );
  return out;
}

async function buildSource(src: LawSource, fetchedOn: string): Promise<{ markdown: string; count: number; empty: string[] }> {
  const [chapters, entries] =
    src.kind === 'act'
      ? await Promise.all([
          getJson<Chapter[]>(`api/cbic-act-chapter-msts/chapterListByActId/${src.id}`),
          getJson<Entry[]>(`api/cbic-act-section-msts/findByActId/${src.id}`),
        ])
      : await Promise.all([
          getJson<Chapter[]>(`api/cbic-rule-chapter-msts/findChapterByRuleId/${src.id}`),
          getJson<Entry[]>(`api/cbic-rule-section-msts/viewBySectionAllRules/${src.id}`),
        ]);

  const chapterById = new Map(chapters.map((c) => [c.id, c]));
  const chapterOrder = (e: Entry) => chapterById.get(e.chapterId?.id ?? e.cbicRuleChapterMst?.id ?? -1)?.orderId ?? 0;
  const usable = entries
    .filter((e) => e.isActive !== 'N' && e.contentFilePath && e.sectionNo)
    .filter((e) => !/^(form|annexure|appendix)\b/i.test(e.sectionNo!.trim()))
    .filter((e) => e.sectionNo!.trim() !== src.title && !/header_v/i.test(e.contentFilePath!))
    .sort((a, b) => chapterOrder(a) - chapterOrder(b) || (a.orderId ?? 0) - (b.orderId ?? 0));

  const empty: string[] = [];
  const texts = await mapLimit(usable, CONCURRENCY, async (e) => {
    const html = await getText(`content/html/${e.contentFilePath!.replace(/\\/g, '/')}`);
    const text = stripLeadingTitle(htmlToLawText(html), e);
    if (!text) empty.push(e.sectionNo!);
    return text;
  });

  const lines: string[] = [
    '---',
    `title: ${src.title}`,
    'audience: [gst_law]',
    'locale: en',
    `tags: [gst law, ${src.short.toLowerCase()}, bare act]`,
    `url: ${PORTAL}`,
    '---',
    '',
    `# ${src.title}`,
    '',
    `Official text from the CBIC Tax Information Portal (${PORTAL}), downloaded on ${fetchedOn}. Amendment history footnotes are omitted. The text published in the Official Gazette is authoritative.`,
    '',
  ];
  let currentChapter: number | null = null;
  usable.forEach((e, i) => {
    if (!texts[i]) return;
    const chapterId = e.chapterId?.id ?? e.cbicRuleChapterMst?.id ?? null;
    const chapter = chapterId != null ? chapterById.get(chapterId) : undefined;
    if (chapterId !== currentChapter && chapter && chapter.chapterNo && chapter.chapterNo.trim() !== src.title) {
      currentChapter = chapterId;
      const name = (chapter.chapterName ?? '').replace(/[[\]]/g, '').trim();
      lines.push(`## ${src.short}, ${chapter.chapterNo.trim()}${name ? `: ${name}` : ''}`, '');
    }
    lines.push(`### ${entryHeading(src, e)}`, '', texts[i], '');
  });

  return { markdown: `${lines.join('\n').trim()}\n`, count: usable.length - empty.length, empty };
}

async function main() {
  const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
  const fetchedOn = new Date().toISOString().slice(0, 10);
  mkdirSync(OUT_DIR, { recursive: true });
  for (const src of SOURCES.filter((s) => !only || s.slug === only)) {
    const started = Date.now();
    const { markdown, count, empty } = await buildSource(src, fetchedOn);
    writeFileSync(join(OUT_DIR, `${src.slug}.md`), markdown, 'utf8');
    console.log(
      `[gst-law] ${src.slug}: ${count} entries, ${(markdown.length / 1024).toFixed(0)} KB, ${((Date.now() - started) / 1000).toFixed(0)}s` +
        (empty.length ? ` (empty: ${empty.join(', ')})` : ''),
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[gst-law] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
