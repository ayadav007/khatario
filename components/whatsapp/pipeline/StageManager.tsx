'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react';
import { SlideOverPanel } from '@/components/ui/SlideOverPanel';
import { Button } from '@/components/ui/Button';
import type { StageColor, StageKind } from '@/lib/whatsapp/pipeline';
import { STAGE_COLOR_LABEL, STAGE_DOT, STAGE_KIND_LABEL, type StageOption } from './stageStyle';

const COLORS = Object.keys(STAGE_DOT) as StageColor[];
const KINDS = Object.keys(STAGE_KIND_LABEL) as StageKind[];

const field =
  'rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark';

/** Add, rename, recolour, reorder and delete pipeline stages. Needs the "WhatsApp setup" permission. */
export function StageManager({
  open,
  onClose,
  onChanged,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [stages, setStages] = useState<StageOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<StageKind>('open');
  const [deleting, setDeleting] = useState<StageOption | null>(null);
  const [moveTo, setMoveTo] = useState('');

  async function load() {
    const res = await fetch('/api/whatsapp/pipeline/stages');
    const data = await res.json().catch(() => ({}));
    setStages(res.ok ? data.stages || [] : []);
  }

  useEffect(() => {
    if (open) void load();
  }, [open]);

  async function call(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        onError(res.status === 403 ? 'You need the WhatsApp setup permission to change stages' : data.error || 'Could not save');
        return false;
      }
      await load();
      onChanged();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const patch = (id: string, body: Record<string, unknown>) =>
    call(`/api/whatsapp/pipeline/stages/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

  async function shift(index: number, dir: -1 | 1) {
    if (!stages) return;
    const next = [...stages];
    const [moved] = next.splice(index, 1);
    next.splice(index + dir, 0, moved);
    setStages(next);
    await call('/api/whatsapp/pipeline/stages', { method: 'PUT', body: JSON.stringify({ order: next.map((s) => s.id) }) });
  }

  async function add() {
    if (!newName.trim()) return;
    const ok = await call('/api/whatsapp/pipeline/stages', { method: 'POST', body: JSON.stringify({ name: newName, kind: newKind }) });
    if (ok) {
      setNewName('');
      setNewKind('open');
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const q = moveTo ? `?move_to=${moveTo}` : '';
    const ok = await call(`/api/whatsapp/pipeline/stages/${deleting.id}${q}`, { method: 'DELETE' });
    if (ok) {
      setDeleting(null);
      setMoveTo('');
    }
  }

  return (
    <SlideOverPanel open={open} onClose={onClose} title="Pipeline stages">
      <p className="text-sm text-text-secondary">
        Won and lost stages only show recent deals on the board. Renaming a stage keeps the chats in it.
      </p>
      {!stages ? (
        <div className="py-8 text-center text-sm text-text-muted">
          <Loader2 className="mx-auto h-4 w-4 animate-spin" />
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {stages.map((s, i) => (
            <li key={s.id} className="rounded-lg border border-border p-2 dark:border-border-dark">
              <div className="flex items-center gap-2">
                <span className={`h-3 w-3 shrink-0 rounded-full ${STAGE_DOT[s.color]}`} />
                <input
                  className={`${field} min-w-0 flex-1`}
                  defaultValue={s.name}
                  maxLength={60}
                  aria-label="Stage name"
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== s.name) void patch(s.id, { name });
                  }}
                />
                <button
                  type="button"
                  className="rounded p-1 text-text-muted hover:bg-surface-secondary disabled:opacity-30"
                  disabled={busy || i === 0}
                  onClick={() => void shift(i, -1)}
                  aria-label={`Move ${s.name} up`}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-text-muted hover:bg-surface-secondary disabled:opacity-30"
                  disabled={busy || i === stages.length - 1}
                  onClick={() => void shift(i, 1)}
                  aria-label={`Move ${s.name} down`}
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-30"
                  disabled={busy || stages.length <= 1}
                  onClick={() => {
                    setDeleting(s);
                    setMoveTo(stages.find((x) => x.id !== s.id)?.id || '');
                  }}
                  aria-label={`Delete ${s.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex gap-2 pl-5">
                <select
                  className={field}
                  value={s.color}
                  onChange={(e) => void patch(s.id, { color: e.target.value })}
                  aria-label="Colour"
                >
                  {COLORS.map((c) => (
                    <option key={c} value={c}>{STAGE_COLOR_LABEL[c]}</option>
                  ))}
                </select>
                <select
                  className={field}
                  value={s.kind}
                  onChange={(e) => void patch(s.id, { kind: e.target.value })}
                  aria-label="Stage type"
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>{STAGE_KIND_LABEL[k]}</option>
                  ))}
                </select>
              </div>
              {deleting?.id === s.id && (
                <div className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-800">
                  <p>Move its chats to:</p>
                  <div className="mt-1 flex gap-2">
                    <select className={`${field} flex-1`} value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move chats to">
                      {stages
                        .filter((x) => x.id !== s.id)
                        .map((x) => (
                          <option key={x.id} value={x.id}>{x.name}</option>
                        ))}
                      <option value="">Take them off the board</option>
                    </select>
                    <Button size="sm" variant="secondary" onClick={() => setDeleting(null)} disabled={busy}>
                      Keep
                    </Button>
                    <Button size="sm" onClick={() => void confirmDelete()} disabled={busy}>
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4 dark:border-border-dark"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          className={`${field} min-w-0 flex-1`}
          placeholder="New stage, e.g. Quoted"
          maxLength={60}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          aria-label="New stage name"
        />
        <select className={field} value={newKind} onChange={(e) => setNewKind(e.target.value as StageKind)} aria-label="New stage type">
          {KINDS.map((k) => (
            <option key={k} value={k}>{STAGE_KIND_LABEL[k]}</option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={busy || !newName.trim()}>
          <Plus className="mr-1 h-4 w-4" />
          Add
        </Button>
      </form>
    </SlideOverPanel>
  );
}
