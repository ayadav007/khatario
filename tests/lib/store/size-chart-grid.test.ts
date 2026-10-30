import {
  addColumn,
  addRow,
  extrasChanged,
  moveTab,
  removeColumn,
  removeRow,
  setCell,
  CHART_MAX_COLUMNS,
  CHART_MAX_ROWS,
} from '@/lib/store/size-chart-grid';

const chart = { columns: ['Size', 'Chest'], rows: [['S', '36'], ['M', '38']] };

describe('size-chart-grid', () => {
  it('adds and removes columns keeping rows aligned', () => {
    const a = addColumn(chart);
    expect(a.columns).toHaveLength(3);
    expect(a.rows.every((r) => r.length === 3)).toBe(true);
    const b = removeColumn(a, 0);
    expect(b.columns).toEqual(['Chest', '']);
    expect(b.rows[0]).toEqual(['36', '']);
  });

  it('respects limits', () => {
    let c = chart;
    for (let i = 0; i < 20; i++) c = addColumn(c);
    expect(c.columns).toHaveLength(CHART_MAX_COLUMNS);
    for (let i = 0; i < 30; i++) c = addRow(c);
    expect(c.rows).toHaveLength(CHART_MAX_ROWS);
    expect(removeColumn({ columns: ['a'], rows: [['x']] }, 0).columns).toHaveLength(1);
  });

  it('removes rows and sets cells without mutating', () => {
    expect(removeRow(chart, 0).rows).toEqual([['M', '38']]);
    const c = setCell(chart, 1, 1, '40');
    expect(c.rows[1][1]).toBe('40');
    expect(chart.rows[1][1]).toBe('38');
  });

  it('moves tabs', () => {
    const tabs = [{ title: 'a', body: '1' }, { title: 'b', body: '2' }];
    expect(moveTab(tabs, 0, 1).map((t) => t.title)).toEqual(['b', 'a']);
    expect(moveTab(tabs, 0, -1)).toBe(tabs);
  });

  it('detects changes', () => {
    expect(extrasChanged(null, undefined)).toBe(false);
    expect(extrasChanged(chart, { ...chart })).toBe(false);
    expect(extrasChanged(chart, setCell(chart, 0, 0, 'XS'))).toBe(true);
  });
});
