'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Bot, Loader2, Send, X } from 'lucide-react';
import {
  Badge,
  btnCls,
  Field,
  getJson,
  inputCls,
  Notice,
  PAIN_POINT_OPTIONS,
  BUSINESS_TYPE_OPTIONS,
  PIPELINE_LABELS,
  PIPELINE_ORDER,
  pipelineTone,
  primaryBtnCls,
  Row,
  sendJson,
  State,
  Table,
  useJson,
  when,
} from './shared';

type LeadsResponse = {
  leads: Row[];
  counts: Record<string, number>;
  page: number;
  pageSize: number;
  assignees: Array<{ id: string; name: string; email: string }>;
  steps: Array<{ id: string; label: string }>;
  templates: Array<{ event_key: string; name: string }>;
};

type Detail = { lead: Row; events: Row[]; followups: Row[]; windowOpen: boolean };

const label = (pairs: readonly (readonly [string, string])[], v?: string | null) => pairs.find(([k]) => k === v)?.[1] || v || '—';
const HANDED_OFF = '_handed_off';

function stepLabel(steps: LeadsResponse['steps'], id?: string | null) {
  if (!id) return '—';
  if (id === HANDED_OFF) return 'With sales (bot paused)';
  return steps.find((s) => s.id === id)?.label || id;
}

