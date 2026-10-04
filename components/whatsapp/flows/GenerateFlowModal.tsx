'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';

export function GenerateFlowModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/whatsapp/flows/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not generate a flow.');
        return;
      }
      onCreated(data.flow.id);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl dark:bg-surface-dark">
        <h2 className="text-base font-semibold">Generate flow with AI</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Describe the shop or order journey. We save a draft — nothing goes live until you publish.
        </p>
        <Textarea
          className="mt-3"
          rows={6}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="When a customer says order, show buttons for Browse shop, Order status, and Talk to team. Browse shop should open the catalogue."
        />
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void generate()} disabled={busy || prompt.trim().length < 8}>
            {busy ? 'Generating…' : 'Generate draft'}
          </Button>
        </div>
      </div>
    </div>
  );
}
