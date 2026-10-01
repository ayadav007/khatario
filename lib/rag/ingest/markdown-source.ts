import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { KB_AUDIENCES, type KbAudience, type KbSourceInput, type Locale } from '../types';
import { asString, asStringArray, parseFrontmatter } from './frontmatter';

export const KNOWLEDGE_DIR = 'knowledge';
/** `_meta` holds the glossary; `generated/` mirrors DB-backed sources that are indexed directly. */
const SKIP_DIRS = new Set(['_meta', 'generated']);

export function knowledgeRoot(cwd = process.cwd()): string {
  return join(cwd, KNOWLEDGE_DIR);
}

function walk(dir: string, root: string, out: string[]) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (dir === root && SKIP_DIRS.has(entry)) continue;
      walk(full, root, out);
    } else if (entry.endsWith('.md') && entry.toLowerCase() !== 'readme.md') {
      out.push(full);
    }
  }
}

export function listKnowledgeFiles(cwd = process.cwd()): string[] {
  const root = knowledgeRoot(cwd);
  if (!existsSync(root)) return [];
  const files: string[] = [];
  walk(root, root, files);
  return files.sort();
}

function toLocator(file: string, cwd: string): string {
  return relative(knowledgeRoot(cwd), file).split(sep).join('/');
}

function firstHeading(body: string): string | null {
  const m = /^#\s+(.+)$/m.exec(body);
  return m ? m[1].trim() : null;
}

function defaultAudience(locator: string): KbAudience[] {
  if (locator.startsWith('how-to/')) return ['tenant_user'];
  if (locator.startsWith('gst-law/')) return ['gst_law'];
  if (locator.startsWith('internal/')) return ['internal'];
  return ['prospect'];
}

export class KnowledgeFileError extends Error {}

export function loadMarkdownSource(file: string, cwd = process.cwd()): KbSourceInput {
  const locator = toLocator(file, cwd);
  const { data, body } = parseFrontmatter(readFileSync(file, 'utf8'));

  const declared = asStringArray(data.audience);
  const invalid = declared.filter((a) => !(KB_AUDIENCES as readonly string[]).includes(a));
  if (invalid.length) {
    throw new KnowledgeFileError(`${locator}: unknown audience ${invalid.join(', ')}`);
  }
  const audiences = (declared.length ? declared : defaultAudience(locator)) as KbAudience[];
  if (audiences.includes('gst_law') && audiences.length > 1) {
    throw new KnowledgeFileError(`${locator}: gst_law content must not be shared with other audiences`);
  }
  if (audiences.includes('tenant_customer')) {
    throw new KnowledgeFileError(`${locator}: tenant_customer content must come from tenant sources`);
  }

  const localeRaw = asString(data.locale) ?? 'en';
  const locale: Locale = localeRaw === 'hinglish' || localeRaw === 'hi' ? localeRaw : 'en';
  const title = asString(data.title) ?? firstHeading(body) ?? locator;

  return {
    kind: 'markdown',
    locator,
    audiences,
    businessId: null,
    documents: [
      {
        docKey: locator,
        title,
        url: asString(data.url),
        audiences,
        locale,
        tags: asStringArray(data.tags),
        requiredFeature: asString(data.required_feature),
        body: body.trim(),
      },
    ],
  };
}
