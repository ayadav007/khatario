/**
 * Spatially-aware table reconstructor for Google Vision `fullTextAnnotation`.
 *
 * Problem: Google Vision's DOCUMENT_TEXT_DETECTION sometimes reads multi-column
 * invoice tables column-by-column (all descriptions → all qtys → all rates …)
 * instead of row-by-row. When that happens, the flat OCR text passed to Groq has
 * numbers from different columns mixed up, causing wrong discount / GST assignments.
 *
 * Solution: Use word-level bounding-box data to:
 *   1. Detect the line-items table header row.
 *   2. Build column zones from the header word x-positions.
 *   3. Assign each subsequent word to a column zone by x-overlap.
 *   4. Output a pipe-separated table block that Groq can parse column-by-column.
 *
 * If no table is detected (single-column invoice, thermal receipt) we return null
 * and the caller falls back to the plain OCR text.
 */

import type { FullTextAnnotation } from './vision-types';
import { reconstructOcrLines, type OcrWordBox } from './ocrLayoutService';

// ─── Types ───────────────────────────────────────────────────────────────────

interface WordWithPos {
  text: string;
  xMin: number;
  xMax: number;
  xMid: number;
  yMin: number;
  yMax: number;
  yMid: number;
}

interface TableColumn {
  /** Normalised label used as header text */
  label: string;
  xMin: number;
  xMax: number;
  xMid: number;
}

interface TableRow {
  yMid: number;
  cells: (string | null)[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Keywords that identify column headers in Indian GST invoice tables */
const HEADER_KEYWORD_RE =
  /\b(description|particulars|item|product|goods|name|sl\.?\s*no|sno|sr\.?\s*no|hsn|sac|qty|quantity|nos|pcs|unit|rate|price|mrp|discount|disc\.?|less|taxable|assessable|cgst|sgst|igst|gst|tax|amount|total|net|value)\b/i;

/** Minimum number of header keyword matches to declare a line the table header */
const MIN_HEADER_KEYWORDS = 3;

function collectWordPositions(annotation: FullTextAnnotation): WordWithPos[] {
  const out: WordWithPos[] = [];
  for (const page of annotation.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const word of para.words ?? []) {
          const text = (word.symbols ?? []).map((s) => s.text ?? '').join('').trim();
          if (!text) continue;
          const verts = word.boundingBox?.vertices ?? [];
          if (!verts.length) continue;
          const xs = verts.map((v) => v.x ?? 0);
          const ys = verts.map((v) => v.y ?? 0);
          const xMin = Math.min(...xs);
          const xMax = Math.max(...xs);
          const yMin = Math.min(...ys);
          const yMax = Math.max(...ys);
          out.push({
            text,
            xMin,
            xMax,
            xMid: (xMin + xMax) / 2,
            yMin,
            yMax,
            yMid: (yMin + yMax) / 2,
          });
        }
      }
    }
  }
  return out;
}

/** Group words into horizontal lines by y-proximity */
function groupIntoLines(
  words: WordWithPos[],
  tol: number,
): WordWithPos[][] {
  if (!words.length) return [];
  const sorted = [...words].sort((a, b) => a.yMid - b.yMid || a.xMid - b.xMid);
  const lines: WordWithPos[][] = [];
  for (const w of sorted) {
    let placed = false;
    for (const line of lines) {
      const refY = line[0].yMid;
      if (Math.abs(w.yMid - refY) <= tol) {
        line.push(w);
        placed = true;
        break;
      }
    }
    if (!placed) lines.push([w]);
  }
  for (const line of lines) {
    line.sort((a, b) => a.xMid - b.xMid);
  }
  lines.sort((a, b) => Math.min(...a.map((w) => w.yMin)) - Math.min(...b.map((w) => w.yMin)));
  return lines;
}

/** Count how many header keywords appear in a line's combined text */
function headerKeywordCount(words: WordWithPos[]): number {
  const text = words.map((w) => w.text).join(' ');
  return (text.match(/\b(description|particulars|item|product|goods|name|sl\.?\s*no|sno|sr\.?\s*no|hsn|sac|qty|quantity|nos|pcs|unit|rate|price|mrp|discount|disc\.?|less|taxable|assessable|cgst|sgst|igst|gst|tax|amount|total|net|value)\b/gi) ?? []).length;
}

/**
 * Find the index of the line that is most likely the item-table header.
 * We look for the line with the most header keyword matches and at least MIN_HEADER_KEYWORDS.
 */
