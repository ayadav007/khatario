'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format, isPast } from 'date-fns';
import { AlarmClock, Check, Loader2, MessageCircle, Phone, RotateCcw, Send, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SlideOverPanel } from '@/components/ui/SlideOverPanel';
import { NewConversationModal } from '@/components/whatsapp/conversations/NewConversationModal';
import { ReminderForm } from '@/components/whatsapp/pipeline/DealSection';
import { STAGE_DOT, type StageOption } from '@/components/whatsapp/pipeline/stageStyle';
import { useAuth } from '@/contexts/AuthContext';
import type { LeadDetail } from '@/lib/leads/list';
import { ConvertLeadDialog } from './ConvertLeadDialog';
import { LeadNotes } from './LeadNotes';
import {
  describeLeadSource,
  formatLeadPhone,
  LEAD_TYPE_LABEL,
  LEAD_TYPE_STYLE,
  leadsApi,
  sourceStyle,
  TEMPERATURE_STYLE,
} from './leadLabels';

const field =
  'w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark';
const labelCls = 'mb-1 block text-xs font-medium text-text-secondary';

type Agent = { id: string; name: string; can_receive?: boolean };

/**
 * "New enquiry" for a lead: a repeat enquiry from the same number. While the number has an open lead
 * the user confirms closing it (lost, 'New enquiry') and the request carries confirm_close_open: true.
 */
