/**
 * Invoice extract pipeline helpers: Vision layout reconstruction, GST section parsing,
 * propagation, and validation. See `ocrLayoutService`, `gstSectionParser`, etc.
 */

export {
  reconstructOcrLines,
  classifyOcrLineKind,
  inferPageHeightFromOcrLines,
  inferPageHeightFromAnnotation,
  isLikelyProductRowText,
  looksLikeExchangeOrAdjustmentRow,
  type OcrLogicalLine,
  type OcrLineKind,
} from './ocrLayoutService';
export type { OcrLine } from './ocrLineTypes';
export {
  parseHeaderGstRate,
  tryParseCgstSgstHalves,
  tryParseIgstPercent,
} from './gstHeaderParser';
export {
  scoreGstHeaderLikelihood,
  DEFAULT_GST_HEADER_CONFIDENCE_THRESHOLD,
  type GstHeaderScoreContext,
} from './gstHeaderHeuristics';
export {
  detectInvoiceRegionsFromOcrLines,
  isFooterRegion,
  looksLikeGrandTotalAnchorLine,
  type InvoiceRegions,
  type RectRegion,
} from './invoiceRegionDetector';
export {
  isGstSectionHeaderLine,
  parseGstRateFromSectionHeaderLine,
  detectGstSections,
  type GstSectionMarker,
} from './gstSectionParser';
export {
  assignSectionGstRates,
  propagateGstRatesOnOcrLines,
  applyOcrSectionGstToExtract,
  inferNegativeLineTotalFromExchangeOcrText,
  mergeMissingOcrExchangeItemRowsIntoItems,
  refreshTaxableValuesAfterGstPatch,
  type OcrGstPropagationDebug,
  type GstPropagationTrace,
} from './gstPropagationEngine';
export {
  buildPlainTableGapCandidates,
  largestUnusedPlausibleTableAmount,
  mergeMissingPlainLinesFromOcrGrandTotalGap,
  type OcrGapFillCandidate,
} from './ocrGrandTotalGapFill';
export { validateGstExtractAgainstOcr, type GstValidationResult, type GstValidationIssue } from './gstValidationEngine';
export {
  applyNumericOcrReconciliationToExtract,
  type NumericReconciliationDebug,
  type NumericRepairFieldTrace,
} from './numericReconciliationEngine';
export { generateNumericRepairCandidates, type OcrNumericFieldKind, OCR_DIGIT_CONFUSIONS } from './ocrNumericRepair';
export {
  scoreInvoiceWideReconciliation,
  isNearLegalGstSlab,
  type InvoiceWideExtractLike,
  type InvoiceWideScore,
  type InvoiceWideValidationResult,
} from './invoiceMathValidator';
export {
  expectedInclusiveLineTotal,
  lineInclusiveTotalError,
  defaultLineTotalTolerance,
  type LineAmountConsistencyContext,
  type LineCheckerPriceMode,
} from './lineItemConsistencyChecker';
export type { FullTextAnnotation, VisionPage } from './vision-types';
export {
  preprocessInvoiceImage,
  preprocessProfileFromEnv,
  isPreprocessEnabled,
  INVOICE_PREPROCESS_PROFILES,
  DEFAULT_PREPROCESS_PROFILE,
  getPreprocessProfile,
  type PreprocessInvoiceImageOptions,
  type PreprocessInvoiceImageResult,
  type InvoicePreprocessProfileId,
  type InvoicePreprocessProfile,
} from './imagePreprocessingService';
export {
  parseSpatialDocument,
  extractWordsFromAnnotation,
  clusterWordsIntoRows,
  buildColumnAnchors,
  buildOcrColumns,
  numericDensityPerColumn,
  detectTableRegions,
  unionBBox,
  looksNumericToken,
  spatialDocumentToLineTexts,
  rowRawTextSpatial,
} from './ocrSpatialParser';
export type {
  BoundingBox,
  OcrWord,
  OcrRow,
  OcrColumn,
  TableRegion,
  InvoiceSpatialDocument,
  RowConfidenceMeta,
  ColumnConfidenceMeta,
  AlignmentConfidenceMeta,
  SpatialParseDebug,
} from './ocrSpatialParser';
export {
  parseInvoiceTableSemantics,
  resolveEffectiveTableRegions,
  type ParseInvoiceTableSemanticsOptions,
} from './invoiceTableSemanticParser';
export type {
  SemanticInvoiceLineItem,
  SemanticInvoiceTableParseResult,
  SemanticInvoiceTableParseDebug,
  SemanticColumnKind,
  GstSourceKind,
  ConfidenceBreakdownEntry,
  SpatialTableRegionKind,
  ClassifiedTableRegionMeta,
  GstSummaryRegionExtract,
  TotalsRegionExtract,
} from './semanticInvoiceTypes';
export {
  classifyTableRegion,
  classifyAllTableRegions,
  bboxBandIoU,
} from './tableRegionClassifier';
export {
  parseSemanticLinesForRegion,
  type RegionSemanticParseSlice,
} from './regionScopedSemanticParser';
export { parseGstSummaryRegion } from './gstSummaryRegionParser';
export { parseTotalsRegion } from './totalsRegionParser';
export type {
  InvoiceOptimizationInput,
  InvoiceOptimizationResult,
  OptimizedSemanticInvoiceLine,
  RepairedFieldTrace,
  RejectedRepairCandidateTrace,
} from './invoiceOptimizationTypes';
export {
  optimizeInvoiceInterpretation,
  type OptimizeInvoiceInterpretationOptions,
} from './invoiceOptimizationEngine';
export type {
  NumericRepairSearchOptions,
} from './numericRepairSearch';
export type { OptimizationWeights } from './optimizationScorer';
export {
  summarizeInvoiceCorrectionDelta,
  type InvoiceCorrectionSummary,
} from './invoiceExtractionCorrectionSummary';
export {
  EXTRACTION_PARSER_ENGINE_VERSION,
  extractionLearningEnabled,
  extractionSpatialLearningEnabled,
  tryBuildExtractionLearningSnapshot,
  computeLayoutFingerprintFromAnnotation,
  type ExtractionLearningSnapshotPayload,
} from './extractionLearningSnapshot';
export {
  insertInvoiceLearningEvent,
  mergeLearningInsertPayload,
  type ExtractionLearningEventType,
  type ExtractionLearningInsertPayload,
} from './extractionLearningTelemetry';
export {
  aggregateFieldLearning,
  aggregateLayoutProfiles,
  aggregateVendorProfiles,
  invoiceExtractionAggregationEnabled,
  runInvoiceLearningAggregationCli,
  runInvoiceLearningAggregationTransactional,
  type AggregationChunkStats,
  type FieldLearningUpsertRow,
  type InvoiceLearningAggregationSummary,
  type LayoutProfileUpsertRow,
  type VendorProfileUpsertRow,
} from './learningAggregation';

