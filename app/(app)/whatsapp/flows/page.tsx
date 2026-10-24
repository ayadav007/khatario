'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { Button } from '@/components/ui/Button';
import { WhatsAppAddonModal } from '@/components/subscription/WhatsAppAddonModal';
import { GenerateFlowModal } from '@/components/whatsapp/flows/GenerateFlowModal';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscriptionCheck } from '@/hooks/useSubscriptionCheck';
import { Lock, Sparkles, Workflow } from 'lucide-react';

type FlowRow = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
};

export default function WhatsAppFlowsPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { business } = useAuth();
  const { hasFeature, loading, refreshAddons } = useSubscriptionCheck(business?.id);
  const hasAccess = hasFeature('whatsapp_bot');
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fromLegacy = search.get('from') === 'bot-rules';
  const wantsNew = search.get('new') === '1';

  useEffect(() => {
    if (!loading && !hasAccess) setShowUpgrade(true);
  }, [loading, hasAccess]);

  async function load() {
    const res = await fetch('/api/whatsapp/flows');
    const data = await res.json().catch(() => ({}));
    if (res.ok) setFlows(data.flows || []);
  }

  useEffect(() => {
    if (hasAccess) void load();
  }, [hasAccess]);

  useEffect(() => {
    if (hasAccess && wantsNew && !busy) void create();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot from TopBar +
  }, [hasAccess, wantsNew]);

  async function create(starter?: 'shop_order') {
    setBusy(true);
    try {
      const res = await fetch('/api/whatsapp/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: starter ? `Shop order ${new Date().toISOString().slice(0, 16).replace('T', ' ')}` : `Untitled ${new Date().toISOString().slice(11, 16)}`, starter }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.flow?.id) router.push(`/whatsapp/flows/${data.flow.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function importRules() {
    setBusy(true);
    try {
      const res = await fetch('/api/whatsapp/flows/import-bot-rules', { method: 'POST' });
      await res.json().catch(() => ({}));
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="flex min-h-[240px] items-center justify-center text-sm text-text-muted">Loading…</div>;
  }

  if (!hasAccess) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center">
        <Lock className="mx-auto h-12 w-12 text-text-muted" />
        <h1 className="mt-3 text-xl font-semibold">Flows need Connect</h1>
        <p className="mt-2 text-sm text-text-secondary">Guided WhatsApp journeys and AI generate come with Khatario Connect.</p>
        <Button className="mt-4" onClick={() => setShowUpgrade(true)}>Unlock Connect</Button>
        {showUpgrade && (
          <WhatsAppAddonModal
            addonType="whatsapp_bot"
            onClose={() => setShowUpgrade(false)}
            onPurchaseSuccess={async () => {
              await refreshAddons?.();
              window.location.reload();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <ListPageHeader
        title="Flows"
        description="Guided WhatsApp journeys. Exact keywords start a flow; anything else can go to the AI agent."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setGenerateOpen(true)}>
              <Sparkles className="mr-1 h-4 w-4" />
              Generate with AI
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void create('shop_order')} disabled={busy}>
              Shop starter
            </Button>
            <Button size="sm" onClick={() => void create()} disabled={busy}>
              New flow
            </Button>
          </div>
        }
      />

      {fromLegacy ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Keyword auto-replies still run until you import and publish them as Flows.{' '}
          <button type="button" className="underline" onClick={() => void importRules()} disabled={busy}>
            Import existing rules as drafts
          </button>
        </p>
      ) : null}

      <ul className="mt-4 divide-y divide-border rounded-lg border border-border dark:divide-border-dark dark:border-border-dark">
        {flows.length === 0 ? (
          <li className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-text-secondary">
            <Workflow className="h-8 w-8 text-text-muted" />
            No flows yet. Generate one with AI or start from the shop template.
          </li>
        ) : (
          flows.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface-secondary/60"
                onClick={() => router.push(`/whatsapp/flows/${f.id}`)}
              >
                <span className="font-medium">{f.name}</span>
                <span className="text-xs capitalize text-text-muted">{f.status}</span>
              </button>
            </li>
          ))
        )}
      </ul>

      <GenerateFlowModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onCreated={(id) => router.push(`/whatsapp/flows/${id}`)}
      />
    </div>
  );
}
