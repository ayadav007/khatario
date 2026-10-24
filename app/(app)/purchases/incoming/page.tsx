'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useToastContext } from '@/contexts/ToastContext';

type Bill = {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  grand_total: string | number;
  supplier_name: string;
  line_count: number;
  purchase_id: string | null;
  receipt_status: 'received' | 'received_with_issues' | null;
  possible_duplicate: boolean;
};

const TABS: Array<{ key: 'pending' | 'received' | 'all'; label: string }> = [
  { key: 'pending', label: 'To receive' },
  { key: 'received', label: 'Received' },
  { key: 'all', label: 'All' },
];

/** Bills from connected suppliers that arrive straight into this business's purchases. */
export default function IncomingBillsPage() {
  const toast = useToastContext();
  const [tab, setTab] = useState<'pending' | 'received' | 'all'>('pending');
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/purchases/incoming-bills?status=${tab}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load bills');
      setBills(data.bills || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load bills');
    } finally {
      setLoading(false);
    }
  }, [tab, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Incoming bills"
        subtitle="Bills from your connected suppliers. Check what arrived and they become purchases, with no typing."
        actions={
          <Link href="/purchases">
            <Button variant="secondary">Purchases</Button>
          </Link>
        }
      />
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button key={t.key} size="sm" variant={tab === t.key ? 'primary' : 'ghost'} onClick={() => setTab(t.key)}>
            {t.label}
          </Button>
        ))}
      </div>
      <Card padding="md">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
          </div>
        ) : bills.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-secondary">
            {tab === 'pending'
              ? 'Nothing to receive. Bills from connected suppliers show up here.'
              : 'No bills here yet.'}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {bills.map((b) => (
              <li key={b.invoice_id}>
                <Link
                  href={`/purchases/incoming/${b.invoice_id}`}
                  className="flex flex-col gap-1 py-3 hover:bg-gray-50 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-text-primary">{b.supplier_name}</p>
                    <p className="text-xs text-text-secondary">
                      Bill {b.invoice_number} · {new Date(b.invoice_date).toLocaleDateString('en-IN')} · {b.line_count}{' '}
                      item{b.line_count === 1 ? '' : 's'}
                    </p>
                    {b.possible_duplicate && !b.purchase_id && (
                      <p className="text-xs text-amber-700">
                        You already have a purchase with this bill number from this supplier. Check before receiving.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {b.purchase_id ? (
                      <Chip variant={b.receipt_status === 'received_with_issues' ? 'warning' : 'success'}>
                        {b.receipt_status === 'received_with_issues' ? 'Received with issues' : 'Received'}
                      </Chip>
                    ) : (
                      <Chip variant="secondary">To receive</Chip>
                    )}
                    <span className="font-semibold text-text-primary">
                      ₹{Number(b.grand_total).toLocaleString('en-IN')}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
