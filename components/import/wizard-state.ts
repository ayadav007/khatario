/**
 * State of the import wizard. Pure: no React and no fetch, so it is unit tested.
 * Components call the API and dispatch the results here.
 */
import type { PreviewResult, RunSummary } from '@/lib/import/run';
import type { ColumnMatches, DateOrder, ImportField, SectionKey, SourceApp } from '@/lib/import/types';

export type WizardStep = 'upload' | 'match' | 'preview' | 'importing' | 'done';

/** Wording and permission module for each section the wizard serves. */
export const IMPORT_SECTIONS: Record<SectionKey, { label: string; title: string; listHref: string; module: SectionKey }> = {
  customers: { label: 'customers', title: 'Import customers', listHref: '/customers', module: 'customers' },
  suppliers: { label: 'suppliers', title: 'Import suppliers', listHref: '/suppliers', module: 'suppliers' },
  items: { label: 'items', title: 'Import items', listHref: '/items', module: 'items' },
};

export function isImportSection(value: string): value is SectionKey {
  return Object.prototype.hasOwnProperty.call(IMPORT_SECTIONS, value);
}

export interface UploadResult {
  runId: string;
  headers: string[];
  samples: string[][];
  guesses: ColumnMatches;
  fields: ImportField[];
  rowCount: number;
  needsDateOrder: boolean;
}

export interface BatchResult {
  done: boolean;
  processed: number;
  total: number;
  saved: number;
  skipped: number;
  failed: number;
}

export interface UndoResult {
  removed: number;
  kept: { label: string; reason: string }[];
}

export type Progress = Omit<BatchResult, 'done'>;

export type Paused = { processed: number; total: number; message: string };

export const STALLED_MESSAGE = 'The import stopped making progress. Try Resume.';

/** A batch that is not done yet but moved no further than `before`: calling again would loop. */
export function isStalled(before: number, result: BatchResult): boolean {
  return !result.done && result.processed <= before;
}

export interface WizardState {
  step: WizardStep;
  sourceApp: SourceApp;
  uploading: boolean;
  error: string | null;
  runId: string | null;
  headers: string[];
  samples: string[][];
  fields: ImportField[];
  rowCount: number;
  needsDateOrder: boolean;
  columnMatches: ColumnMatches;
  dateOrder: DateOrder;
  /** Field key to the file's value and the choice made for it. */
  valueMatches: Record<string, Record<string, string>>;
  preview: PreviewResult | null;
  previewLoading: boolean;
  progress: Progress | null;
  /** Set when a batch call failed or stopped advancing; counts are data rows, not file row numbers. */
  paused: Paused | null;
  /** Result of undoing the current run from the Done step. */
  undone: UndoResult | null;
  history: RunSummary[];
}

export type WizardAction =
  | { type: 'set_source_app'; sourceApp: SourceApp }
  | { type: 'upload_started' }
  | { type: 'upload_succeeded'; result: UploadResult }
  | { type: 'upload_failed'; code?: string; message: string }
  | { type: 'match_column'; column: number; field: string | null }
  | { type: 'set_date_order'; dateOrder: DateOrder }
  | { type: 'go_to_preview' }
  | { type: 'back_to_match' }
  | { type: 'set_value_match'; field: string; value: string; choice: string }
  | { type: 'preview_loaded'; result: PreviewResult }
  | { type: 'preview_failed'; message: string }
  | { type: 'commit_started' }
  | { type: 'batch_succeeded'; result: BatchResult }
  | { type: 'batch_failed'; message: string }
  | { type: 'resume' }
  | { type: 'resume_run'; run: RunSummary }
  | { type: 'history_loaded'; runs: RunSummary[] }
  | { type: 'run_undone'; runId: string; result: UndoResult }
  | { type: 'start_over' };

export function initialWizardState(sourceApp: SourceApp = 'other'): WizardState {
  return {
    step: 'upload',
    sourceApp,
    uploading: false,
    error: null,
    runId: null,
    headers: [],
    samples: [],
    fields: [],
    rowCount: 0,
    needsDateOrder: false,
    columnMatches: {},
    dateOrder: 'dmy',
    valueMatches: {},
    preview: null,
    previewLoading: false,
    progress: null,
    paused: null,
    undone: null,
    history: [],
  };
}

