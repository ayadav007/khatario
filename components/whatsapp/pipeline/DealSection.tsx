'use client';

import { useEffect, useState } from 'react';
import { format, isPast } from 'date-fns';
import { AlarmClock, Check, Loader2 } from 'lucide-react';
import type { DealView } from '@/lib/whatsapp/pipeline';
import type { FollowupRow } from '@/lib/whatsapp/followups';
import { STAGE_DOT, type StageOption } from './stageStyle';

const field =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:border-border-dark dark:bg-surface-dark';
const labelCls = 'mb-1 block text-xs font-medium text-gray-700 dark:text-text-secondary';

type Preset = 'hour' | 'evening' | 'tomorrow' | 'monday' | 'custom';

/** Due time for a quick "remind me" choice, in the viewer's own clock. */
export function presetDue(preset: Exclude<Preset, 'custom'>, now = new Date()): Date {
  const d = new Date(now);
  if (preset === 'hour') return new Date(now.getTime() + 60 * 60 * 1000);
  if (preset === 'evening') {
    d.setHours(18, 0, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  }
  if (preset === 'tomorrow') {
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return d;
  }
  // Next Monday 10:00 (a week out when today is Monday).
  const add = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + add);
  d.setHours(10, 0, 0, 0);
  return d;
}

/** Stage, deal value and follow-up reminders for one chat, in the contact panel. */
export function DealSection({ conversationId, isGroup }: { conversationId: string; isGroup?: boolean }) {
  const [deal, setDeal] = useState<DealView | null>(null);
  const [stages, setStages] = useState<StageOption[]>([]);
  const [value, setValue] = useState('');
  const [closeOn, setCloseOn] = useState('');
  const [lostReason, setLostReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followups, setFollowups] = useState<FollowupRow[]>([]);
  const [remindOpen, setRemindOpen] = useState(false);

  async function loadFollowups() {
    const res = await fetch(`/api/whatsapp/followups?conversation_id=${encodeURIComponent(conversationId)}`);
    const data = await res.json().catch(() => ({}));
    setFollowups(res.ok ? data.followups || [] : []);
  }

  useEffect(() => {
    let cancelled = false;
    setDeal(null);
    setError(null);
    setRemindOpen(false);
    fetch(`/api/whatsapp/conversations/${encodeURIComponent(conversationId)}/deal`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setDeal(data.deal);
        setStages(data.stages || []);
        setValue(data.deal?.deal_value != null ? String(data.deal.deal_value) : '');
        setCloseOn(data.deal?.expected_close_on || '');
        setLostReason(data.deal?.lost_reason || '');
      })
      .catch(() => undefined);
    void loadFollowups();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per chat
  }, [conversationId]);

  async function save(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/conversations/${encodeURIComponent(conversationId)}/deal`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not save');
        return;
      }
      setDeal(data.deal);
      setLostReason(data.deal?.lost_reason || '');
    } finally {
      setSaving(false);
    }
  }

  async function updateFollowup(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/whatsapp/followups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Could not update the reminder');
    }
    await loadFollowups();
  }

  if (isGroup) return null;

  const stage = stages.find((s) => s.id === deal?.stage_id) ?? null;

  return (
    <div className="space-y-3 border-b border-gray-200 pb-4 dark:border-border-dark">
      <div>
        <label className={labelCls} htmlFor="deal-stage">
          Pipeline stage
          {saving && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
        </label>
        <div className="flex items-center gap-2">
          {stage && <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STAGE_DOT[stage.color]}`} />}
          <select
            id="deal-stage"
            className={field}
            value={deal?.stage_id || ''}
            disabled={!deal || saving}
            onChange={(e) => void save({ stage_id: e.target.value || null })}
          >
            <option value="">Not on the pipeline</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {deal?.stage_id && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls} htmlFor="deal-value">Deal value (₹)</label>
            <input
              id="deal-value"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              className={field}
              value={value}
              placeholder="0"
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => {
                const next = value.trim() === '' ? null : Number(value);
                if (next !== deal.deal_value) void save({ deal_value: next });
              }}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="deal-close">Expected close</label>
            <input
              id="deal-close"
              type="date"
              className={field}
              value={closeOn}
              onChange={(e) => {
                setCloseOn(e.target.value);
                void save({ expected_close_on: e.target.value || null });
              }}
            />
          </div>
        </div>
      )}

      {stage?.kind === 'lost' && (
        <div>
          <label className={labelCls} htmlFor="deal-lost">Why it was lost</label>
          <input
            id="deal-lost"
            className={field}
            maxLength={200}
            value={lostReason}
            placeholder="e.g. Price too high"
            onChange={(e) => setLostReason(e.target.value)}
            onBlur={() => {
              if ((lostReason.trim() || null) !== (deal?.lost_reason || null)) void save({ lost_reason: lostReason });
            }}
          />
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className={labelCls}>Follow-ups</span>
          {!remindOpen && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline"
              onClick={() => setRemindOpen(true)}
            >
              <AlarmClock className="h-3.5 w-3.5" />
              Remind me
            </button>
          )}
        </div>
        {followups.length === 0 && !remindOpen && <p className="text-xs text-gray-500">No reminders on this chat.</p>}
        <ul className="space-y-1.5">
          {followups.map((f) => {
            const due = new Date(f.due_at);
            const overdue = isPast(due);
            return (
              <li key={f.id} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs dark:border-border-dark">
                <div className="flex items-center gap-2">
                  <AlarmClock className={`h-3.5 w-3.5 shrink-0 ${overdue ? 'text-red-600' : 'text-gray-400'}`} />
                  <span className={overdue ? 'font-medium text-red-700' : 'text-gray-800 dark:text-text-primary'}>
                    {format(due, 'EEE d MMM, h:mm a')}
                  </span>
                  <span className="ml-auto truncate text-gray-500">{f.assigned_name}</span>
                </div>
                {f.note && <p className="mt-0.5 pl-5 text-gray-600 dark:text-text-secondary">{f.note}</p>}
                <div className="mt-1 flex gap-3 pl-5">
                  <button type="button" className="inline-flex items-center gap-0.5 font-medium text-emerald-700 hover:underline" onClick={() => void updateFollowup(f.id, { status: 'done' })}>
                    <Check className="h-3 w-3" /> Done
                  </button>
                  <button type="button" className="text-gray-600 hover:underline" onClick={() => void updateFollowup(f.id, { due_at: presetDue('tomorrow').toISOString() })}>
                    Tomorrow
                  </button>
                  <button type="button" className="text-gray-600 hover:underline" onClick={() => void updateFollowup(f.id, { status: 'cancelled' })}>
                    Cancel
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {remindOpen && (
          <ReminderForm
            conversationId={conversationId}
            onDone={async (err) => {
              if (err) {
                setError(err);
                return;
              }
              setRemindOpen(false);
              await loadFollowups();
            }}
            onCancel={() => setRemindOpen(false)}
          />
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ReminderForm({
  conversationId,
  onDone,
  onCancel,
}: {
  conversationId: string;
  onDone: (error?: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [preset, setPreset] = useState<Preset>('tomorrow');
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState('');
  const [cancelOnReply, setCancelOnReply] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const due = preset === 'custom' ? (custom ? new Date(custom) : null) : presetDue(preset);
    if (!due || Number.isNaN(due.getTime())) {
      await onDone('Pick a date and time');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/whatsapp/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId, due_at: due.toISOString(), note, cancel_on_reply: cancelOnReply }),
      });
      const data = await res.json().catch(() => ({}));
      await onDone(res.ok ? undefined : data.error || 'Could not set the reminder');
    } finally {
      setBusy(false);
    }
  }

  const presets: Array<[Preset, string]> = [
    ['hour', 'In 1 hour'],
    ['evening', 'This evening'],
    ['tomorrow', 'Tomorrow 10 am'],
    ['monday', 'Next Monday'],
    ['custom', 'Pick a time'],
  ];

  return (
    <form
      className="mt-2 space-y-2 rounded-lg border border-primary-200 bg-primary-50/40 p-2 dark:border-border-dark dark:bg-surface-dark"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap gap-1">
        {presets.map(([key, text]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPreset(key)}
            className={`rounded-full px-2 py-0.5 text-xs ${
              preset === key ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200 dark:bg-surface-dark dark:text-text-secondary'
            }`}
          >
            {text}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <input type="datetime-local" className={field} value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Remind at" />
      )}
      <input className={field} placeholder="Note (optional), e.g. send revised quote" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Reminder note" />
      <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-text-secondary">
        <input type="checkbox" checked={cancelOnReply} onChange={(e) => setCancelOnReply(e.target.checked)} />
        Cancel if they reply before then
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="text-xs text-gray-600 hover:underline" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={busy} className="rounded-lg bg-primary-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
          {busy ? 'Saving…' : 'Set reminder'}
        </button>
      </div>
    </form>
  );
}