export function NewEnquiryButton({
  lead,
  onCreated,
  onError,
  size = 'sm',
}: {
  lead: { id: string; closed_at: string | null };
  onCreated: (newLeadId: string) => void;
  onError: (message: string) => void;
  size?: 'sm' | 'md';
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send(confirm: boolean) {
    setBusy(true);
    try {
      const { ok, data } = await leadsApi<{ lead?: { id: string } }>(`/api/whatsapp/leads/${lead.id}/new-enquiry`, {
        method: 'POST',
        body: JSON.stringify(confirm ? { confirm_close_open: true } : {}),
      });
      if (ok && data.lead) {
        setConfirming(false);
        onCreated(data.lead.id);
        return;
      }
      // A closed lead whose number has another open lead: ask before closing that one.
      if (data.code === 'LEAD_OPEN' && !confirm) {
        setConfirming(true);
        return;
      }
      setConfirming(false);
      onError(data.error || 'Could not start a new enquiry');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size={size}
        disabled={busy}
        onClick={() => (lead.closed_at ? void send(false) : setConfirming(true))}
      >
        <RotateCcw className="mr-1 h-4 w-4" />
        New enquiry
      </Button>
      {confirming && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Start a new enquiry?">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl dark:bg-surface-dark">
            <h2 className="text-base font-semibold text-text-primary">Start a new enquiry?</h2>
            <p className="mt-1 text-sm text-text-secondary">
              This number already has an open lead. It will be closed as lost (&ldquo;New enquiry&rdquo;) and a new lead opened.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={() => void send(true)} disabled={busy}>
                {busy ? 'Starting…' : 'Close it and start'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** One lead in a side panel: deal, owner, note, reminders, the number's other enquiries and actions. */
export function LeadDrawer({
  leadId,
  onClose,
  onChanged,
  onOpenLead,
}: {
  leadId: string | null;
  onClose: () => void;
  /** Something on the lead changed (or a lead was added); refresh lists and boards. */
  onChanged?: () => void;
  /** The drawer switched to another lead (other enquiries, new enquiry). */
  onOpenLead?: (id: string) => void;
}) {
  const router = useRouter();
  const { business } = useAuth();
  const [id, setId] = useState<string | null>(leadId);
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [stages, setStages] = useState<StageOption[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [value, setValue] = useState('');
  const [closeOn, setCloseOn] = useState('');
  const [lostReason, setLostReason] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remindOpen, setRemindOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);

  useEffect(() => setId(leadId), [leadId]);
  // The lead on screen; an answer for one the drawer has since left is dropped.
  const shownId = useRef<string | null>(leadId);
  shownId.current = id;

  const load = useCallback(async (leadToLoad: string) => {
    const { ok, status, data } = await leadsApi<{ lead: LeadDetail }>(`/api/whatsapp/leads/${encodeURIComponent(leadToLoad)}`);
    if (shownId.current !== leadToLoad) return;
    if (!ok) {
      setLead(null);
      setNotFound(status === 404);
      if (status !== 404) setError(data.error || 'Could not load the lead');
      return;
    }
    const l = data.lead;
    setLead(l);
    setNotFound(false);
    setValue(l.deal_value != null ? String(l.deal_value) : '');
    setCloseOn(l.expected_close_on || '');
    setLostReason(l.lost_reason || '');
    setNote(l.note || '');
  }, []);

  useEffect(() => {
    // A new lead, or the drawer closing (Escape too), drops the dialogs opened for the last one.
    setRemindOpen(false);
    setConvertOpen(false);
    setMessageOpen(false);
    if (!id) return;
    setLead(null);
    setNotFound(false);
    setError(null);
    void load(id);
  }, [id, load]);

  useEffect(() => {
    if (!id || stages.length) return;
    void leadsApi('/api/whatsapp/pipeline/stages').then(({ data }) => setStages(data.stages || []));
    void leadsApi('/api/whatsapp/users').then(({ data }) =>
      setAgents((data.users || []).filter((u: Agent) => u.can_receive !== false)),
    );
  }, [id, stages.length]);

  function switchTo(next: string) {
    setId(next);
    onOpenLead?.(next);
  }

  async function save(body: Record<string, unknown>) {
    if (!lead) return;
    setSaving(true);
    setError(null);
    try {
      const { ok, data } = await leadsApi(`/api/whatsapp/leads/${lead.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      if (!ok) setError(data.error || 'Could not save');
      await load(lead.id);
      if (ok) onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  async function updateFollowup(followupId: string, body: Record<string, unknown>) {
    const { ok, data } = await leadsApi(`/api/whatsapp/followups/${followupId}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!ok) setError(data.error || 'Could not update the reminder');
    if (lead) await load(lead.id);
  }

  const stage = stages.find((s) => s.id === lead?.stage_id) ?? null;
  const ownerOptions = lead?.owner_id && !agents.some((a) => a.id === lead.owner_id)
    ? [...agents, { id: lead.owner_id, name: lead.owner_name || 'Current owner' }]
    : agents;

  return (
    <>
      <SlideOverPanel open={!!id} onClose={onClose} title={lead?.name || 'Lead'} widthClass="max-w-lg">
        {!lead ? (
          <div className="p-6 text-sm text-text-muted">
            {notFound ? (
              'This lead was not found, or you cannot see it.'
            ) : error ? (
              <span className="text-red-600">{error}</span>
            ) : (
              <span className="flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading lead…</span>
            )}
          </div>
        ) : (
          <div className="space-y-5 p-4">
            {/* Contact */}
            <section className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-text-muted" />
                <span className="text-text-primary">{formatLeadPhone(lead.phone)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${LEAD_TYPE_STYLE[lead.lead_type]}`}>
                  {LEAD_TYPE_LABEL[lead.lead_type]}
                </span>
                {lead.closed_at ? (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                    Closed {format(new Date(lead.closed_at), 'd MMM yyyy')}
                  </span>
                ) : (
                  <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700">Open</span>
                )}
                {lead.temperature && TEMPERATURE_STYLE[lead.temperature] && (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${TEMPERATURE_STYLE[lead.temperature]}`}>
                    {lead.temperature}
                    {lead.lead_score != null ? ` · ${lead.lead_score}` : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-text-secondary">Source</span>
                <span
                  className={`truncate rounded-full px-2 py-0.5 font-medium ${sourceStyle(lead.source)}`}
                  title={typeof lead.source_detail?.message === 'string' ? (lead.source_detail.message as string) : undefined}
                >
                  {describeLeadSource(lead.source, lead.source_detail)}
                </span>
              </div>
              <p className="text-xs text-text-muted">
                Opened {format(new Date(lead.opened_at), 'd MMM yyyy, h:mm a')}
                {lead.message_count != null ? ` · ${lead.message_count} messages` : ' · No chat yet'}
              </p>
            </section>

            {/* Actions */}
            <section className="flex flex-wrap gap-2">
              {lead.conversation_id ? (
                <Link
                  href={`/whatsapp/conversations?c=${lead.conversation_id}`}
                  className="inline-flex items-center rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
                >
                  <MessageCircle className="mr-1 h-4 w-4" />
                  Open chat
                </Link>
              ) : (
                <Button type="button" size="sm" onClick={() => setMessageOpen(true)}>
                  <Send className="mr-1 h-4 w-4" />
                  Message
                </Button>
              )}
              {lead.customer_id ? (
                <Link
                  href={`/customers/${lead.customer_id}`}
                  className="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-surface-secondary dark:border-border-dark"
                >
                  <UserCheck className="mr-1 h-4 w-4" />
                  View customer
                </Link>
              ) : (
                <Button type="button" variant="secondary" size="sm" onClick={() => setConvertOpen(true)}>
                  <UserCheck className="mr-1 h-4 w-4" />
                  Convert to customer
                </Button>
              )}
              <NewEnquiryButton
                lead={lead}
                onCreated={(newId) => {
                  onChanged?.();
                  switchTo(newId);
                }}
                onError={setError}
              />
            </section>

            {/* Deal */}
            <section className="space-y-3">
              <div>
                <label className={labelCls} htmlFor="lead-stage">
                  Pipeline stage
                  {saving && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
                </label>
                <div className="flex items-center gap-2">
                  {stage && <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STAGE_DOT[stage.color]}`} />}
                  <select
                    id="lead-stage"
                    className={field}
                    value={lead.stage_id || ''}
                    disabled={saving}
                    onChange={(e) => void save({ stage_id: e.target.value || null })}
                  >
                    <option value="">Not on the pipeline</option>
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {lead.stage_id && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls} htmlFor="lead-value">Deal value (₹)</label>
                    <input
                      id="lead-value"
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
                        if (next !== lead.deal_value) void save({ deal_value: next });
                      }}
                    />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="lead-close">Expected close</label>
                    <input
                      id="lead-close"
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
                  <label className={labelCls} htmlFor="lead-lost">Why it was lost</label>
                  <input
                    id="lead-lost"
                    className={field}
                    maxLength={200}
                    value={lostReason}
                    placeholder="e.g. Price too high"
                    onChange={(e) => setLostReason(e.target.value)}
                    onBlur={() => {
                      const reason = lostReason.trim();
                      if ((reason || null) !== (lead.lost_reason || null)) void save({ lost_reason: reason });
                    }}
                  />
                </div>
              )}

              <div>
                <label className={labelCls} htmlFor="lead-owner">Owner</label>
                <select
                  id="lead-owner"
                  className={field}
                  value={lead.owner_id || ''}
                  disabled={saving}
                  onChange={(e) => void save({ owner_id: e.target.value || null })}
                >
                  <option value="">Nobody</option>
                  {ownerOptions.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls} htmlFor="lead-note">Note</label>
                <textarea
                  id="lead-note"
                  className={field}
                  rows={3}
                  maxLength={2000}
                  value={note}
                  placeholder="What they asked for, budget, timing…"
                  onChange={(e) => setNote(e.target.value)}
                  onBlur={() => {
                    if (note !== (lead.note || '')) void save({ note });
                  }}
                />
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
            </section>

            {lead.summary && (
              <section>
                <h3 className={labelCls}>AI summary</h3>
                <p className="whitespace-pre-line rounded-lg bg-surface-secondary p-2 text-sm text-text-secondary dark:bg-surface-dark">{lead.summary}</p>
              </section>
            )}

            <section>
              <LeadNotes leadId={lead.id} />
            </section>

            {/* Follow-ups */}
            <section>
              <div className="mb-1 flex items-center justify-between">
                <h3 className={labelCls}>Follow-ups</h3>
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
              {lead.followups.length === 0 && !remindOpen && <p className="text-xs text-text-muted">No reminders on this lead.</p>}
              <ul className="space-y-1.5">
                {lead.followups.map((f) => {
                  const due = new Date(f.due_at);
                  const overdue = isPast(due);
                  return (
                    <li key={f.id} className="rounded-lg border border-border px-2 py-1.5 text-xs dark:border-border-dark">
                      <div className="flex items-center gap-2">
                        <AlarmClock className={`h-3.5 w-3.5 shrink-0 ${overdue ? 'text-red-600' : 'text-text-muted'}`} />
                        <span className={overdue ? 'font-medium text-red-700' : 'text-text-primary'}>{format(due, 'EEE d MMM, h:mm a')}</span>
                        <span className="ml-auto truncate text-text-muted">{f.assigned_name}</span>
                      </div>
                      {f.note && <p className="mt-0.5 pl-5 text-text-secondary">{f.note}</p>}
                      <div className="mt-1 flex gap-3 pl-5">
                        <button type="button" className="inline-flex items-center gap-0.5 font-medium text-emerald-700 hover:underline" onClick={() => void updateFollowup(f.id, { status: 'done' })}>
                          <Check className="h-3 w-3" /> Done
                        </button>
                        <button type="button" className="text-text-secondary hover:underline" onClick={() => void updateFollowup(f.id, { status: 'cancelled' })}>
                          Cancel
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {remindOpen && (
                <ReminderForm
                  target={{ lead_id: lead.id }}
                  onDone={async (err) => {
                    if (err) {
                      setError(err);
                      return;
                    }
                    setRemindOpen(false);
                    await load(lead.id);
                    onChanged?.();
                  }}
                  onCancel={() => setRemindOpen(false)}
                />
              )}
            </section>

            {/* The number's other enquiries */}
            {lead.other_leads.length > 0 && (
              <section>
                <h3 className={labelCls}>Other leads from this number</h3>
                <ul className="divide-y divide-border rounded-lg border border-border dark:divide-border-dark dark:border-border-dark">
                  {lead.other_leads.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-secondary dark:hover:bg-surface-dark"
                        onClick={() => switchTo(o.id)}
                      >
                        <span className="text-text-primary">{format(new Date(o.opened_at), 'd MMM yyyy')}</span>
                        <span className="text-text-muted">{o.stage_name || 'Not on the pipeline'}</span>
                        <span className="ml-auto text-xs text-text-muted">{o.closed_at ? 'Closed' : 'Open'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </SlideOverPanel>

      {id && lead && convertOpen && (
        <ConvertLeadDialog
          leadId={lead.id}
          name={lead.name}
          phone={lead.phone}
          onClose={() => setConvertOpen(false)}
          onConverted={() => {
            setConvertOpen(false);
            void load(lead.id);
            onChanged?.();
          }}
        />
      )}

      {id && lead && messageOpen && (
        // The modal sits at z-50; this wrapper lifts it above the panel (z-70).
        <div className="relative z-[80]">
          <NewConversationModal
            isOpen
            onClose={() => setMessageOpen(false)}
            onSuccess={(_phone, conversationId) => {
              if (conversationId) router.push(`/whatsapp/conversations?c=${conversationId}`);
              else {
                void load(lead.id);
                onChanged?.();
              }
            }}
            businessId={business?.id || ''}
            initialPhoneNumber={`+${lead.phone.replace(/\D/g, '')}`}
          />
        </div>
      )}
    </>
  );
}
