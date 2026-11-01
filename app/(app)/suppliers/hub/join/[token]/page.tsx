'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';

type Order = { status: string; buyer: { name: string; city: string | null }; joined: boolean; lines: { id: string }[] };

/** A signed-in supplier connects with the shop that sent them an order link. */
export default function JoinFromOrderLinkPage({ params }: { params: { token: string } }) {
  const router = useRouter();
  const toast = useToastContext();
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/public/supplier-order/${encodeURIComponent(params.token)}`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setOrder(d.order))
      .catch(() => setMissing(true));
  }, [params.token]);

  const connect = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/suppliers/hub/invite-orders/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: params.token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not connect');
      toast.success(`Connected with ${order?.buyer.name}. Their next orders will come to Supplier Hub.`);
      router.push('/suppliers/hub');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not connect');
    } finally {
      setBusy(false);
    }
  };

  if (missing) return <div className="p-6 text-center text-sm text-text-secondary">This order link is not valid.</div>;
  if (!order) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title={`Connect with ${order.buyer.name}`} subtitle={order.buyer.city || undefined} />
      <Card padding="md" className="space-y-3">
        <p className="text-sm text-text-secondary">
          {order.buyer.name} sent you an order for {order.lines.length} item{order.lines.length === 1 ? '' : 's'}. Connect
          to get their orders in Supplier Hub, send bills that go straight into their purchases, and see when they run low on
          your items if they share it.
        </p>
        <Button onClick={connect} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Connect with {order.buyer.name}
        </Button>
      </Card>
    </div>
  );
}
