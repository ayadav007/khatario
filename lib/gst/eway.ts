/** E-way bill numbers issued by the GST portal are 12 digits. */
export function parseEwayBillNumber(value: unknown): { number: string | null; error?: string } {
  const raw = String(value ?? '').trim();
  if (!raw) return { number: null };
  if (!/^\d{12}$/.test(raw)) {
    return { number: null, error: 'E-way bill number must be 12 digits' };
  }
  return { number: raw };
}

export function parseEwayBillDate(value: unknown): { date: string | null; error?: string } {
  if (value == null || String(value).trim() === '') return { date: null };
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { date: null, error: 'E-way bill date must be YYYY-MM-DD' };
  }
  return { date: raw };
}
