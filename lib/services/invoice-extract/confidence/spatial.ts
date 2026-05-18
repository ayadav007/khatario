import { parseSpatialDocument, type InvoiceSpatialDocument } from '@/lib/services/invoice-extract/ocrSpatialParser';
import type { FullTextAnnotation } from '@/lib/services/invoice-extract/vision-types';

/**
 * Derives a spatial OCR document for confidence scoring (same pipeline as learning snapshots).
 */
export function deriveSpatialDocumentFromAnnotation(
  annotation: FullTextAnnotation | null | undefined,
): InvoiceSpatialDocument | null {
  if (!annotation) return null;
  try {
    return parseSpatialDocument(annotation) ?? null;
  } catch {
    return null;
  }
}
