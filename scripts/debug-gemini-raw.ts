/**
 * ONE-OFF diagnostic: one Gemini GenerateContent call, print RAW text, then stop.
 *
 * Does NOT call pipelineFromLlmContent, normalize, mapper, GST calc, or repairs.
 *
 * Usage (from app root, VPS or local):
 *   npx tsx scripts/debug-gemini-raw.ts /tmp/dmart-test.jpg
 *
 * Loads .env.production (same file the VPS app uses). Do not commit this script
 * unless you explicitly want it on the server via git.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { VISION_PROMPT } from '../lib/gst-invoice-vision-prompt';
import { buildGeminiVisionGenerateContentBody } from '../lib/invoice-extract/latency/gemini-generation-config';
import { prepareInvoiceVisionImageServer } from '../lib/invoice-extract/latency/prepare-vision-image-server';

/** Keep in sync with lib/services/invoice-extract/pipeline/geminiVisionPipeline.ts */
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.0-flash';
const TIMEOUT_MS = 90_000;

function loadAppEnv(): string {
  const cwd = process.cwd();
  const productionPath = path.join(cwd, '.env.production');
  const fallbackPath = path.join(cwd, '.env');
  if (fs.existsSync(productionPath)) {
    dotenv.config({ path: productionPath });
    return productionPath;
  }
  if (fs.existsSync(fallbackPath)) {
    dotenv.config({ path: fallbackPath });
    return fallbackPath;
  }
  throw new Error(`No .env.production or .env in ${cwd}`);
}

function sniffMimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff';
  return 'image/jpeg';
}

/** Fence/brace slice only — not pipelineFromLlmContent (that normalizes). */
function extractJsonText(raw: string): string {
  let cleaned = raw.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) cleaned = fence[1].trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) return cleaned.slice(first, last + 1);
  return cleaned;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function classifyGstRate(rate: number): string {
  if (Math.abs(rate) < 0.25) return '0%';
  if (Math.abs(rate - 2.9) < 0.2) return '~2.9%';
  if (Math.abs(rate - 5) < 0.35) return '5%';
  if (Math.abs(rate - 12) < 0.35) return '12%';
  if (Math.abs(rate - 18) < 0.35) return '18%';
  if (Math.abs(rate - 28) < 0.35) return '28%';
  return `other (${rate})`;
}

function collectRates(parsed: Record<string, unknown>): number[] {
  const out: number[] = [];
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const r = num((it as Record<string, unknown>).gst_rate);
    if (r != null) out.push(r);
  }
  const summary = Array.isArray(parsed.gst_summary) ? parsed.gst_summary : [];
  for (const row of summary) {
    if (!row || typeof row !== 'object') continue;
    const r = num((row as Record<string, unknown>).gst_rate);
    if (r != null) out.push(r);
  }
  return out;
}

