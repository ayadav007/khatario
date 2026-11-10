import {
  looksLikeEmail,
  looksLikeGstin,
  looksLikePhone,
  looksLikePincode,
  normaliseKey,
} from '@/lib/import/parse-values';
import { PRESET_ALIASES } from '@/lib/import/presets';
import type { ColumnMatches, FieldType, ImportField, SectionKey, SourceApp } from '@/lib/import/types';

const SAMPLE_LIMIT = 50;
const VALUE_THRESHOLD = 0.8;

/** Checked in this order so one column cannot satisfy two types. */
const VALUE_CHECKS: Array<[FieldType, (v: string) => boolean]> = [
  ['gstin', looksLikeGstin],
  ['phone', looksLikePhone],
  ['email', looksLikeEmail],
  ['pincode', looksLikePincode],
];

export interface GuessColumnsInput {
  fields: ImportField[];
  headers: string[];
  sampleRows: string[][];
  sourceApp: SourceApp;
  section: SectionKey;
  /** Normalised header to field key. */
  saved: Record<string, string>;
}

function guessByValues(fields: ImportField[], values: string[]): string | null {
  const filled = values.map((v) => String(v ?? '').trim()).filter(Boolean);
  if (filled.length === 0) return null;
  for (const [type, check] of VALUE_CHECKS) {
    const field = fields.find((f) => f.type === type);
    if (!field) continue;
    const passing = filled.filter(check).length;
    if (passing / filled.length >= VALUE_THRESHOLD) return field.key;
  }
  return null;
}

export function guessColumns(input: GuessColumnsInput): ColumnMatches {
  const { fields, headers, sampleRows, sourceApp, section, saved } = input;
  const fieldKeys = new Set(fields.map((f) => f.key));

  const presetByHeader = new Map<string, string>();
  if (sourceApp !== 'other') {
    const preset = PRESET_ALIASES[sourceApp]?.[section] ?? {};
    for (const [fieldKey, names] of Object.entries(preset)) {
      if (!fieldKeys.has(fieldKey)) continue;
      for (const name of names) {
        const k = normaliseKey(name);
        if (!presetByHeader.has(k)) presetByHeader.set(k, fieldKey);
      }
    }
  }

  const aliasByHeader = new Map<string, string>();
  for (const field of fields) {
    for (const alias of field.aliases) {
      const k = normaliseKey(alias);
      if (k && !aliasByHeader.has(k)) aliasByHeader.set(k, field.key);
    }
  }

  const result: ColumnMatches = {};
  const taken = new Set<string>();

  headers.forEach((header, index) => {
    const key = normaliseKey(header);
    let guess: string | null = null;

    const savedKey = saved[key];
    if (key && savedKey && fieldKeys.has(savedKey)) guess = savedKey;
    if (!guess && key) guess = presetByHeader.get(key) ?? null;
    if (!guess && key) guess = aliasByHeader.get(key) ?? null;
    if (!guess) {
      const values = sampleRows.slice(0, SAMPLE_LIMIT).map((row) => row[index] ?? '');
      guess = guessByValues(fields, values);
    }

    if (guess && !taken.has(guess)) {
      taken.add(guess);
      result[index] = guess;
    } else {
      result[index] = null;
    }
  });

  return result;
}
