import { z } from 'zod';
import { isBlockType } from '@/lib/marketing-builder/block-types';
import { isSafeHref, isSafeImageSrc, youtubeId } from '@/lib/marketing-builder/safe-url';

export const MARKETING_DOC_MAX_BYTES = 1_000_000;
const MAX_STRING = 5_000;
const MAX_ARRAY = 100;
const MAX_DEPTH = 14;
const MAX_NODES = 1_500;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const componentShape = z.object({
  type: z.string().max(60),
  props: z.record(z.unknown()),
});

const documentShape = z.object({
  root: z.object({ props: z.record(z.unknown()).optional() }).passthrough(),
  content: z.array(componentShape),
  zones: z.record(z.array(componentShape)).optional(),
});

export type MarketingComponent = { type: string; props: Record<string, unknown> & { id: string } };
export type MarketingDocument = {
  root: { props: Record<string, unknown> };
  content: MarketingComponent[];
  zones?: Record<string, MarketingComponent[]>;
};

export type SanitizeResult = { ok: true; data: MarketingDocument } | { ok: false; error: string };

class DocError extends Error {}

type Ctx = { nodes: number };

function isComponentLike(v: unknown): v is { type: unknown; props: unknown } {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    'type' in v &&
    'props' in v &&
    typeof (v as { props: unknown }).props === 'object'
  );
}

function cleanString(key: string, value: string): string {
  const v = value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
  if (/href$/i.test(key)) return isSafeHref(v) ? v.trim() : '';
  if (/(image|src)$/i.test(key)) return isSafeImageSrc(v) ? v.trim() : '';
  if (key === 'videoUrl') return v.trim() === '' || youtubeId(v) ? v.trim() : '';
  return v;
}

function cleanValue(key: string, value: unknown, depth: number, ctx: Ctx): unknown {
  if (depth > MAX_DEPTH) throw new DocError('Page is nested too deeply');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return cleanString(key, value);
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(isComponentLike)) {
      return value.map((item) => cleanComponent(item, depth + 1, ctx));
    }
    return value
      .slice(0, MAX_ARRAY)
      .map((item) => cleanValue(key, item, depth + 1, ctx))
      .filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    return cleanProps(value as Record<string, unknown>, depth + 1, ctx);
  }
  return undefined;
}

function cleanProps(props: Record<string, unknown>, depth: number, ctx: Ctx): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN_KEYS.has(key) || key.length > 60) continue;
    const cleaned = cleanValue(key, value, depth, ctx);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

function cleanComponent(raw: unknown, depth: number, ctx: Ctx): MarketingComponent {
  const parsed = componentShape.safeParse(raw);
  if (!parsed.success) throw new DocError('Malformed block');
  const { type, props } = parsed.data;
  if (!isBlockType(type)) throw new DocError(`Unknown block type: ${type}`);
  ctx.nodes += 1;
  if (ctx.nodes > MAX_NODES) throw new DocError('Page has too many blocks');
  const id = props.id;
  if (typeof id !== 'string' || !id || id.length > 120) throw new DocError(`Block ${type} is missing an id`);
  return { type, props: { ...cleanProps(props, depth, ctx), id } };
}

/** Validates an editor document before it is stored or rendered. */
export function sanitizeMarketingDocument(input: unknown): SanitizeResult {
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(input) ?? '', 'utf8');
  } catch {
    return { ok: false, error: 'Page data is not valid JSON' };
  }
  if (size > MARKETING_DOC_MAX_BYTES) {
    return { ok: false, error: 'Page is too large (limit 1 MB). Remove some blocks or long text.' };
  }

  const parsed = documentShape.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Page data has an invalid shape' };

  const ctx: Ctx = { nodes: 0 };
  try {
    const content = parsed.data.content.map((c) => cleanComponent(c, 1, ctx));
    const zones = parsed.data.zones
      ? Object.fromEntries(
          Object.entries(parsed.data.zones)
            .filter(([zone]) => zone.length <= 200 && !FORBIDDEN_KEYS.has(zone))
            .map(([zone, items]) => [zone, items.map((c) => cleanComponent(c, 1, ctx))]),
        )
      : undefined;
    const rootProps = cleanProps(parsed.data.root.props ?? {}, 1, ctx);
    return { ok: true, data: { root: { props: rootProps }, content, ...(zones ? { zones } : {}) } };
  } catch (err) {
    if (err instanceof DocError) return { ok: false, error: err.message };
    throw err;
  }
}
