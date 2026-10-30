import type { SizeChart, StoreTab } from '@/lib/store/product-extras';

export const CHART_MAX_COLUMNS = 8;
export const CHART_MAX_ROWS = 20;
export const TABS_MAX = 4;

export const emptyChart = (): SizeChart => ({ columns: ['Size', ''], rows: [['', '']] });

export function addColumn(chart: SizeChart): SizeChart {
  if (chart.columns.length >= CHART_MAX_COLUMNS) return chart;
  return { columns: [...chart.columns, ''], rows: chart.rows.map((r) => [...r, '']) };
}

export function removeColumn(chart: SizeChart, index: number): SizeChart {
  if (chart.columns.length <= 1 || index < 0 || index >= chart.columns.length) return chart;
  return {
    columns: chart.columns.filter((_, i) => i !== index),
    rows: chart.rows.map((r) => r.filter((_, i) => i !== index)),
  };
}

export function addRow(chart: SizeChart): SizeChart {
  if (chart.rows.length >= CHART_MAX_ROWS) return chart;
  return { ...chart, rows: [...chart.rows, chart.columns.map(() => '')] };
}

export function removeRow(chart: SizeChart, index: number): SizeChart {
  if (index < 0 || index >= chart.rows.length) return chart;
  return { ...chart, rows: chart.rows.filter((_, i) => i !== index) };
}

export function setHeader(chart: SizeChart, col: number, text: string): SizeChart {
  return { ...chart, columns: chart.columns.map((c, i) => (i === col ? text : c)) };
}

export function setCell(chart: SizeChart, row: number, col: number, text: string): SizeChart {
  return {
    ...chart,
    rows: chart.rows.map((r, ri) => (ri === row ? r.map((c, ci) => (ci === col ? text : c)) : r)),
  };
}

/** Moves a tab up (-1) or down (+1); out-of-range moves return the list unchanged. */
export function moveTab(tabs: StoreTab[], index: number, dir: -1 | 1): StoreTab[] {
  const to = index + dir;
  if (index < 0 || index >= tabs.length || to < 0 || to >= tabs.length) return tabs;
  const next = [...tabs];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** True when the two values differ (deep, JSON-shaped values only). */
export function extrasChanged(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}