export {
  invoiceConfidenceEngineEnabled,
  getConfidenceWeights,
  getConfidenceThresholds,
  calculateFieldConfidence,
  calculateInvoiceConfidence,
  calculateTableConfidence,
  deriveSpatialDocumentFromAnnotation,
  loadHistoricalConfidenceSignalsFromDb,
  emptyHistoricalConfidenceSignals,
  mergeHistoricalSignals,
  classifyInvoiceStatus,
  type ConfidenceBreakdown4,
  type FieldConfidenceResult,
  type HistoricalConfidenceSignals,
  type InvoiceCompositeConfidence,
  type InvoiceConfidenceContext,
  type InvoiceReviewStatus,
  type TableConfidenceResult,
} from './confidence';

export { detectSemanticHeaders } from './semanticHeaderDetector';
export { inferColumnSemantics } from './semanticColumnInference';
export {
  validateSemanticLineItem,
  numericConsistencyFactor,
  type SemanticValidationOptions,
} from './semanticLineValidator';
export {
  parseNumericCell,
  parseQuantityCell,
  sanitizeNumericToken,
  isNumericLookingToken,
} from './numericColumnInterpreter';

export {
  invoiceLayoutIntelligenceEnabled,
  layoutHighConfidenceAcceptanceMin,
  layoutMinSamplesForSignals,
  detectKnownLayout,
  buildLayoutHints,
  formatAdaptiveHintBlock,
  selectExtractionStrategy,
  loadLayoutRollupBrief,
  extractGstinHintFromOcr,
  type KnownLayoutProfileRecord,
  type LayoutExtractionStrategy,
  type LayoutRollupBrief,
  type LayoutStrategyDecision,
} from './layoutIntelligence';