/** Labels of required fields no column is matched to. */
export function missingRequiredFields(state: Pick<WizardState, 'fields' | 'columnMatches'>): string[] {
  const chosen = new Set(Object.values(state.columnMatches).filter((v): v is string => typeof v === 'string'));
  return state.fields.filter((f) => f.required && !chosen.has(f.key)).map((f) => f.label);
}

/** A run left mid-import that commit can continue. */
export function isResumable(run: RunSummary): boolean {
  return (run.status === 'committing' || run.status === 'failed') && run.processed < run.total;
}

function progressOf(r: Progress): Progress {
  return { processed: r.processed, total: r.total, saved: r.saved, skipped: r.skipped, failed: r.failed };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'set_source_app':
      return { ...state, sourceApp: action.sourceApp };

    case 'upload_started':
      return { ...state, uploading: true, error: null };

    case 'upload_succeeded': {
      const r = action.result;
      return {
        ...initialWizardState(state.sourceApp),
        history: state.history,
        step: 'match',
        runId: r.runId,
        headers: r.headers,
        samples: r.samples,
        fields: r.fields,
        rowCount: r.rowCount,
        needsDateOrder: r.needsDateOrder,
        columnMatches: { ...r.guesses },
      };
    }

    case 'upload_failed':
      return { ...state, step: 'upload', uploading: false, error: action.message };

    case 'match_column': {
      const columnMatches: ColumnMatches = {};
      state.headers.forEach((_, i) => {
        const current = state.columnMatches[i] ?? null;
        columnMatches[i] = action.field !== null && current === action.field ? null : current;
      });
      columnMatches[action.column] = action.field;
      return { ...state, columnMatches };
    }

    case 'set_date_order':
      return { ...state, dateOrder: action.dateOrder };

    case 'go_to_preview':
      if (state.step !== 'match' || missingRequiredFields(state).length > 0) return state;
      return { ...state, step: 'preview', preview: null, previewLoading: true, error: null };

    case 'back_to_match':
      return { ...state, step: 'match', preview: null, previewLoading: false, error: null };

    case 'set_value_match':
      return {
        ...state,
        valueMatches: {
          ...state.valueMatches,
          [action.field]: { ...state.valueMatches[action.field], [action.value]: action.choice },
        },
        previewLoading: true,
        error: null,
      };

    case 'preview_loaded':
      return { ...state, preview: action.result, previewLoading: false, error: null };

    case 'preview_failed':
      return { ...state, previewLoading: false, error: action.message };

    case 'commit_started':
      return {
        ...state,
        step: 'importing',
        paused: null,
        error: null,
        progress: { processed: 0, total: state.rowCount, saved: 0, skipped: 0, failed: 0 },
      };

    case 'batch_succeeded': {
      const r = action.result;
      const stalled = isStalled(state.progress?.processed ?? 0, r);
      return {
        ...state,
        step: r.done ? 'done' : 'importing',
        progress: progressOf(r),
        paused: stalled ? { processed: r.processed, total: r.total, message: STALLED_MESSAGE } : null,
      };
    }

    case 'batch_failed':
      return {
        ...state,
        paused: {
          processed: state.progress?.processed ?? 0,
          total: state.progress?.total ?? state.rowCount,
          message: action.message,
        },
      };

    case 'resume':
      return { ...state, paused: null };

    case 'resume_run':
      return {
        ...initialWizardState(state.sourceApp),
        history: state.history,
        step: 'importing',
        runId: action.run.id,
        rowCount: action.run.total,
        progress: progressOf(action.run),
      };

    case 'history_loaded':
      return { ...state, history: action.runs };

    case 'run_undone': {
      const status: RunSummary['status'] = action.result.kept.length === 0 ? 'undone' : 'done';
      return {
        ...state,
        history: state.history.map((r) => (r.id === action.runId ? { ...r, status } : r)),
        undone: action.runId === state.runId ? action.result : state.undone,
      };
    }

    case 'start_over':
      return { ...initialWizardState(state.sourceApp), history: state.history };

    default:
      return state;
  }
}
