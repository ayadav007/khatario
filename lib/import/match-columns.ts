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

function guessByValues(fields: ImportField[], values: string[], taken: Set<string>): string | null {
  const filled = values.map((v) => String(v ?? '').trim()).filter(Boolean);
  if (filled.length === 0) return null;
  for (const [type, check] of VALUE_CHECKS) {
    const field = fields.find((f) => f.type === type);
    if (!field || taken.has(field.key)) continue;
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

  const keys = headers.map((h) => normaliseKey(h));
  const result: ColumnMatches = {};
  const taken = new Set<string>();

  // Tiers run in order. Within a tier the earliest column claims a free field;
  // a column left without a field moves on to the next tier.
  const tiers: Array<(index: number) => string | null> = [
    (i) => {
      const savedKey = keys[i] ? saved[keys[i]] : undefined;
      return savedKey && fieldKeys.has(savedKey) ? savedKey : null;
    },
    (i) => (keys[i] ? presetByHeader.get(keys[i]) ?? null : null),
    (i) => (keys[i] ? aliasByHeader.get(keys[i]) ?? null : null),
    (i) =>
      guessByValues(
        fields,
        sampleRows.slice(0, SAMPLE_LIMIT).map((row) => row[i] ?? ''),
        taken,
      ),
  ];

  const assigned = new Set<number>();
  for (const tier of tiers) {
    headers.forEach((_, index) => {
      if (assigned.has(index)) return;
      const guess = tier(index);
      if (guess && !taken.has(guess)) {
        taken.add(guess);
        result[index] = guess;
        assigned.add(index);
      }
    });
  }
  headers.forEach((_, index) => {
    if (!assigned.has(index)) result[index] = null;
  });

  return result;
}
