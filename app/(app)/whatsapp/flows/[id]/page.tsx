'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Maximize2, Minimize2, Play } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FlowCanvas } from '@/components/whatsapp/flows/FlowCanvas';
import { FlowSimulator } from '@/components/whatsapp/flows/FlowSimulator';
import { MobileFlowEditor } from '@/components/whatsapp/flows/MobileFlowEditor';
import { GenerateFlowModal } from '@/components/whatsapp/flows/GenerateFlowModal';
import { emptyFlowDefinition, type FlowDefinition } from '@/lib/whatsapp/flows/schema';

type FlowRow = {
  id: string;
  name: string;
  status: string;
  definition: FlowDefinition;
};

export default function WhatsAppFlowEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [flow, setFlow] = useState<FlowRow | null>(null);
  const [name, setName] = useState('');
  const [definition, setDefinition] = useState<FlowDefinition>(emptyFlowDefinition());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [tryOpen, setTryOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/whatsapp/flows/${params.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Flow not found');
        return;
      }
      setFlow(data.flow);
      setName(data.flow.name);
      setDefinition(data.flow.definition);
    })();
  }, [params.id]);

  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/flows/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, definition }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || 'Could not save');
      else setFlow(data.flow);
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    await save();
    const res = await fetch(`/api/whatsapp/flows/${params.id}/publish`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error || 'Could not publish');
    else setFlow(data.flow);
  }

  async function unpublish() {
    const res = await fetch(`/api/whatsapp/flows/${params.id}/unpublish`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error || 'Could not unpublish');
    else setFlow(data.flow);
  }

  if (error && !flow) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">{error}</p>
        <Button className="mt-3" variant="secondary" onClick={() => router.push('/whatsapp/flows')}>
          Back
        </Button>
      </div>
    );
  }

  if (!flow) return <div className="p-6 text-sm text-text-muted">Loading…</div>;

  return (
    <>
      <div
        className={clsx(
          'flex flex-col bg-background',
          expanded ? 'fixed inset-0 z-[80]' : 'min-h-[calc(100vh-4rem)]',
        )}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 dark:border-border-dark">
          {!expanded ? (
            <Button variant="ghost" size="sm" onClick={() => router.push('/whatsapp/flows')}>
              Back
            </Button>
          ) : null}
          <Input className="max-w-xs" value={name} onChange={(e) => setName(e.target.value)} />
          <span className="text-xs capitalize text-text-muted">{flow.status}</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              variant={tryOpen ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setTryOpen((v) => !v)}
              title="Preview this draft without publishing"
            >
              <Play className="mr-1 h-4 w-4" />
              Try flow
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="hidden md:inline-flex"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? 'Exit fullscreen (Esc)' : 'Expand canvas'}
            >
              {expanded ? <Minimize2 className="mr-1 h-4 w-4" /> : <Maximize2 className="mr-1 h-4 w-4" />}
              {expanded ? 'Exit' : 'Expand'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setGenerateOpen(true)}>
              Generate with AI
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void save()} disabled={saving}>
              Save draft
            </Button>
            {flow.status === 'published' ? (
              <Button variant="secondary" size="sm" onClick={() => void unpublish()}>
                Unpublish
              </Button>
            ) : (
              <Button size="sm" onClick={() => void publish()}>
                Publish
              </Button>
            )}
          </div>
        </div>

        {error ? <p className="px-3 py-2 text-sm text-red-600">{error}</p> : null}

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div
            className={clsx(
              'min-h-0 min-w-0 flex-1',
              expanded ? 'flex' : 'hidden md:flex',
            )}
          >
            <FlowCanvas
              key={flow.id}
              definition={definition}
              onChange={setDefinition}
              className="flex min-h-0 w-full flex-1 overflow-hidden border-0 md:border-r md:border-border md:dark:border-border-dark"
            />
          </div>

          {!expanded ? (
            <div className="p-3 md:hidden">
              <MobileFlowEditor definition={definition} onChange={setDefinition} />
            </div>
          ) : null}

          {tryOpen ? (
            <div
              className={clsx(
                'flex shrink-0 flex-col bg-surface',
                expanded
                  ? 'h-full w-full max-w-md border-l border-border dark:border-border-dark'
                  : 'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-[90] max-md:h-[min(70vh,560px)] max-md:rounded-t-2xl max-md:border max-md:border-border max-md:shadow-xl md:h-auto md:w-96 md:border-l md:border-border md:dark:border-border-dark',
              )}
            >
              <FlowSimulator definition={definition} open onClose={() => setTryOpen(false)} />
            </div>
          ) : null}
        </div>
      </div>

      <GenerateFlowModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onCreated={(id) => router.push(`/whatsapp/flows/${id}`)}
      />
    </>
  );
}
