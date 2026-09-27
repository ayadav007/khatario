import type { ChunkDraft } from '../types';

export interface ChunkOptions {
  targetTokens: number;
  maxTokens: number;
  overlapTokens: number;
  /** Sections shorter than this are folded into the next section instead of standing alone. */
  minSectionTokens: number;
}

const DEFAULTS: ChunkOptions = {
  targetTokens: 380,
  maxTokens: 560,
  overlapTokens: 60,
  minSectionTokens: 18,
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface Section {
  path: string[];
  body: string;
}

function splitSections(markdown: string): Section[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const sections: Section[] = [];
  const stack: Array<{ level: number; text: string }> = [];
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    const body = buffer.join('\n').trim();
    sections.push({ path: stack.map((s) => s.text), body });
    buffer = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = !inFence ? /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (m) {
      flush();
      const level = m[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, text: m[2].trim() });
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections.filter((s) => s.body.length > 0 || s.path.length > 0);
}

function splitLongParagraph(paragraph: string, maxTokens: number): string[] {
  if (estimateTokens(paragraph) <= maxTokens) return [paragraph];
  const sentences = paragraph.split(/(?<=[.!?।])\s+/);
  const out: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (estimateTokens(candidate) > maxTokens && current) {
      out.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out.flatMap((part) => {
    if (estimateTokens(part) <= maxTokens) return [part];
    const size = maxTokens * 4;
    const pieces: string[] = [];
    for (let i = 0; i < part.length; i += size) pieces.push(part.slice(i, i + size));
    return pieces;
  });
}

function tailForOverlap(text: string, overlapTokens: number): string {
  if (overlapTokens <= 0) return '';
  const chars = overlapTokens * 4;
  if (text.length <= chars) return text;
  const slice = text.slice(-chars);
  const boundary = slice.search(/(?<=[.!?।\n])\s/);
  return (boundary > 0 ? slice.slice(boundary) : slice).trim();
}

/**
 * Heading-aware chunker: each heading section becomes one or more chunks, so FAQ entries
 * stay individually retrievable while long guides are split near the target size.
 */
export function chunkMarkdown(markdown: string, options: Partial<ChunkOptions> = {}): ChunkDraft[] {
  const opts = { ...DEFAULTS, ...options };
  const sections = splitSections(markdown);
  const chunks: ChunkDraft[] = [];
  let carry = '';

  const push = (headingPath: string, content: string) => {
    const text = content.trim();
    if (!text) return;
    chunks.push({
      ordinal: chunks.length,
      headingPath,
      content: text,
      tokenEstimate: estimateTokens(text),
    });
  };

  for (let s = 0; s < sections.length; s++) {
    const section = sections[s];
    const headingPath = section.path.join(' > ');
    const body = carry ? `${carry}\n\n${section.body}`.trim() : section.body;
    carry = '';

    const hasMore = s < sections.length - 1;
    if (estimateTokens(body) < opts.minSectionTokens && hasMore) {
      carry = body;
      continue;
    }

    const paragraphs = body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .flatMap((p) => splitLongParagraph(p, opts.maxTokens));

    let current = '';
    for (const paragraph of paragraphs) {
      const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
      if (estimateTokens(candidate) > opts.targetTokens && current) {
        push(headingPath, current);
        const overlap = tailForOverlap(current, opts.overlapTokens);
        current = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
      } else {
        current = candidate;
      }
    }
    push(headingPath, current);
  }
  if (carry) push(sections[sections.length - 1]?.path.join(' > ') ?? '', carry);
  return chunks;
}
