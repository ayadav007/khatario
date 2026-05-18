'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import type { PublicBusinessSurface, PublicInvoiceSummary } from '@/lib/customer-surface/types';
import { CustomerSurfaceShell } from './CustomerSurfaceShell';

interface PublicBillPayload {
  summary: PublicInvoiceSummary;
  business: PublicBusinessSurface;
  html: string;
  public_token: string;
}

function formatInr(n: number) {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PublicBillView({
  token,
  viewSource = 'public_link',
}: {
  token: string;
  viewSource?: 'public_link' | 'portal';
}) {
  const [data, setData] = useState<PublicBillPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const viewRecorded = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/i/${encodeURIComponent(token)}`);
      if (!res.ok) {
        setError(res.status === 404 ? 'This bill is not available.' : 'Could not load bill.');
        setData(null);
        return;
      }
      const json = await res.json();
      setData({
        summary: json.summary,
        business: json.business,
        html: json.html,
        public_token: json.public_token,
      });
    } catch {
      setError('Could not load bill.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!data || viewRecorded.current) return;
    viewRecorded.current = true;
    void fetch(`/api/public/i/${encodeURIComponent(token)}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: viewSource }),
    }).catch(() => {});
  }, [data, token, viewSource]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center">
        <p className="text-lg font-medium text-text-primary">{error || 'Not found'}</p>
      </div>
    );
  }

  const { summary, business, html } = data;
  const balanceTone =
    summary.payment_status === 'paid'
      ? 'text-green-700'
      : summary.payment_status === 'partial'
        ? 'text-amber-700'
        : 'text-red-600';

  return (
    <CustomerSurfaceShell
      business={business}
      footerExtra={
        business.portal_slug ? (
          <p className="text-center text-sm text-text-secondary">
            <a
              href={`/portal/${business.portal_slug}`}
              className="link-primary font-medium"
            >
              View all your bills with {business.name}
            </a>
          </p>
        ) : null
      }
    >
      <section className="rounded-lg border border-border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-text-secondary">Bill for {summary.customer_name}</p>
            <h1 className="text-xl font-bold text-gray-900">{summary.invoice_number}</h1>
            {summary.invoice_date ? (
              <p className="text-sm text-text-secondary">
                {new Date(summary.invoice_date).toLocaleDateString('en-IN')}
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="text-sm text-text-secondary">Amount due</p>
            <p className={`text-2xl font-bold ${balanceTone}`}>
              {formatInr(summary.balance_amount)}
            </p>
            <p className="text-xs capitalize text-text-muted">{summary.payment_status}</p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <a
            href={`/api/public/i/${encodeURIComponent(token)}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-gray-50 px-3 py-2 text-sm font-medium text-text-primary hover:bg-gray-100"
          >
            <Download className="h-4 w-4" />
            Download PDF
          </a>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
        <div
          className="invoice-preview p-2 sm:p-4 [&_img]:max-w-full"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </section>
    </CustomerSurfaceShell>
  );
}
