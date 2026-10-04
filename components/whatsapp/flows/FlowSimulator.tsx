'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { FlowDefinition } from '@/lib/whatsapp/flows/schema';
import { createSimState, resetSimState, simStep, type SimBubble, type SimState } from '@/lib/whatsapp/flows/simulate';

function BotBubble({ bubble }: { bubble: Extract<SimBubble, { role: 'bot' }> }) {
  const { reply } = bubble;
  return (
    <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-emerald-50 px-3 py-2 text-sm text-text-primary dark:bg-emerald-950/40">
      <p className="whitespace-pre-wrap">{reply.header ? `${reply.header}\n${reply.text}` : reply.text}</p>
      {reply.mediaUrl ? <p className="mt-1 text-[10px] text-text-muted">Media: {reply.mediaType} {reply.mediaUrl}</p> : null}
      {reply.footer ? <p className="mt-1 text-xs text-text-muted">{reply.footer}</p> : null}
      {reply.buttons?.length ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {reply.buttons.map((b) => (
            <span
              key={b.id}
              data-option-id={b.id}
              className="rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-center text-xs font-medium text-emerald-800 dark:border-emerald-800 dark:bg-surface-dark dark:text-emerald-200"
            >
              {b.title}
            </span>
          ))}
        </div>
      ) : null}
      {reply.list?.rows.length ? (
        <div className="mt-2 space-y-1">
          <p className="text-[10px] font-semibold uppercase text-text-muted">{reply.list.buttonText}</p>
          {reply.list.rows.map((r) => (
            <div
              key={r.id}
              data-option-id={r.id}
              className="rounded-lg border border-border px-2 py-1.5 text-xs dark:border-border-dark"
            >
              <p className="font-medium">{r.title}</p>
              {r.description ? <p className="text-text-muted">{r.description}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function FlowSimulator({
  definition,
  open,
  onClose,
}: {
  definition: FlowDefinition;
  open: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<SimState>(() => createSimState());
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setState(createSimState());
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.bubbles.length]);

  if (!open) return null;

  const lastBot = [...state.bubbles].reverse().find((b) => b.role === 'bot');
  const options =
    lastBot && state.status === 'active'
      ? lastBot.reply.buttons?.map((b) => ({ id: b.id, title: b.title })) ||
        lastBot.reply.list?.rows.map((r) => ({ id: r.id, title: r.title })) ||
        []
      : [];

  function send(text: string, replyId?: string | null) {
    const t = text.trim();
    if (!t && !replyId) return;
    setState((prev) => simStep(definition, prev, { text: t || replyId || '', replyId }));
    setDraft('');
  }

  return (
    <aside className="flex h-full w-full max-w-md flex-col border-l border-border bg-surface dark:border-border-dark sm:w-96">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 dark:border-border-dark">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">Try flow</p>
          <p className="truncate text-xs text-text-muted">Uses your current draft — nothing is sent on WhatsApp</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Reset preview"
          onClick={() => setState((prev) => resetSimState(prev))}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" aria-label="Close preview" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <label className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-text-secondary dark:border-border-dark">
        <input
          type="checkbox"
          checked={state.treatAsFirstMessage}
          onChange={(e) =>
            setState((prev) => ({
              ...resetSimState(prev),
              treatAsFirstMessage: e.target.checked,
            }))
          }
        />
        Treat next start as first message in chat
      </label>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#efeae2] px-3 py-3 dark:bg-zinc-900/60">
        {state.bubbles.length === 0 ? (
          <p className="rounded-lg bg-white/80 px-3 py-2 text-xs text-text-secondary dark:bg-surface-dark/80">
            Type a START keyword (exact match), or enable first-message if your Start node uses that.
          </p>
        ) : null}
        {state.bubbles.map((b) => {
          if (b.role === 'user') {
            return (
              <div key={b.id} className="flex justify-end">
                <div className="max-w-[90%] rounded-2xl rounded-br-md bg-[#d9fdd3] px-3 py-2 text-sm text-text-primary">
                  {b.text}
                </div>
              </div>
            );
          }
          if (b.role === 'system') {
            return (
              <p key={b.id} className="text-center text-[11px] text-text-muted">
                {b.text}
              </p>
            );
          }
          return (
            <div key={b.id} className="flex justify-start">
              <BotBubble bubble={b} />
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2 dark:border-border-dark">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className="rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-800 hover:bg-primary-100 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-200"
              onClick={() => send(o.title, o.id)}
            >
              {o.title}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="flex items-center gap-2 border-t border-border p-2 dark:border-border-dark"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={state.status === 'ended' ? 'Reset to try again' : 'Customer message…'}
          disabled={state.status === 'ended'}
          className="flex-1"
        />
        <Button type="submit" size="sm" disabled={state.status === 'ended' || !draft.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </aside>
  );
}
