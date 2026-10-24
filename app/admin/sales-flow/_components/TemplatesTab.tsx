'use client';

import { useState } from 'react';
import { Loader2, RefreshCw, Send, Sparkles } from 'lucide-react';
import type { MediaInfo } from './MessagesEditor';
import { Badge, btnCls, Field, inputCls, Notice, primaryBtnCls, Row, sendJson, State, useJson, useStoredPhone } from './shared';

type TemplatesResponse = { templates: Row[]; purposes: Record<string, string>; missing: string[] };

function statusTone(s: string) {
  if (s === 'approved') return 'green' as const;
  if (s === 'rejected') return 'red' as const;
  if (s === 'pending') return 'amber' as const;
  return 'gray' as const;
}

function quickReplies(buttons: unknown): string[] {
  return Array.isArray(buttons) ? buttons.map((b) => String((b as { text?: string })?.text || '')).filter(Boolean) : [];
}

function TemplateCard({ t, purpose, media, canEdit, onChanged }: { t: Row; purpose?: string; media: MediaInfo[]; canEdit: boolean; onChanged: (msg: string) => void }) {
  const editable = t.status === 'draft' || t.status === 'rejected';
  const [body, setBody] = useState<string>(t.body_text);
  const [footer, setFooter] = useState<string>(t.footer_text || '');
  const [headerFormat, setHeaderFormat] = useState<string>(t.header_format || 'none');
  const [headerKey, setHeaderKey] = useState<string>(t.header_media_key || '');
  const [replies, setReplies] = useState<string>(quickReplies(t.buttons).join(', '));
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [phone, setPhone] = useStoredPhone();
  const changed =
    body !== t.body_text ||
    footer !== (t.footer_text || '') ||
    headerFormat !== (t.header_format || 'none') ||
    headerKey !== (t.header_media_key || '') ||
    replies !== quickReplies(t.buttons).join(', ');

  const call = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setErr('');
    try {
      onChanged(await fn());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy('');
    }
  };

  const save = () =>
    call('save', async () => {
      await sendJson(`/api/admin/sales-flow/templates/${t.id}`, 'PATCH', {
        body_text: body,
        footer_text: footer || null,
        header_format: headerFormat,
        header_media_key: headerFormat === 'image' || headerFormat === 'video' ? headerKey || null : null,
        quick_replies: replies.split(',').map((s) => s.trim()).filter(Boolean),
      });
      return `Saved ${t.name}.`;
    });

  const submit = () =>
    call('submit', async () => {
      if (changed) await save();
      await sendJson(`/api/admin/sales-flow/templates/${t.id}`, 'POST', { action: 'submit' });
      return `${t.name} sent to Meta for approval. Approval usually takes minutes to a day.`;
    });

  const test = () =>
    call('test', async () => {
      await sendJson(`/api/admin/sales-flow/templates/${t.id}`, 'POST', { action: 'test', phone });
      return `Test of ${t.name} sent.`;
    });

  const headerMedia = media.find((m) => m.key === headerKey);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-900">{t.name}</p>
          <p className="text-xs text-gray-500">
            {t.event_key} · {t.category} · {t.language}
          </p>
          {purpose ? <p className="mt-1 text-sm text-gray-600">{purpose}</p> : null}
        </div>
        <Badge tone={statusTone(t.status)}>{t.status}</Badge>
      </div>
      {t.status === 'rejected' && t.rejected_reason ? (
        <div className="mb-3">
          <Notice tone="error">Meta rejected this template: {t.rejected_reason}. Edit it and submit again.</Notice>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Header">
              <select className={inputCls} disabled={!editable || !canEdit} value={headerFormat} onChange={(e) => setHeaderFormat(e.target.value)}>
                <option value="none">None</option>
                <option value="image">Image</option>
                <option value="video">Video</option>
              </select>
            </Field>
            {headerFormat === 'image' || headerFormat === 'video' ? (
              <Field label="Header media" hint="Sample sent to Meta; per-lead images come from the follow-up settings">
                <select className={inputCls} disabled={!editable || !canEdit} value={headerKey} onChange={(e) => setHeaderKey(e.target.value)}>
                  <option value="">Choose…</option>
                  {media
                    .filter((m) => m.kind === headerFormat)
                    .map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label} ({m.key})
                      </option>
                    ))}
                </select>
              </Field>
            ) : null}
          </div>
          <Field label="Body ({{1}} is the lead's first name)">
            <textarea className={inputCls} rows={6} disabled={!editable || !canEdit} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Footer">
              <input className={inputCls} disabled={!editable || !canEdit} value={footer} onChange={(e) => setFooter(e.target.value)} />
            </Field>
            <Field label="Quick-reply buttons" hint="Comma separated; match flow button titles so taps continue the flow">
              <input className={inputCls} disabled={!editable || !canEdit} value={replies} onChange={(e) => setReplies(e.target.value)} />
            </Field>
          </div>
        </div>
        <div className="rounded-xl bg-[#e5ddd5] p-3">
          <div className="rounded-lg bg-white p-2 text-sm shadow">
            {headerFormat === 'image' && headerMedia ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={headerMedia.previewUrl} alt="" className="mb-2 max-h-32 w-full rounded object-cover" />
            ) : headerFormat !== 'none' ? (
              <div className="mb-2 flex h-20 items-center justify-center rounded bg-gray-100 text-xs text-gray-500">{headerFormat} header</div>
            ) : null}
            <p className="whitespace-pre-wrap text-gray-800">{body.replace('{{1}}', 'Ramesh')}</p>
            {footer ? <p className="mt-1 text-xs text-gray-400">{footer}</p> : null}
          </div>
          {replies
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((r) => (
              <div key={r} className="mt-1 rounded-lg bg-white py-1.5 text-center text-sm font-medium text-sky-600 shadow">
                {r}
              </div>
            ))}
        </div>
      </div>

      {err ? <p className="mt-3 text-sm text-red-600">{err}</p> : null}
      {canEdit ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {editable ? (
            <>
              <button type="button" className={btnCls} disabled={Boolean(busy) || !changed} onClick={save}>
                {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
              </button>
              <button type="button" className={primaryBtnCls} disabled={Boolean(busy)} onClick={submit}>
                {busy === 'submit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit to Meta
              </button>
            </>
          ) : null}
          {t.status === 'approved' ? (
            <>
              <input className={`${inputCls} max-w-[180px]`} placeholder="91XXXXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <button type="button" className={btnCls} disabled={Boolean(busy) || !phone} onClick={test}>
                {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send test
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function TemplatesTab({ canEdit }: { canEdit: boolean }) {
  const { data, error, loading, reload } = useJson<TemplatesResponse>('/api/admin/sales-flow/templates');
  const mediaRes = useJson<{ media: MediaInfo[] }>('/api/admin/sales-flow/media');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  if (!data) return <State loading={loading} error={error} />;

  const action = async (name: 'seed' | 'sync') => {
    setBusy(name);
    setMsg(null);
    try {
      const r = await sendJson<{ created?: string[]; skipped?: string[] }>('/api/admin/sales-flow/templates', 'POST', { action: name });
      setMsg({ tone: 'ok', text: name === 'seed' ? `Created ${r.created?.length || 0} draft template(s).` : 'Statuses refreshed from Meta.' });
      await reload();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : 'Failed' });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-4">
      <Notice tone="info">
        Follow-ups more than 24 hours after a lead&apos;s last message can only use templates approved by Meta. Image headers use the screenshots from the
        Media tab; Meta needs a sample of the image when you submit.
      </Notice>
      <div className="flex flex-wrap gap-2">
        {canEdit && data.missing.length ? (
          <button type="button" className={primaryBtnCls} disabled={Boolean(busy)} onClick={() => action('seed')}>
            {busy === 'seed' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Create {data.missing.length} starter template(s)
          </button>
        ) : null}
        {canEdit ? (
          <button type="button" className={btnCls} disabled={Boolean(busy)} onClick={() => action('sync')}>
            {busy === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh statuses from Meta
          </button>
        ) : null}
      </div>
      {msg ? <Notice tone={msg.tone === 'ok' ? 'ok' : 'error'}>{msg.text}</Notice> : null}
      {data.templates.length === 0 ? <p className="text-sm text-gray-500">No funnel templates yet. Create the starter templates to begin.</p> : null}
      <div className="space-y-4">
        {data.templates.map((t) => (
          <TemplateCard
            key={`${t.id}-${t.updated_at}`}
            t={t}
            purpose={data.purposes[t.event_key]}
            media={mediaRes.data?.media || []}
            canEdit={canEdit}
            onChanged={(text) => {
              setMsg({ tone: 'ok', text });
              void reload();
            }}
          />
        ))}
      </div>
    </div>
  );
}