function Transcript({ events }: { events: Row[] }) {
  return (
    <div className="space-y-2 rounded-xl bg-[#efeae2] p-3">
      {events.length === 0 ? <p className="text-center text-sm text-gray-500">No messages yet.</p> : null}
      {events.map((e) => {
        if (e.kind === 'inbound' || e.kind === 'outbound') {
          const out = e.kind === 'outbound';
          return (
            <div key={e.id} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm ${out ? 'bg-[#d9fdd3]' : 'bg-white'}`}>
                <p className="whitespace-pre-wrap text-gray-800">{String(e.detail?.text || (e.detail?.reply_id ? `[tapped ${e.detail.reply_id}]` : ''))}</p>
                <p className="mt-0.5 text-right text-[10px] text-gray-500">{when(e.created_at)}</p>
              </div>
            </div>
          );
        }
        let text = e.kind.replace(/_/g, ' ');
        if (e.kind === 'status') text = `Stage: ${PIPELINE_LABELS[e.from_status] || e.from_status || '—'} → ${PIPELINE_LABELS[e.to_status] || e.to_status}`;
        else if (e.kind === 'step') text = `Step: ${e.to_step || 'none'}${e.detail?.reason ? ` (${e.detail.reason})` : ''}`;
        else if (e.kind === 'followup') text = `Follow-up sent: ${e.detail?.kind || ''} (${e.detail?.via || ''})`;
        else if (e.kind === 'field') text = `Saved: ${Object.entries(e.detail || {}).map(([k, v]) => `${k} = ${v}`).join(', ')}`;
        else if (e.kind === 'signup') text = `Trial account created (${e.detail?.via === 'whatsapp_link' ? 'WhatsApp link' : 'matched by phone'})`;
        else if (e.kind === 'manual_message') text = 'Message sent by sales';
        else if (e.kind === 'manual_template') text = `Template sent by sales: ${e.detail?.event_key || ''}`;
        return (
          <p key={e.id} className="text-center text-[11px] text-gray-500">
            <span className="rounded bg-white/70 px-2 py-0.5">
              {text} · {when(e.created_at)}
            </span>
          </p>
        );
      })}
    </div>
  );
}

function LeadPanel({ id, meta, onClose, onChanged }: { id: string; meta: LeadsResponse; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [text, setText] = useState('');
  const [notes, setNotes] = useState('');
  const [template, setTemplate] = useState('');
  const [resumeStep, setResumeStep] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setDetail(null);
    setError('');
    getJson<Detail>(`/api/admin/sales-flow/leads/${id}`)
      .then((d) => {
        setDetail(d);
        setNotes(d.lead.notes || '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, [id]);

  const call = async (name: string, method: 'PATCH' | 'POST', body: Record<string, unknown>, okText: string) => {
    setBusy(name);
    setMsg(null);
    try {
      const d = await sendJson<Detail>(`/api/admin/sales-flow/leads/${id}`, method, body);
      setDetail(d);
      setMsg({ tone: 'ok', text: okText });
      onChanged();
      return true;
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : 'Failed' });
      return false;
    } finally {
      setBusy('');
    }
  };

  const l = detail?.lead;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{l?.name || l?.business_name || l?.phone || 'Lead'}</h3>
            {l ? (
              <p className="text-sm text-gray-600">
                {l.phone} {l.business_name ? `· ${l.business_name}` : ''} {l.city ? `· ${l.city}` : ''}
              </p>
            ) : null}
          </div>
          <button type="button" className={btnCls} onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {!detail ? <State loading={!error} error={error} /> : null}
        {l && detail ? (
          <div className="space-y-5">
            {msg ? <Notice tone={msg.tone === 'ok' ? 'ok' : 'error'}>{msg.text}</Notice> : null}
            <div className="flex flex-wrap gap-2">
              <Badge tone={pipelineTone(l.pipeline_status)}>{PIPELINE_LABELS[l.pipeline_status] || l.pipeline_status}</Badge>
              <Badge>{stepLabel(meta.steps, l.flow_step)}</Badge>
              {l.opted_out_at ? <Badge tone="red">Opted out</Badge> : null}
              <Badge tone={detail.windowOpen ? 'green' : 'gray'}>{detail.windowOpen ? '24-hour window open' : 'Window closed (templates only)'}</Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Stage">
                <select
                  className={inputCls}
                  value={l.pipeline_status}
                  disabled={Boolean(busy)}
                  onChange={(e) => call('status', 'PATCH', { pipeline_status: e.target.value }, 'Stage updated.')}
                >
                  {PIPELINE_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {PIPELINE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Salesperson">
                <select
                  className={inputCls}
                  value={l.assigned_to || ''}
                  disabled={Boolean(busy)}
                  onChange={(e) => call('assign', 'PATCH', { assigned_to: e.target.value || null }, 'Assignment saved.')}
                >
                  <option value="">Unassigned</option>
                  {meta.assignees.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-gray-200 p-4 text-sm">
              <dt className="text-gray-500">Business type</dt>
              <dd>{label(BUSINESS_TYPE_OPTIONS, l.business_type)}</dd>
              <dt className="text-gray-500">Pain point</dt>
              <dd>{label(PAIN_POINT_OPTIONS, l.pain_point)}</dd>
              <dt className="text-gray-500">Opening</dt>
              <dd>{l.entry_key || '—'}</dd>
              <dt className="text-gray-500">Campaign / ad</dt>
              <dd>
                {l.campaign_name || l.campaign_id || '—'}
                {l.ad_id ? <span className="block text-xs text-gray-500">Ad {l.ad_id}</span> : null}
                {l.ad_headline ? <span className="block text-xs text-gray-500">{l.ad_headline}</span> : null}
              </dd>
              <dt className="text-gray-500">Demo</dt>
              <dd>{l.demo_sent_at ? `Sent ${when(l.demo_sent_at)}${l.demo_read_at ? ', seen' : ''}` : '—'}</dd>
              <dt className="text-gray-500">Trial</dt>
              <dd>
                {l.trial_created_at ? when(l.trial_created_at) : '—'}
                {l.business_display ? <span className="block text-xs text-gray-500">{l.business_display}</span> : null}
              </dd>
              <dt className="text-gray-500">First invoice</dt>
              <dd>{when(l.activated_at)}</dd>
              <dt className="text-gray-500">Paid</dt>
              <dd>{l.converted_at ? `${when(l.converted_at)}${l.conversion_value ? ` · ₹${Number(l.conversion_value).toLocaleString('en-IN')}` : ''}` : '—'}</dd>
            </dl>

            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-800">Conversation</h4>
              <Transcript events={detail.events} />
            </div>

            <div className="rounded-xl border border-gray-200 p-4">
              <h4 className="mb-2 text-sm font-semibold text-gray-800">Reply</h4>
              {detail.windowOpen && !l.opted_out_at ? (
                <div className="space-y-2">
                  <textarea className={inputCls} rows={3} value={text} placeholder="Type a WhatsApp message…" onChange={(e) => setText(e.target.value)} />
                  <button
                    type="button"
                    className={primaryBtnCls}
                    disabled={Boolean(busy) || !text.trim()}
                    onClick={async () => {
                      if (await call('message', 'POST', { action: 'message', text }, 'Message sent.')) setText('');
                    }}
                  >
                    {busy === 'message' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send on WhatsApp
                  </button>
                </div>
              ) : null}
              {!l.opted_out_at ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <Field label={detail.windowOpen ? 'Or send an approved template' : 'Window closed: send an approved template'}>
                    <select className={`${inputCls} min-w-[240px]`} value={template} onChange={(e) => setTemplate(e.target.value)}>
                      <option value="">Choose…</option>
                      {meta.templates.map((t) => (
                        <option key={t.event_key} value={t.event_key}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button
                    type="button"
                    className={btnCls}
                    disabled={Boolean(busy) || !template}
                    onClick={() => call('template', 'POST', { action: 'template', event_key: template }, 'Template sent.')}
                  >
                    {busy === 'template' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send template
                  </button>
                  {meta.templates.length === 0 ? <p className="w-full text-xs text-gray-500">No approved templates yet (Templates tab).</p> : null}
                </div>
              ) : (
                <p className="text-sm text-gray-500">This lead sent STOP. They must send START before you can message them.</p>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 p-4">
              <h4 className="mb-1 text-sm font-semibold text-gray-800">Hand back to the bot</h4>
              <p className="mb-2 text-xs text-gray-500">Puts the lead on a step. &quot;Send now&quot; also sends that step&apos;s messages (window must be open).</p>
              <div className="flex flex-wrap items-end gap-2">
                <select className={`${inputCls} max-w-xs`} value={resumeStep} onChange={(e) => setResumeStep(e.target.value)}>
                  <option value="">No step (AI assistant answers)</option>
                  {meta.steps.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <button type="button" className={btnCls} disabled={Boolean(busy)} onClick={() => call('resume', 'POST', { action: 'resume', step_id: resumeStep || null }, 'Bot resumed.')}>
                  <Bot className="h-4 w-4" /> Resume quietly
                </button>
                <button
                  type="button"
                  className={btnCls}
                  disabled={Boolean(busy) || !resumeStep || !detail.windowOpen}
                  onClick={() => call('resume', 'POST', { action: 'resume', step_id: resumeStep, send: true }, 'Bot resumed and step sent.')}
                >
                  <Send className="h-4 w-4" /> Resume and send now
                </button>
              </div>
            </div>

            <div>
              <Field label="Notes">
                <textarea className={inputCls} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <button type="button" className={`${btnCls} mt-2`} disabled={Boolean(busy) || notes === (l.notes || '')} onClick={() => call('notes', 'PATCH', { notes }, 'Notes saved.')}>
                Save notes
              </button>
            </div>

            {detail.followups.length ? (
              <div>
                <h4 className="mb-2 text-sm font-semibold text-gray-800">Follow-ups</h4>
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm">
                  {detail.followups.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span>{f.kind}</span>
                      <span className="flex items-center gap-2 text-xs text-gray-500">
                        {when(f.due_at)}
                        <Badge tone={f.status === 'sent' ? 'green' : f.status === 'pending' ? 'amber' : f.status === 'failed' ? 'red' : 'gray'}>
                          {f.status}
                          {f.sent_via ? ` · ${f.sent_via}` : ''}
                        </Badge>
                      </span>
                      {f.error_message ? <span className="w-full text-xs text-red-600">{f.error_message}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function PipelineTab() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [campaign, setCampaign] = useState('');
  const [assigned, setAssigned] = useState('');
  const [page, setPage] = useState(1);
  const openId = params.get('lead');

  const url = useMemo(() => {
    const s = new URLSearchParams({ page: String(page) });
    if (status) s.set('status', status);
    if (search) s.set('q', search);
    if (campaign) s.set('campaign', campaign);
    if (assigned) s.set('assigned_to', assigned);
    return `/api/admin/sales-flow/leads?${s.toString()}`;
  }, [status, search, campaign, assigned, page]);
  const { data, error, loading, reload } = useJson<LeadsResponse>(url);

  const openLead = (id: string | null) => {
    const s = new URLSearchParams(params.toString());
    s.set('tab', 'pipeline');
    if (id) s.set('lead', id);
    else s.delete('lead');
    router.replace(`/admin/sales-flow?${s.toString()}`);
  };

  const total = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setStatus('');
            setPage(1);
          }}
          className={`rounded-full border px-3 py-1 text-sm ${status === '' ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-700'}`}
        >
          All {total}
        </button>
        {PIPELINE_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
            className={`rounded-full border px-3 py-1 text-sm ${status === s ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-700'}`}
          >
            {PIPELINE_LABELS[s]} {data?.counts[s] ?? 0}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q);
            setPage(1);
          }}
        >
          <input className={`${inputCls} w-56`} placeholder="Search name, business, phone" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" className={btnCls}>
            Search
          </button>
        </form>
        <input
          className={`${inputCls} w-48`}
          placeholder="Campaign name or id"
          value={campaign}
          onChange={(e) => {
            setCampaign(e.target.value);
            setPage(1);
          }}
        />
        <select
          className={`${inputCls} w-48`}
          value={assigned}
          onChange={(e) => {
            setAssigned(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Anyone</option>
          <option value="none">Unassigned</option>
          {data?.assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {!data ? (
        <State loading={loading} error={error} />
      ) : (
        <>
          <Table head={['Lead', 'Business', 'Stage', 'Step', 'Campaign', 'Salesperson', 'Last message']} empty={data.leads.length === 0}>
            {data.leads.map((l) => (
              <tr key={l.id} className="cursor-pointer hover:bg-gray-50" onClick={() => openLead(l.id)}>
                <td className="px-4 py-3">
                  <span className="font-medium text-gray-900">{l.name || '—'}</span>
                  <span className="block text-xs text-gray-500">{l.phone}</span>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {l.business_name || '—'}
                  <span className="block text-xs text-gray-500">
                    {label(BUSINESS_TYPE_OPTIONS, l.business_type)} · {label(PAIN_POINT_OPTIONS, l.pain_point)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={pipelineTone(l.pipeline_status)}>{PIPELINE_LABELS[l.pipeline_status] || l.pipeline_status}</Badge>
                  {l.opted_out_at ? <span className="ml-1"><Badge tone="red">STOP</Badge></span> : null}
                </td>
                <td className="px-4 py-3 text-gray-700">{stepLabel(data.steps, l.flow_step)}</td>
                <td className="px-4 py-3 text-gray-700">{l.campaign_name || l.campaign_id || (l.ad_id ? `Ad ${l.ad_id}` : '—')}</td>
                <td className="px-4 py-3 text-gray-700">{l.assigned_name || '—'}</td>
                <td className="px-4 py-3 text-gray-500">{when(l.last_inbound_at || l.created_at)}</td>
              </tr>
            ))}
          </Table>
          <div className="flex items-center justify-end gap-2 text-sm">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className={btnCls}>
              Previous
            </button>
            <span className="text-gray-500">Page {page}</span>
            <button type="button" disabled={data.leads.length < data.pageSize} onClick={() => setPage(page + 1)} className={btnCls}>
              Next
            </button>
          </div>
        </>
      )}

      {openId && data ? <LeadPanel id={openId} meta={data} onClose={() => openLead(null)} onChanged={() => void reload()} /> : null}
    </div>
  );
}
