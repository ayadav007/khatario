'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, RefreshCw, Sparkles, Trash2, Send, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SettingsBlock } from '@/components/whatsapp/settings/SettingsBlock';
import { Badge } from '@/components/ui/Badge';
import { Toast, type ToastType } from '@/components/ui/Toast';
import {
  TENANT_WA_EVENTS,
  TENANT_WA_FIELDS,
  TENANT_WA_GROUP_LABELS,
  countPlaceholders,
  eventStarters,
  previewTemplateBody,
  templateEventMismatch,
  type TenantWaEvent,
  type TenantWaEventGroup,
  type TenantWaStarter,
} from '@/lib/whatsapp/tenant-events';

type Template = {
  id: string;
  name: string;
  language: string;
  category: 'AUTHENTICATION' | 'UTILITY' | 'MARKETING';
  header_format: string;
  header_text: string | null;
  body_text: string;
  footer_text: string | null;
  example_vars: string[];
  placeholder_count: number;
  status: string;
  rejected_reason: string | null;
  source: 'khatario' | 'meta';
};

type Mapping = { event_key: string; template_id: string; variable_map: string[] };

type DraftSeed = {
  name: string;
  language?: string;
  category: Template['category'];
  body_text: string;
  footer_text?: string | null;
  example_vars: string[];
};

type ReminderSchedule = { reminder_send_time: string; reminder_send_timezone: string };
type DueReminder = { enabled: boolean; days_before: number; message_template: string; include_pdf: boolean };
type OverdueReminder = { enabled: boolean; interval_days: number; message_template: string; include_pdf: boolean };
type ReminderBundle = { schedule: ReminderSchedule; payment_due: DueReminder; overdue: OverdueReminder };

function seedFromStarter(starter: TenantWaStarter): DraftSeed {
  return {
    name: starter.name,
    category: starter.category,
    body_text: starter.body,
    footer_text: starter.footer ?? '',
    example_vars: starter.variableMap.map((key) => TENANT_WA_FIELDS[key].sample),
  };
}

const inputCls =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500';

function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'secondary' | 'info' }> = {
    approved: { label: 'Approved', variant: 'success' },
    pending: { label: 'Waiting for Meta', variant: 'warning' },
    rejected: { label: 'Rejected', variant: 'danger' },
    paused: { label: 'Paused', variant: 'warning' },
    disabled: { label: 'Disabled', variant: 'danger' },
    draft: { label: 'Draft', variant: 'secondary' },
  };
  const s = map[status] ?? { label: status, variant: 'secondary' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Request failed');
  return data as T;
}

