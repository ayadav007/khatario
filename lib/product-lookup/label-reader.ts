import { prepareInvoiceVisionImageServer } from '@/lib/invoice-extract/latency/prepare-vision-image-server';
import {
  ProviderHttpError,
  geminiVisionModels,
  runWithModelFallback,
} from '@/lib/services/invoice-extract/pipeline/visionModelFallback';

/**
 * Scan & Add Items: read a product label photo with the same Gemini vision models as bill scanning.
 * The model only reports what is printed; anything it cannot see comes back null and the
 * shopkeeper types it. Nothing read here is saved until the shopkeeper confirms the form.
 */

/** front = name and brand side; details = MRP / batch / dates panel; size = net quantity. */
export type LabelStep = 'front' | 'details' | 'size';
export const LABEL_STEPS: readonly LabelStep[] = ['front', 'details', 'size'];

export interface LabelReading {
  name: string | null;
  brand: string | null;
  /** Net quantity as printed, e.g. "100 g". */
  size: string | null;
  mrp: number | null;
  batch_number: string | null;
  /** YYYY-MM-DD, or YYYY-MM when the pack prints only a month. */
  manufacturing_date: string | null;
  expiry_date: string | null;
  /** "Best before 9 months from manufacture" style text, kept as printed. */
  best_before_text: string | null;
}

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 45_000;

const str = { type: 'STRING', nullable: true };
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: str,
    brand: str,
    size: str,
    mrp: { type: 'NUMBER', nullable: true },
    batch_number: str,
    manufacturing_date: str,
    expiry_date: str,
    best_before_text: str,
  },
};

const COMMON_RULES = `You read the packaging of a product sold in an Indian grocery shop.
Report only text that is printed and readable in this photo. Never guess, never fill from what the product usually is.
Return null for anything not visible or not readable.`;

const STEP_PROMPTS: Record<LabelStep, string> = {
  front: `${COMMON_RULES}
This photo shows the front of the pack.
- name: the product name as a shopper would say it, including variant or flavour (e.g. "Parle-G Original Glucose Biscuits", "Maggi 2-Minute Masala Noodles"). Do not add the pack size here.
- brand: the brand (e.g. "Parle", "Maggi").
- size: net quantity if printed on this side, exactly as printed with its unit (e.g. "100 g", "1 L", "6 x 50 g").
All other fields null.`,
  details: `${COMMON_RULES}
This photo shows the panel with price and dates, usually printed together.
- mrp: the MRP in rupees as a number (from "MRP Rs. 10.00 (incl. of all taxes)" return 10). If several prices, the one labelled MRP.
- batch_number: the batch or lot code (after "Batch No.", "B.No.", "Lot").
- manufacturing_date: the packed or manufactured date as YYYY-MM-DD, or YYYY-MM if only month and year are printed.
- expiry_date: the expiry or use-by date in the same format. Only when an actual date is printed.
- best_before_text: if the pack says "best before N months from manufacture" or similar, that text as printed. Do not calculate a date from it.
- size: net quantity if printed here, exactly as printed.
name and brand null.`,
  size: `${COMMON_RULES}
This photo shows the net quantity of the pack.
- size: net quantity exactly as printed with its unit (e.g. "75 g", "500 ml", "1 kg"). If the photo shows "Net Wt." or "Net Qty", use that value.
All other fields null.`,
};

const clean = (v: unknown, max = 120): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t && t.toLowerCase() !== 'null' ? t.slice(0, max) : null;
};

/** Accepts YYYY-MM-DD or YYYY-MM with a real month and day; anything else is dropped, not repaired. */
export function cleanLabelDate(v: unknown): string | null {
  const t = clean(v, 10);
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(t);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null];
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  if (day !== null) {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() !== month - 1) return null;
  }
  return t;
}

/** Keeps only the fields this step asks for, in valid shapes. */
export function cleanLabelReading(raw: unknown, step: LabelStep): LabelReading {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mrp = typeof r.mrp === 'number' && Number.isFinite(r.mrp) && r.mrp > 0 && r.mrp < 1_000_000 ? Math.round(r.mrp * 100) / 100 : null;
  const reading: LabelReading = {
    name: step === 'front' ? clean(r.name) : null,
    brand: step === 'front' ? clean(r.brand, 60) : null,
    size: clean(r.size, 40),
    mrp: step === 'details' ? mrp : null,
    batch_number: step === 'details' ? clean(r.batch_number, 60) : null,
    manufacturing_date: step === 'details' ? cleanLabelDate(r.manufacturing_date) : null,
    expiry_date: step === 'details' ? cleanLabelDate(r.expiry_date) : null,
    best_before_text: step === 'details' ? clean(r.best_before_text, 120) : null,
  };
  return reading;
}

export class LabelReaderUnavailableError extends Error {}

export async function readProductLabel(image: Buffer, mimeType: string, step: LabelStep): Promise<LabelReading> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new LabelReaderUnavailableError('GEMINI_API_KEY is not configured');

  let prepared: { buffer: Buffer; mimeType: string };
  try {
    prepared = await prepareInvoiceVisionImageServer(image, mimeType);
  } catch {
    prepared = { buffer: image, mimeType };
  }
  const base64 = prepared.buffer.toString('base64');

  const json = await runWithModelFallback('gemini', geminiVisionModels(), async (model) => {
    const res = await fetch(`${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      // Key in a header, not the URL, so it never shows up in error or proxy logs.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: STEP_PROMPTS[step] }, { inline_data: { mime_type: prepared.mimeType, data: base64 } }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          maxOutputTokens: 512,
          ...(/gemini-([3-9]|\d{2,})/.test(model) ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new ProviderHttpError('gemini', model, res.status, await res.text());
    return res.json();
  });

  const content = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  let parsed: unknown = null;
  try {
    parsed = typeof content === 'string' ? JSON.parse(content) : null;
  } catch {
    parsed = null;
  }
  return cleanLabelReading(parsed, step);
}
