'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Plus, RotateCcw, Save, Send, Trash2, Upload } from 'lucide-react';
import type { FlowDefinition, FlowEntry, FlowFollowup, FlowStep } from '@/lib/sales-funnel/definition';
import { MessagesEditor, type MediaInfo, type StepRef } from './MessagesEditor';
import {
  Badge,
  btnCls,
  BUSINESS_TYPE_OPTIONS,
  dangerBtnCls,
  Field,
  inputCls,
  ListInput,
  Notice,
  PAIN_POINT_OPTIONS,
  primaryBtnCls,
  sendJson,
  State,
  useJson,
  useStoredPhone,
  when,
} from './shared';

type FlowResponse = {
  draft: { version: number; flow: FlowDefinition; updated_at: string; errors: string[] };
  published: { version: number };
  versions: Array<{ version: number; status: string; note: string | null; published_at: string | null; updated_at: string }>;
  media: MediaInfo[];
  options: { actions: string[]; leadFields: string[]; anchors: string[]; conditions: string[]; templateEventKeys: string[] };
};

type Selection = { kind: 'step'; id: string } | { kind: 'entries' } | { kind: 'followup'; kind_: string } | { kind: 'settings' } | { kind: 'versions' };

const ACTION_LABELS: Record<string, string> = {
  mark_qualified: 'Mark lead qualified',
  mark_demo_interested: 'Mark demo interested',
  mark_demo_sent: 'Mark demo sent (starts demo follow-ups)',
  send_signup_link: 'Create signed signup link ({{signup_link}})',
  handoff_to_sales: 'Hand over to sales (bot goes quiet)',
  mark_lost: 'Mark lead lost',
};
const FIELD_LABELS: Record<string, string> = {
  business_type: 'Business type',
  pain_point: 'Pain point',
  business_name: 'Business name',
  owner_name: 'Owner name',
  city: 'City',
};
const ANCHOR_LABELS: Record<string, string> = {
  awaiting_reply: 'After the bot asks a question',
  demo_sent: 'After the demo is sent',
  trial_created: 'After the trial account is created',
};
const CONDITION_LABELS: Record<string, string> = {
  no_reply: 'Lead has not replied since',
  no_trial: 'Lead has not started a trial',
  no_invoice: 'Trial has no invoice yet',
  activated_not_paid: 'Has invoiced but not paid',
};

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function delayLabel(min: number) {
  if (min < 60) return `${min} min`;
  if (min < 60 * 24) return `${+(min / 60).toFixed(1)} h`;
  return `${+(min / 1440).toFixed(1)} days`;
}

