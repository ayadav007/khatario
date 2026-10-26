'use client';

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Archive, Check, Code2, Copy, Download, Link2, Loader2, Megaphone, Plug, RefreshCw, Trash2, Webhook } from 'lucide-react';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Toast } from '@/components/ui/Toast';
import type { EntryLink, LeadSourceRow } from '@/lib/whatsapp/lead-sources';

type Option = { id: string; name: string };
type Routing = { stage_id: string; assign_to: string; label_ids: string[] };

const field =
  'w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark';
const labelCls = 'mb-1 block text-xs font-medium text-text-secondary';

async function api<T = any>(url: string, init?: RequestInit): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const res = await fetch(url, init ? { ...init, headers: { 'Content-Type': 'application/json' } } : undefined);
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && !data.error) data.error = 'You need the WhatsApp setup permission for this';
  return { ok: res.ok, data };
}

function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  return [
    copied,
    (key, text) => {
      void navigator.clipboard?.writeText(text).then(() => {
        setCopied(key);
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
      });
    },
  ];
}

export function LeadSourcesPage() {
  const [stages, setStages] = useState<Option[]>([]);
  const [agents, setAgents] = useState<Option[]>([]);
  const [labels, setLabels] = useState<Option[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const notify = useCallback((message: string, type: 'success' | 'error' = 'success') => setToast({ message, type }), []);

  useEffect(() => {
    void api('/api/whatsapp/pipeline/stages').then(({ data }) => setStages(data.stages || []));
    void api('/api/whatsapp/users').then(({ data }) =>
      setAgents((data.users || []).filter((u: { can_receive?: boolean }) => u.can_receive !== false)),
    );
    void api('/api/whatsapp/labels').then(({ data }) => setLabels(data.labels || []));
  }, []);

  const pickers = { stages, agents, labels };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <ListPageHeader
        title="Lead sources"
        description="Know where every WhatsApp lead came from, and send each one to the right stage and person."
        showActionsOnMobile
      />
      <AdsCard />
      <LinksSection pickers={pickers} notify={notify} />
      <IndiaMartSection pickers={pickers} notify={notify} />
      <WebhooksSection pickers={pickers} notify={notify} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

type Pickers = { stages: Option[]; agents: Option[]; labels: Option[] };
type Notify = (message: string, type?: 'success' | 'error') => void;

function RoutingFields({ value, onChange, pickers }: { value: Routing; onChange: (r: Routing) => void; pickers: Pickers }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <label className={labelCls}>Pipeline stage</label>
        <select className={field} value={value.stage_id} onChange={(e) => onChange({ ...value, stage_id: e.target.value })}>
          <option value="">First open stage</option>
          {pickers.stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelCls}>Give the chat to</label>
        <select className={field} value={value.assign_to} onChange={(e) => onChange({ ...value, assign_to: e.target.value })}>
          <option value="">Nobody (Requesting queue)</option>
          {pickers.agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelCls}>Add labels</label>
        <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
          {pickers.labels.length === 0 && <span className="text-xs text-text-muted">No labels yet</span>}
          {pickers.labels.map((l) => {
            const on = value.label_ids.includes(l.id);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => onChange({ ...value, label_ids: on ? value.label_ids.filter((x) => x !== l.id) : [...value.label_ids, l.id] })}
                className={`rounded-full px-2 py-0.5 text-xs ${on ? 'bg-primary-600 text-white' : 'bg-surface-secondary text-text-secondary ring-1 ring-border'}`}
              >
                {l.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const emptyRouting: Routing = { stage_id: '', assign_to: '', label_ids: [] };
const routingBody = (r: Routing) => ({ stage_id: r.stage_id || null, assign_to: r.assign_to || null, label_ids: r.label_ids });

function SectionTitle({ icon: Icon, title, text }: { icon: typeof Link2; title: string; text: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="rounded-lg bg-primary-50 p-2 text-primary-700 dark:bg-surface-dark">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
        <p className="text-sm text-text-secondary">{text}</p>
      </div>
    </div>
  );
}

function AdsCard() {
  return (
    <Card padding="md">
      <SectionTitle
        icon={Megaphone}
        title="Click-to-WhatsApp ads"
        text="Nothing to set up. When someone taps your Facebook or Instagram ad and messages you, the chat is marked “WhatsApp ad” with the ad's headline and goes on the pipeline."
      />
      <p className="text-xs text-text-muted">
        Needs your number connected through the Meta Cloud API (Settings → WhatsApp → Connection). Numbers linked by QR code don&apos;t get ad details from Meta; use a tracked link in the ad instead.
      </p>
    </Card>
  );
}

function LinksSection({ pickers, notify }: { pickers: Pickers; notify: Notify }) {
  const [links, setLinks] = useState<EntryLink[] | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', prefill_text: '' });
  const [routing, setRouting] = useState<Routing>(emptyRouting);
  const [saving, setSaving] = useState(false);
  const [copied, copy] = useCopy();

  const load = useCallback(async () => {
    const { ok, data } = await api('/api/whatsapp/lead-sources/links');
    if (!ok) {
      setLinks([]);
      notify(data.error || 'Could not load links', 'error');
      return;
    }
    setLinks(data.links || []);
    setBaseUrl(data.base_url || window.location.origin);
    setForm((f) => (f.phone ? f : { ...f, phone: data.suggested_phone || '' }));
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setSaving(true);
    try {
      const { ok, data } = await api('/api/whatsapp/lead-sources/links', {
        method: 'POST',
        body: JSON.stringify({ ...form, ...routingBody(routing) }),
      });
      if (!ok) return notify(data.error || 'Could not create the link', 'error');
      setForm((f) => ({ ...f, name: '', prefill_text: '' }));
      setRouting(emptyRouting);
      notify('Link created');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function archive(link: EntryLink) {
    const { ok, data } = await api(`/api/whatsapp/lead-sources/links/${link.id}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) });
    if (!ok) return notify(data.error || 'Could not archive', 'error');
    notify('Link archived; it no longer opens WhatsApp');
    await load();
  }

  async function downloadQr(link: EntryLink) {
    const url = await QRCode.toDataURL(`${baseUrl}/w/${link.code}?via=qr`, { width: 800, margin: 2 });
    const a = document.createElement('a');
    a.href = url;
    a.download = `whatsapp-qr-${link.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
    a.click();
  }

  return (
    <Card padding="md">
      <SectionTitle
        icon={Link2}
        title="Tracked links, QR codes and website button"
        text="Put a link in an ad, Instagram bio or poster. When someone writes in through it, the chat shows which link brought them."
      />

      <div className="space-y-3 rounded-lg border border-border p-3 dark:border-border-dark">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls} htmlFor="link-name">Name</label>
            <input id="link-name" className={field} placeholder="e.g. Diwali poster" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className={labelCls} htmlFor="link-phone">Your WhatsApp number</label>
            <input id="link-phone" className={field} placeholder="919876543210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className={labelCls} htmlFor="link-text">Message they send</label>
            <input
              id="link-text"
              className={field}
              placeholder="Hi! I would like to know more."
              maxLength={400}
              value={form.prefill_text}
              onChange={(e) => setForm({ ...form, prefill_text: e.target.value })}
            />
          </div>
        </div>
        <RoutingFields value={routing} onChange={setRouting} pickers={pickers} />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-text-muted">A short code like “(ref K7Q2MX)” is added to the message so we can tell which link it came from.</p>
          <Button size="sm" onClick={() => void create()} disabled={saving || !form.name.trim() || !form.phone.trim()}>
            {saving ? 'Creating…' : 'Create link'}
          </Button>
        </div>
      </div>

      {!links ? (
        <div className="py-6 text-center text-sm text-text-muted">
          <Loader2 className="mx-auto h-4 w-4 animate-spin" />
        </div>
      ) : links.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">No links yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border dark:divide-border-dark">
          {links.map((l) => {
            const url = `${baseUrl}/w/${l.code}`;
            const snippet = `<script src="${baseUrl}/api/public/wa-widget/${l.code}" async></script>`;
            return (
              <li key={l.id} className="py-3">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-text-primary">{l.name}</p>
                    <p className="truncate font-mono text-xs text-text-secondary">{url}</p>
                    <p className="mt-1 text-xs text-text-muted">
                      {l.clicks} clicks · {l.qr_scans} QR scans · {l.widget_clicks} website taps · <strong>{l.chats ?? 0} chats</strong> · {l.won ?? 0} won
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => copy(`url-${l.id}`, url)}>
                      {copied === `url-${l.id}` ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
                      Link
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void downloadQr(l)}>
                      <Download className="mr-1 h-4 w-4" />
                      QR
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => copy(`js-${l.id}`, snippet)} title="Paste this on your website">
                      {copied === `js-${l.id}` ? <Check className="mr-1 h-4 w-4" /> : <Code2 className="mr-1 h-4 w-4" />}
                      Website button
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void archive(l)} aria-label={`Archive ${l.name}`}>
                      <Archive className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function IndiaMartSection({ pickers, notify }: { pickers: Pickers; notify: Notify }) {
  const [source, setSource] = useState<LeadSourceRow | null | undefined>(undefined);
  const [key, setKey] = useState('');
  const [routing, setRouting] = useState<Routing>(emptyRouting);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api('/api/whatsapp/lead-sources');
    const im = (data.sources || []).find((s: LeadSourceRow) => s.kind === 'indiamart') || null;
    setSource(im);
    if (im) setRouting({ stage_id: im.stage_id || '', assign_to: im.assign_to || '', label_ids: im.label_ids || [] });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    try {
      const { ok, data } = await api('/api/whatsapp/lead-sources', {
        method: 'POST',
        body: JSON.stringify({ kind: 'indiamart', key: key.trim() || undefined, ...routingBody(routing) }),
      });
      if (!ok) return notify(data.error || 'Could not save', 'error');
      setKey('');
      notify(source ? 'IndiaMART settings saved' : 'IndiaMART connected. New leads arrive every 10 minutes.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    try {
      const { ok, data } = await api('/api/whatsapp/lead-sources/indiamart/sync', { method: 'POST', body: '{}' });
      if (!ok) notify(data.error || 'Sync failed', 'error');
      else notify(`Checked IndiaMART: ${data.run.imported} new lead${data.run.imported === 1 ? '' : 's'}`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(enabled: boolean) {
    if (!source) return;
    const { ok, data } = await api(`/api/whatsapp/lead-sources/${source.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
    if (!ok) notify(data.error || 'Could not update', 'error');
    await load();
  }

  async function disconnect() {
    if (!source) return;
    const { ok, data } = await api(`/api/whatsapp/lead-sources/${source.id}`, { method: 'DELETE' });
    if (!ok) return notify(data.error || 'Could not disconnect', 'error');
    notify('IndiaMART disconnected');
    await load();
  }

  const result = source?.last_result as { fetched?: number; imported?: number } | null | undefined;

  return (
    <Card padding="md">
      <SectionTitle
        icon={Plug}
        title="IndiaMART"
        text="New buy-leads become WhatsApp chats on your pipeline, with the enquiry attached. Reply to them from Conversations."
      />
      {source === undefined ? (
        <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
      ) : (
        <div className="space-y-3">
          {source && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-secondary/60 p-3 text-sm dark:bg-surface-dark">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${source.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                {source.enabled ? 'Connected' : 'Paused'}
              </span>
              <span className="text-text-secondary">{source.leads} leads imported</span>
              {source.last_run_at && (
                <span className="text-text-muted">
                  Last checked {new Date(source.last_run_at).toLocaleString()}
                  {result?.fetched !== undefined ? ` · ${result.imported ?? 0} new` : ''}
                </span>
              )}
              {source.last_error && <span className="w-full text-xs text-red-600">IndiaMART said: {source.last_error}</span>}
              <div className="ml-auto flex gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => void sync()} disabled={busy || !source.enabled}>
                  <RefreshCw className="mr-1 h-4 w-4" />
                  Sync now
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void toggle(!source.enabled)} disabled={busy}>
                  {source.enabled ? 'Pause' : 'Resume'}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void disconnect()} disabled={busy} aria-label="Disconnect IndiaMART">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <div>
            <label className={labelCls} htmlFor="im-key">{source ? 'Replace CRM key (optional)' : 'IndiaMART CRM key'}</label>
            <input
              id="im-key"
              type="password"
              autoComplete="off"
              className={field}
              placeholder={source ? '•••••••• saved' : 'Paste the key from IndiaMART Lead Manager → Import/Export → CRM API'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </div>
          <RoutingFields value={routing} onChange={setRouting} pickers={pickers} />
          <div className="flex justify-end">
            <Button size="sm" onClick={() => void save()} disabled={busy || (!source && !key.trim())}>
              {source ? 'Save' : 'Connect IndiaMART'}
            </Button>
          </div>
          <p className="text-xs text-text-muted">
            IndiaMART lets us check once every 5 minutes. A new lead has not messaged you on WhatsApp yet, so start the conversation with an approved template.
          </p>
        </div>
      )}
    </Card>
  );
}

function WebhooksSection({ pickers, notify }: { pickers: Pickers; notify: Notify }) {
  const [sources, setSources] = useState<LeadSourceRow[]>([]);
  const [name, setName] = useState('');
  const [routing, setRouting] = useState<Routing>(emptyRouting);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, copy] = useCopy();

  const load = useCallback(async () => {
    const { data } = await api('/api/whatsapp/lead-sources');
    setSources((data.sources || []).filter((s: LeadSourceRow) => s.kind === 'webhook'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    try {
      const { ok, data } = await api('/api/whatsapp/lead-sources', {
        method: 'POST',
        body: JSON.stringify({ kind: 'webhook', name: name.trim() || undefined, ...routingBody(routing) }),
      });
      if (!ok) return notify(data.error || 'Could not create the webhook', 'error');
      setNewUrl(data.url);
      setName('');
      setRouting(emptyRouting);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: LeadSourceRow) {
    const { ok, data } = await api(`/api/whatsapp/lead-sources/${s.id}`, { method: 'DELETE' });
    if (!ok) return notify(data.error || 'Could not delete', 'error');
    notify('Webhook deleted; its URL stops working now');
    await load();
  }

  return (
    <Card padding="md">
      <SectionTitle
        icon={Webhook}
        title="Lead webhook (JustDial, Facebook lead forms, website forms)"
        text="A private URL that turns any lead into a WhatsApp chat. Connect JustDial, Facebook Lead Ads or your website form to it with Zapier or Make."
      />
      {newUrl && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Copy this URL now. It won&apos;t be shown again.</p>
          <div className="mt-2 flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-xs">{newUrl}</code>
            <Button size="sm" variant="secondary" onClick={() => copy('new-url', newUrl)}>
              {copied === 'new-url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-2 text-xs">
            Send a POST with JSON: <code>{'{ "phone": "9876543210", "name": "Ravi", "message": "Need 20 cartons", "id": "lead-123" }'}</code>. Only <code>phone</code> is required; <code>id</code> stops the same lead coming in twice.
          </p>
        </div>
      )}
      <ul className="mb-3 divide-y divide-border dark:divide-border-dark">
        {sources.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <span className="font-medium text-text-primary">{s.name}</span>
            <span className="font-mono text-xs text-text-muted">…{s.token_hint}</span>
            <span className="text-text-secondary">{s.leads} leads</span>
            {s.last_run_at && <span className="text-xs text-text-muted">last {new Date(s.last_run_at).toLocaleString()}</span>}
            <Button size="sm" variant="secondary" className="ml-auto" onClick={() => void remove(s)} aria-label={`Delete ${s.name}`}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="space-y-3 rounded-lg border border-border p-3 dark:border-border-dark">
        <div>
          <label className={labelCls} htmlFor="wh-name">Name</label>
          <input id="wh-name" className={field} placeholder="e.g. JustDial via Zapier" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <RoutingFields value={routing} onChange={setRouting} pickers={pickers} />
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void create()} disabled={busy}>
            Create webhook URL
          </Button>
        </div>
      </div>
    </Card>
  );
}
