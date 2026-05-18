import { randomUUID } from 'crypto';
import type { NormalizedBankRow } from '@/lib/bank/types';

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseInrAmount(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[₹,\s]/g, '').trim();
  if (!s || s === '-') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? roundMoney(n) : null;
}

/** Parse DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD */
export function parseStatementDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (dmy) {
    let y = parseInt(dmy[3], 10);
    if (y < 100) y += 2000;
    const d = dmy[1].padStart(2, '0');
    const m = dmy[2].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

export function makePreviewRow(partial: Omit<NormalizedBankRow, 'tempId'>): NormalizedBankRow {
  return {
    tempId: randomUUID(),
    ...partial,
  };
}
