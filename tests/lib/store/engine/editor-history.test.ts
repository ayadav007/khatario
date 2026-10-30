import {
  HISTORY_LIMIT,
  MERGE_MS,
  canRedo,
  canUndo,
  createHistory,
  record,
  redo,
  undo,
} from '@/lib/store/engine/editor/history';

describe('editor history', () => {
  it('exposes the documented limits', () => {
    expect(HISTORY_LIMIT).toBe(100);
    expect(MERGE_MS).toBe(1000);
  });

  it('same key within 1000 ms replaces present without a new past entry', () => {
    let h = createHistory(0);
    h = record(h, 1, 'k', 0);
    h = record(h, 2, 'k', 500);
    h = record(h, 3, 'k', 999 + 500); // 999 after the previous record (lastAt updates)
    expect(h.present).toBe(3);
    expect(h.past).toEqual([0]);
  });

  it('different key, or 1000 ms or more apart, or a null key adds a past entry', () => {
    let h = createHistory(0);
    h = record(h, 1, 'a', 0);
    h = record(h, 2, 'b', 10);
    expect(h.past).toEqual([0, 1]);
    h = record(h, 3, 'b', 1010);
    expect(h.past).toEqual([0, 1, 2]);
    h = record(h, 4, null, 1020);
    h = record(h, 5, null, 1030);
    expect(h.past).toEqual([0, 1, 2, 3, 4]);
  });

  it('undo after a merged run returns the state before the run', () => {
    let h = createHistory(0);
    h = record(h, 1, 'k', 0);
    h = record(h, 2, 'k', 100);
    h = record(h, 3, 'k', 200);
    h = undo(h);
    expect(h.present).toBe(0);
    expect(h.future).toEqual([3]);
    h = redo(h);
    expect(h.present).toBe(3);
  });

  it('undo resets the merge key so the next edit does not merge into the old run', () => {
    let h = createHistory(0);
    h = record(h, 1, 'k', 0);
    h = record(h, 2, 'k', 10);
    h = undo(h);
    expect(h.lastKey).toBeNull();
    h = record(h, 9, 'k', 20);
    expect(h.past).toEqual([0]);
    expect(h.present).toBe(9);
    h = undo(h);
    expect(h.present).toBe(0);
  });

  it('record clears the future', () => {
    let h = createHistory(0);
    h = record(h, 1, null, 0);
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = record(h, 2, null, 10);
    expect(h.future).toEqual([]);
    expect(canRedo(h)).toBe(false);
  });

  it('past never exceeds 100 (oldest dropped)', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 150; i++) h = record(h, i, null, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toBe(50);
    expect(h.past[h.past.length - 1]).toBe(149);
    expect(h.present).toBe(150);
  });

  it('record with next === present is a no-op', () => {
    const h = createHistory({ a: 1 });
    expect(record(h, h.present, null, 5)).toBe(h);
  });

  it('undo/redo at the ends return the same object', () => {
    const h = createHistory(0);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('never mutates the history passed in', () => {
    const h = createHistory(0);
    const a = record(h, 1, 'k', 0);
    const snap = JSON.stringify(a);
    record(a, 2, 'k', 10);
    undo(a);
    expect(JSON.stringify(a)).toBe(snap);
    expect(h.past).toEqual([]);
  });
});
