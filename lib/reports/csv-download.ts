import { csvSafeText } from '@/lib/csv-safe';
/** Downloads rows as a CSV file in the browser. Values are quoted when they need it. */
export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number | null | undefined>>): void {
  const cell = (v: string | number | null | undefined) => {
    const s = csvSafeText(v === null || v === undefined ? '' : String(v));
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Indian financial year (April to March) containing a date. */
export function financialYearOf(date: Date = new Date()): { from: string; to: string; label: string } {
  const y = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return { from: `${y}-04-01`, to: `${y + 1}-03-31`, label: `${y}-${String((y + 1) % 100).padStart(2, '0')}` };
}
