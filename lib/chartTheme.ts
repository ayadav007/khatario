/**
 * SVG charts use explicit stroke/fill — tie them to theme via useDarkMode + this palette.
 */
export type ChartPalette = {
  grid: string;
  gridStrong: string;
  axis: string;
  label: string;
  labelStrong: string;
  zeroLine: string;
  pointStroke: string;
  emptyState: string;
};

export function getChartPalette(isDark: boolean): ChartPalette {
  if (isDark) {
    return {
      grid: '#334155',
      gridStrong: '#475569',
      axis: '#94a3b8',
      label: '#cbd5e1',
      labelStrong: '#f1f5f9',
      zeroLine: '#94a3b8',
      pointStroke: '#1e293b',
      emptyState: '#64748b',
    };
  }
  return {
    grid: '#e5e7eb',
    gridStrong: '#d1d5db',
    axis: '#6b7280',
    label: '#4b5563',
    labelStrong: '#374151',
    zeroLine: '#6b7280',
    pointStroke: '#ffffff',
    emptyState: '#9ca3af',
  };
}
