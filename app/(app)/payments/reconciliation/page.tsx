'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SplitPaneLayout } from '@/components/layout/SplitPaneLayout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { clsx } from 'clsx';
import { RefreshCcw, X } from 'lucide-react';

type TxStatus = 'pending' | 'success' | 'failed' | 'requires_review' | string;

type ReconciliationRow = {
  id: string;
  order_id: string;
  amount: string;
  currency: string;
  status: TxStatus;
  method: string;
  provider: string;
  utr: string | null;
  provider_payment_id: string | null;
  raw_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  order_payment_status?: string | null;
  order_payment_reference?: string | null;
  order_created_at?: string;
};

function formatDateTime(v?: string) {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMoney(amountText: string, currency: string) {
  const n = Number(amountText);
  const val = Number.isFinite(n) ? n : 0;
  const prefix = currency?.toUpperCase?.() === 'INR' ? '₹' : currency?.toUpperCase?.() || '';
  return `${prefix} ${val.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`.trim();
}

function pickValidation(raw: Record<string, unknown>): unknown {
  const v = (raw as any)?.webhook_validation;
  if (v != null) return v;
  const mv = (raw as any)?.manual_validation;
  if (mv != null) return mv;
  return null;
}

export default function PaymentReconciliationPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();

  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [status, setStatus] = useState<string>('requires_review');
  const [provider, setProvider] = useState<string>('all');
  const [q, setQ] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) || null,
    [rows, selectedId]
  );

  const providers = useMemo(() => {
    const set = new Set(rows.map((r) => r.provider).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  async function fetchRows() {
    if (!business?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('business_id', business.id);
      params.set('user_id', user?.id || '');
      params.set('reconciliation', '1');
      if (status && status !== 'all') params.set('status', status);
      if (provider && provider !== 'all') params.set('provider', provider);
      if (q.trim()) params.set('q', q.trim());

      const res = await fetch(`/api/payments?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load');
      setRows(data.payment_transactions || []);
    } catch (e: any) {
      toast.showToast?.(e?.message || 'Failed to load reconciliation data', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (business?.id && user?.id) void fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, user?.id]);

  async function runAction(row: ReconciliationRow, action: 'mark_paid' | 'mark_failed' | 'retry_verification') {
    if (!business?.id) return;
    setActionLoading(`${row.id}:${action}`);
    try {
      const res = await fetch('/api/payments/manual-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          user_id: user?.id,
          transaction_id: row.id,
          action,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Action failed');
      toast.showToast?.('Updated', 'success');
      await fetchRows();
    } catch (e: any) {
      toast.showToast?.(e?.message || 'Action failed', 'error');
    } finally {
      setActionLoading(null);
    }
  }

  const toolbar = (
    <div className="px-4 pt-4 pb-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Payment Reconciliation</h1>
          <p className="text-sm text-text-secondary mt-1">
            Review gateway transactions and fix issues with an audit trail.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void fetchRows()}
          isLoading={loading}
          className="whitespace-nowrap"
        >
          <RefreshCcw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-text-muted">Status</span>
          <select
            className="h-10 rounded-md border border-border bg-white px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="requires_review">Requires review</option>
            <option value="pending">Pending</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-text-muted">Provider</span>
          <select
            className="h-10 rounded-md border border-border bg-white px-3 text-sm"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="all">All</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-text-muted">Search</span>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Order ID, UTR, provider payment id…"
            className="h-10"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void fetchRows()}
          className="whitespace-nowrap"
        >
          Apply
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ('');
            setProvider('all');
            setStatus('requires_review');
            void fetchRows();
          }}
        >
          Reset
        </Button>
      </div>
    </div>
  );

  const list = (
    <Card className="mx-4 mb-4 overflow-hidden">
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-text-secondary">
            <tr className="border-b border-border">
              <th className="text-left font-semibold px-3 py-2">Date</th>
              <th className="text-left font-semibold px-3 py-2">Order ID</th>
              <th className="text-right font-semibold px-3 py-2">Amount</th>
              <th className="text-left font-semibold px-3 py-2">Status</th>
              <th className="text-left font-semibold px-3 py-2">Provider</th>
              <th className="text-left font-semibold px-3 py-2">Reference</th>
              <th className="text-right font-semibold px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSelected = r.id === selectedId;
              const ref = r.utr || r.provider_payment_id || '-';
              const canMark = r.status === 'requires_review';
              const canRetry = r.status === 'pending';
              return (
                <tr
                  key={r.id}
                  className={clsx(
                    'border-b border-border hover:bg-gray-50 cursor-pointer',
                    isSelected && 'bg-gray-50'
                  )}
                  onClick={() => setSelectedId(r.id)}
                >
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(r.updated_at || r.created_at)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-text-secondary">
                    {r.order_id.slice(0, 8)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {formatMoney(r.amount, r.currency)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} showIcon={false} />
                  </td>
                  <td className="px-3 py-2">{r.provider}</td>
                  <td className="px-3 py-2 font-mono text-xs text-text-secondary">{ref}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      {canMark && (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            isLoading={actionLoading === `${r.id}:mark_paid`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void runAction(r, 'mark_paid');
                            }}
                          >
                            Mark as Paid
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            isLoading={actionLoading === `${r.id}:mark_failed`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void runAction(r, 'mark_failed');
                            }}
                          >
                            Mark as Failed
                          </Button>
                        </>
                      )}
                      {canRetry && (
                        <Button
                          variant="secondary"
                          size="sm"
                          isLoading={actionLoading === `${r.id}:retry_verification`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void runAction(r, 'retry_verification');
                          }}
                        >
                          Retry Verification
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-text-muted">
                  No transactions found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );

  const detail = (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary truncate">
            {selected ? `Order ${selected.order_id.slice(0, 8)}` : 'Details'}
          </div>
          <div className="text-xs text-text-secondary mt-0.5">
            {selected ? `${formatMoney(selected.amount, selected.currency)} · ${selected.provider}` : ''}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
          <X className="w-4 h-4" />
          Close
        </Button>
      </div>

      {!selected ? (
        <div className="p-4 text-sm text-text-muted">Select a transaction to view details.</div>
      ) : (
        <div className="p-4 flex-1 overflow-auto space-y-4">
          <Card className="p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-text-primary">Status</div>
              <StatusBadge status={selected.status} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-text-muted">Transaction ID</div>
                <div className="font-mono text-xs text-text-secondary break-all">{selected.id}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Order ID</div>
                <div className="font-mono text-xs text-text-secondary break-all">{selected.order_id}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Reference</div>
                <div className="font-mono text-xs text-text-secondary break-all">
                  {selected.utr || selected.provider_payment_id || '-'}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Timestamps</div>
                <div className="text-xs text-text-secondary">
                  Created: {formatDateTime(selected.created_at)}
                  <br />
                  Updated: {formatDateTime(selected.updated_at)}
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              {selected.status === 'requires_review' && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    isLoading={actionLoading === `${selected.id}:mark_paid`}
                    onClick={() => void runAction(selected, 'mark_paid')}
                  >
                    Mark as Paid
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    isLoading={actionLoading === `${selected.id}:mark_failed`}
                    onClick={() => void runAction(selected, 'mark_failed')}
                  >
                    Mark as Failed
                  </Button>
                </>
              )}
              {selected.status === 'pending' && (
                <Button
                  variant="secondary"
                  size="sm"
                  isLoading={actionLoading === `${selected.id}:retry_verification`}
                  onClick={() => void runAction(selected, 'retry_verification')}
                >
                  Retry Verification
                </Button>
              )}
            </div>
          </Card>

          <Card className="p-3">
            <div className="text-sm font-semibold text-text-primary">Validation</div>
            <pre className="mt-2 text-xs bg-gray-50 border border-border rounded-md p-2 overflow-auto">
              {JSON.stringify(pickValidation(selected.raw_payload || {}), null, 2) || 'null'}
            </pre>
          </Card>

          <Card className="p-3">
            <div className="text-sm font-semibold text-text-primary">Raw payload</div>
            <pre className="mt-2 text-xs bg-gray-50 border border-border rounded-md p-2 overflow-auto">
              {JSON.stringify(selected.raw_payload || {}, null, 2)}
            </pre>
          </Card>
        </div>
      )}
    </div>
  );

  return (
    <SplitPaneLayout
      isDetailOpen={!!selectedId}
      onCloseDetail={() => setSelectedId(null)}
      toolbarSlot={toolbar}
      listSlot={list}
      detailSlot={detail}
    />
  );
}

