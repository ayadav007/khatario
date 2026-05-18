'use client';

import React, { useState, useEffect } from 'react';
import { ShoppingBag, FileText, Loader2, ChevronDown, ChevronUp, ExternalLink, IndianRupee } from 'lucide-react';
import { format } from 'date-fns';

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  grand_total: number;
  payment_status: string;
  status: string;
  customer_name: string | null;
}

interface SalesOrder {
  id: string;
  order_number: string;
  order_date: string;
  grand_total: number;
  status: string;
}

interface LinkedOrdersCardProps {
  conversationId: string;
  businessId: string;
}

function statusBadge(status: string, type: 'payment' | 'order') {
  const map: Record<string, string> = {
    paid: 'bg-green-100 text-green-700',
    unpaid: 'bg-red-100 text-red-700',
    partial: 'bg-yellow-100 text-yellow-700',
    confirmed: 'bg-blue-100 text-blue-700',
    pending: 'bg-orange-100 text-orange-700',
    delivered: 'bg-green-100 text-green-700',
    cancelled: 'bg-gray-100 text-gray-500',
    draft: 'bg-gray-100 text-gray-500',
    final: 'bg-blue-100 text-blue-700',
    verified: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    requires_review: 'bg-yellow-100 text-yellow-700',
  };
  const cls = map[status?.toLowerCase()] || 'bg-gray-100 text-gray-500';
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${cls}`}>
      {status}
    </span>
  );
}

export function LinkedOrdersCard({ conversationId, businessId }: LinkedOrdersCardProps) {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!conversationId || !businessId) return;
    setLoading(true);
    setError('');

    fetch(`/api/whatsapp/conversations/${conversationId}/linked-orders?business_id=${businessId}`)
      .then((res) => {
        // 404 = conversation not yet in DB (live-mode-only chat) → treat as empty
        if (res.status === 404) return { invoices: [], orders: [] };
        return res.json();
      })
      .then((data) => {
        if (data.error) { setError(data.error); return; }
        setInvoices(data.invoices || []);
        setOrders(data.orders || []);
      })
      .catch(() => setError('Failed to load linked orders.'))
      .finally(() => setLoading(false));
  }, [conversationId, businessId]);

  const totalItems = invoices.length + orders.length;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Linked Orders & Invoices</span>
          {!loading && totalItems > 0 && (
            <span className="text-xs bg-slate-100 text-primary-700 font-semibold px-1.5 py-0.5 rounded-full">
              {totalItems}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {expanded && (
        <div className="divide-y divide-gray-100">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : error ? (
            <p className="text-xs text-red-500 px-4 py-3">{error}</p>
          ) : totalItems === 0 ? (
            <p className="text-xs text-gray-400 px-4 py-4 text-center">No linked orders or invoices found.</p>
          ) : (
            <>
              {/* Invoices */}
              {invoices.map((inv) => (
                <div key={inv.id} className="px-4 py-3 flex items-start justify-between gap-2 hover:bg-gray-50">
                  <div className="flex items-start gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">{inv.invoice_number}</span>
                        {statusBadge(inv.payment_status, 'payment')}
                        {statusBadge(inv.status, 'order')}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {inv.invoice_date ? format(new Date(inv.invoice_date), 'dd MMM yyyy') : '—'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="flex items-center gap-0.5 justify-end text-sm font-semibold text-gray-800">
                      <IndianRupee className="w-3 h-3" />
                      {Number(inv.grand_total || 0).toLocaleString('en-IN')}
                    </div>
                    <a
                      href={`/invoices/${inv.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary-600 hover:underline flex items-center gap-0.5 justify-end mt-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ))}

              {/* Sales Orders */}
              {orders.map((ord) => (
                <div key={ord.id} className="px-4 py-3 flex items-start justify-between gap-2 hover:bg-gray-50">
                  <div className="flex items-start gap-2 min-w-0">
                    <ShoppingBag className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">{ord.order_number}</span>
                        {statusBadge(ord.status, 'order')}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {ord.order_date ? format(new Date(ord.order_date), 'dd MMM yyyy') : '—'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="flex items-center gap-0.5 justify-end text-sm font-semibold text-gray-800">
                      <IndianRupee className="w-3 h-3" />
                      {Number(ord.grand_total || 0).toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
