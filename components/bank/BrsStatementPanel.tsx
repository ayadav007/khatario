'use client';

import React, { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

type BrsPayload = {
  as_on_date: string;
  window_start: string;
  result: {
    balance_per_books: number;
    add_cheques_issued_not_presented: number;
    less_deposits_not_credited: number;
    less_bank_debits_not_in_books: number;
    add_bank_credits_not_in_books: number;
    balance_per_bank_computed: number;
    balance_per_bank_statement: number | null;
    unexplained_difference: number | null;
  };
  ledger_items_not_on_statement: Array<{
    id: string;
    entry_date: string;
    debit: number;
    credit: number;
    narration: string | null;
    reference_number: string | null;
  }>;
  bank_items_not_in_books: Array<{
    id: string;
    transaction_date: string;
    description: string;
    debit_amount: number;
    credit_amount: number;
  }>;
};

const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function BrsStatementPanel({ businessId, bankAccountId }: { businessId: string; bankAccountId: string }) {
  const [open, setOpen] = useState(false);
  const [asOn, setAsOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<BrsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/bank/brs?business_id=${encodeURIComponent(businessId)}&bank_account_id=${encodeURIComponent(
          bankAccountId
        )}&as_on_date=${asOn}`
      );
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed to load BRS');
      setData(j);
    } catch (e: any) {
      setError(e.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [businessId, bankAccountId, asOn]);

  const r = data?.result;
  const row = (label: string, value: number, sign: '+' | '−' | '') => (
    <tr className="border-b border-border">
      <td className="py-2 pr-4">{label}</td>
      <td className="py-2 text-right font-mono">
        {sign} {fmt(value)}
      </td>
    </tr>
  );

  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <button
        type="button"
        className="flex items-center gap-2 text-sm font-semibold text-text-primary"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Bank reconciliation statement (BRS)
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="font-medium text-text-secondary">As on</span>
              <input
                type="date"
                className="mt-1 block rounded-md border border-border px-3 py-2 text-sm"
                value={asOn}
                onChange={(e) => setAsOn(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? 'Preparing…' : 'Prepare BRS'}
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {r && data && (
            <>
              <table className="w-full max-w-xl text-sm">
                <tbody>
                  {row('Balance as per books (Dr)', r.balance_per_books, '')}
                  {row('Add: cheques issued but not presented', r.add_cheques_issued_not_presented, '+')}
                  {row('Less: deposits not yet credited by bank', r.less_deposits_not_credited, '−')}
                  {row('Less: bank charges / debits not in books', r.less_bank_debits_not_in_books, '−')}
                  {row('Add: interest / credits not in books', r.add_bank_credits_not_in_books, '+')}
                  <tr className="border-b-2 border-text-primary font-semibold">
                    <td className="py-2 pr-4">Balance as per bank (computed)</td>
                    <td className="py-2 text-right font-mono">{fmt(r.balance_per_bank_computed)}</td>
                  </tr>
                  {r.balance_per_bank_statement != null && (
                    <>
                      <tr>
                        <td className="py-2 pr-4">Balance as per bank statement</td>
                        <td className="py-2 text-right font-mono">{fmt(r.balance_per_bank_statement)}</td>
                      </tr>
                      <tr className={Math.abs(r.unexplained_difference || 0) < 0.01 ? 'text-green-700' : 'text-red-600'}>
                        <td className="py-2 pr-4 font-medium">Unexplained difference</td>
                        <td className="py-2 text-right font-mono">{fmt(r.unexplained_difference || 0)}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
              <p className="text-xs text-text-secondary">
                Book entries from {data.window_start} (first imported statement) onward are considered. Book the
                unmatched bank charges and interest with &quot;Create entry…&quot; above.
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <h4 className="mb-2 text-sm font-semibold">In books, not on statement</h4>
                  <ul className="max-h-64 space-y-1 overflow-auto text-xs">
                    {data.ledger_items_not_on_statement.map((l) => (
                      <li key={l.id} className="flex justify-between gap-2 border-b border-border py-1">
                        <span>
                          {l.entry_date} · {l.reference_number || l.narration || '—'}
                        </span>
                        <span className="font-mono">
                          {l.debit > 0 ? `Dr ${fmt(l.debit)}` : `Cr ${fmt(l.credit)}`}
                        </span>
                      </li>
                    ))}
                    {!data.ledger_items_not_on_statement.length && <li className="text-text-secondary">None</li>}
                  </ul>
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-semibold">On statement, not in books</h4>
                  <ul className="max-h-64 space-y-1 overflow-auto text-xs">
                    {data.bank_items_not_in_books.map((b) => (
                      <li key={b.id} className="flex justify-between gap-2 border-b border-border py-1">
                        <span>
                          {b.transaction_date} · {b.description}
                        </span>
                        <span className="font-mono">
                          {b.debit_amount > 0 ? `W ${fmt(b.debit_amount)}` : `D ${fmt(b.credit_amount)}`}
                        </span>
                      </li>
                    ))}
                    {!data.bank_items_not_in_books.length && <li className="text-text-secondary">None</li>}
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
