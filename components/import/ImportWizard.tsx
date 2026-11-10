'use client';

import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/layout/PageHeader';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { ImportHistory } from '@/components/import/ImportHistory';
import { ImportingStep } from '@/components/import/ImportingStep';
import { MatchColumnsStep } from '@/components/import/MatchColumnsStep';
import { PreviewStep } from '@/components/import/PreviewStep';
import { UploadStep } from '@/components/import/UploadStep';
import {
  addUndo,
  IMPORT_SECTIONS,
  initialWizardState,
  isStalled,
  isUndoStalled,
  missingRequiredFields,
  wizardReducer,
  type BatchResult,
  type UndoResult,
  type UploadResult,
  type WizardState,
  UNDO_STALLED_MESSAGE,
} from '@/components/import/wizard-state';
import type { PreviewResult, RunSummary } from '@/lib/import/run';
import type { SectionKey } from '@/lib/import/types';

const TOO_LARGE = 'This file is larger than 10 MB.';
const OFFLINE = 'Could not reach the server. Check your connection and try again.';

type ApiResult<T> = { ok: true; data: T } | { ok: false; code?: string; message: string };

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const data = await res.json();
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function callApi<T>(url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await readJson(res);
    if (res.ok && data) return { ok: true, data: data as T };
    return {
      ok: false,
      code: typeof data?.code === 'string' ? data.code : undefined,
      message: typeof data?.error === 'string' ? data.error : 'Something went wrong. Try again.',
    };
  } catch {
    return { ok: false, message: OFFLINE };
  }
}

const STEPS: { key: WizardState['step'][]; label: string }[] = [
  { key: ['upload'], label: 'Upload' },
  { key: ['match'], label: 'Match columns' },
  { key: ['preview'], label: 'Preview' },
  { key: ['importing', 'done'], label: 'Import' },
];

