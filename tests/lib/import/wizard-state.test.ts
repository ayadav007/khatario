import {
  initialWizardState,
  missingRequiredFields,
  STALLED_MESSAGE,
  wizardReducer,
  type WizardState,
} from '@/components/import/wizard-state';
import type { ImportField } from '@/lib/import/types';
import type { RunSummary } from '@/lib/import/run';

const fields: ImportField[] = [
  { key: 'name', label: 'Customer name', type: 'text', required: true, aliases: [] },
  { key: 'gstin', label: 'GSTIN', type: 'gstin', aliases: [] },
  { key: 'phone', label: 'Phone', type: 'phone', aliases: [] },
];

const upload = {
  runId: '11111111-1111-4111-8111-111111111111',
  headers: ['Party', 'GST No', 'Mobile'],
  samples: [['Asha Traders', '27AAAPA1234A1Z5', '9876543210']],
  guesses: { 0: 'name', 1: 'gstin', 2: null },
  fields,
  rowCount: 450,
  needsDateOrder: false,
};

function onMatch(): WizardState {
  return wizardReducer(initialWizardState(), { type: 'upload_succeeded', result: upload });
}

function importing(): WizardState {
  const preview = wizardReducer(onMatch(), { type: 'go_to_preview' });
  return wizardReducer(preview, { type: 'commit_started' });
}

const run = (over: Partial<RunSummary>): RunSummary => ({
  id: '22222222-2222-4222-8222-222222222222',
  section: 'customers',
  sourceApp: 'tally',
  fileName: 'parties.xlsx',
  status: 'done',
  saved: 10,
  skipped: 0,
  failed: 0,
  processed: 10,
  total: 10,
  createdAt: '2026-11-10T10:00:00.000Z',
  createdByName: 'Asha',
  ...over,
});

test('upload success moves to match with the guesses', () => {
  const s = onMatch();
  expect(s.step).toBe('match');
  expect(s.runId).toBe(upload.runId);
  expect(s.columnMatches).toEqual({ 0: 'name', 1: 'gstin', 2: null });
  expect(s.headers).toEqual(upload.headers);
  expect(s.error).toBeNull();
});

test('an upload refused as too large stays on upload with the message', () => {
  const started = wizardReducer(initialWizardState(), { type: 'upload_started' });
  const s = wizardReducer(started, { type: 'upload_failed', code: 'TOO_LARGE', message: 'This file is larger than 10 MB.' });
  expect(s.step).toBe('upload');
  expect(s.uploading).toBe(false);
  expect(s.error).toBe('This file is larger than 10 MB.');
});

test('choosing a field for a column clears it from any other column', () => {
  const s = wizardReducer(onMatch(), { type: 'match_column', column: 2, field: 'name' });
  expect(s.columnMatches).toEqual({ 0: null, 1: 'gstin', 2: 'name' });
});

test('match to preview is refused while a required field is unmatched', () => {
  const unmatched = wizardReducer(onMatch(), { type: 'match_column', column: 0, field: null });
  expect(missingRequiredFields(unmatched)).toEqual(['Customer name']);
  const s = wizardReducer(unmatched, { type: 'go_to_preview' });
  expect(s.step).toBe('match');

  const ok = wizardReducer(onMatch(), { type: 'go_to_preview' });
  expect(ok.step).toBe('preview');
  expect(ok.previewLoading).toBe(true);
});

test('a batch with done false stays on importing and updates progress', () => {
  const s = wizardReducer(importing(), {
    type: 'batch_succeeded',
    result: { done: false, processed: 200, total: 450, saved: 190, skipped: 10, failed: 0 },
  });
  expect(s.step).toBe('importing');
  expect(s.progress).toEqual({ processed: 200, total: 450, saved: 190, skipped: 10, failed: 0 });
});

test('a batch with done true moves to done', () => {
  const s = wizardReducer(importing(), {
    type: 'batch_succeeded',
    result: { done: true, processed: 450, total: 450, saved: 430, skipped: 15, failed: 5 },
  });
  expect(s.step).toBe('done');
  expect(s.progress?.saved).toBe(430);
});

test('a failed batch pauses after the rows processed so far, and resume clears it', () => {
  const mid = wizardReducer(importing(), {
    type: 'batch_succeeded',
    result: { done: false, processed: 200, total: 450, saved: 200, skipped: 0, failed: 0 },
  });
  const s = wizardReducer(mid, { type: 'batch_failed', message: 'Import failed' });
  expect(s.step).toBe('importing');
  expect(s.paused).toEqual({ processed: 200, total: 450, message: 'Import failed' });
  expect(wizardReducer(s, { type: 'resume' }).paused).toBeNull();
});

test('a batch that is not done and did not advance pauses with the stalled message', () => {
  const mid = wizardReducer(importing(), {
    type: 'batch_succeeded',
    result: { done: false, processed: 200, total: 450, saved: 200, skipped: 0, failed: 0 },
  });
  expect(mid.paused).toBeNull();
  const s = wizardReducer(mid, {
    type: 'batch_succeeded',
    result: { done: false, processed: 200, total: 450, saved: 200, skipped: 0, failed: 0 },
  });
  expect(s.step).toBe('importing');
  expect(s.paused).toEqual({ processed: 200, total: 450, message: STALLED_MESSAGE });
});

test('resuming an unfinished run from history goes to importing with its progress', () => {
  const unfinished = run({ status: 'failed', processed: 200, total: 450, saved: 200 });
  const s = wizardReducer(initialWizardState(), { type: 'resume_run', run: unfinished });
  expect(s.step).toBe('importing');
  expect(s.runId).toBe(unfinished.id);
  expect(s.progress).toEqual({ processed: 200, total: 450, saved: 200, skipped: 0, failed: 0 });
});

test('undo from history updates that run status in state', () => {
  const other = run({ id: '33333333-3333-4333-8333-333333333333' });
  const loaded = wizardReducer(initialWizardState(), { type: 'history_loaded', runs: [run({}), other] });
  const s = wizardReducer(loaded, { type: 'run_undone', runId: run({}).id, result: { removed: 10, kept: [] } });
  expect(s.history.map((r) => r.status)).toEqual(['undone', 'done']);

  const partly = wizardReducer(loaded, {
    type: 'run_undone',
    runId: run({}).id,
    result: { removed: 9, kept: [{ label: 'Asha Traders', reason: 'Used in an invoice' }] },
  });
  expect(partly.history[0].status).toBe('done');
});
