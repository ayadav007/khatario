export type {
  KnownLayoutProfileRecord,
  LayoutExtractionStrategy,
  LayoutRollupBrief,
  LayoutStrategyDecision,
} from './types';
export { invoiceLayoutIntelligenceEnabled, layoutHighConfidenceAcceptanceMin, layoutMinSamplesForSignals } from './featureFlag';
export { detectKnownLayout } from './detectKnownLayout';
export { buildLayoutHints, formatAdaptiveHintBlock } from './buildLayoutHints';
export {
  selectExtractionStrategy,
  loadLayoutRollupBrief,
  extractGstinHintFromOcr,
} from './selectExtractionStrategy';
