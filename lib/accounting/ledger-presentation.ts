import { balanceSide, signedLedgerBalance, type BalanceSide } from '@/lib/accounting/ledger-register';

export type LedgerSourceLine = {
  id: string;
  entry_date: string | Date;
  created_at?: string | Date | null;
  account_id: string;
  account_code?: string | null;
  account_name?: string | null;
  account_nature?: string | null;
  voucher_id?: string | null;
  voucher_type?: string | null;
  voucher_number?: string | null;
  reference_number?: string | null;
  narration?: string | null;
  debit: number | string;
  credit: number | string;
};

export type PresentedLedgerRow = {
  id: string;
  entry_date: string;
  account_id: string;
  account_code: string | null;
  account_name: string | null;
  account_nature: string | null;
  voucher_number: string | null;
  voucher_type: string | null;
  voucher_types: string[];
  reference_number: string | null;
  narration: string | null;
  debit: number;
  credit: number;
  opening: number;
  opening_side: BalanceSide;
  closing: number;
  balance_side: BalanceSide;
};

type Group = {
  key: string;
  lines: LedgerSourceLine[];
};

function money(value: number | string): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function dateKey(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const match = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function timeKey(line: LedgerSourceLine): string {
  const created = line.created_at instanceof Date ? line.created_at.toISOString() : String(line.created_at || '');
  return `${dateKey(line.entry_date)}|${created}|${line.id}`;
}

/** Same account and the same bill or voucher number. A line with no number stays on its own voucher. */
export function ledgerVoucherKey(line: LedgerSourceLine): string {
  const ref = String(line.reference_number || line.voucher_number || '').trim();
  if (ref) return `${line.account_id}|ref:${ref.toLowerCase()}`;
  if (line.voucher_id) return `${line.account_id}|voucher:${line.voucher_type || ''}:${line.voucher_id}`;
  return `${line.account_id}|line:${line.id}`;
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/**
 * Merges consecutive lines of one account that belong to the same voucher number,
 * then fills Opening, Closing, and Balance from the running position of that account.
 * A line of the same account in between keeps the two sides on their own rows.
 */
export function presentLedgerEntries(
  lines: LedgerSourceLine[],
  openingByAccount: Iterable<{ account_id: string; debit: number; credit: number }> = [],
): PresentedLedgerRow[] {
  const prior = new Map<string, { debit: number; credit: number }>();
  for (const row of openingByAccount) prior.set(row.account_id, row);

  const byAccount = new Map<string, LedgerSourceLine[]>();
  for (const line of lines) {
    const list = byAccount.get(line.account_id) || [];
    list.push(line);
    byAccount.set(line.account_id, list);
  }

  const presented: PresentedLedgerRow[] = [];
  for (const [accountId, accountLines] of byAccount) {
    const ordered = [...accountLines].sort((a, b) => timeKey(a).localeCompare(timeKey(b)));
    const groups: Group[] = [];
    for (const line of ordered) {
      const key = ledgerVoucherKey(line);
      const previous = groups[groups.length - 1];
      if (previous && previous.key === key) previous.lines.push(line);
      else groups.push({ key, lines: [line] });
    }

    const nature = ordered.find((line) => line.account_nature)?.account_nature;
    const broughtForward = prior.get(accountId);
    let running = signedLedgerBalance(nature, broughtForward?.debit || 0, broughtForward?.credit || 0);

    for (const group of groups) {
      const debit = money(group.lines.reduce((sum, line) => sum + money(line.debit), 0));
      const credit = money(group.lines.reduce((sum, line) => sum + money(line.credit), 0));
      const opening = balanceSide(nature, running);
      running = money(running + signedLedgerBalance(nature, debit, credit));
      const closing = balanceSide(nature, running);
      const first = [...group.lines].sort((a, b) => timeKey(a).localeCompare(timeKey(b)))[0];
      const last = [...group.lines].sort((a, b) => timeKey(b).localeCompare(timeKey(a)))[0];
      const types = unique(group.lines.map((line) => line.voucher_type));
      const reference = unique(group.lines.map((line) => line.reference_number || line.voucher_number))[0] || null;
      presented.push({
        id: group.lines.map((line) => line.id).join(':'),
        entry_date: dateKey(last.entry_date),
        account_id: accountId,
        account_code: first.account_code || null,
        account_name: first.account_name || null,
        account_nature: nature || null,
        voucher_number: first.voucher_number || null,
        voucher_type: types.length === 1 ? types[0] : null,
        voucher_types: types,
        reference_number: reference,
        narration: unique(group.lines.map((line) => line.narration)).join(' · ') || null,
        debit,
        credit,
        opening: opening.amount,
        opening_side: opening.side,
        closing: closing.amount,
        balance_side: closing.side,
      });
    }
  }

  presented.sort((a, b) => {
    const date = dateKey(b.entry_date).localeCompare(dateKey(a.entry_date));
    if (date !== 0) return date;
    return b.id.localeCompare(a.id);
  });
  return presented;
}
