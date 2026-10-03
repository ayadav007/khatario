'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { FlowMessage, FlowOption } from '@/lib/sales-funnel/definition';
import { btnCls, Field, inputCls, LIMITS, LimitedInput, ListInput } from './shared';

export type MediaInfo = { key: string; kind: 'image' | 'video'; label: string; uploaded: boolean; builtin: boolean; previewUrl: string };
export type StepRef = { id: string; label: string };

const LEAD_FIELD_LABELS: Record<string, string> = {
  business_type: 'Business type',
  pain_point: 'Pain point',
  business_name: 'Business name',
  owner_name: 'Owner name',
  city: 'City',
};

export const VARIABLES_HINT =
  'Variables: {{first_name}}, {{name_suffix}} (" Ramesh" or empty), {{owner_name}}, {{business_name}}, {{business_type_label}}, {{pain_point_label}}, {{app_link}}, {{signup_link}}';

function move<T>(arr: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const copy = [...arr];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

function MediaSelect({ value, kind, media, onChange, allowEmpty }: { value?: string; kind: 'image' | 'video'; media: MediaInfo[]; onChange: (v: string | undefined) => void; allowEmpty?: boolean }) {
  const list = media.filter((m) => m.kind === kind);
  const missing = value && !media.some((m) => m.key === value);
  return (
    <select className={inputCls} value={value || ''} onChange={(e) => onChange(e.target.value || undefined)}>
      {allowEmpty ? <option value="">None</option> : <option value="">Choose…</option>}
      {list.map((m) => (
        <option key={m.key} value={m.key}>
          {m.label} ({m.key}){m.kind === 'video' && !m.uploaded ? ' – not uploaded' : ''}
        </option>
      ))}
      {missing ? <option value={value}>{value} (not uploaded yet)</option> : null}
    </select>
  );
}

function OptionsEditor({
  options,
  isList,
  steps,
  onChange,
}: {
  options: FlowOption[];
  isList: boolean;
  steps: StepRef[];
  onChange: (o: FlowOption[]) => void;
}) {
  const max = isList ? LIMITS.listRowsMax : LIMITS.buttonsMax;
  const titleMax = isList ? LIMITS.listRowTitle : LIMITS.buttonTitle;
  const set = (i: number, patch: Partial<FlowOption>) => onChange(options.map((o, k) => (k === i ? { ...o, ...patch } : o)));
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-700">
        {isList ? 'List rows' : 'Buttons'} ({options.length}/{max})
      </p>
      {options.map((o, i) => {
        const [setField, setValue] = Object.entries(o.set || {})[0] || ['', ''];
        return (
          <div key={i} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <LimitedInput label="Title" value={o.title} max={titleMax} onChange={(v) => set(i, { title: v })} />
              <Field label="Option id" hint="Unique in the whole flow">
                <input className={inputCls} value={o.id} onChange={(e) => set(i, { id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
              </Field>
              <Field label="Then go to">
                <select className={inputCls} value={o.next || ''} onChange={(e) => set(i, { next: e.target.value || undefined })}>
                  <option value="">Stay (no step)</option>
                  {steps.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} ({s.id})
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex items-end gap-1">
                <button type="button" className={btnCls} onClick={() => onChange(move(options, i, -1))} title="Move up">
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button type="button" className={btnCls} onClick={() => onChange(move(options, i, 1))} title="Move down">
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button type="button" className={btnCls} onClick={() => onChange(options.filter((_, k) => k !== i))} title="Remove">
                  <Trash2 className="h-4 w-4 text-red-500" />
                </button>
              </div>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {isList ? (
                <LimitedInput label="Description" value={o.description} max={LIMITS.listRowDescription} onChange={(v) => set(i, { description: v || undefined })} />
              ) : null}
              <Field label="Save to lead">
                <select
                  className={inputCls}
                  value={setField}
                  onChange={(e) => set(i, { set: e.target.value ? { [e.target.value]: setValue || '' } : undefined })}
                >
                  <option value="">Nothing</option>
                  {Object.entries(LEAD_FIELD_LABELS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              {setField ? (
                <Field label="Value saved">
                  <input className={inputCls} value={setValue} onChange={(e) => set(i, { set: { [setField]: e.target.value } })} />
                </Field>
              ) : null}
              <div className={isList ? '' : 'lg:col-span-2'}>
                <ListInput label="Typed words that pick it" value={o.keywords} onChange={(v) => set(i, { keywords: v.length ? v : undefined })} placeholder="demo, video" />
              </div>
            </div>
          </div>
        );
      })}
      {options.length < max ? (
        <button
          type="button"
          className={btnCls}
          onClick={() => onChange([...options, { id: `opt_${Date.now().toString(36)}`, title: 'New option' }])}
        >
          <Plus className="h-4 w-4" /> Add {isList ? 'row' : 'button'}
        </button>
      ) : null}
    </div>
  );
}

function blank(type: FlowMessage['type']): FlowMessage {
  switch (type) {
    case 'text':
      return { type, body: 'New message' };
    case 'buttons':
      return { type, body: 'Choose one', options: [{ id: `opt_${Date.now().toString(36)}`, title: 'Option 1' }] };
    case 'list':
      return { type, body: 'Choose one', buttonText: 'Choose', options: [{ id: `opt_${Date.now().toString(36)}`, title: 'Option 1' }] };
    case 'image':
      return { type, mediaKey: '' };
    case 'video':
      return { type, mediaKey: 'demo_video' };
  }
}

const TYPE_LABEL: Record<FlowMessage['type'], string> = {
  text: 'Text',
  buttons: 'Buttons (up to 3)',
  list: 'List (up to 10)',
  image: 'Image',
  video: 'Video',
};

export function MessagesEditor({
  messages,
  steps,
  media,
  onChange,
  max = 6,
}: {
  messages: FlowMessage[];
  steps: StepRef[];
  media: MediaInfo[];
  onChange: (m: FlowMessage[]) => void;
  max?: number;
}) {
  const set = (i: number, m: FlowMessage) => onChange(messages.map((x, k) => (k === i ? m : x)));
  return (
    <div className="space-y-3">
      {messages.map((m, i) => (
        <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800">
              {i + 1}. {TYPE_LABEL[m.type]}
            </span>
            <div className="flex gap-1">
              <button type="button" className={btnCls} onClick={() => onChange(move(messages, i, -1))} title="Move up">
                <ArrowUp className="h-4 w-4" />
              </button>
              <button type="button" className={btnCls} onClick={() => onChange(move(messages, i, 1))} title="Move down">
                <ArrowDown className="h-4 w-4" />
              </button>
              <button type="button" className={btnCls} onClick={() => onChange(messages.filter((_, k) => k !== i))} title="Remove message">
                <Trash2 className="h-4 w-4 text-red-500" />
              </button>
            </div>
          </div>

          {m.type === 'text' ? (
            <LimitedInput label="Message" multiline rows={5} value={m.body} max={LIMITS.text} onChange={(v) => set(i, { ...m, body: v })} />
          ) : null}

          {m.type === 'buttons' || m.type === 'list' ? (
            <div className="space-y-3">
              <LimitedInput label="Message" multiline rows={5} value={m.body} max={LIMITS.interactiveBody} onChange={(v) => set(i, { ...m, body: v })} />
              <div className="grid gap-2 sm:grid-cols-3">
                <LimitedInput label="Header (optional)" value={m.headerText} max={LIMITS.headerText} onChange={(v) => set(i, { ...m, headerText: v || undefined })} />
                <LimitedInput label="Footer (optional)" value={m.footer} max={LIMITS.footer} onChange={(v) => set(i, { ...m, footer: v || undefined })} />
                {m.type === 'list' ? (
                  <LimitedInput label="List button" value={m.buttonText} max={LIMITS.listButton} onChange={(v) => set(i, { ...m, buttonText: v })} />
                ) : (
                  <Field label="Header image (optional)" hint="Replaces the text header">
                    <MediaSelect allowEmpty kind="image" media={media} value={m.headerMediaKey} onChange={(v) => set(i, { ...m, headerMediaKey: v })} />
                  </Field>
                )}
              </div>
              <OptionsEditor
                options={m.options}
                isList={m.type === 'list'}
                steps={steps}
                onChange={(options) => set(i, { ...m, options } as FlowMessage)}
              />
            </div>
          ) : null}

          {m.type === 'image' ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Image">
                <MediaSelect kind="image" media={media} value={m.mediaKey} onChange={(v) => set(i, { ...m, mediaKey: v || '' })} />
              </Field>
              <LimitedInput label="Caption (optional)" multiline value={m.caption} max={LIMITS.caption} onChange={(v) => set(i, { ...m, caption: v || undefined })} />
            </div>
          ) : null}

          {m.type === 'video' ? (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Video" hint="Upload the demo video in the Media tab (MP4)">
                  <MediaSelect kind="video" media={media} value={m.mediaKey} onChange={(v) => set(i, { ...m, mediaKey: v || '' })} />
                </Field>
                <LimitedInput label="Caption (optional)" multiline value={m.caption} max={LIMITS.caption} onChange={(v) => set(i, { ...m, caption: v || undefined })} />
              </div>
              <div className="rounded-lg border border-dashed border-gray-300 p-3">
                <p className="mb-2 text-xs font-medium text-gray-700">Sent instead while the video is not uploaded</p>
                {(m.fallback || []).map((f, k) => (
                  <div key={k} className="mb-2 grid gap-2 sm:grid-cols-[120px_1fr_1fr_auto]">
                    <select
                      className={inputCls}
                      value={f.type}
                      onChange={(e) => set(i, { ...m, fallback: (m.fallback || []).map((x, j) => (j === k ? { ...x, type: e.target.value as 'text' | 'image' } : x)) })}
                    >
                      <option value="text">Text</option>
                      <option value="image">Image</option>
                    </select>
                    {f.type === 'image' ? (
                      <MediaSelect kind="image" media={media} value={f.mediaKey} onChange={(v) => set(i, { ...m, fallback: (m.fallback || []).map((x, j) => (j === k ? { ...x, mediaKey: v } : x)) })} />
                    ) : (
                      <input className={inputCls} value={f.body || ''} placeholder="Text" onChange={(e) => set(i, { ...m, fallback: (m.fallback || []).map((x, j) => (j === k ? { ...x, body: e.target.value } : x)) })} />
                    )}
                    <input
                      className={inputCls}
                      value={f.caption || ''}
                      placeholder="Caption"
                      disabled={f.type !== 'image'}
                      onChange={(e) => set(i, { ...m, fallback: (m.fallback || []).map((x, j) => (j === k ? { ...x, caption: e.target.value } : x)) })}
                    />
                    <button type="button" className={btnCls} onClick={() => set(i, { ...m, fallback: (m.fallback || []).filter((_, j) => j !== k) })}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </button>
                  </div>
                ))}
                {(m.fallback || []).length < 5 ? (
                  <button type="button" className={btnCls} onClick={() => set(i, { ...m, fallback: [...(m.fallback || []), { type: 'image', mediaKey: '' }] })}>
                    <Plus className="h-4 w-4" /> Add fallback item
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ))}
      {messages.length < max ? (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TYPE_LABEL) as FlowMessage['type'][]).map((t) => (
            <button key={t} type="button" className={btnCls} onClick={() => onChange([...messages, blank(t)])}>
              <Plus className="h-4 w-4" /> {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      ) : null}
      <p className="text-xs text-gray-500">{VARIABLES_HINT}</p>
    </div>
  );
}
