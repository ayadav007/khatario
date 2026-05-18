'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/contexts/AuthContext';

export type GatewayPaymentTransactionRow = {
  id: string;
  order_id: string;
  amount: string;
  currency: string;
  status: string;
  method: string;
  provider: string;
  utr: string | null;
  provider_payment_id: string | null;
  created_at: string;
  updated_at: string;
};

function formatInr(amount: string | number): string {
  const n = typeof amount === 'number' ? amount : parseFloat(String(amount));
  const v = Number.isFinite(n) ? n : 0;
  return `₹ ${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatMethod(method: string): string {
  const m = method.toLowerCase();
  if (m === 'upi_collect') return 'UPI collect';
  if (m === 'virtual_account') return 'Virtual account';
  return method.replace(/_/g, ' ');
}

function statusPillClasses(status: string): string {
  const s = status.toLowerCase();
  switch (s) {
    case 'success':
      return 'bg-green-50 text-green-800 border-green-200';
    case 'pending':
      return 'bg-amber-50 text-amber-900 border-amber-200';
    case 'requires_review':
      return 'bg-orange-50 text-orange-900 border-orange-200';
    case 'failed':
      return 'bg-red-50 text-red-800 border-red-200';
    default:
      return 'bg-gray-50 text-gray-800 border-gray-200';
  }
}

function referenceForRow(row: GatewayPaymentTransactionRow): string {
  const utr = row.utr?.trim();
  const pid = row.provider_payment_id?.trim();
  if (utr) return utr;
  if (pid) return pid;
  return '—';
}

interface SalesOrderPaymentTransactionsPanelProps {
  orderId: string;
}

export function SalesOrderPaymentTransactionsPanel({
  orderId,
}: SalesOrderPaymentTransactionsPanelProps) {
  const { business, user } = useAuth();
  const [rows, setRows] = useState<GatewayPaymentTransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        order_id: orderId,
        business_id: business.id,
        user_id: user.id,
      });
      const res = await fetch(`/api/payments?${params.toString()}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        setRows([]);
        setError(data.error || 'Could not load payment transactions');
        return;
      }
      setRows(Array.isArray(data.payment_transactions) ? data.payment_transactions : []);
    } catch {
      setRows([]);
      setError('Could not load payment transactions');
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id, orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!business?.id || !user?.id) {
    return null;
  }

  return (
    <Card className="border border-border bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-text-primary mb-3">
        Gateway payment transactions
      </h2>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading transactions…
        </div>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-secondary py-2">
          No payment provider transactions for this order yet.
        </p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-secondary text-xs uppercase tracking-wide">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium text-right">Amount</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Method</th>
                <th className="py-2 pr-3 font-medium">Provider</th>
                <th className="py-2 font-medium">Reference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const when = row.updated_at || row.created_at;
                const d = when ? new Date(when) : null;
                return (
                  <tr
                    key={row.id}
                    className="border-b border-border/80 last:border-0"
                  >
                    <td className="py-2.5 pr-3 text-text-primary whitespace-nowrap">
                      {d && !isNaN(d.getTime())
                        ? format(d, 'dd MMM yyyy, HH:mm')
                        : '—'}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-medium text-gray-900 tabular-nums">
                      {formatInr(row.amount)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={clsx(
                          'inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold capitalize',
                          statusPillClasses(row.status)
                        )}
                      >
                        {row.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-text-primary capitalize">
                      {formatMethod(row.method)}
                    </td>
                    <td className="py-2.5 pr-3 text-text-primary">
                      {row.provider}
                    </td>
                    <td className="py-2.5 font-mono text-xs text-text-primary break-all max-w-[200px]">
                      {referenceForRow(row)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
