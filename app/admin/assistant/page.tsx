'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { AlertTriangle, Bot, CheckCircle2, Loader2, RefreshCw, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { useAdmin } from '@/context/AdminContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'leads', label: 'Leads' },
  { id: 'unanswered', label: 'Unanswered' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'sources', label: 'Knowledge sources' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const CHANNEL_LABELS: Record<string, string> = {
  web: 'Website (landing, pricing, book demo)',
  signup: 'Signup page',
  trial_app: 'Trial users in the app',
  in_app: 'All tenant staff in the app (phase 2)',
  whatsapp: 'Khatario WhatsApp number (phase 2)',
};
const LEAD_STATUSES = ['new', 'contacted', 'demo_booked', 'trial_started', 'converted', 'lost'];

type Row = Record<string, any>;

function when(v?: string | null) {
  return v ? format(new Date(v), 'd MMM yyyy, h:mm a') : '—';
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...platformAdminFetchInit, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

function useView<T>(view: TabId, query = '') {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getJson<T>(`/api/admin/assistant?view=${view}${query}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [view, query]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load };
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'warn' | 'good' }) {
  const color = tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-green-600' : 'text-gray-900';
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-gray-600">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function Health({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />}
      <span>
        <span className="font-medium text-gray-900">{label}</span>
        {!ok && hint ? <span className="block text-gray-500">{hint}</span> : null}
      </span>
    </li>
  );
}

function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {empty ? (
            <tr>
              <td colSpan={head.length} className="px-4 py-10 text-center text-gray-500">
                Nothing here yet.
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

function Pager({ page, count, pageSize, onPage }: { page: number; count: number; pageSize: number; onPage: (p: number) => void }) {
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-sm">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">
        Previous
      </button>
      <span className="text-gray-500">Page {page}</span>
      <button type="button" disabled={count < pageSize} onClick={() => onPage(page + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">
        Next
      </button>
    </div>
  );
}

function State({ loading, error }: { loading: boolean; error: string }) {
  if (error) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-primary-600" />;
  return null;
}

function OverviewTab() {
  const { isMinimumRole } = useAdmin();
  const { data, error, loading, reload } = useView<Row>('overview');
  const [saving, setSaving] = useState('');
  if (!data) return <State loading={loading} error={error} />;
  const { stats, health, settings } = data;

  const toggle = async (channel: string, value: boolean) => {
    setSaving(channel);
    try {
      await getJson('/api/admin/assistant/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: { [channel]: value } }),
      });
      await reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving('');
    }
  };

  const budgetUse = health.dailyTokenBudget > 0 ? Math.round((health.tokensToday / health.dailyTokenBudget) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Conversations (7 days)" value={stats.conversations7d} />
        <Stat label="Questions asked (7 days)" value={stats.messages7d} />
        <Stat label="Could not answer (7 days)" value={stats.unanswered7d} tone={stats.unanswered7d ? 'warn' : undefined} />
        <Stat label="New leads" value={stats.newLeads} tone={stats.newLeads ? 'good' : undefined} />
        <Stat label="Handed to a human (7 days)" value={stats.handedOff7d} />
        <Stat label="Helpful / not helpful (7 days)" value={`${stats.thumbsUp7d} / ${stats.thumbsDown7d}`} />
        <Stat label="Sources with errors" value={stats.sourcesWithErrors} tone={stats.sourcesWithErrors ? 'warn' : undefined} />
        <Stat label="Last indexed" value={stats.lastIndexedAt ? format(new Date(stats.lastIndexedAt), 'd MMM, h:mm a') : 'Never'} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-gray-900">Health</h2>
          <ul className="space-y-2">
            <Health ok={health.enabled} label="Assistant enabled" hint="ASSISTANT_ENABLED=false is set on this server." />
            <Health ok={health.chatModel} label="Chat model key" hint="Set GROQ_API_KEY or GEMINI_API_KEY. Until then answers quote the guide directly." />
            <Health ok={health.embeddings} label="Embedding key" hint="Set GEMINI_API_KEY for meaning-based search." />
            <Health ok={health.vector} label="pgvector" hint="Install pgvector and run npm run kb:enable-vector. Keyword search works meanwhile." />
            <Health
              ok={budgetUse < 90}
              label={`Tokens today: ${health.tokensToday.toLocaleString('en-IN')} of ${health.dailyTokenBudget > 0 ? health.dailyTokenBudget.toLocaleString('en-IN') : 'unlimited'}`}
              hint="Near the daily budget. Over budget, answers fall back to quoting the guide."
            />
          </ul>
          <p className="mt-3 text-xs text-gray-500">Conversations are deleted after {health.retentionDays} days of inactivity. Leads are kept.</p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-gray-900">Channels</h2>
          <ul className="space-y-3">
            {Object.keys(CHANNEL_LABELS).map((channel) => {
              const on = settings.channels?.[channel] === true;
              return (
                <li key={channel} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-700">{CHANNEL_LABELS[channel]}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    disabled={!isMinimumRole('admin') || saving === channel}
                    onClick={() => toggle(channel, !on)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${on ? 'bg-primary-600' : 'bg-gray-300'}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${on ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                </li>
              );
            })}
          </ul>
          {!isMinimumRole('admin') ? <p className="mt-3 text-xs text-gray-500">Only admins can change channels.</p> : null}
        </section>
      </div>
    </div>
  );
}

function ConversationDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    getJson<Row>(`/api/admin/assistant/conversations/${id}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="flex h-full w-full max-w-xl flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="font-semibold text-gray-900">Conversation</h2>
            {data ? (
              <p className="text-xs text-gray-500">
                {data.conversation.channel} · {data.conversation.audience} · {data.conversation.status}
                {data.conversation.business_name ? ` · ${data.conversation.business_name}` : ''}
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {!data && !error ? <Loader2 className="h-6 w-6 animate-spin text-primary-600" /> : null}
          {data?.messages.map((m: Row) => (
            <div key={m.id} className={`rounded-xl p-3 text-sm ${m.role === 'user' ? 'ml-10 bg-primary-50' : 'mr-10 bg-gray-50'}`}>
              <p className="whitespace-pre-wrap text-gray-800">{m.content}</p>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                <span>{when(m.created_at)}</span>
                {m.intent ? <span>intent: {m.intent}</span> : null}
                {m.model ? <span>{m.model}</span> : null}
                {m.answered === false ? <span className="font-medium text-amber-600">not answered</span> : null}
                {m.feedback === 1 ? <ThumbsUp className="h-3.5 w-3.5 text-green-600" /> : null}
                {m.feedback === -1 ? <ThumbsDown className="h-3.5 w-3.5 text-red-600" /> : null}
                {m.retrieval?.chunks?.length ? <span>sources: {m.retrieval.chunks.map((c: Row) => c.title).filter(Boolean).slice(0, 3).join(', ')}</span> : null}
              </p>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function ConversationsTab() {
  const [page, setPage] = useState(1);
  const [channel, setChannel] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading } = useView<Row>('conversations', `&page=${page}${channel ? `&channel=${channel}` : ''}`);
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <select value={channel} onChange={(e) => { setPage(1); setChannel(e.target.value); }} className="rounded-lg border px-3 py-2 text-sm">
          <option value="">All channels</option>
          {Object.keys(CHANNEL_LABELS).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      {!data ? <State loading={loading} error={error} /> : (
        <>
          <Table head={['First question', 'Channel', 'Who', 'Messages', 'Status', 'Last message']} empty={!data.rows.length}>
            {data.rows.map((r: Row) => (
              <tr key={r.id} onClick={() => setOpen(r.id)} className="cursor-pointer hover:bg-gray-50">
                <td className="max-w-xs truncate px-4 py-3 text-gray-900">{r.first_question || '—'}</td>
                <td className="px-4 py-3">{r.channel}</td>
                <td className="px-4 py-3 text-gray-600">{r.business_name || r.lead_name || r.lead_phone || r.audience}</td>
                <td className="px-4 py-3">{r.message_count}</td>
                <td className="px-4 py-3">{r.status}</td>
                <td className="px-4 py-3 text-gray-600">{when(r.last_message_at)}</td>
              </tr>
            ))}
          </Table>
          <Pager page={data.page} count={data.rows.length} pageSize={data.pageSize} onPage={setPage} />
        </>
      )}
      {open ? <ConversationDrawer id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function LeadsTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading, reload } = useView<Row>('leads', `&page=${page}${status ? `&status=${status}` : ''}`);

  const update = async (id: string, body: Row) => {
    try {
      await getJson(`/api/admin/assistant/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <div>
      <div className="mb-3">
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} className="rounded-lg border px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
      </div>
      {!data ? <State loading={loading} error={error} /> : (
        <>
          <Table head={['Name', 'Phone / email', 'Business', 'Needs', 'Demo', 'Status', 'Notes', 'Created']} empty={!data.rows.length}>
            {data.rows.map((l: Row) => (
              <tr key={l.id} className="align-top">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {l.conversation_id ? (
                    <button type="button" className="text-primary-700 hover:underline" onClick={() => setOpen(l.conversation_id)}>
                      {l.name || 'Unnamed'}
                    </button>
                  ) : (l.name || 'Unnamed')}
                  <span className="block text-xs font-normal text-gray-500">{l.source_channel}</span>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {l.phone ? <a href={`tel:+91${l.phone}`} className="block hover:underline">+91 {l.phone}</a> : null}
                  {l.email ? <a href={`mailto:${l.email}`} className="block text-xs text-gray-500 hover:underline">{l.email}</a> : null}
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {l.business_name || '—'}
                  {l.city ? <span className="block text-xs text-gray-500">{l.city}</span> : null}
                </td>
                <td className="max-w-[12rem] px-4 py-3 text-xs text-gray-600">
                  {(l.needs ?? []).join(', ') || '—'}
                  {l.recommended_plan ? <span className="block">Plan: {l.recommended_plan}</span> : null}
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">
                  {l.booking_number ? `${l.booking_number} · ${format(new Date(l.scheduled_date), 'd MMM')} ${l.scheduled_time?.slice(0, 5) ?? ''}` : '—'}
                </td>
                <td className="px-4 py-3">
                  <select value={l.status} onChange={(e) => update(l.id, { status: e.target.value })} className="rounded-md border px-2 py-1 text-xs">
                    {LEAD_STATUSES.map((s) => (
                      <option key={s} value={s}>{s.replace('_', ' ')}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <textarea
                    defaultValue={l.notes ?? ''}
                    rows={2}
                    onBlur={(e) => e.target.value !== (l.notes ?? '') && update(l.id, { notes: e.target.value })}
                    className="w-44 rounded-md border px-2 py-1 text-xs"
                    placeholder="Add a note"
                  />
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">{when(l.created_at)}</td>
              </tr>
            ))}
          </Table>
          <Pager page={data.page} count={data.rows.length} pageSize={data.pageSize} onPage={setPage} />
        </>
      )}
      {open ? <ConversationDrawer id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function UnansweredTab() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading } = useView<Row>('unanswered', `&page=${page}`);
  if (!data) return <State loading={loading} error={error} />;
  return (
    <div>
      <p className="mb-3 text-sm text-gray-600">
        Questions the assistant could not answer from the guide. Add the answer to a file under <code>knowledge/</code> and it will be indexed on the next deploy.
      </p>
      <Table head={['Question', 'Channel', 'Audience', 'Closest source', 'When']} empty={!data.rows.length}>
        {data.rows.map((r: Row) => (
          <tr key={r.id} onClick={() => setOpen(r.conversation_id)} className="cursor-pointer hover:bg-gray-50">
            <td className="max-w-md px-4 py-3 text-gray-900">{r.question || '—'}</td>
            <td className="px-4 py-3">{r.channel}</td>
            <td className="px-4 py-3">{r.audience}</td>
            <td className="px-4 py-3 text-xs text-gray-500">{r.retrieval?.chunks?.[0]?.title ?? '—'}</td>
            <td className="px-4 py-3 text-gray-600">{when(r.created_at)}</td>
          </tr>
        ))}
      </Table>
      <Pager page={data.page} count={data.rows.length} pageSize={data.pageSize} onPage={setPage} />
      {open ? <ConversationDrawer id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function FeedbackTab() {
  const [page, setPage] = useState(1);
  const [rating, setRating] = useState('down');
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading } = useView<Row>('feedback', `&page=${page}${rating ? `&rating=${rating}` : ''}`);
  return (
    <div>
      <div className="mb-3">
        <select value={rating} onChange={(e) => { setPage(1); setRating(e.target.value); }} className="rounded-lg border px-3 py-2 text-sm">
          <option value="down">Not helpful</option>
          <option value="up">Helpful</option>
          <option value="">All</option>
        </select>
      </div>
      {!data ? <State loading={loading} error={error} /> : (
        <>
          <Table head={['Rating', 'Question', 'Answer', 'Channel', 'When']} empty={!data.rows.length}>
            {data.rows.map((r: Row) => (
              <tr key={r.id} onClick={() => setOpen(r.conversation_id)} className="cursor-pointer align-top hover:bg-gray-50">
                <td className="px-4 py-3">{r.rating === 1 ? <ThumbsUp className="h-4 w-4 text-green-600" /> : <ThumbsDown className="h-4 w-4 text-red-600" />}</td>
                <td className="max-w-xs px-4 py-3 text-gray-900">{r.question || '—'}</td>
                <td className="max-w-md px-4 py-3 text-xs text-gray-600"><span className="line-clamp-3">{r.answer}</span></td>
                <td className="px-4 py-3">{r.channel}</td>
                <td className="px-4 py-3 text-gray-600">{when(r.created_at)}</td>
              </tr>
            ))}
          </Table>
          <Pager page={data.page} count={data.rows.length} pageSize={data.pageSize} onPage={setPage} />
        </>
      )}
      {open ? <ConversationDrawer id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function SourcesTab() {
  const { isMinimumRole } = useAdmin();
  const { data, error, loading, reload } = useView<Row>('sources');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const reindex = async (target: string, force = false) => {
    setBusy(true);
    setMessage('');
    try {
      const res = await getJson<{ status: string }>('/api/admin/assistant/reindex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, force }),
      });
      setMessage(
        res.status === 'queued'
          ? 'Re-index queued. The worker picks it up in a few seconds.'
          : 'Re-index started on this server. Refresh in a minute to see the result.',
      );
      window.setTimeout(() => void reload(), 8000);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not start re-index');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {isMinimumRole('admin') ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {[
            ['all', 'Re-index everything'],
            ['markdown', 'Guides'],
            ['plans', 'Plans & prices'],
            ['marketing', 'Website pages'],
          ].map(([target, label]) => (
            <button
              key={target}
              type="button"
              disabled={busy}
              onClick={() => reindex(target)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" /> {label}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => confirm('Re-embed every chunk? This uses embedding quota.') && reindex('all', true)}
            className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:text-gray-800 disabled:opacity-50"
          >
            Force full rebuild
          </button>
        </div>
      ) : null}
      {message ? <p className="mb-3 rounded-lg bg-primary-50 p-3 text-sm text-primary-800">{message}</p> : null}
      {!data ? <State loading={loading} error={error} /> : (
        <Table head={['Source', 'Kind', 'Audience', 'Documents', 'Chunks', 'Status', 'Last indexed']} empty={!data.rows.length}>
          {data.rows.map((s: Row) => (
            <tr key={s.id} className="align-top">
              <td className="px-4 py-3 font-mono text-xs text-gray-900">{s.locator}</td>
              <td className="px-4 py-3">{s.kind}</td>
              <td className="px-4 py-3 text-xs">{(s.audiences ?? []).join(', ')}</td>
              <td className="px-4 py-3">{s.documents}</td>
              <td className="px-4 py-3">{s.chunk_count}</td>
              <td className="px-4 py-3">
                <span className={s.status === 'error' ? 'font-medium text-red-600' : s.status === 'ok' ? 'text-green-700' : 'text-gray-600'}>{s.status}</span>
                {s.error ? <span className="block max-w-xs text-xs text-red-600">{s.error}</span> : null}
              </td>
              <td className="px-4 py-3 text-gray-600">{when(s.last_indexed_at)}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function AssistantAdmin() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('tab');
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : 'overview';

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-3 text-2xl font-bold text-gray-900 sm:text-3xl">
          <Bot className="h-8 w-8 text-primary-600" />
          AI Assistant
        </h1>
        <p className="mt-2 text-gray-600">Conversations, leads and the knowledge the assistant answers from.</p>
      </div>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => router.replace(`/admin/assistant?tab=${t.id}`)}
            className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.id ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'conversations' && <ConversationsTab />}
      {tab === 'leads' && <LeadsTab />}
      {tab === 'unanswered' && <UnansweredTab />}
      {tab === 'feedback' && <FeedbackTab />}
      {tab === 'sources' && <SourcesTab />}
    </div>
  );
}

export default function AdminAssistantPage() {
  return (
    <Suspense fallback={<div className="p-8"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>}>
      <AssistantAdmin />
    </Suspense>
  );
}
