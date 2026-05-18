'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Package,
  Tag,
  ClipboardList,
  History as HistoryIcon,
  Loader2,
  TrendingUp,
  TrendingDown,
  ExternalLink,
  Trash2,
  FileText,
  Printer,
} from 'lucide-react';
import { clsx } from 'clsx';
import { DetailPanelShell, DetailPanelTab } from '@/components/layout/DetailPanelShell';
import { Chip } from '@/components/ui/Chip';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';

interface ItemDetailPanelProps {
  itemId: string;
  onClose: () => void;
  onDelete?: (item: any) => void;
  canDelete?: boolean;
}

type TabId = 'overview' | 'transactions' | 'history';

interface ItemTransaction {
  type: 'invoice' | 'purchase';
  id: string;
  ref_no: string;
  date: string;
  party_name: string | null;
  party_id: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  document_type: string | null;
}

interface HistoryEntry {
  id: string;
  action_type: string;
  description: string;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
  metadata: Record<string, unknown> | null;
}

function formatINR(n: number | string | null | undefined) {
  const num = Number(n ?? 0);
  return `₹ ${num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function ItemDetailPanel({ itemId, onClose, onDelete, canDelete }: ItemDetailPanelProps) {
  const router = useRouter();
  const { business, user } = useAuth();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const [transactions, setTransactions] = useState<ItemTransaction[] | null>(null);
  const [txSummary, setTxSummary] = useState<any>(null);
  const [txLoading, setTxLoading] = useState(false);

  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchItem = useCallback(async () => {
    if (!business?.id || !itemId || !user?.id) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/items/${itemId}?business_id=${business.id}&user_id=${user.id}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setItem(data.item);
      } else {
        setItem(null);
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id, itemId]);

  const fetchTransactions = useCallback(async () => {
    if (!business?.id || !user?.id || !itemId) return;
    setTxLoading(true);
    try {
      const res = await fetch(
        `/api/items/${itemId}/transactions?business_id=${business.id}&user_id=${user.id}&limit=100`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions || []);
        setTxSummary(data.summary || null);
      } else {
        setTransactions([]);
      }
    } finally {
      setTxLoading(false);
    }
  }, [business?.id, user?.id, itemId]);

  const fetchHistory = useCallback(async () => {
    if (!business?.id || !user?.id || !itemId) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(
        `/api/items/${itemId}/history?business_id=${business.id}&user_id=${user.id}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history || []);
      } else {
        setHistory([]);
      }
    } finally {
      setHistoryLoading(false);
    }
  }, [business?.id, user?.id, itemId]);

  useEffect(() => {
    setActiveTab('overview');
    setTransactions(null);
    setHistory(null);
    setTxSummary(null);
    fetchItem();
  }, [itemId, fetchItem]);

  useEffect(() => {
    if (activeTab === 'transactions' && transactions === null) {
      fetchTransactions();
    }
    if (activeTab === 'history' && history === null) {
      fetchHistory();
    }
  }, [activeTab, transactions, history, fetchTransactions, fetchHistory]);

  const tabs: DetailPanelTab[] = useMemo(
    () => [
      { id: 'overview', label: 'Overview', icon: ClipboardList },
      { id: 'transactions', label: 'Transactions', icon: Package },
      { id: 'history', label: 'History', icon: HistoryIcon },
    ],
    []
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-card">
        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-card p-8">
        <p className="text-text-secondary mb-4">Item not found</p>
        <button onClick={onClose} className="text-primary-600 hover:underline text-sm">
          Close
        </button>
      </div>
    );
  }

  const isService = item.item_type === 'service';
  const stock = Number(item.current_stock ?? 0);
  const minStock = Number(item.min_stock ?? 0);
  let stockVariant: 'success' | 'warning' | 'error' = 'success';
  if (stock <= 0) stockVariant = 'error';
  else if (stock <= minStock) stockVariant = 'warning';

  const avatar = item.image_url ? (
    <img
      src={item.image_url}
      alt={item.name}
      className="w-10 h-10 rounded-lg object-cover border border-border"
    />
  ) : (
    <div
      className={clsx(
        'w-10 h-10 rounded-lg flex items-center justify-center border border-border',
        isService ? 'bg-slate-50 text-primary-600' : 'bg-slate-50 text-primary-600'
      )}
    >
      {isService ? <Tag className="w-5 h-5" /> : <Package className="w-5 h-5" />}
    </div>
  );

  const moreActions: NonNullable<React.ComponentProps<typeof DetailPanelShell>['moreActions']> = [];
  moreActions.push({
    label: 'Open full page',
    icon: ExternalLink,
    onClick: () => router.push(`/items/${itemId}`),
  });
  moreActions.push({
    label: 'Print barcode',
    icon: Printer,
    onClick: () => router.push(`/items/barcodes?item=${itemId}`),
  });
  if (onDelete && canDelete) {
    moreActions.push({
      label: 'Remove from catalog',
      icon: Trash2,
      variant: 'danger',
      onClick: () => onDelete(item),
    });
  }

  return (
    <DetailPanelShell
      title={item.name}
      subtitle={
        <div className="flex items-center gap-2 flex-wrap">
          {item.code && <span>Code: {item.code}</span>}
          {item.barcode && (
            <>
              <span>•</span>
              <span className="font-mono">{item.barcode}</span>
            </>
          )}
          <span
            className={clsx(
              'text-[10px] uppercase px-1.5 py-0.5 rounded font-bold tracking-wider',
              isService ? 'bg-slate-100 text-primary-700' : 'bg-slate-100 text-primary-700'
            )}
          >
            {isService ? 'Service' : 'Goods'}
          </span>
        </div>
      }
      avatar={avatar}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as TabId)}
      onClose={onClose}
      onEdit={() => router.push(`/items/new?edit=${itemId}`)}
      moreActions={moreActions}
    >
      {activeTab === 'overview' && (
        <div className="p-4 md:p-6 space-y-6">
          {/* Primary Details */}
          <section>
            <h3 className="text-sm font-semibold text-text-primary mb-3">Primary Details</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <FieldRow label="Item Name" value={item.name} />
              <FieldRow
                label="Item Type"
                value={isService ? 'Service' : 'Goods'}
              />
              <FieldRow label="Unit" value={item.unit || '-'} />
              <FieldRow label="HSN / SAC" value={item.hsn_sac || '-'} />
              {item.code && <FieldRow label="Item Code" value={item.code} />}
              {item.barcode && (
                <FieldRow label="Barcode" value={<span className="font-mono">{item.barcode}</span>} />
              )}
              {item.brand && <FieldRow label="Brand" value={item.brand} />}
              {item.country_of_origin && (
                <FieldRow label="Country of Origin" value={item.country_of_origin} />
              )}
            </div>
          </section>

          {/* Sales Information */}
          <section>
            <h3 className="text-sm font-semibold text-text-primary mb-3">Sales Information</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <FieldRow
                label="Selling Price"
                value={
                  item.selling_price != null
                    ? formatINR(item.selling_price)
                    : <span className="text-text-muted">Not set</span>
                }
              />
              {item.mrp && <FieldRow label="MRP" value={formatINR(item.mrp)} />}
              <FieldRow
                label="Purchase Price"
                value={item.purchase_price ? formatINR(item.purchase_price) : '-'}
              />
              <FieldRow label="Tax Rate" value={`${item.tax_rate ?? 0}%`} />
            </div>
          </section>

          {/* Stock (goods only) */}
          {!isService && (
            <section>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Stock</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <FieldRow
                  label="Current Stock"
                  value={
                    <Chip variant={stockVariant} className="text-xs">
                      {stock} {item.unit}
                    </Chip>
                  }
                />
                <FieldRow
                  label="Low Stock Alert"
                  value={`${minStock} ${item.unit}`}
                />
                {item.valuation_method && (
                  <FieldRow
                    label="Valuation Method"
                    value={
                      <span className="uppercase">
                        {item.valuation_method === 'fifo' && 'FIFO'}
                        {item.valuation_method === 'lifo' && 'LIFO'}
                        {item.valuation_method === 'weighted_avg' && 'Weighted Avg'}
                        {item.valuation_method === 'simple' && 'Simple'}
                      </span>
                    }
                  />
                )}
                <FieldRow
                  label="Track Batch / Serial"
                  value={
                    [
                      item.track_batch && 'Batch',
                      item.track_serial && 'Serial',
                    ]
                      .filter(Boolean)
                      .join(' + ') || 'No'
                  }
                />
              </div>
            </section>
          )}

          {/* Description */}
          {item.description && (
            <section>
              <h3 className="text-sm font-semibold text-text-primary mb-2">Description</h3>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{item.description}</p>
            </section>
          )}

          {/* Reporting tags (placeholder for now) */}
          <section>
            <h3 className="text-sm font-semibold text-text-primary mb-2">Reporting Tags</h3>
            <p className="text-sm text-text-muted italic">
              No reporting tag has been associated with this item.
            </p>
          </section>
        </div>
      )}

      {activeTab === 'transactions' && (
        <div className="p-4 md:p-6">
          {txLoading && transactions === null ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
            </div>
          ) : (
            <>
              {/* Summary cards */}
              {txSummary && (
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div className="p-4 rounded-lg border border-border bg-green-50/50 dark:bg-green-900/10">
                    <div className="flex items-center gap-2 text-green-700 dark:text-green-400 mb-1">
                      <TrendingUp className="w-4 h-4" />
                      <span className="text-xs font-semibold uppercase tracking-wide">Sold</span>
                    </div>
                    <div className="text-lg font-bold text-text-primary">
                      {txSummary.sales_qty} {item.unit}
                    </div>
                    <div className="text-xs text-text-secondary mt-0.5">
                      {formatINR(txSummary.sales_amount)} • {txSummary.sales_count} invoice(s)
                    </div>
                  </div>
                  <div className="p-4 rounded-lg border border-border bg-slate-100/50 dark:bg-primary-900/10">
                    <div className="flex items-center gap-2 text-primary-700 dark:text-primary-400 mb-1">
                      <TrendingDown className="w-4 h-4" />
                      <span className="text-xs font-semibold uppercase tracking-wide">Purchased</span>
                    </div>
                    <div className="text-lg font-bold text-text-primary">
                      {txSummary.purchase_qty} {item.unit}
                    </div>
                    <div className="text-xs text-text-secondary mt-0.5">
                      {formatINR(txSummary.purchase_amount)} • {txSummary.purchase_count} bill(s)
                    </div>
                  </div>
                </div>
              )}

              {transactions && transactions.length === 0 ? (
                <div className="text-center py-12 text-text-secondary">
                  <FileText className="w-10 h-10 mx-auto text-text-muted mb-3" />
                  <p>No transactions yet for this item.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border text-text-secondary">
                      <tr>
                        <th className="text-left py-2 px-2 font-medium">Type</th>
                        <th className="text-left py-2 px-2 font-medium">Reference</th>
                        <th className="text-left py-2 px-2 font-medium">Date</th>
                        <th className="text-left py-2 px-2 font-medium">Party</th>
                        <th className="text-right py-2 px-2 font-medium">Qty</th>
                        <th className="text-right py-2 px-2 font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions?.map((tx) => (
                        <tr
                          key={`${tx.type}-${tx.id}`}
                          className="border-b border-border hover:bg-slate-50/30 cursor-pointer"
                          onClick={() =>
                            router.push(
                              tx.type === 'invoice' ? `/invoices/${tx.id}` : `/purchases/${tx.id}`
                            )
                          }
                        >
                          <td className="py-2 px-2">
                            <span
                              className={clsx(
                                'text-[10px] uppercase font-bold px-1.5 py-0.5 rounded',
                                tx.type === 'invoice'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-slate-100 text-primary-700'
                              )}
                            >
                              {tx.type === 'invoice' ? 'Sale' : 'Purchase'}
                            </span>
                          </td>
                          <td className="py-2 px-2 font-medium text-text-primary">{tx.ref_no}</td>
                          <td className="py-2 px-2 text-text-secondary">
                            {tx.date ? format(new Date(tx.date), 'dd MMM yyyy') : '-'}
                          </td>
                          <td className="py-2 px-2 text-text-secondary truncate max-w-[180px]">
                            {tx.party_name || '-'}
                          </td>
                          <td className="py-2 px-2 text-right text-text-primary">
                            {tx.quantity}
                          </td>
                          <td className="py-2 px-2 text-right font-semibold text-text-primary">
                            {formatINR(tx.line_total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="p-4 md:p-6">
          {historyLoading && history === null ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
            </div>
          ) : history && history.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">
              <HistoryIcon className="w-10 h-10 mx-auto text-text-muted mb-3" />
              <p>No activity recorded yet.</p>
            </div>
          ) : (
            <ol className="relative border-l-2 border-border ml-2 space-y-4">
              {history?.map((h) => (
                <li key={h.id} className="pl-4 relative">
                  <span
                    className={clsx(
                      'absolute -left-[7px] top-1.5 w-3 h-3 rounded-full border-2 border-surface dark:border-surface-dark',
                      actionDotColor(h.action_type)
                    )}
                  />
                  <div className="text-sm text-text-primary font-medium">
                    {h.description}
                  </div>
                  <div className="text-xs text-text-secondary mt-0.5">
                    {h.user_name || h.user_email || 'System'} •{' '}
                    {format(new Date(h.created_at), 'dd MMM yyyy, HH:mm')}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </DetailPanelShell>
  );
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <div className="text-text-secondary text-xs md:text-sm">{label}</div>
      <div className="text-text-primary font-medium">{value}</div>
    </>
  );
}

function actionDotColor(action: string): string {
  switch (action) {
    case 'create':
      return 'bg-green-500';
    case 'update':
      return 'bg-primary-500';
    case 'delete':
      return 'bg-red-500';
    case 'approve':
      return 'bg-emerald-500';
    case 'reject':
      return 'bg-orange-500';
    default:
      return 'bg-gray-400';
  }
}
