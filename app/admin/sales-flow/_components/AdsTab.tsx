'use client';

import { useState } from 'react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { btnCls, dangerBtnCls, Field, inputCls, Notice, primaryBtnCls, Row, sendJson, State, Table, useJson, when } from './shared';

type AdsResponse = { mappings: Row[]; unmapped: Row[]; entries: Array<{ id: string; label: string }> };
type Form = { ad_id: string; campaign_id: string; campaign_name: string; ad_name: string; entry_key: string };

const EMPTY: Form = { ad_id: '', campaign_id: '', campaign_name: '', ad_name: '', entry_key: '' };

export function AdsTab({ canEdit }: { canEdit: boolean }) {
  const { data, error, loading, reload } = useJson<AdsResponse>('/api/admin/sales-flow/ads');
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  if (!data) return <State loading={loading} error={error} />;

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setMsg(null);
    try {
      await sendJson('/api/admin/sales-flow/ads', 'PUT', form);
      setMsg({ tone: 'ok', text: `Saved ad ${form.ad_id}. Existing leads from this ad now show the campaign.` });
      setForm(null);
      await reload();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (adId: string) => {
    if (!window.confirm(`Remove the mapping for ad ${adId}?`)) return;
    try {
      await sendJson(`/api/admin/sales-flow/ads?ad_id=${encodeURIComponent(adId)}`, 'DELETE');
      await reload();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : 'Failed' });
    }
  };

  const entryLabel = (id: string | null) => data.entries.find((e) => e.id === id)?.label || (id ? id : 'By message text');

  return (
    <div className="space-y-5">
      <Notice tone="info">
        WhatsApp tells us only the ad id when someone taps a click-to-WhatsApp ad. Map each ad id (Ads Manager, ad level) to its campaign so
        metrics are grouped by campaign, and optionally pick which opening it starts with.
      </Notice>
      {msg ? <Notice tone={msg.tone === 'ok' ? 'ok' : 'error'}>{msg.text}</Notice> : null}

      {data.unmapped.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="mb-2 text-sm font-medium text-amber-900">Ads seen on leads but not mapped yet</p>
          <div className="flex flex-wrap gap-2">
            {data.unmapped.map((u) => (
              <button
                key={u.ad_id}
                type="button"
                disabled={!canEdit}
                className={btnCls}
                onClick={() => setForm({ ...EMPTY, ad_id: u.ad_id, ad_name: u.headline || '' })}
                title={u.headline || ''}
              >
                {u.ad_id} · {u.leads} lead(s)
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {canEdit && !form ? (
        <button type="button" className={primaryBtnCls} onClick={() => setForm({ ...EMPTY })}>
          <Plus className="h-4 w-4" /> Map an ad
        </button>
      ) : null}

      {form ? (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Ad id">
              <input className={inputCls} value={form.ad_id} onChange={(e) => setForm({ ...form, ad_id: e.target.value.trim() })} />
            </Field>
            <Field label="Ad name">
              <input className={inputCls} value={form.ad_name} onChange={(e) => setForm({ ...form, ad_name: e.target.value })} />
            </Field>
            <Field label="Campaign name">
              <input className={inputCls} value={form.campaign_name} onChange={(e) => setForm({ ...form, campaign_name: e.target.value })} />
            </Field>
            <Field label="Campaign id (optional)">
              <input className={inputCls} value={form.campaign_id} onChange={(e) => setForm({ ...form, campaign_id: e.target.value.trim() })} />
            </Field>
            <Field label="Opening">
              <select className={inputCls} value={form.entry_key} onChange={(e) => setForm({ ...form, entry_key: e.target.value })}>
                <option value="">By message text</option>
                {data.entries.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className={primaryBtnCls} disabled={busy || !form.ad_id} onClick={save}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
            </button>
            <button type="button" className={btnCls} onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <Table head={['Ad', 'Campaign', 'Opening', 'Leads', 'Updated', '']} empty={data.mappings.length === 0}>
        {data.mappings.map((m) => (
          <tr key={m.ad_id}>
            <td className="px-4 py-3">
              <span className="font-medium text-gray-900">{m.ad_name || m.ad_id}</span>
              <span className="block text-xs text-gray-500">{m.ad_id}</span>
            </td>
            <td className="px-4 py-3 text-gray-700">
              {m.campaign_name || '—'}
              {m.campaign_id ? <span className="block text-xs text-gray-500">{m.campaign_id}</span> : null}
            </td>
            <td className="px-4 py-3 text-gray-700">{entryLabel(m.entry_key)}</td>
            <td className="px-4 py-3 text-gray-700">{m.leads}</td>
            <td className="px-4 py-3 text-gray-500">{when(m.updated_at)}</td>
            <td className="px-4 py-3">
              {canEdit ? (
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={btnCls}
                    onClick={() =>
                      setForm({ ad_id: m.ad_id, campaign_id: m.campaign_id || '', campaign_name: m.campaign_name || '', ad_name: m.ad_name || '', entry_key: m.entry_key || '' })
                    }
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button type="button" className={dangerBtnCls} onClick={() => remove(m.ad_id)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
