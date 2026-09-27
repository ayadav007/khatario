import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { normalizeText, tokenize } from './text';

export type Glossary = Map<string, string[]>;

let cached: Glossary | null = null;

export function parseGlossary(source: string): Glossary {
  const map: Glossary = new Map();
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([^:]+):\s*\[(.*)\]\s*$/.exec(line);
    if (!m) continue;
    const term = normalizeText(m[1]);
    const expansions = m[2]
      .split(',')
      .map((s) => normalizeText(s))
      .filter(Boolean);
    if (term && expansions.length) map.set(term, expansions);
  }
  return map;
}

export function loadGlossary(cwd = process.cwd()): Glossary {
  if (cached) return cached;
  const path = join(cwd, 'knowledge', '_meta', 'glossary.yml');
  cached = existsSync(path) ? parseGlossary(readFileSync(path, 'utf8')) : new Map();
  return cached;
}

export interface TermGroup {
  /** The user's own word (or phrase) as typed. */
  term: string;
  /** Tokens that count as a match for this term, including glossary expansions. */
  alternatives: string[];
}

/**
 * Split a query into term groups. Multi-word glossary phrases ("bill kaise banaye") are matched
 * first so their expansion is used instead of the individual (often stopword) tokens.
 */
export function expandQuery(text: string, glossary: Glossary = loadGlossary()): TermGroup[] {
  let normalized = ` ${normalizeText(text)} `;
  const groups: TermGroup[] = [];

  const phrases = Array.from(glossary.keys())
    .filter((k) => k.includes(' '))
    .sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    if (normalized.includes(` ${phrase} `)) {
      const alts = [...glossary.get(phrase)!.flatMap((e) => tokenize(e)), ...tokenize(phrase)];
      groups.push({ term: phrase, alternatives: Array.from(new Set(alts)) });
      normalized = normalized.split(` ${phrase} `).join(' ');
    }
  }

  for (const token of tokenize(normalized)) {
    if (groups.some((g) => g.term === token)) continue;
    const alts = new Set([token]);
    for (const e of glossary.get(token) ?? []) tokenize(e).forEach((t) => alts.add(t));
    groups.push({ term: token, alternatives: Array.from(alts) });
  }
  return groups;
}
