import type { FullTextAnnotation } from '@/lib/services/invoice-extract/vision-types';
import {
  extractWordsFromAnnotation,
  parseSpatialDocument,
  looksNumericToken,
  spatialDocumentToLineTexts,
} from '@/lib/services/invoice-extract/ocrSpatialParser';

function fakeWord(text: string, minX: number, minY: number, maxX: number, maxY: number) {
  const chars = [...text];
  const symbols = chars.map((ch, i) => ({
    text: ch,
    boundingBox: {
      vertices: [
        { x: minX + i * 8, y: minY },
        { x: minX + (i + 1) * 8, y: minY },
        { x: minX + (i + 1) * 8, y: maxY },
        { x: minX + i * 8, y: maxY },
      ],
    },
  }));
  return {
    symbols,
    boundingBox: {
      vertices: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ],
    },
  };
}

function minimalAnnotation(words: Array<{ text: string; x: number; y: number; w: number; h: number }>): FullTextAnnotation {
  const visionWords = words.map((w) => fakeWord(w.text, w.x, w.y, w.x + w.w, w.y + w.h));
  return {
    pages: [
      {
        width: 800,
        height: 1200,
        blocks: [
          {
            paragraphs: [{ words: visionWords }],
          },
        ],
      },
    ],
    text: words.map((w) => w.text).join(' '),
  };
}

describe('ocrSpatialParser', () => {
  it('extractWordsFromAnnotation preserves bbox and hierarchy indices', () => {
    const anno = minimalAnnotation([
      { text: 'GST', x: 10, y: 100, w: 40, h: 20 },
      { text: '999', x: 400, y: 102, w: 36, h: 18 },
    ]);
    const ws = extractWordsFromAnnotation(anno);
    expect(ws).toHaveLength(2);
    expect(ws[0].text).toBe('GST');
    expect(ws[0].bbox.minX).toBe(10);
    expect(ws[1].centerX).toBeGreaterThan(ws[0].centerX);
  });

  it('looksNumericToken recognizes decimals and hyphen paise', () => {
    expect(looksNumericToken('240.00')).toBe(true);
    expect(looksNumericToken('240-00')).toBe(true);
    expect(looksNumericToken('18%')).toBe(true);
    expect(looksNumericToken('ITEM')).toBe(false);
  });

  it('parseSpatialDocument builds rows, columns, alignment debug', () => {
    const anno = minimalAnnotation([
      { text: 'Qty', x: 50, y: 200, w: 30, h: 16 },
      { text: 'Rate', x: 200, y: 200, w: 36, h: 16 },
      { text: 'Amt', x: 380, y: 202, w: 34, h: 16 },
      { text: '2', x: 55, y: 230, w: 14, h: 16 },
      { text: '100', x: 205, y: 228, w: 36, h: 18 },
      { text: '212', x: 385, y: 230, w: 40, h: 18 },
    ]);
    const doc = parseSpatialDocument(anno);
    expect(doc).not.toBeNull();
    expect(doc!.rows.length).toBeGreaterThanOrEqual(2);
    expect(doc!.columns.length).toBeGreaterThanOrEqual(2);
    expect(doc!.debug.rowConfidenceAggregate).toBeGreaterThan(0);
    expect(doc!.debug.columnConfidenceAggregate).toBeGreaterThan(0);
    expect(doc!.debug.alignment.cleanAssignmentRatio).toBeGreaterThan(0);
    expect(doc!.debug.numericDensityPerColumn.length).toBe(doc!.columns.length);
    expect(doc!.tableRegions.length).toBeGreaterThanOrEqual(1);
    const lines = spatialDocumentToLineTexts(doc!);
    expect(lines.some((l) => l.includes('Qty'))).toBe(true);
  });

  it('returns null for missing annotation', () => {
    expect(parseSpatialDocument(null)).toBeNull();
    expect(parseSpatialDocument(undefined)).toBeNull();
  });
});
