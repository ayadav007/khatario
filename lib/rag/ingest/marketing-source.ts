import { queryRows } from '@/lib/db';
import type { KbSourceInput } from '../types';

const SLUG_URLS: Record<string, string> = { home: '/' };

const HEADING_KEYS = ['title', 'heading', 'headline', 'eyebrow', 'question', 'name', 'label'];
const SKIP_KEYS = new Set([
  'id', 'href', 'url', 'src', 'image', 'imageUrl', 'icon', 'iconName', 'color', 'background',
  'variant', 'align', 'theme', 'className', 'style', 'ogImage', 'layout', 'size', 'anchor',
]);

function stripHtml(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeProse(value: string): boolean {
  const v = value.trim();
  if (v.length < 3) return false;
  if (/^(https?:|\/|#|mailto:|tel:|data:)/i.test(v)) return false;
  if (/^#?[0-9a-f]{3,8}$/i.test(v)) return false;
  if (/^[a-z0-9_-]+$/.test(v) && !v.includes(' ') && v.length < 24) return false;
  return /[A-Za-z\u0900-\u097F]/.test(v);
}

function collectText(node: unknown, out: string[], depth = 0): void {
  if (depth > 8 || node == null) return;
  if (typeof node === 'string') {
    const clean = stripHtml(node);
    if (looksLikeProse(clean)) out.push(clean);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, out, depth + 1);
    return;
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (SKIP_KEYS.has(key)) continue;
      collectText(value, out, depth + 1);
    }
  }
}

type PuckBlock = { type?: string; props?: Record<string, unknown> };
type PuckDoc = { root?: { props?: Record<string, unknown> }; content?: PuckBlock[] };

/** Flattens a published Site Builder (Puck) document into markdown, one section per block. */
export function marketingDocumentToMarkdown(doc: PuckDoc, pageTitle: string): string {
  const lines: string[] = [`# ${pageTitle}`, ''];
  const rootProps = doc.root?.props ?? {};
  if (typeof rootProps.description === 'string') lines.push(stripHtml(rootProps.description), '');

  for (const block of doc.content ?? []) {
    const props = block.props ?? {};
    const headingKey = HEADING_KEYS.find((k) => typeof props[k] === 'string' && looksLikeProse(String(props[k])));
    const heading = headingKey ? stripHtml(String(props[headingKey])) : (block.type ?? 'Section');
    const texts: string[] = [];
    collectText(
      Object.fromEntries(Object.entries(props).filter(([k]) => k !== headingKey)),
      texts,
    );
    const unique = Array.from(new Set(texts));
    if (!unique.length) continue;
    lines.push(`## ${heading}`, '', ...unique.map((t) => (t.length > 80 ? t : `- ${t}`)), '');
  }
  return lines.join('\n').trim() + '\n';
}

export async function loadMarketingSources(slug?: string): Promise<KbSourceInput[]> {
  const rows = await queryRows<{ slug: string; published_data: PuckDoc | null }>(
    `SELECT slug, published_data FROM marketing_pages
      WHERE published_data IS NOT NULL ${slug ? 'AND slug = $1' : ''}`,
    slug ? [slug] : [],
  );
  return rows.map((row) => {
    const title = typeof row.published_data?.root?.props?.title === 'string'
      ? String(row.published_data.root.props.title)
      : `Khatario ${row.slug} page`;
    return {
      kind: 'marketing_page' as const,
      locator: row.slug,
      audiences: ['prospect'],
      businessId: null,
      documents: [
        {
          docKey: row.slug,
          title,
          url: SLUG_URLS[row.slug] ?? '/',
          audiences: ['prospect'],
          locale: 'en',
          tags: ['marketing'],
          requiredFeature: null,
          body: marketingDocumentToMarkdown(row.published_data ?? {}, title),
        },
      ],
    };
  });
}