function findHeaderLineIndex(lines: WordWithPos[][]): number {
  let best = -1;
  let bestScore = MIN_HEADER_KEYWORDS - 1;
  for (let i = 0; i < lines.length; i++) {
    const score = headerKeywordCount(lines[i]);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Build column zones from the header words.
 * Each header word becomes a column; its x-zone is the gap between midpoints of adjacent columns.
 */
function buildColumns(headerWords: WordWithPos[], pageWidth: number): TableColumn[] {
  const sorted = [...headerWords].sort((a, b) => a.xMid - b.xMid);
  const cols: TableColumn[] = sorted.map((w) => ({
    label: w.text.trim(),
    xMin: w.xMin,
    xMax: w.xMax,
    xMid: w.xMid,
  }));

  // Expand zones to fill gaps between columns
  for (let i = 0; i < cols.length; i++) {
    const prev = cols[i - 1]?.xMid ?? 0;
    const next = cols[i + 1]?.xMid ?? pageWidth;
    cols[i].xMin = (prev + cols[i].xMid) / 2;
    cols[i].xMax = (cols[i].xMid + next) / 2;
  }
  if (cols.length > 0) {
    cols[0].xMin = 0;
    cols[cols.length - 1].xMax = pageWidth;
  }
  return cols;
}

/**
 * Assign a word to a column by finding the column with the greatest x-overlap.
 * Falls back to nearest column midpoint.
 */
function assignToColumn(word: WordWithPos, cols: TableColumn[]): number {
  let best = 0;
  let bestOverlap = -Infinity;
  for (let i = 0; i < cols.length; i++) {
    const overlapL = Math.max(word.xMin, cols[i].xMin);
    const overlapR = Math.min(word.xMax, cols[i].xMax);
    const overlap = overlapR - overlapL;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = i;
    }
  }
  if (bestOverlap < 0) {
    // No overlap — use nearest midpoint
    let minDist = Infinity;
    for (let i = 0; i < cols.length; i++) {
      const d = Math.abs(word.xMid - cols[i].xMid);
      if (d < minDist) {
        minDist = d;
        best = i;
      }
    }
  }
  return best;
}

/** Detect whether the table appears to be reading row-by-row or column-by-column.
 *  Row-by-row: most table-body lines span > 50% of the table width and contain ≥ 2 words.
 *  Column-by-column: many body lines are narrow (single column width).
 */
function detectColumnByColumnLayout(
  bodyLines: WordWithPos[][],
  tableXMin: number,
  tableXMax: number,
): boolean {
  if (!bodyLines.length) return false;
  const tableWidth = Math.max(1, tableXMax - tableXMin);
  let narrowCount = 0;
  for (const line of bodyLines) {
    if (!line.length) continue;
    const lineXMin = Math.min(...line.map((w) => w.xMin));
    const lineXMax = Math.max(...line.map((w) => w.xMax));
    const lineWidth = lineXMax - lineXMin;
    if (lineWidth / tableWidth < 0.35) narrowCount++;
  }
  return narrowCount / bodyLines.length > 0.55;
}

/**
 * Detects whether the OCR text looks like it was read column-by-column from the raw text lines.
 * Used as a quick pre-check before full spatial analysis.
 */
function quickCheckColumnByColumn(ocrText: string): boolean {
  // Column-by-column reading often produces many short (1-3 word) lines with numeric values
  const lines = ocrText.split('\n').filter((l) => l.trim());
  const numericLines = lines.filter((l) => /^\s*[\d,. ₹Rs.]+\s*$/.test(l));
  return numericLines.length > 8 && numericLines.length / lines.length > 0.3;
}

/**
 * Format a pipe-separated table row. Null cells become empty strings.
 * Long description text is truncated to keep the table readable.
 */
function formatRow(cells: (string | null)[], maxDescLen = 60): string {
  return '| ' + cells.map((c, i) => {
    const s = (c ?? '').trim();
    // Truncate only what looks like a description cell (long text)
    if (i <= 1 && s.length > maxDescLen) return s.slice(0, maxDescLen) + '…';
    return s;
  }).join(' | ') + ' |';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Attempts to reconstruct the line-items table from Google Vision spatial data.
 *
 * Returns a formatted string block like:
 * ```
 * === RECONSTRUCTED ITEM TABLE (spatial column alignment) ===
 * | Sl | Description | HSN | Qty | Rate | Discount | Taxable | CGST | SGST | Total |
 * |----|-------------|-----|-----|------|----------|---------|------|------|-------|
 * | 1  | Product A   | ...
 * ...
 * === END ITEM TABLE ===
 * ```
 *
 * Returns null if the table cannot be confidently detected or reconstruction
 * would not help (e.g. single-column receipts, very short invoices).
 *
 * @param annotation - Google Vision fullTextAnnotation
 * @param ocrText - raw OCR text (used for quick layout check)
 */
export function reconstructItemTableFromAnnotation(
  annotation: FullTextAnnotation | null | undefined,
  ocrText: string,
): string | null {
  if (!annotation?.pages?.length) return null;

  const page = annotation.pages[0];
  const pageWidth = page?.width && page.width > 0 ? page.width : 1000;
  const pageHeight = page?.height && page.height > 0 ? page.height : 1400;

  const words = collectWordPositions(annotation);
  if (words.length < 10) return null;

  const medH = (() => {
    const hs = words.map((w) => Math.max(1, w.yMax - w.yMin)).sort((a, b) => a - b);
    return hs[Math.floor(hs.length / 2)] || 10;
  })();

  const lines = groupIntoLines(words, medH * 0.55);
  if (lines.length < 4) return null;

  const headerIdx = findHeaderLineIndex(lines);
  if (headerIdx < 0) return null;

  const headerWords = lines[headerIdx];
  if (headerWords.length < MIN_HEADER_KEYWORDS) return null;

  // Only look at the top 80% of the page for table body (avoid footer totals)
  const tableTop = Math.min(...headerWords.map((w) => w.yMin));
  const tableBottom = pageHeight * 0.8;

  const bodyLines = lines
    .slice(headerIdx + 1)
    .filter((l) => {
      const yMin = Math.min(...l.map((w) => w.yMin));
      return yMin <= tableBottom;
    })
    // Skip lines that look like totals/summaries
    .filter((l) => {
      const text = l.map((w) => w.text).join(' ').toUpperCase();
      return !/\b(GRAND\s+TOTAL|NET\s+(PAYABLE|AMOUNT)|AMOUNT\s+PAYABLE|ROUND\s+OFF|CGST\s+@|SGST\s+@|IGST\s+@|SUB\s*TOTAL|GST\s+SUMMARY)\b/.test(text);
    });

  if (bodyLines.length < 2) return null;

  // Determine table x-extent from header
  const tableXMin = Math.min(...headerWords.map((w) => w.xMin));
  const tableXMax = Math.max(...headerWords.map((w) => w.xMax));

  const isColByCol = detectColumnByColumnLayout(bodyLines, tableXMin, tableXMax);

  // Even if not strictly column-by-column, if lines have ≥3 numeric values spread
  // across the table width, spatial alignment helps
  const hasWideNumericRows = bodyLines.some((line) => {
    const nums = line.filter((w) => /^[\d,. ₹]+$/.test(w.text));
    const spread = line.length >= 3 &&
      Math.max(...line.map((w) => w.xMax)) - Math.min(...line.map((w) => w.xMin)) > tableXMax * 0.4;
    return nums.length >= 3 && spread;
  });

  if (!isColByCol && !hasWideNumericRows && !quickCheckColumnByColumn(ocrText)) {
    return null;
  }

  // Build columns from header words
  const cols = buildColumns(headerWords, pageWidth);
  if (cols.length < 3) return null;

  // Assemble table rows
  const tableRows: TableRow[] = [];

  for (const line of bodyLines) {
    const cells: (string | null)[] = Array(cols.length).fill(null);
    // For each word in this line, assign to column and append text
    for (const word of line) {
      const colIdx = assignToColumn(word, cols);
      cells[colIdx] = cells[colIdx] ? `${cells[colIdx]} ${word.text}` : word.text;
    }
    // Skip rows where all cells are empty
    if (cells.every((c) => !c)) continue;
    // Skip rows where only 1 cell is filled and it's a header-like word
    if (cells.filter(Boolean).length === 1) {
      const single = cells.find(Boolean)?.toUpperCase() ?? '';
      if (HEADER_KEYWORD_RE.test(single)) continue;
    }
    tableRows.push({ yMid: Math.min(...line.map((w) => w.yMid)), cells });
  }

  if (tableRows.length < 2) return null;

  // Limit to first 60 rows for token budget
  const rowsToShow = tableRows.slice(0, 60);

  const headerRow = formatRow(cols.map((c) => c.label));
  const separator = '|' + cols.map(() => '---|').join('');
  const dataRows = rowsToShow.map((r) => formatRow(r.cells));

  return [
    '=== RECONSTRUCTED ITEM TABLE (use this for column-correct line item data) ===',
    'Note: columns reconstructed from bounding-box spatial positions. Use this table to assign correct values for Qty, Rate, Discount, Taxable, CGST, SGST, IGST, and Total per line item.',
    headerRow,
    separator,
    ...dataRows,
    '=== END ITEM TABLE ===',
  ].join('\n');
}