export {
  repairTotalsSection,
  repairLineItems,
  repairGSTSection,
  repairExtractSectionsDeterministic,
} from './repair/sectionRepairEngine';

export { pipelineFromLlmContent } from './pipeline/llmExtractParse';
export { runGoogleVisionGroqTextPipeline } from './pipeline/googleVisionGroqTextPipeline';
export type {
  ExtractionPipelineResult,
  InvoiceExtractDebugPayload,
} from './pipeline/extractionPipelineTypes';

export {
  GoogleVisionGroqProvider,
  AzureDocumentIntelligenceProvider,
  type InvoiceExtractionInput,
  type InvoiceExtractionProvider,
  type InvoiceExtractionResult,
} from './providers';

export {
  PARSER_VERSION_METADATA,
  getParserVersionMetadata,
  type ParserVersionMetadata,
} from './parserVersion';
export {
  extractionDetailedTelemetryEnabled,
  buildInvoiceTelemetryInsertRow,
  upsertInvoiceExtractionTelemetry,
  recordInvoiceExtractionTelemetry,
  type InvoiceTelemetryInsertRow,
} from './invoiceExtractionTelemetry';
export {
  extractionCorrectionLoggingEnabled,
  buildCorrectionLogsFromPurchaseReviewDelta,
  insertInvoiceCorrectionLogs,
  type CorrectionLogInsertRow,
} from './invoiceCorrectionLogger';
export {
  supplierHashFromGstin,
  inferDominantLayoutType,
  buildSupplierLayoutFingerprint,
  type SupplierFingerprintDigest,
  type DominantLayoutType,
} from './supplierFingerprintEngine';
export {
  loadGoldenScenariosUnder,
  runGoldenBenchmarkSuite,
  runGoldenBenchmarkSuiteFromDisk,
  summarizeBenchmark,
  type GoldenInvoiceCategory,
  type InvoiceGoldenScenarioFile,
  type InvoiceBenchmarkMetrics,
  type InvoiceBenchmarkAggregate,
} from './invoiceBenchmarkRunner';
export {
  insertAdaptiveConfigProposal,
  getAdaptiveProposal,
  updateAdaptiveProposalBenchmarkSummary,
  type AdaptiveConfigPatch,
  type AdaptiveProposalRecord,
  type AdaptiveProposalStatus,
} from './adaptiveConfigEngine';
export {
  runBenchmarkGateForProposal,
  approveAdaptiveProposal,
  rejectAdaptiveProposal,
  promoteAdaptiveProposal,
  type PromotionBenchmarkOptions,
} from './configPromotionEngine';
export {
  analyticsMostCorrectedSuppliers,
  analyticsRepairStatistics,
  analyticsLayoutDistribution,
  analyticsCommonWarnings,
  analyticsGstMismatchHistogram,
  type SupplierCorrectionCountRow,
} from './extractionAnalytics';

export {
  supplierAwareExtractionEnabled,
  resolveSupplierAwareExtractionContext,
  formatSupplierAwareHintBlock,
  type SupplierAwareResolution,
} from './supplierAwareExtractionEngine';
export { computeLayoutPriors } from './layoutPriorEngine';
export type { LayoutPriorApplication } from './layoutPriorEngine';
export {
  resolveExtractionProfile,
  resolveOptimizationPriceMode,
  type ResolvedExtractionProfile,
  type CorrectionTelemetryHint,
} from './extractionProfileResolver';
export {
  mergeAdaptiveConfigPatches,
  patchMatchesSupplierLayout,
  loadMergedApprovedAdaptivePatch,
  type IgnoredAdaptiveRelease,
} from './supplierAdaptiveConfigResolver';

export {
  buildVisualTableCellGrid,
  visualTableCellsEnabled,
  type VisualTableCellGridResult,
} from './visualTableCellEngine';
export type {
  VisualTableCell,
  VisualTableCellSemantic,
  VisualTableCellEngineDebug,
} from './visualTableCellEngine';