export function TenantTemplatesPanel() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [cloudReady, setCloudReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Template | 'new' | DraftSeed | null>(null);
  const [reminders, setReminders] = useState<ReminderBundle | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const notify = (message: string, type: ToastType = 'success') => setToast({ message, type });

  const load = useCallback(async () => {
    try {
      const data = await api<{ templates: Template[]; mappings: Mapping[]; cloud_ready: boolean }>(
        '/api/settings/whatsapp-templates',
      );
      setTemplates(data.templates);
      setMappings(data.mappings);
      setCloudReady(data.cloud_ready);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not load templates', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!editing) return;
    document.getElementById('wa-template-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [editing]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/whatsapp/reminders');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const due = data.settings?.payment_due;
        const late = data.settings?.overdue;
        setReminders({
          schedule: {
            reminder_send_time: data.schedule?.reminder_send_time || '09:00',
            reminder_send_timezone: data.schedule?.reminder_send_timezone || 'Asia/Kolkata',
          },
          payment_due: {
            enabled: !!due?.enabled,
            days_before: Number(due?.days_before) || 1,
            message_template: due?.message_template || '',
            include_pdf: due?.include_pdf !== false,
          },
          overdue: {
            enabled: !!late?.enabled,
            interval_days: Number(late?.interval_days) || 7,
            message_template: late?.message_template || '',
            include_pdf: late?.include_pdf !== false,
          },
        });
      } catch {
        /* Auto reminders may be off this plan; the card explains that. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Something went wrong', 'error');
    } finally {
      setBusy(null);
    }
  };

  const sync = () =>
    run('sync', async () => {
      const data = await api<{ templates: Template[] }>('/api/settings/whatsapp-templates/sync', { method: 'POST' });
      setTemplates(data.templates);
      notify(`Synced ${data.templates.length} template${data.templates.length === 1 ? '' : 's'} from Meta`);
    });

  const submit = (t: Template) =>
    run(`submit:${t.id}`, async () => {
      await api(`/api/settings/whatsapp-templates/${t.id}/submit`, { method: 'POST' });
      await load();
      notify('Sent to Meta for approval');
    });

  const remove = (t: Template) => {
    if (!window.confirm(`Delete template ${t.name}? It is also removed from your Meta account.`)) return;
    void run(`delete:${t.id}`, async () => {
      await api(`/api/settings/whatsapp-templates/${t.id}`, { method: 'DELETE' });
      await load();
      notify('Template deleted');
    });
  };

  const groups = useMemo(() => {
    const out: Record<TenantWaEventGroup, TenantWaEvent[]> = { store: [], delivery: [], merchant: [], billing: [] };
    for (const e of TENANT_WA_EVENTS) out[e.group].push(e);
    return out;
  }, []);

  if (loading) {
    return (
      <SettingsBlock title="Message templates" description="Approved wording Meta lets you send from your own number.">
        <p className="text-sm text-text-secondary">Loading message templates...</p>
      </SettingsBlock>
    );
  }

  if (!cloudReady) {
    return (
      <SettingsBlock
        title="Message templates"
        description="Approved wording Meta lets you send from your own number, for invoices, order updates and reminders."
      >
        <p className="text-sm text-text-secondary">
          Templates need the Meta Cloud API. Without it, your QR-linked number sends invoices and reminders as plain
          text, so you don&apos;t need templates.
        </p>
        <div className="flex justify-end border-t border-border pt-4 dark:border-border-dark">
          <Link
            href="/settings/whatsapp#wa-cloud"
            className="inline-flex items-center rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
          >
            Set up Cloud API
          </Link>
        </div>
      </SettingsBlock>
    );
  }

  return (
    <>
      <SettingsBlock
        title="Which wording each message uses"
        description="Pick an approved template for each message Khatario sends. Start from a suggested wording, edit it and submit it to Meta. It is used only after Meta approves it."
      >
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={sync} isLoading={busy === 'sync'}>
            {busy !== 'sync' && <RefreshCw className="h-4 w-4" />} Sync from Meta
          </Button>
        </div>
        {(Object.keys(groups) as TenantWaEventGroup[]).map((g) => (
          <div key={g} className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {TENANT_WA_GROUP_LABELS[g]}
            </h4>
            <div className="divide-y divide-border rounded-lg border border-border">
              {groups[g].map((event) => (
                <EventRow
                  key={event.key}
                  event={event}
                  templates={templates}
                  mapping={mappings.find((m) => m.event_key === event.key) ?? null}
                  reminders={reminders}
                  onReminders={setReminders}
                  onUseStarter={(starter) => setEditing(seedFromStarter(starter))}
                  onSaved={(m) => setMappings(m)}
                  onTemplatesChanged={load}
                  notify={notify}
                />
              ))}
            </div>
          </div>
        ))}
      </SettingsBlock>

      <SettingsBlock
        title="Your templates"
        description="Templates on your WhatsApp Business Account. New ones need Meta's approval, usually within minutes."
      >
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" /> New template
            </Button>
          </div>

          {editing ? (
            <div id="wa-template-editor">
              <TemplateForm
                initial={editing !== 'new' && 'id' in editing ? editing : null}
                seed={editing !== 'new' && editing !== null && !('id' in editing) ? editing : null}
                onCancel={() => setEditing(null)}
                onSaved={async (msg) => {
                  setEditing(null);
                  await load();
                  notify(msg);
                }}
                notify={notify}
              />
            </div>
          ) : null}

          {templates.length === 0 ? (
            <p className="text-sm text-text-secondary">
              No templates yet. Pick a wording on a message above, edit it, and submit it to Meta. Or sync templates
              you already created in Meta.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {templates.map((t) => {
                const editable = t.source === 'khatario' && ['draft', 'rejected'].includes(t.status);
                return (
                  <li key={t.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium text-text-primary">{t.name}</span>
                        <span className="text-xs text-text-muted">
                          {t.language} · {t.category.toLowerCase()}
                          {t.source === 'meta' ? ' · from Meta' : ''}
                        </span>
                        {statusBadge(t.status)}
                      </div>
                      <p className="line-clamp-2 text-sm text-text-secondary">
                        {t.category === 'AUTHENTICATION'
                          ? 'Fixed Meta text: "<code> is your verification code."'
                          : t.body_text || '(no text synced)'}
                      </p>
                      {t.status === 'rejected' && t.rejected_reason ? (
                        <p className="text-xs text-red-600">Meta: {t.rejected_reason}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {editable ? (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
                            <Pencil className="h-4 w-4" /> Edit
                          </Button>
                          <Button size="sm" onClick={() => submit(t)} isLoading={busy === `submit:${t.id}`}>
                            {busy !== `submit:${t.id}` && <Send className="h-4 w-4" />} Submit
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setEditing({
                              name: `${t.name}_v2`,
                              language: t.language,
                              category: t.category,
                              body_text: t.body_text,
                              footer_text: t.footer_text,
                              example_vars: t.example_vars || [],
                            })
                          }
                        >
                          <Pencil className="h-4 w-4" /> Copy to a new draft
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(t)}
                        isLoading={busy === `delete:${t.id}`}
                        aria-label={`Delete ${t.name}`}
                      >
                        {busy !== `delete:${t.id}` && <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
      </SettingsBlock>

      {toast ? <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} /> : null}
    </>
  );
}

function BillingTrigger({
  eventKey,
  reminders,
  onReminders,
  notify,
}: {
  eventKey: 'payment_due_reminder' | 'payment_overdue_reminder';
  reminders: ReminderBundle | null;
  onReminders: (next: ReminderBundle) => void;
  notify: (message: string, type?: ToastType) => void;
}) {
  const [saving, setSaving] = useState(false);
  if (!reminders) {
    return (
      <p className="text-xs text-text-muted">
        Choose the day and time under WhatsApp → Notifications. Auto reminders need the WhatsApp Bot addon.
      </p>
    );
  }
  const due = eventKey === 'payment_due_reminder';
  const save = async () => {
    setSaving(true);
    try {
      await api('/api/whatsapp/reminders', {
        method: 'POST',
        body: JSON.stringify(
          due
            ? { payment_due: reminders.payment_due, schedule: reminders.schedule }
            : { overdue: reminders.overdue, schedule: reminders.schedule },
        ),
      });
      notify('Reminder schedule saved');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save the schedule', 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-2 rounded-lg border border-border px-3 py-2">
      <p className="text-xs font-medium text-text-primary">When to send</p>
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={due ? reminders.payment_due.enabled : reminders.overdue.enabled}
          onChange={(e) =>
            onReminders(
              due
                ? { ...reminders, payment_due: { ...reminders.payment_due, enabled: e.target.checked } }
                : { ...reminders, overdue: { ...reminders.overdue, enabled: e.target.checked } },
            )
          }
        />
        Send this reminder
      </label>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs text-text-secondary">
          {due ? 'Days before the due date' : 'Repeat every (days)'}
          <input
            type="number"
            min={1}
            max={30}
            className={`${inputCls} mt-1`}
            value={due ? reminders.payment_due.days_before : reminders.overdue.interval_days}
            onChange={(e) => {
              const n = Math.max(1, parseInt(e.target.value, 10) || 1);
              onReminders(
                due
                  ? { ...reminders, payment_due: { ...reminders.payment_due, days_before: n } }
                  : { ...reminders, overdue: { ...reminders.overdue, interval_days: n } },
              );
            }}
          />
        </label>
        <label className="text-xs text-text-secondary">
          Local time
          <input
            type="time"
            className={`${inputCls} mt-1`}
            value={reminders.schedule.reminder_send_time}
            onChange={(e) =>
              onReminders({
                ...reminders,
                schedule: { ...reminders.schedule, reminder_send_time: e.target.value || '09:00' },
              })
            }
          />
        </label>
        <label className="text-xs text-text-secondary">
          Time zone
          <select
            className={`${inputCls} mt-1`}
            value={reminders.schedule.reminder_send_timezone}
            onChange={(e) =>
              onReminders({
                ...reminders,
                schedule: { ...reminders.schedule, reminder_send_timezone: e.target.value },
              })
            }
          >
            {Array.from(
              new Set([
                'Asia/Kolkata',
                'Asia/Dubai',
                'Asia/Singapore',
                'Europe/London',
                'America/New_York',
                reminders.schedule.reminder_send_timezone,
              ]),
            ).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={due ? reminders.payment_due.include_pdf : reminders.overdue.include_pdf}
          onChange={(e) =>
            onReminders(
              due
                ? { ...reminders, payment_due: { ...reminders.payment_due, include_pdf: e.target.checked } }
                : { ...reminders, overdue: { ...reminders.overdue, include_pdf: e.target.checked } },
            )
          }
        />
        Attach the invoice PDF on a QR number, or when the template has a document header
      </label>
      <Button size="sm" onClick={save} isLoading={saving}>
        Save schedule
      </Button>
    </div>
  );
}

function EventRow({
  event,
  templates,
  mapping,
  reminders,
  onReminders,
  onUseStarter,
  onSaved,
  onTemplatesChanged,
  notify,
}: {
  event: TenantWaEvent;
  templates: Template[];
  mapping: Mapping | null;
  reminders: ReminderBundle | null;
  onReminders: (next: ReminderBundle) => void;
  onUseStarter: (starter: TenantWaStarter) => void;
  onSaved: (m: Mapping[]) => void;
  onTemplatesChanged: () => Promise<void>;
  notify: (message: string, type?: ToastType) => void;
}) {
  const [templateId, setTemplateId] = useState(mapping?.template_id ?? '');
  const [varMap, setVarMap] = useState<string[]>(mapping?.variable_map ?? []);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  const savedKey = JSON.stringify([mapping?.template_id ?? '', mapping?.variable_map ?? []]);
  useEffect(() => {
    const [id, map] = JSON.parse(savedKey) as [string, string[]];
    setTemplateId(id);
    setVarMap(map);
  }, [savedKey]);

  const options = templates.filter((t) => event.categories.includes(t.category));
  const selected = templates.find((t) => t.id === templateId) ?? null;
  const mapped = mapping ? templates.find((t) => t.id === mapping.template_id) ?? null : null;
  const needsMap = selected && selected.category !== 'AUTHENTICATION';
  const effectiveMap = needsMap ? Array.from({ length: selected.placeholder_count }, (_, i) => varMap[i] ?? '') : [];
  const mismatch = selected ? templateEventMismatch(event, selected, needsMap ? effectiveMap : ['code']) : null;
  const dirty =
    templateId !== (mapping?.template_id ?? '') ||
    JSON.stringify(effectiveMap) !== JSON.stringify(needsMap ? mapping?.variable_map ?? [] : []);

  const state = (() => {
    if (!mapped) {
      return event.key === 'store_otp'
        ? { text: 'Default code template', variant: 'info' as const }
        : { text: 'Plain text over QR', variant: 'secondary' as const };
    }
    if (mapped.status === 'approved') return { text: 'Using template', variant: 'success' as const };
    if (mapped.status === 'pending') return { text: 'Waiting for Meta approval', variant: 'warning' as const };
    return { text: `Template ${mapped.status}`, variant: 'danger' as const };
  })();

  const save = async () => {
    setSaving(true);
    try {
      const data = await api<{ mappings: Mapping[] }>('/api/settings/whatsapp-templates/events', {
        method: 'PUT',
        body: JSON.stringify({
          event_key: event.key,
          template_id: templateId || null,
          variable_map: effectiveMap,
        }),
      });
      onSaved(data.mappings);
      notify(templateId ? `${event.label}: template saved` : `${event.label}: back to plain text`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const suggest = async () => {
    setSuggesting(true);
    try {
      const data = await api<{ mappings: Mapping[]; template: Template }>(
        `/api/settings/whatsapp-templates/events/${event.key}/suggest`,
        { method: 'POST' },
      );
      await onTemplatesChanged();
      onSaved(data.mappings);
      notify(
        data.template.status === 'approved'
          ? `${event.label}: suggested template approved and selected`
          : `${event.label}: suggested template sent to Meta for approval`,
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not create the template', 'error');
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text-primary">{event.label}</p>
          <p className="text-xs text-text-muted">{event.description}</p>
        </div>
        <Badge variant={state.variant}>{state.text}</Badge>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          className={`${inputCls} sm:max-w-xs`}
          value={templateId}
          onChange={(e) => {
            setTemplateId(e.target.value);
            setVarMap([]);
          }}
          aria-label={`Template for ${event.label}`}
        >
          <option value="">
            {event.key === 'store_otp'
              ? 'Default code template'
              : event.key === 'invoice_sent' || event.key === 'payment_due_reminder' || event.key === 'payment_overdue_reminder'
                ? 'No template yet (not sent on WhatsApp Business API)'
                : 'No template (plain text over QR)'}
          </option>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.language}){t.status === 'approved' ? '' : ` - ${t.status}`}
            </option>
          ))}
        </select>
        {event.key === 'store_otp' && !mapping ? (
          <Button variant="secondary" size="sm" onClick={suggest} isLoading={suggesting}>
            {!suggesting && <Sparkles className="h-4 w-4" />} Use suggested template
          </Button>
        ) : null}
      </div>

      {event.key !== 'store_otp' ? (
        <div className="space-y-2">
          {eventStarters(event).map((starter) => (
            <div key={starter.id} className="rounded-lg border border-border bg-surface-secondary px-3 py-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-xs font-medium text-text-primary">{starter.label}</p>
                <Button variant="secondary" size="sm" onClick={() => onUseStarter(starter)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit this wording
                </Button>
              </div>
              <p className="mt-1 text-sm text-text-secondary">
                {previewTemplateBody(starter.body, starter.variableMap)}
              </p>
            </div>
          ))}
          <p className="text-xs text-text-muted">
            {event.key === 'invoice_sent'
              ? 'Sends when you tap Send on an invoice. Meta must approve the wording before WhatsApp Business API can deliver it.'
              : event.key === 'payment_due_reminder' || event.key === 'payment_overdue_reminder'
                ? 'After approval, select the template above. The schedule below is when Khatario sends it.'
                : 'Sends when this happens in Khatario. Edit the wording, submit it to Meta, then select the approved template.'}
          </p>
        </div>
      ) : null}

      {event.key === 'payment_due_reminder' || event.key === 'payment_overdue_reminder' ? (
        <BillingTrigger
          eventKey={event.key}
          reminders={reminders}
          onReminders={onReminders}
          notify={notify}
        />
      ) : null}

      {needsMap && selected.placeholder_count > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {effectiveMap.map((value, i) => (
            <label key={i} className="flex items-center gap-2 text-sm">
              <span className="w-10 shrink-0 font-mono text-text-muted">{`{{${i + 1}}}`}</span>
              <select
                className={inputCls}
                value={value}
                onChange={(e) => {
                  const next = [...effectiveMap];
                  next[i] = e.target.value;
                  setVarMap(next);
                }}
              >
                <option value="">Choose field...</option>
                {event.fields.map((f) => (
                  <option key={f} value={f}>
                    {TENANT_WA_FIELDS[f].label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ) : null}

      {selected ? (
        <p className="rounded-lg bg-surface-secondary px-3 py-2 text-sm text-text-secondary">
          {selected.category === 'AUTHENTICATION'
            ? `${TENANT_WA_FIELDS.code.sample} is your verification code. For your security, do not share this code.`
            : previewTemplateBody(selected.body_text, effectiveMap) || '(Sync from Meta to see this template text)'}
        </p>
      ) : null}

      {dirty ? (
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={save} isLoading={saving} disabled={!!mismatch && !!templateId}>
            Save
          </Button>
          {mismatch && templateId ? <span className="text-xs text-amber-700">{mismatch}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function TemplateForm({
  initial,
  seed,
  onCancel,
  onSaved,
  notify,
}: {
  initial: Template | null;
  seed?: DraftSeed | null;
  onCancel: () => void;
  onSaved: (message: string) => Promise<void>;
  notify: (message: string, type?: ToastType) => void;
}) {
  const [name, setName] = useState(initial?.name ?? seed?.name ?? '');
  const [language, setLanguage] = useState(initial?.language ?? seed?.language ?? 'en_US');
  const [category, setCategory] = useState<Template['category']>(initial?.category ?? seed?.category ?? 'UTILITY');
  const [header, setHeader] = useState(initial?.header_text ?? '');
  const [body, setBody] = useState(initial?.body_text ?? seed?.body_text ?? '');
  const [footer, setFooter] = useState(initial?.footer_text ?? seed?.footer_text ?? '');
  const [examples, setExamples] = useState<string[]>(initial?.example_vars ?? seed?.example_vars ?? []);
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);

  const placeholders = category === 'AUTHENTICATION' ? 0 : countPlaceholders(body);

  const save = async (andSubmit: boolean) => {
    setSaving(andSubmit ? 'submit' : 'draft');
    try {
      const payload = {
        name,
        language,
        category,
        header_text: header,
        body_text: body,
        footer_text: footer,
        example_vars: Array.from({ length: placeholders }, (_, i) => examples[i] ?? ''),
      };
      const { template } = initial
        ? await api<{ template: Template }>(`/api/settings/whatsapp-templates/${initial.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await api<{ template: Template }>('/api/settings/whatsapp-templates', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      if (andSubmit) {
        await api(`/api/settings/whatsapp-templates/${template.id}/submit`, { method: 'POST' });
      }
      await onSaved(andSubmit ? 'Template sent to Meta for approval' : 'Draft saved');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save the template', 'error');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-secondary p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-text-primary">
          {initial ? `Edit ${initial.name}` : seed ? 'Edit wording before sending to Meta' : 'New template'}
        </h4>
        <button type="button" onClick={onCancel} className="text-text-muted hover:text-text-primary" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm sm:col-span-1">
          <span className="font-medium text-text-secondary">Name</span>
          <input
            className={`${inputCls} mt-1 font-mono`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!!initial}
            placeholder="order_update"
          />
          <span className="mt-1 block text-xs text-text-muted">Lowercase letters, numbers and _</span>
        </label>
        <label className="text-sm">
          <span className="font-medium text-text-secondary">Language</span>
          <select className={`${inputCls} mt-1`} value={language} onChange={(e) => setLanguage(e.target.value)} disabled={!!initial}>
            <option value="en_US">English (US)</option>
            <option value="en">English</option>
            <option value="en_GB">English (UK)</option>
            <option value="hi">Hindi</option>
            <option value="mr">Marathi</option>
            <option value="gu">Gujarati</option>
            <option value="ta">Tamil</option>
            <option value="te">Telugu</option>
            <option value="kn">Kannada</option>
            <option value="bn">Bengali</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium text-text-secondary">Category</span>
          <select
            className={`${inputCls} mt-1`}
            value={category}
            onChange={(e) => setCategory(e.target.value as Template['category'])}
          >
            <option value="UTILITY">Utility (orders, invoices, reminders)</option>
            <option value="AUTHENTICATION">Authentication (verification codes)</option>
            <option value="MARKETING">Marketing (offers)</option>
          </select>
        </label>
      </div>

      {category === 'AUTHENTICATION' ? (
        <p className="text-sm text-text-secondary">
          Meta writes the text for verification-code templates: &quot;&lt;code&gt; is your verification code. For
          your security, do not share this code.&quot; with a Copy code button.
        </p>
      ) : (
        <>
          <label className="block text-sm">
            <span className="font-medium text-text-secondary">Header (optional)</span>
            <input className={`${inputCls} mt-1`} value={header} onChange={(e) => setHeader(e.target.value)} maxLength={60} />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-text-secondary">Message</span>
            <textarea
              className={`${inputCls} mt-1 min-h-[96px]`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={1024}
              placeholder="Hi {{1}}, your order {{2}} is on its way."
            />
            <span className="mt-1 block text-xs text-text-muted">
              Use {'{{1}}'}, {'{{2}}'}... for details Khatario fills in. The message can&apos;t start or end with one.
            </span>
          </label>
          {placeholders > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {Array.from({ length: placeholders }, (_, i) => (
                <label key={i} className="flex items-center gap-2 text-sm">
                  <span className="w-10 shrink-0 font-mono text-text-muted">{`{{${i + 1}}}`}</span>
                  <input
                    className={inputCls}
                    placeholder="Example for Meta review"
                    value={examples[i] ?? ''}
                    onChange={(e) => {
                      const next = [...examples];
                      next[i] = e.target.value;
                      setExamples(next);
                    }}
                  />
                </label>
              ))}
            </div>
          ) : null}
          <label className="block text-sm">
            <span className="font-medium text-text-secondary">Footer (optional)</span>
            <input className={`${inputCls} mt-1`} value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={60} />
          </label>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => save(true)} isLoading={saving === 'submit'} disabled={!!saving}>
          Save and submit to Meta
        </Button>
        <Button variant="secondary" size="sm" onClick={() => save(false)} isLoading={saving === 'draft'} disabled={!!saving}>
          Save draft
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={!!saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}