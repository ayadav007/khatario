/**
 * Minimal Google Cloud Vision `DOCUMENT_TEXT_DETECTION` shapes we read.
 * @see https://cloud.google.com/vision/docs/reference/rest/v1/images/annotate#TextAnnotation
 */

export interface VisionVertex {
  x?: number;
  y?: number;
}

export interface VisionBoundingPoly {
  vertices?: VisionVertex[];
}

export interface VisionSymbol {
  text?: string;
  boundingBox?: VisionBoundingPoly;
}

export interface VisionWord {
  symbols?: VisionSymbol[];
  /** Some responses include a single property field; we only use symbols. */
  boundingBox?: VisionBoundingPoly;
}

export interface VisionParagraph {
  words?: VisionWord[];
  boundingBox?: VisionBoundingPoly;
}

export interface VisionBlock {
  paragraphs?: VisionParagraph[];
  boundingBox?: VisionBoundingPoly;
}

export interface VisionPage {
  width?: number;
  height?: number;
  blocks?: VisionBlock[];
}

export interface FullTextAnnotation {
  pages?: VisionPage[];
  text?: string;
}

export interface VisionAnnotateResponse {
  responses?: Array<{
    fullTextAnnotation?: FullTextAnnotation;
    textAnnotations?: Array<{ description?: string }>;
    error?: { message?: string };
  }>;
}
