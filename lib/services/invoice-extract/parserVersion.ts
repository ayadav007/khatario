/**
 * Deterministic extraction stack versioning — every extraction run should attach this bundle.
 * Bump individual semver-ish tokens when behaviour of that stage changes materially.
 */

export const PARSER_VERSION_METADATA = {
  /** Umbrella pipeline / coercion version (stored on learning rows & telemetry). */
  parserVersion: 'spatial_semantic_opt_v1',
  preprocessingVersion: 'invoice_preprocess_v1',
  spatialEngineVersion: 'ocr_spatial_parse_v1',
  semanticParserVersion: 'invoice_table_semantic_v1',
  optimizationEngineVersion: 'invoice_optimize_greedy_v1',
  gstEngineVersion: 'gst_propagation_validate_v1',
} as const;

export type ParserVersionMetadata = typeof PARSER_VERSION_METADATA;

export function getParserVersionMetadata(): ParserVersionMetadata {
  return PARSER_VERSION_METADATA;
}