/** The four-step import screen for one section: Upload, Match columns, Preview, Importing / Done. */
export function ImportWizard({ section }: { section: SectionKey }) {
  const meta = IMPORT_SECTIONS[section];
  const { user, business } = useAuth();
  const toast = useToastContext();
  const { status: authStatus } = useAuthorizationGuard({
    resource: meta.module,
    action: 'create',
    skipCheck: !user?.id || !business?.id,
  });
  const [state, dispatch] = useReducer(wizardReducer, undefined, () => initialWizardState());
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  /** Records removed so far by the undo under way (it runs in calls of up to 2,000). */
  const [undoRemoved, setUndoRemoved] = useState(0);
  const alive = useRef(true);
  const committing = useRef(false);
  const previewSeq = useRef(0);
  const base = `/api/import/${section}`;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadHistory = useCallback(async () => {
    const r = await callApi<{ runs: RunSummary[] }>(`/api/import/history?section=${section}`);
    if (alive.current && r.ok) dispatch({ type: 'history_loaded', runs: r.data.runs });
  }, [section]);

  useEffect(() => {
    if (authStatus === 'allowed') void loadHistory();
  }, [authStatus, loadHistory]);

  const upload = async (file: File) => {
    dispatch({ type: 'upload_started' });
    const form = new FormData();
    form.append('file', file);
    form.append('source_app', state.sourceApp);
    try {
      const res = await fetch(`${base}/upload`, { method: 'POST', credentials: 'include', body: form });
      // A file over the proxy limit is refused with an HTML 413 before it reaches the app.
      const data = res.status === 413 ? null : await readJson(res);
      if (!alive.current) return;
      if (!data) {
        dispatch({ type: 'upload_failed', code: 'TOO_LARGE', message: TOO_LARGE });
      } else if (!res.ok) {
        dispatch({
          type: 'upload_failed',
          code: typeof data.code === 'string' ? data.code : undefined,
          message: typeof data.error === 'string' ? data.error : 'This file could not be uploaded.',
        });
      } else {
        dispatch({ type: 'upload_succeeded', result: data as unknown as UploadResult });
      }
    } catch {
      if (alive.current) dispatch({ type: 'upload_failed', message: OFFLINE });
    }
  };

  const runPreview = async (input: Pick<WizardState, 'runId' | 'headers' | 'columnMatches' | 'valueMatches' | 'dateOrder'>) => {
    const seq = ++previewSeq.current;
    const r = await callApi<PreviewResult>(`${base}/preview`, {
      run_id: input.runId,
      column_matches: Object.fromEntries(input.headers.map((_, i) => [i, input.columnMatches[i] ?? null])),
      value_matches: input.valueMatches,
      date_order: input.dateOrder,
    });
    // Only the latest request's answer counts.
    if (!alive.current || seq !== previewSeq.current) return;
    if (r.ok) dispatch({ type: 'preview_loaded', result: r.data });
    else dispatch({ type: 'preview_failed', message: r.message });
  };

  const goToPreview = () => {
    if (missingRequiredFields(state).length > 0) return;
    dispatch({ type: 'go_to_preview' });
    void runPreview(state);
  };

  const setValueMatch = (field: string, value: string, choice: string) => {
    if (!choice) return;
    dispatch({ type: 'set_value_match', field, value, choice });
    const valueMatches = { ...state.valueMatches, [field]: { ...state.valueMatches[field], [value]: choice } };
    void runPreview({ ...state, valueMatches });
  };

  /** Calls commit until the run is done, a call fails, or a batch stops advancing. */
  const commit = async (runId: string, startProcessed: number) => {
    if (committing.current) return;
    committing.current = true;
    let processed = startProcessed;
    try {
      for (;;) {
        const r = await callApi<BatchResult>(`${base}/commit`, { run_id: runId });
        if (!alive.current) return;
        if (!r.ok) {
          dispatch({ type: 'batch_failed', code: r.code, message: r.message });
          return;
        }
        // The reducer pauses a stalled batch with its message; the loop stops here too.
        dispatch({ type: 'batch_succeeded', result: r.data });
        if (isStalled(processed, r.data)) return;
        processed = r.data.processed;
        if (r.data.done) break;
      }
      void loadHistory();
    } finally {
      committing.current = false;
    }
  };

  const startImport = () => {
    if (!state.runId) return;
    dispatch({ type: 'commit_started' });
    void commit(state.runId, 0);
  };

  const resume = () => {
    if (!state.runId) return;
    dispatch({ type: 'resume' });
    void commit(state.runId, state.progress?.processed ?? 0);
  };

  const resumeRun = (run: RunSummary) => {
    dispatch({ type: 'resume_run', run });
    void commit(run.id, run.processed);
  };

  /** Calls undo until the server says done, a call fails, or a call handles no record. */
  const undo = async (runId: string) => {
    setBusyRunId(runId);
    setUndoRemoved(0);
    let total: UndoResult | null = null;
    let stopped: string | null = null;
    for (;;) {
      const r = await callApi<UndoResult>(`${base}/undo`, { run_id: runId });
      if (!alive.current) return;
      if (!r.ok) {
        stopped = r.message;
        break;
      }
      total = addUndo(total, r.data);
      setUndoRemoved(total.removed);
      if (r.data.done) break;
      if (isUndoStalled(r.data)) {
        stopped = UNDO_STALLED_MESSAGE;
        break;
      }
    }
    setBusyRunId(null);
    if (stopped !== null || !total) {
      const message = stopped ?? UNDO_STALLED_MESSAGE;
      toast.error(total && total.removed > 0 ? `Removed ${total.removed} records, then stopped. ${message}` : message);
      void loadHistory();
      return;
    }
    dispatch({ type: 'run_undone', runId, result: total });
    if (total.kept.length > 0) {
      toast.warning(`Removed ${total.removed} records. ${total.kept.length} kept because they are already used.`);
    } else {
      toast.success(`Removed ${total.removed} records.`);
    }
    void loadHistory();
  };

  if (authStatus === 'loading') {
    return (
      <div className="flex h-[calc(100vh-100px)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }
  if (authStatus === 'denied') return <AccessDenied module={meta.module} action="create" />;

  const stepIndex = STEPS.findIndex((s) => s.key.includes(state.step));
  const problemRowsHref = state.runId ? `${base}/problem-rows?run_id=${encodeURIComponent(state.runId)}` : null;

  return (
    <div className="space-y-3 md:space-y-6">
      <Link href={meta.listHref} className="inline-flex min-h-11 items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to {meta.label}
      </Link>
      <PageHeader title={meta.title} />

      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Import steps">
        {STEPS.map((s, i) => (
          <li
            key={s.label}
            aria-current={i === stepIndex ? 'step' : undefined}
            className={clsx(i === stepIndex ? 'font-semibold text-text-primary' : 'text-text-secondary')}
          >
            {i + 1}. {s.label}
          </li>
        ))}
      </ol>

      <Card>
        {state.step === 'upload' ? (
          <UploadStep
            section={section}
            sourceApp={state.sourceApp}
            uploading={state.uploading}
            error={state.error}
            onSourceApp={(sourceApp) => dispatch({ type: 'set_source_app', sourceApp })}
            onFile={(file) => void upload(file)}
          />
        ) : null}
        {state.step === 'match' ? (
          <MatchColumnsStep
            headers={state.headers}
            samples={state.samples}
            fields={state.fields}
            rowCount={state.rowCount}
            columnMatches={state.columnMatches}
            needsDateOrder={state.needsDateOrder}
            dateOrder={state.dateOrder}
            missingRequired={missingRequiredFields(state)}
            onMatch={(column, field) => dispatch({ type: 'match_column', column, field })}
            onDateOrder={(dateOrder) => dispatch({ type: 'set_date_order', dateOrder })}
            onBack={() => dispatch({ type: 'start_over' })}
            onNext={goToPreview}
          />
        ) : null}
        {state.step === 'preview' ? (
          <PreviewStep
            sectionLabel={meta.label}
            fields={state.fields}
            preview={state.preview}
            loading={state.previewLoading}
            error={state.error}
            valueMatches={state.valueMatches}
            problemRowsHref={problemRowsHref}
            onValueMatch={setValueMatch}
            onBack={() => dispatch({ type: 'back_to_match' })}
            onImport={startImport}
          />
        ) : null}
        {state.step === 'importing' || state.step === 'done' ? (
          <ImportingStep
            done={state.step === 'done'}
            progress={state.progress}
            paused={state.paused}
            undone={state.undone}
            undoing={busyRunId !== null && busyRunId === state.runId}
            undoRemoved={undoRemoved}
            problemRowsHref={problemRowsHref}
            listHref={meta.listHref}
            listLabel={meta.label}
            onResume={resume}
            onUndo={() => state.runId && void undo(state.runId)}
          />
        ) : null}
      </Card>

      {state.step === 'upload' ? (
        <ImportHistory
          runs={state.history}
          busyRunId={busyRunId}
          undoRemoved={undoRemoved}
          onUndo={(run) => void undo(run.id)}
          onResume={resumeRun}
        />
      ) : null}
    </div>
  );
}
