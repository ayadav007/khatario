/**
 * PHASE 1 — Fuzzy, OCR-tolerant semantic header detection on spatial rows.
 */

import type { OcrRow } from './ocrSpatialParser';
import type { SemanticColumnKind } from './semanticInvoiceTypes';
import type { OcrWord } from './ocrSpatialParser';

/** Normalized synonym → semantic kind */
const NORMALIZED_SYNONYMS: Array<{ patterns: string[]; kind: SemanticColumnKind }> = [
  { kind: 'ITEM', patterns: ['item', 'particular', 'desc', 'descript', 'product', 'title', 'name', 'goods', 'material'] },
  { kind: 'HSN', patterns: ['hsn', 'sac', 'hsnsac'] },
  { kind: 'QTY', patterns: ['qty', 'qnty', 'quantity', 'qtykg', 'nos', 'pcs', 'pkt'] },
  { kind: 'UNIT', patterns: ['unit', 'uom', 'per'] },
  { kind: 'RATE', patterns: ['rate', 'price', 'mrp', 'unitprice', 'up', 'rsp'] },
  { kind: 'AMOUNT', patterns: ['amount', 'amt', 'value', 'total', 'net', 'gross', 'taxable'] },
  { kind: 'GST', patterns: ['gst', 'cgst', 'sgst', 'igst', 'tax', 'vat', 'gstpercent'] },
  { kind: 'DISCOUNT', patterns: ['disc', 'discount', 'off'] },
];

export function normalizeHeaderKey(s: string): string {
  return s.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/** Bounded Levenshtein for short OCR tokens */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const cur = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = cur;
    }
  }
  return row[n];
}

/**
 * Score how strongly `token` matches a semantic catalog entry.
 */
export function scoreTokenAgainstSemantics(token: string): { kind: SemanticColumnKind; score: number } | null {
  const key = normalizeHeaderKey(token);
  if (key.length < 2) return null;

  let best: { kind: SemanticColumnKind; score: number } | null = null;

  for (const { patterns, kind } of NORMALIZED_SYNONYMS) {
    for (const p of patterns) {
      if (key.includes(p) || p.includes(key)) {
        const sc = Math.min(1, 0.65 + 0.35 * (Math.min(key.length, p.length) / Math.max(key.length, p.length)));
        if (!best || sc > best.score) best = { kind, score: sc };
      }
      const maxDist = key.length <= 5 ? 1 : key.length <= 9 ? 2 : 2;
      if (Math.abs(key.length - p.length) <= 4) {
        const d = levenshtein(key, p);
        if (d <= maxDist) {
          const sc = Math.max(0, 1 - d / (Math.max(key.length, p.length) + 1)) * 0.82;
          if (!best || sc > best.score) best = { kind, score: sc };
        }
      }
    }
  }

  return best;
}

export interface HeaderCellDetection {
  columnIndex: number;
  rawText: string;
  meaning: SemanticColumnKind;
  score: number;
}

export interface SemanticHeaderDetectionResult {
  /** Row chosen as header band (single primary header row). */
  headerRowIndex: number | null;
  /** Per-cell semantic hits */
  cells: HeaderCellDetection[];
  /** Best meaning per column (max score wins). */
  columnMeanings: Map<number, SemanticColumnKind>;
  headerConfidence: number;
}

function wordsGroupedByColumn(
  row: OcrRow,
  columnOfWord: (w: OcrWord) => number | undefined
): Map<number, OcrWord[]> {
  const m = new Map<number, OcrWord[]>();
  const sorted = [...row.words].sort((a, b) => a.centerX - b.centerX);
  for (const w of sorted) {
    const c = columnOfWord(w);
    if (c == null) continue;
    const arr = m.get(c) ?? [];
    arr.push(w);
    m.set(c, arr);
  }
  return m;
}

function cellRaw(words: OcrWord[]): string {
  return words
    .map((w) => w.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect header row and semantic labels per column using fuzzy tokens.
 *
 * @param columnOfWord maps each word to column index (same ordering as spatial columns).
 */
export function detectSemanticHeaders(
  rows: OcrRow[],
  columnOfWord: (w: OcrWord) => number | undefined,
  options?: { maxScanRows?: number; minHeaderHits?: number }
): SemanticHeaderDetectionResult {
  const maxScan = options?.maxScanRows ?? 28;
  const minHits = options?.minHeaderHits ?? 2;

  let bestRow: number | null = null;
  let bestScore = 0;
  const cellsOut: HeaderCellDetection[] = [];
  let columnMeanings = new Map<number, SemanticColumnKind>();

  const scanLimit = Math.min(maxScan, rows.length);

  for (let ri = 0; ri < scanLimit; ri++) {
    const row = rows[ri];
    const byCol = wordsGroupedByColumn(row, columnOfWord);
    let rowSemanticScore = 0;
    let hitCols = 0;
    const rowCells: HeaderCellDetection[] = [];

    for (const [colIdx, ws] of byCol) {
      const raw = cellRaw(ws);
      const tokens = raw.split(/\s+/).filter(Boolean);
      let colBest: HeaderCellDetection | null = null;
      for (const tok of tokens) {
        const hit = scoreTokenAgainstSemantics(tok);
        if (!hit) continue;
        if (!colBest || hit.score > colBest.score) {
          colBest = { columnIndex: colIdx, rawText: tok, meaning: hit.kind, score: hit.score };
        }
      }
      if (colBest && colBest.score >= 0.45) {
        rowCells.push(colBest);
        rowSemanticScore += colBest.score;
        hitCols++;
      }
    }

    /** Prefer rows with multiple semantic columns and moderate word count (table header shape). */
    const adjusted =
      hitCols >= minHits ? rowSemanticScore * (1 + 0.08 * Math.min(hitCols, 8)) : 0;

    if (adjusted > bestScore && hitCols >= minHits) {
      bestScore = adjusted;
      bestRow = ri;
      cellsOut.length = 0;
      cellsOut.push(...rowCells);
    }
  }

  if (bestRow == null) {
    return {
      headerRowIndex: null,
      cells: [],
      columnMeanings: new Map(),
      headerConfidence: 0,
    };
  }

  columnMeanings = new Map<number, SemanticColumnKind>();
  for (const c of cellsOut) {
    const prev = columnMeanings.get(c.columnIndex);
    const prevScore = cellsOut.find((x) => x.columnIndex === c.columnIndex && x.meaning === prev)?.score ?? 0;
    if (!prev || c.score >= prevScore) columnMeanings.set(c.columnIndex, c.meaning);
  }

  const headerConfidence = Math.min(1, bestScore / Math.max(4, cellsOut.length * 0.85));

  return {
    headerRowIndex: bestRow,
    cells: cellsOut,
    columnMeanings,
    headerConfidence,
  };
}