function printUsage(json: unknown): void {
  const usage =
    json && typeof json === 'object'
      ? (json as Record<string, unknown>).usageMetadata
      : null;
  if (!usage || typeof usage !== 'object') {
    console.log('(no usageMetadata)');
    return;
  }
  const u = usage as Record<string, unknown>;
  console.log(
    JSON.stringify(
      {
        promptTokenCount: u.promptTokenCount ?? null,
        candidatesTokenCount: u.candidatesTokenCount ?? null,
        totalTokenCount: u.totalTokenCount ?? null,
        thoughtsTokenCount: u.thoughtsTokenCount ?? null,
        cachedContentTokenCount: u.cachedContentTokenCount ?? null,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const imageArg = process.argv[2];
  if (!imageArg) {
    console.error('Usage: npx tsx scripts/debug-gemini-raw.ts <image-path>');
    process.exit(1);
  }

  const envFile = loadAppEnv();
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set in', envFile);
    process.exit(1);
  }

  const model = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const absPath = path.resolve(imageArg);
  if (!fs.existsSync(absPath)) {
    console.error('Image not found:', absPath);
    process.exit(1);
  }

  const rawBuffer = fs.readFileSync(absPath);
  const fallbackMime = sniffMimeFromPath(absPath);

  let prepared: Awaited<ReturnType<typeof prepareInvoiceVisionImageServer>>;
  try {
    prepared = await prepareInvoiceVisionImageServer(rawBuffer, fallbackMime);
  } catch {
    prepared = {
      buffer: rawBuffer,
      mimeType: fallbackMime,
      width: 0,
      height: 0,
      originalWidth: 0,
      originalHeight: 0,
      resized: false,
      reencoded: false,
      oriented: false,
    };
  }

  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = buildGeminiVisionGenerateContentBody({
    prompt: VISION_PROMPT,
    mimeType: prepared.mimeType,
    base64: prepared.buffer.toString('base64'),
  });

  console.log('MODEL:');
  console.log(model);
  console.log('');
  console.log('ENV FILE:');
  console.log(envFile);
  console.log('');
  console.log('IMAGE PREP (same as production pipeline):');
  console.log(
    JSON.stringify(
      {
        path: absPath,
        source_bytes: rawBuffer.length,
        prepared_bytes: prepared.buffer.length,
        mime_type: prepared.mimeType,
        width: prepared.width,
        height: prepared.height,
        original_width: prepared.originalWidth,
        original_height: prepared.originalHeight,
        resized: prepared.resized,
        reencoded: prepared.reencoded,
        oriented: prepared.oriented,
      },
      null,
      2,
    ),
  );
  console.log('');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  console.log('HTTP STATUS:');
  console.log(String(res.status));
  console.log('');

  const json: unknown = await res.json();

  console.log('USAGE:');
  printUsage(json);
  console.log('');

  if (!res.ok) {
    console.error('Gemini HTTP error. Response JSON (truncated):');
    console.error(JSON.stringify(json).slice(0, 2000));
    process.exit(1);
  }

  const candidate = (json as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> }; finishReason?: unknown }> })
    ?.candidates?.[0];
  const rawText = candidate?.content?.parts?.[0]?.text;

  console.log('RAW GEMINI TEXT:');
  if (typeof rawText !== 'string' || !rawText.trim()) {
    console.log('(empty)');
    console.log('finishReason:', candidate?.finishReason ?? 'unknown');
    console.log('Response snippet:', JSON.stringify(json).slice(0, 800));
    process.exit(1);
  }
  console.log(rawText);
  console.log('');

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(extractJsonText(rawText)) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('DIAGNOSTIC JSON PARSE FAILED (raw text is still above):', msg);
    process.exit(0);
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  console.log('ITEM GST:');
  console.log('item | quantity | rate | gst_rate | cgst | sgst | taxable | line_total');
  items.forEach((row, i) => {
    const it = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    const name = String(it.description ?? it.item_name ?? '').replace(/\s+/g, ' ').slice(0, 40);
    console.log(
      [
        `${i + 1}:${name || '—'}`,
        it.qty ?? '',
        it.rate ?? '',
        it.gst_rate ?? '',
        it.cgst_amount ?? '',
        it.sgst_amount ?? '',
        it.taxable_value ?? '',
        it.line_total ?? '',
      ].join(' | '),
    );
  });
  console.log('');

  const summary = Array.isArray(parsed.gst_summary) ? parsed.gst_summary : [];
  console.log('GST SUMMARY:');
  console.log('gst_rate | taxable_value | cgst | sgst | igst');
  for (const row of summary) {
    const s = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    console.log(
      [s.gst_rate ?? '', s.taxable_value ?? '', s.cgst ?? '', s.sgst ?? '', s.igst ?? ''].join(' | '),
    );
  }
  console.log('');

  const rates = collectRates(parsed);
  const labels = new Set(rates.map(classifyGstRate));
  const has = (tag: string) => (labels.has(tag) ? 'YES' : 'NO');

  console.log('GST RATE FLAGS (from items + gst_summary only; not from our normalize):');
  console.log(`  0%:    ${has('0%')}`);
  console.log(`  5%:    ${has('5%')}`);
  console.log(`  18%:   ${has('18%')}`);
  console.log(`  ~2.9%: ${has('~2.9%')}`);
  const others = [...labels].filter((l) => !['0%', '5%', '18%', '~2.9%'].includes(l));
  console.log(`  other: ${others.length ? others.join(', ') : 'NO'}`);
  console.log('  unique gst_rate values:', rates.length ? [...new Set(rates.map((r) => r))].join(', ') : '(none)');
  console.log('');
  console.log('Stopped before normalize / mapper / GST calculation.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
