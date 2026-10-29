'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNowStrict, isPast } from 'date-fns';
import { AlarmClock, Loader2, Search, Settings2, User } from 'lucide-react';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';
import type { BoardCard, BoardColumn } from '@/lib/whatsapp/pipeline';
import { formatDealValue, SOURCE_LABEL, SOURCE_STYLE, STAGE_DOT, type StageOption } from './stageStyle';
import { StageManager } from './StageManager';

type Agent = { id: string; name: string; can_receive?: boolean };
type LabelRow = { id: string; name: string };

const TEMPERATURE_STYLE: Record<string, string> = {
  hot: 'bg-red-50 text-red-700',
  warm: 'bg-amber-50 text-amber-700',
  cold: 'bg-slate-100 text-slate-600',
};

export function PipelineBoard() {
  const [columns, setColumns] = useState<BoardColumn[] | null>(null);
  const [isSupervisor, setIsSupervisor] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [owner, setOwner] = useState('');
  const [labelId, setLabelId] = useState('');
  const [source, setSource] = useState('');
  const [closedDays, setClosedDays] = useState('90');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [labels, setLabels] = useState<LabelRow[]>([]);
  const [manageOpen, setManageOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [lostPrompt, setLostPrompt] = useState<{ card: BoardCard; toStageId: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const dragCard = useRef<BoardCard | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (debouncedSearch) p.set('search', debouncedSearch);
    if (owner) p.set('owner', owner);
    if (labelId) p.set('label_id', labelId);
    if (source) p.set('source', source);
    p.set('closed_days', closedDays);
    return p;
  }, [debouncedSearch, owner, labelId, source, closedDays]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/whatsapp/pipeline?${query.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setToast({ message: data.error || 'Could not load the pipeline', type: 'error' });
      setColumns([]);
      return;
    }
    setColumns(data.columns || []);
    setIsSupervisor(!!data.is_supervisor);
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch('/api/whatsapp/labels')
      .then((r) => (r.ok ? r.json() : { labels: [] }))
      .then((d) => setLabels(d.labels || []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isSupervisor) return;
    fetch('/api/whatsapp/users')
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => setAgents((d.users || []).filter((u: Agent) => u.can_receive !== false)))
      .catch(() => undefined);
  }, [isSupervisor]);

  const stages: StageOption[] = useMemo(
    () => (columns || []).map(({ id, name, color, kind, position }) => ({ id, name, color, kind, position })),
    [columns],
  );

  async function loadMore(col: BoardColumn) {
    setLoadingMore(col.id);
    try {
      const p = new URLSearchParams(query);
      p.set('stage_id', col.id);
      p.set('offset', String(col.cards.length));
      const res = await fetch(`/api/whatsapp/pipeline?${p.toString()}`);
      const data = await res.json().catch(() => ({}));
      const more: BoardCard[] = data.columns?.[0]?.cards || [];
      setColumns((prev) =>
        (prev || []).map((c) => (c.id === col.id ? { ...c, cards: [...c.cards, ...more.filter((m) => !c.cards.some((x) => x.id === m.id))] } : c)),
      );
    } finally {
      setLoadingMore(null);
    }
  }

  async function move(card: BoardCard, toStageId: string, lostReason?: string) {
    if (card.stage_id === toStageId || !columns) return;
    const before = columns;
    // Optimistic: move the card and its value between columns.
    setColumns(
      columns.map((c) => {
        if (c.id === card.stage_id) {
          return { ...c, count: c.count - 1, total_value: c.total_value - (card.deal_value || 0), cards: c.cards.filter((x) => x.id !== card.id) };
        }
        if (c.id === toStageId) {
          const moved = { ...card, stage_id: toStageId, stage_changed_at: new Date().toISOString() };
          return { ...c, count: c.count + 1, total_value: c.total_value + (card.deal_value || 0), cards: [moved, ...c.cards] };
        }
        return c;
      }),
    );
    const res = await fetch(`/api/whatsapp/conversations/${card.id}/deal`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lostReason !== undefined ? { stage_id: toStageId, lost_reason: lostReason } : { stage_id: toStageId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setColumns(before);
      setToast({ message: data.error || 'Could not move the chat', type: 'error' });
    }
  }

  function requestMove(card: BoardCard, toStageId: string) {
    const target = columns?.find((c) => c.id === toStageId);
    if (target?.kind === 'lost') setLostPrompt({ card, toStageId });
    else void move(card, toStageId);
  }

  const totals = useMemo(() => {
    const open = (columns || []).filter((c) => c.kind === 'open');
    return {
      openCount: open.reduce((n, c) => n + c.count, 0),
      openValue: open.reduce((n, c) => n + c.total_value, 0),
      wonValue: (columns || []).filter((c) => c.kind === 'won').reduce((n, c) => n + c.total_value, 0),
    };
  }, [columns]);

  const field =
    'rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark';

  return (
    <div className="flex h-full min-h-0 flex-col p-4 md:p-6">
      <ListPageHeader
        title="Pipeline"
        description="Every lead on WhatsApp by stage. Drag a card to move it; open it to chat."
        showActionsOnMobile
        actions={
          <Button variant="secondary" size="sm" onClick={() => setManageOpen(true)}>
            <Settings2 className="mr-1 h-4 w-4" />
            Stages
          </Button>
        }
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1 md:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            className={`${field} w-full pl-9`}
            placeholder="Search name or number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search pipeline"
          />
        </label>
        {isSupervisor && (
          <select className={field} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Handled by">
            <option value="">Everyone</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
        <select className={field} value={labelId} onChange={(e) => setLabelId(e.target.value)} aria-label="Label">
          <option value="">All labels</option>
          {labels.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <select className={field} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Lead source">
          <option value="">All sources</option>
          {Object.entries(SOURCE_LABEL).map(([key, text]) => (
            <option key={key} value={key}>{text}</option>
          ))}
        </select>
        <select className={field} value={closedDays} onChange={(e) => setClosedDays(e.target.value)} aria-label="Won and lost shown">
          <option value="30">Won/lost: last 30 days</option>
          <option value="90">Won/lost: last 90 days</option>
          <option value="365">Won/lost: last year</option>
        </select>
        {columns && (
          <p className="ml-auto text-sm text-text-secondary">
            {totals.openCount} open · {formatDealValue(totals.openValue)} in play · {formatDealValue(totals.wonValue)} won
          </p>
        )}
      </div>

      {!columns ? (
        <div className="flex flex-1 items-center justify-center py-16 text-sm text-text-muted">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading pipeline…
        </div>
      ) : (
        <div className="mt-4 flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {columns.map((col) => (
            <section
              key={col.id}
              aria-label={col.name}
              className={`flex w-72 shrink-0 flex-col rounded-xl border bg-surface-secondary/50 dark:bg-surface-dark/50 ${
                dragOver === col.id ? 'border-primary-400 ring-2 ring-primary-200' : 'border-border dark:border-border-dark'
              }`}
              onDragOver={(e) => {
                if (!dragCard.current) return;
                e.preventDefault();
                setDragOver(col.id);
              }}
              onDragLeave={() => setDragOver((v) => (v === col.id ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const card = dragCard.current;
                dragCard.current = null;
                if (card) requestMove(card, col.id);
              }}
            >
              <header className="border-b border-border px-3 py-2 dark:border-border-dark">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${STAGE_DOT[col.color]}`} />
                  <h2 className="truncate text-sm font-semibold text-text-primary">{col.name}</h2>
                  <span className="ml-auto rounded-full bg-white px-2 text-xs text-text-secondary dark:bg-surface-dark">{col.count}</span>
                </div>
                <p className="mt-0.5 text-xs text-text-muted">{formatDealValue(col.total_value)}</p>
              </header>
              <div className="flex min-h-[80px] flex-1 flex-col gap-2 overflow-y-auto p-2">
                {col.cards.length === 0 && <p className="px-1 py-6 text-center text-xs text-text-muted">No chats here</p>}
                {col.cards.map((card) => (
                  <DealCard
                    key={card.id}
                    card={card}
                    stages={stages}
                    onDragStart={() => {
                      dragCard.current = card;
                    }}
                    onDragEnd={() => {
                      setDragOver(null);
                    }}
                    onMove={(toStageId) => requestMove(card, toStageId)}
                  />
                ))}
                {col.cards.length < col.count && (
                  <button
                    type="button"
                    className="rounded-lg py-2 text-xs font-medium text-primary-600 hover:bg-white disabled:opacity-50 dark:hover:bg-surface-dark"
                    onClick={() => void loadMore(col)}
                    disabled={loadingMore === col.id}
                  >
                    {loadingMore === col.id ? 'Loading…' : `Show more (${col.count - col.cards.length})`}
                  </button>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {lostPrompt && (
        <LostReasonDialog
          onCancel={() => setLostPrompt(null)}
          onConfirm={(reason) => {
            const { card, toStageId } = lostPrompt;
            setLostPrompt(null);
            void move(card, toStageId, reason);
          }}
        />
      )}

      <StageManager
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onChanged={() => void load()}
        onError={(message) => setToast({ message, type: 'error' })}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

function DealCard({
  card,
  stages,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  card: BoardCard;
  stages: StageOption[];
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (stageId: string) => void;
}) {
  const due = card.next_followup_at ? new Date(card.next_followup_at) : null;
  const overdue = due ? isPast(due) : false;
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className="cursor-grab rounded-lg border border-border bg-white p-2.5 shadow-sm active:cursor-grabbing dark:border-border-dark dark:bg-surface-dark"
    >
      <div className="flex items-start gap-2">
        <Link href={`/whatsapp/conversations?c=${card.id}`} className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-primary hover:underline">{card.name}</p>
          {card.summary ? (
            <p className="mt-0.5 line-clamp-3 text-xs text-text-secondary" title={card.summary}>{card.summary}</p>
          ) : (
            card.last_message_text && <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{card.last_message_text}</p>
          )}
        </Link>
        {card.deal_value !== null && (
          <span className="shrink-0 text-xs font-semibold text-text-primary">{formatDealValue(card.deal_value)}</span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        {card.source && (
          <span className={`rounded-full px-1.5 py-0.5 font-medium ${SOURCE_STYLE[card.source] || 'bg-gray-100 text-gray-600'}`}>
            {SOURCE_LABEL[card.source] || card.source}
          </span>
        )}
        {card.is_customer && (
          <span className="rounded-full bg-orange-50 px-1.5 py-0.5 font-medium text-orange-700">Existing customer</span>
        )}
        {card.temperature && TEMPERATURE_STYLE[card.temperature] && (
          <span className={`rounded-full px-1.5 py-0.5 font-medium capitalize ${TEMPERATURE_STYLE[card.temperature]}`}>{card.temperature}</span>
        )}
        {card.owner_name && (
          <span className="inline-flex items-center gap-0.5 text-text-muted">
            <User className="h-3 w-3" />
            {card.owner_name}
          </span>
        )}
        {due && (
          <span
            className={`inline-flex items-center gap-0.5 ${overdue ? 'font-medium text-red-600' : 'text-text-muted'}`}
            title={due.toLocaleString()}
          >
            <AlarmClock className="h-3 w-3" />
            {overdue ? `Overdue ${formatDistanceToNowStrict(due)}` : `in ${formatDistanceToNowStrict(due)}`}
          </span>
        )}
        {card.expected_close_on && <span className="text-text-muted">Close {card.expected_close_on}</span>}
      </div>
      {/* Drag needs a mouse; touch screens move cards with this. */}
      <select
        className="mt-2 w-full rounded-md border border-border bg-white px-2 py-1 text-xs text-text-secondary md:hidden dark:border-border-dark dark:bg-surface-dark"
        value={card.stage_id}
        onChange={(e) => onMove(e.target.value)}
        aria-label={`Move ${card.name}`}
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </article>
  );
}

function LostReasonDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Why was it lost?">
      <form
        className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl dark:bg-surface-dark"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(reason.trim());
        }}
      >
        <h2 className="text-base font-semibold text-text-primary">Why was it lost?</h2>
        <p className="mt-1 text-xs text-text-secondary">Optional. Helps you see which reasons come up most.</p>
        <input
          autoFocus
          className="mt-3 w-full rounded-lg border border-border px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark"
          placeholder="e.g. Price too high, bought elsewhere"
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm">
            Mark lost
          </Button>
        </div>
      </form>
    </div>
  );
}