function StepEditor({
  step,
  steps,
  media,
  actions,
  onChange,
  onDelete,
}: {
  step: FlowStep;
  steps: StepRef[];
  media: MediaInfo[];
  actions: string[];
  onChange: (s: FlowStep) => void;
  onDelete: () => void;
}) {
  const [phone, setPhone] = useStoredPhone();
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const others = steps.filter((s) => s.id !== step.id);

  const sendTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const r = await sendJson<{ sent: number }>('/api/admin/sales-flow/flow', 'POST', { action: 'test', stepId: step.id, phone });
      setTestMsg({ tone: 'ok', text: `Sent ${r.sent} message(s) from the saved draft.` });
    } catch (err) {
      setTestMsg({ tone: 'error', text: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{step.label}</h3>
          <p className="text-xs text-gray-500">Step id: {step.id}</p>
        </div>
        <button type="button" className={dangerBtnCls} onClick={onDelete}>
          <Trash2 className="h-4 w-4" /> Delete step
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name">
          <input className={inputCls} value={step.label} onChange={(e) => onChange({ ...step, label: e.target.value })} />
        </Field>
        <Field label="Then go straight to" hint="No reply needed; leave empty to wait for a choice">
          <select className={inputCls} value={step.next || ''} onChange={(e) => onChange({ ...step, next: e.target.value || undefined })}>
            <option value="">Wait for the lead</option>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Save typed answer to" hint="Then goes to the step above">
          <select className={inputCls} value={step.collect || ''} onChange={(e) => onChange({ ...step, collect: (e.target.value || undefined) as FlowStep['collect'] })}>
            <option value="">Nothing (expects a choice)</option>
            {Object.entries(FIELD_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Skip this step when the lead already has">
          <select className={inputCls} value={step.skipIfSet || ''} onChange={(e) => onChange({ ...step, skipIfSet: (e.target.value || undefined) as FlowStep['skipIfSet'] })}>
            <option value="">Never skip</option>
            {Object.entries(FIELD_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        {step.skipIfSet ? (
          <Field label="…and go to">
            <select className={inputCls} value={step.skipTo || ''} onChange={(e) => onChange({ ...step, skipTo: e.target.value || undefined })}>
              <option value="">Choose…</option>
              {others.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-700">
          <input type="checkbox" checked={Boolean(step.terminal)} onChange={(e) => onChange({ ...step, terminal: e.target.checked || undefined })} />
          Last step (typed questions go to the AI assistant)
        </label>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-gray-700">When the lead reaches this step</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {actions.map((a) => (
            <label key={a} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={Boolean(step.actions?.includes(a as never))}
                onChange={(e) => {
                  const set = new Set(step.actions || []);
                  if (e.target.checked) set.add(a as never);
                  else set.delete(a as never);
                  onChange({ ...step, actions: set.size ? (Array.from(set) as FlowStep['actions']) : undefined });
                }}
              />
              {ACTION_LABELS[a] || a}
            </label>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-gray-800">Messages</h4>
        <MessagesEditor messages={step.messages} steps={steps} media={media} onChange={(messages) => onChange({ ...step, messages })} />
      </div>

      <div>
        <h4 className="mb-1 text-sm font-semibold text-gray-800">Personalised versions ({step.variants?.length || 0})</h4>
        <p className="mb-2 text-xs text-gray-500">
          Sent instead of the messages above when the lead matches. The most specific match wins (business type and pain point beats one of them).
        </p>
        <div className="space-y-3">
          {(step.variants || []).map((v, i) => (
            <details key={i} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-gray-800">
                {[v.when.business_type && `Business: ${v.when.business_type}`, v.when.pain_point && `Pain point: ${v.when.pain_point}`].filter(Boolean).join(' + ') || 'Any lead'}
              </summary>
              <div className="mt-3 space-y-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <Field label="Business type">
                    <select
                      className={inputCls}
                      value={v.when.business_type || ''}
                      onChange={(e) => onChange({ ...step, variants: (step.variants || []).map((x, k) => (k === i ? { ...x, when: { ...x.when, business_type: e.target.value || undefined } } : x)) })}
                    >
                      <option value="">Any</option>
                      {BUSINESS_TYPE_OPTIONS.map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Pain point">
                    <select
                      className={inputCls}
                      value={v.when.pain_point || ''}
                      onChange={(e) => onChange({ ...step, variants: (step.variants || []).map((x, k) => (k === i ? { ...x, when: { ...x.when, pain_point: e.target.value || undefined } } : x)) })}
                    >
                      <option value="">Any</option>
                      {PAIN_POINT_OPTIONS.map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="flex items-end">
                    <button type="button" className={dangerBtnCls} onClick={() => onChange({ ...step, variants: (step.variants || []).filter((_, k) => k !== i) })}>
                      <Trash2 className="h-4 w-4" /> Remove version
                    </button>
                  </div>
                </div>
                <MessagesEditor
                  messages={v.messages}
                  steps={steps}
                  media={media}
                  onChange={(messages) => onChange({ ...step, variants: (step.variants || []).map((x, k) => (k === i ? { ...x, messages } : x)) })}
                />
              </div>
            </details>
          ))}
          <button
            type="button"
            className={btnCls}
            onClick={() => onChange({ ...step, variants: [...(step.variants || []), { when: {}, messages: clone(step.messages.length ? step.messages : [{ type: 'text', body: 'New message' }]) }] })}
          >
            <Plus className="h-4 w-4" /> Add personalised version
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-medium text-blue-900">Send test to my number</p>
        <p className="mb-2 text-xs text-blue-800">
          Sends this step from the saved draft with sample details. Save first. WhatsApp only delivers if your number messaged Khatario in the last 24 hours.
        </p>
        <div className="flex flex-wrap gap-2">
          <input className={`${inputCls} max-w-xs bg-white`} placeholder="91XXXXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button type="button" className={primaryBtnCls} disabled={testing || !phone} onClick={sendTest}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send test
          </button>
        </div>
        {testMsg ? <p className={`mt-2 text-sm ${testMsg.tone === 'ok' ? 'text-green-700' : 'text-red-700'}`}>{testMsg.text}</p> : null}
      </div>
    </div>
  );
}

function EntriesEditor({ flow, steps, onChange }: { flow: FlowDefinition; steps: StepRef[]; onChange: (f: FlowDefinition) => void }) {
  const setEntry = (i: number, e: FlowEntry) => onChange({ ...flow, entries: flow.entries.map((x, k) => (k === i ? e : x)) });
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Ad openings</h3>
        <p className="text-sm text-gray-600">
          Where a new chat starts. An entry is picked by the ad id (from the Ads tab or listed here), else by words in the lead&apos;s first message
          (the ad&apos;s prefilled text), else the default.
        </p>
      </div>
      {flow.entries.map((e, i) => {
        const [setField, setValue] = Object.entries(e.set || {})[0] || ['', ''];
        return (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Name">
                <input className={inputCls} value={e.label} onChange={(ev) => setEntry(i, { ...e, label: ev.target.value })} />
              </Field>
              <Field label="Entry id">
                <input className={inputCls} value={e.id} onChange={(ev) => setEntry(i, { ...e, id: ev.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
              </Field>
              <Field label="First step">
                <select className={inputCls} value={e.step} onChange={(ev) => setEntry(i, { ...e, step: ev.target.value })}>
                  {steps.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex items-end gap-3">
                <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
                  <input type="radio" name="defaultEntry" checked={flow.defaultEntry === e.id} onChange={() => onChange({ ...flow, defaultEntry: e.id })} />
                  Default
                </label>
                <button type="button" className={dangerBtnCls} disabled={flow.entries.length <= 1} onClick={() => onChange({ ...flow, entries: flow.entries.filter((_, k) => k !== i) })}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="lg:col-span-2">
                <ListInput label="Words in the first message" value={e.keywords} onChange={(v) => setEntry(i, { ...e, keywords: v.length ? v : undefined })} placeholder="gst billing, gst invoice" />
              </div>
              <ListInput label="Ad ids" value={e.adIds} onChange={(v) => setEntry(i, { ...e, adIds: v.length ? v : undefined })} hint="Or map ads in the Ads tab" />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Pre-set field">
                  <select className={inputCls} value={setField} onChange={(ev) => setEntry(i, { ...e, set: ev.target.value ? { [ev.target.value]: setValue || '' } : undefined })}>
                    <option value="">None</option>
                    <option value="pain_point">Pain point</option>
                    <option value="business_type">Business type</option>
                  </select>
                </Field>
                {setField ? (
                  <Field label="Value">
                    <select className={inputCls} value={setValue} onChange={(ev) => setEntry(i, { ...e, set: { [setField]: ev.target.value } })}>
                      <option value="">Choose…</option>
                      {(setField === 'pain_point' ? PAIN_POINT_OPTIONS : BUSINESS_TYPE_OPTIONS).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className={btnCls}
        onClick={() => onChange({ ...flow, entries: [...flow.entries, { id: `entry_${Date.now().toString(36)}`, label: 'New ad opening', step: steps[0]?.id || '' }] })}
      >
        <Plus className="h-4 w-4" /> Add ad opening
      </button>
    </div>
  );
}

function FollowupEditor({
  f,
  steps,
  media,
  options,
  onChange,
  onDelete,
}: {
  f: FlowFollowup;
  steps: StepRef[];
  media: MediaInfo[];
  options: FlowResponse['options'];
  onChange: (f: FlowFollowup) => void;
  onDelete: () => void;
}) {
  const header = Object.entries(f.headerMediaByPainPoint || {});
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{f.label}</h3>
          <p className="text-xs text-gray-500">Follow-up id: {f.kind} · sent at most once per lead</p>
        </div>
        <button type="button" className={dangerBtnCls} onClick={onDelete}>
          <Trash2 className="h-4 w-4" /> Delete
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name">
          <input className={inputCls} value={f.label} onChange={(e) => onChange({ ...f, label: e.target.value })} />
        </Field>
        <Field label="Starts counting">
          <select className={inputCls} value={f.anchor} onChange={(e) => onChange({ ...f, anchor: e.target.value as FlowFollowup['anchor'] })}>
            {options.anchors.map((a) => (
              <option key={a} value={a}>
                {ANCHOR_LABELS[a] || a}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Wait (minutes)" hint={delayLabel(f.delayMinutes)}>
          <input type="number" min={1} className={inputCls} value={f.delayMinutes} onChange={(e) => onChange({ ...f, delayMinutes: Math.max(1, Number(e.target.value) || 1) })} />
        </Field>
        <Field label="Only send if">
          <select className={inputCls} value={f.condition} onChange={(e) => onChange({ ...f, condition: e.target.value as FlowFollowup['condition'] })}>
            {options.conditions.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c] || c}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-700">
          <input type="checkbox" checked={f.enabled} onChange={(e) => onChange({ ...f, enabled: e.target.checked })} />
          Enabled
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-700">
          <input type="checkbox" checked={Boolean(f.repeatCurrentStep)} onChange={(e) => onChange({ ...f, repeatCurrentStep: e.target.checked || undefined })} />
          Repeat the question the lead is on
        </label>
      </div>

      <div>
        <h4 className="mb-1 text-sm font-semibold text-gray-800">Inside the 24-hour window: normal messages</h4>
        <MessagesEditor max={4} messages={f.messages || []} steps={steps} media={media} onChange={(messages) => onChange({ ...f, messages: messages.length ? messages : undefined })} />
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <h4 className="mb-1 text-sm font-semibold text-gray-800">Outside the window: approved template</h4>
        <p className="mb-3 text-xs text-gray-500">WhatsApp only allows approved templates once 24 hours pass since the lead&apos;s last message. Manage them in the Templates tab.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Template">
            <select className={inputCls} value={f.templateEventKey || ''} onChange={(e) => onChange({ ...f, templateEventKey: e.target.value || undefined })}>
              <option value="">None (skip when outside the window)</option>
              {options.templateEventKeys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <ListInput label="Template variables ({{1}}, {{2}}…)" value={f.templateVars} onChange={(v) => onChange({ ...f, templateVars: v.length ? v : undefined })} hint="Usually first_name" />
        </div>
        {f.templateEventKey ? (
          <div className="mt-3">
            <p className="mb-2 text-xs font-medium text-gray-700">Header image by pain point (image-header templates)</p>
            {header.map(([pp, key], i) => (
              <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <select
                  className={inputCls}
                  value={pp}
                  onChange={(e) => {
                    const next = Object.fromEntries(header.map(([p, k], j) => (j === i ? [e.target.value, k] : [p, k])));
                    onChange({ ...f, headerMediaByPainPoint: next });
                  }}
                >
                  {PAIN_POINT_OPTIONS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
                <select
                  className={inputCls}
                  value={key}
                  onChange={(e) => onChange({ ...f, headerMediaByPainPoint: { ...(f.headerMediaByPainPoint || {}), [pp]: e.target.value } })}
                >
                  {media.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label} ({m.kind})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={btnCls}
                  onClick={() => {
                    const next = Object.fromEntries(header.filter((_, j) => j !== i));
                    onChange({ ...f, headerMediaByPainPoint: Object.keys(next).length ? next : undefined });
                  }}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className={btnCls}
              onClick={() => {
                const free = PAIN_POINT_OPTIONS.find(([k]) => !(f.headerMediaByPainPoint || {})[k]);
                if (free) onChange({ ...f, headerMediaByPainPoint: { ...(f.headerMediaByPainPoint || {}), [free[0]]: media[0]?.key || '' } });
              }}
            >
              <Plus className="h-4 w-4" /> Add header image rule
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SettingsEditor({ flow, onChange }: { flow: FlowDefinition; onChange: (f: FlowDefinition) => void }) {
  const s = flow.settings;
  const set = (patch: Partial<FlowDefinition['settings']>) => onChange({ ...flow, settings: { ...s, ...patch } });
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">Settings and sales contact</h3>
      <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-800">
        <input type="checkbox" checked={s.funnelEnabled} onChange={(e) => set({ funnelEnabled: e.target.checked })} />
        <span>
          <span className="font-medium">Sales flow on.</span> When off, prospects on WhatsApp only get the AI assistant.
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Notify sales on WhatsApp" hint="Gets a message on every handover (optional)">
          <input className={inputCls} value={s.salesNotifyPhone || ''} placeholder="91XXXXXXXXXX" onChange={(e) => set({ salesNotifyPhone: e.target.value || undefined })} />
        </Field>
        <Field label="Notify sales by email" hint="Optional; admins always get an in-app alert">
          <input className={inputCls} value={s.salesNotifyEmail || ''} placeholder="sales@khatario.com" onChange={(e) => set({ salesNotifyEmail: e.target.value || undefined })} />
        </Field>
        <Field label="Reply when the lead sends STOP">
          <textarea className={inputCls} rows={2} value={s.optOutReply} onChange={(e) => set({ optOutReply: e.target.value })} />
        </Field>
        <Field label="Reply when the lead sends START">
          <textarea className={inputCls} rows={2} value={s.optInReply} onChange={(e) => set({ optInReply: e.target.value })} />
        </Field>
        <Field label="When the bot does not understand">
          <textarea className={inputCls} rows={2} value={s.notUnderstood} onChange={(e) => set({ notUnderstood: e.target.value })} />
        </Field>
        <Field label="Re-ask the question at most" hint="Then the assistant answers and the bot waits">
          <input type="number" min={0} max={5} className={inputCls} value={s.maxReasks} onChange={(e) => set({ maxReasks: Math.min(5, Math.max(0, Number(e.target.value) || 0)) })} />
        </Field>
        <ListInput label="Opt-out words" value={s.stopKeywords} onChange={(v) => set({ stopKeywords: v })} />
        <ListInput label="Opt-in words" value={s.startKeywords} onChange={(v) => set({ startKeywords: v })} />
        <ListInput label="Talk-to-a-person words" value={s.helpKeywords} onChange={(v) => set({ helpKeywords: v })} />
        <ListInput label="Start-over words" value={s.restartKeywords} onChange={(v) => set({ restartKeywords: v })} />
      </div>
    </div>
  );
}

export function FlowTab({ canEdit }: { canEdit: boolean }) {
  const { data, error, loading, reload } = useJson<FlowResponse>('/api/admin/sales-flow/flow');
  const [flow, setFlow] = useState<FlowDefinition | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<Selection>({ kind: 'step', id: '' });
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string; errors?: string[] } | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!data) return;
    setFlow(clone(data.draft.flow));
    setDirty(false);
    setSel((s) => (s.kind === 'step' && !s.id ? { kind: 'step', id: data.draft.flow.steps[0]?.id || '' } : s));
  }, [data]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const steps: StepRef[] = useMemo(() => (flow?.steps || []).map((s) => ({ id: s.id, label: s.label })), [flow]);

  if (!data || !flow) return <State loading={loading} error={error} />;

  const update = (f: FlowDefinition) => {
    setFlow(f);
    setDirty(true);
  };

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setMsg(null);
    try {
      const text = await fn();
      setMsg({ tone: 'ok', text });
    } catch (err) {
      const e = err as Error & { errors?: string[] };
      setMsg({ tone: 'error', text: e.message, errors: e.errors });
    } finally {
      setBusy('');
    }
  };

  const save = () =>
    run('save', async () => {
      await sendJson('/api/admin/sales-flow/flow', 'PUT', { flow });
      setDirty(false);
      await reload();
      return 'Draft saved. Live chats still use the published version until you publish.';
    });

  const publish = () =>
    run('publish', async () => {
      if (dirty) await sendJson('/api/admin/sales-flow/flow', 'PUT', { flow });
      const r = await sendJson<{ version: number }>('/api/admin/sales-flow/flow', 'POST', { action: 'publish', note });
      setNote('');
      setDirty(false);
      await reload();
      return `Version ${r.version} is live. New messages follow it within 30 seconds.`;
    });

  const action = (label: string, body: Record<string, unknown>, done: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    void run(label, async () => {
      await sendJson('/api/admin/sales-flow/flow', 'POST', body);
      setDirty(false);
      await reload();
      return done;
    });
  };

  const addStep = () => {
    const id = `step_${Date.now().toString(36)}`;
    update({ ...flow, steps: [...flow.steps, { id, label: 'New step', messages: [{ type: 'text', body: 'New message' }] }] });
    setSel({ kind: 'step', id });
  };

  const addFollowup = () => {
    const kind = `followup_${Date.now().toString(36)}`;
    update({
      ...flow,
      followups: [...flow.followups, { kind, label: 'New follow-up', enabled: false, anchor: 'awaiting_reply', delayMinutes: 60, condition: 'no_reply', messages: [{ type: 'text', body: 'Just checking in. Any questions?' }] }],
    });
    setSel({ kind: 'followup', kind_: kind });
  };

  const selectedStep = sel.kind === 'step' ? flow.steps.find((s) => s.id === sel.id) : undefined;
  const selectedFollowup = sel.kind === 'followup' ? flow.followups.find((f) => f.kind === sel.kind_) : undefined;
  const navBtn = (active: boolean) =>
    `w-full rounded-lg px-3 py-2 text-left text-sm transition ${active ? 'bg-primary-50 font-medium text-primary-700' : 'text-gray-700 hover:bg-gray-100'}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="text-sm text-gray-700">
          <span className="font-medium">Editing draft v{data.draft.version}</span>
          <span className="mx-2 text-gray-300">|</span>
          Live: <Badge tone="green">v{data.published.version}</Badge>
          {dirty ? <span className="ml-3 font-medium text-amber-600">Unsaved changes</span> : <span className="ml-3 text-gray-500">Saved {when(data.draft.updated_at)}</span>}
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btnCls} disabled={Boolean(busy) || !dirty} onClick={save}>
              {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft
            </button>
            <input className={`${inputCls} w-48`} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="button" className={primaryBtnCls} disabled={Boolean(busy)} onClick={publish}>
              {busy === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Publish
            </button>
            <button
              type="button"
              className={btnCls}
              disabled={Boolean(busy)}
              onClick={() => action('discard', { action: 'discard' }, 'Draft discarded; showing the live version.', 'Discard all draft changes?')}
            >
              <RotateCcw className="h-4 w-4" /> Discard draft
            </button>
          </div>
        ) : (
          <span className="text-sm text-gray-500">View only (admin role needed to edit)</span>
        )}
      </div>

      {msg ? (
        <Notice tone={msg.tone === 'ok' ? 'ok' : 'error'}>
          <p className="font-medium">{msg.text}</p>
          {msg.errors?.length ? (
            <ul className="mt-1 list-disc pl-5">
              {msg.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}
      {!msg && data.draft.errors.length ? (
        <Notice tone="warn">
          <p className="font-medium">The saved draft has problems and cannot be published yet:</p>
          <ul className="mt-1 list-disc pl-5">
            {data.draft.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-4 rounded-xl border border-gray-200 bg-white p-3 shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <div>
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Steps</p>
            {flow.steps.map((s) => {
              const isEntry = flow.entries.some((e) => e.step === s.id);
              return (
                <button key={s.id} type="button" className={navBtn(sel.kind === 'step' && sel.id === s.id)} onClick={() => setSel({ kind: 'step', id: s.id })}>
                  <span className="block truncate">{s.label}</span>
                  <span className="flex flex-wrap gap-1 pt-0.5">
                    {isEntry ? <Badge tone="blue">opening</Badge> : null}
                    {s.actions?.includes('handoff_to_sales') ? <Badge tone="amber">handover</Badge> : null}
                    {s.collect ? <Badge>asks {FIELD_LABELS[s.collect]?.toLowerCase()}</Badge> : null}
                    {s.variants?.length ? <Badge tone="purple">{s.variants.length} versions</Badge> : null}
                  </span>
                </button>
              );
            })}
            {canEdit ? (
              <button type="button" className={`${btnCls} mt-2 w-full justify-center`} onClick={addStep}>
                <Plus className="h-4 w-4" /> Add step
              </button>
            ) : null}
          </div>
          <div>
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Start</p>
            <button type="button" className={navBtn(sel.kind === 'entries')} onClick={() => setSel({ kind: 'entries' })}>
              Ad openings ({flow.entries.length})
            </button>
          </div>
          <div>
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Follow-ups</p>
            {flow.followups.map((f) => (
              <button key={f.kind} type="button" className={navBtn(sel.kind === 'followup' && sel.kind_ === f.kind)} onClick={() => setSel({ kind: 'followup', kind_: f.kind })}>
                <span className="block truncate">{f.label}</span>
                <span className="flex gap-1 pt-0.5">
                  <Badge tone={f.enabled ? 'green' : 'gray'}>{f.enabled ? delayLabel(f.delayMinutes) : 'off'}</Badge>
                  {f.templateEventKey ? <Badge tone="blue">template</Badge> : null}
                </span>
              </button>
            ))}
            {canEdit ? (
              <button type="button" className={`${btnCls} mt-2 w-full justify-center`} onClick={addFollowup}>
                <Plus className="h-4 w-4" /> Add follow-up
              </button>
            ) : null}
          </div>
          <div>
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">More</p>
            <button type="button" className={navBtn(sel.kind === 'settings')} onClick={() => setSel({ kind: 'settings' })}>
              Settings and sales contact
            </button>
            <button type="button" className={navBtn(sel.kind === 'versions')} onClick={() => setSel({ kind: 'versions' })}>
              Versions ({data.versions.length})
            </button>
          </div>
        </aside>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          {selectedStep ? (
            <StepEditor
              key={selectedStep.id}
              step={selectedStep}
              steps={steps}
              media={data.media}
              actions={data.options.actions}
              onChange={(s) => update({ ...flow, steps: flow.steps.map((x) => (x.id === selectedStep.id ? s : x)) })}
              onDelete={() => {
                const used = flow.entries.some((e) => e.step === selectedStep.id) || flow.steps.some((s) => s.next === selectedStep.id || s.skipTo === selectedStep.id);
                if (!window.confirm(used ? 'Other steps or openings point to this step. Delete anyway? Saving will show what to fix.' : 'Delete this step?')) return;
                update({ ...flow, steps: flow.steps.filter((x) => x.id !== selectedStep.id) });
                setSel({ kind: 'step', id: flow.steps[0]?.id || '' });
              }}
            />
          ) : null}
          {sel.kind === 'entries' ? <EntriesEditor flow={flow} steps={steps} onChange={update} /> : null}
          {selectedFollowup ? (
            <FollowupEditor
              key={selectedFollowup.kind}
              f={selectedFollowup}
              steps={steps}
              media={data.media}
              options={data.options}
              onChange={(f) => update({ ...flow, followups: flow.followups.map((x) => (x.kind === selectedFollowup.kind ? f : x)) })}
              onDelete={() => {
                if (!window.confirm('Delete this follow-up?')) return;
                update({ ...flow, followups: flow.followups.filter((x) => x.kind !== selectedFollowup.kind) });
                setSel({ kind: 'settings' });
              }}
            />
          ) : null}
          {sel.kind === 'settings' ? <SettingsEditor flow={flow} onChange={update} /> : null}
          {sel.kind === 'versions' ? (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-gray-900">Versions</h3>
              <p className="text-sm text-gray-600">Restoring copies a version into the draft; review it, then publish.</p>
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {data.versions.map((v) => (
                  <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <span>
                      <span className="font-medium">v{v.version}</span>{' '}
                      <Badge tone={v.status === 'published' ? 'green' : v.status === 'draft' ? 'amber' : 'gray'}>{v.status}</Badge>
                      {v.note ? <span className="ml-2 text-gray-600">{v.note}</span> : null}
                      <span className="ml-2 text-xs text-gray-400">{when(v.published_at || v.updated_at)}</span>
                    </span>
                    {canEdit && v.status !== 'draft' ? (
                      <button
                        type="button"
                        className={btnCls}
                        disabled={Boolean(busy)}
                        onClick={() => action('restore', { action: 'restore', version: v.version }, `v${v.version} copied into the draft.`, `Replace the draft with v${v.version}?`)}
                      >
                        <RotateCcw className="h-4 w-4" /> Restore
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {canEdit ? (
                <button
                  type="button"
                  className={btnCls}
                  disabled={Boolean(busy)}
                  onClick={() => action('reset', { action: 'reset_default' }, 'Draft reset to the built-in default flow.', 'Replace the draft with the built-in default flow?')}
                >
                  <CheckCircle2 className="h-4 w-4" /> Reset draft to built-in default
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
