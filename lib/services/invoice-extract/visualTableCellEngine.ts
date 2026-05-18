export {
  buildVisualTableCellGrid,
  visualTableCellsEnabled,
  type VisualTableCellGridResult,
} from './visual-table/visualTableCellEngine';
export type {
  VisualTableCell,
  VisualTableCellSemantic,
  VisualTableCellEngineDebug,
} from './visual-table/visualTableCellTypes';
export { stabilizeVisualColumns } from './visual-table/visualColumnStabilizer';
export type { StabilizedColumnLayout, StabilizeVisualColumnsParams } from './visual-table/visualColumnStabilizer';
export { detectNumericBands, type NumericBand } from './visual-table/numericBandDetector';
export {
  assignWordsToColumns,
  mergeWideItemText,
  rowWordsByColumn,
  cellBBox,
  type CellAssignmentResult,
} from './visual-table/cellAssignmentEngine';
export { scoreVisualCell, type CellScoreContext } from './visual-table/cellConfidenceScorer';
