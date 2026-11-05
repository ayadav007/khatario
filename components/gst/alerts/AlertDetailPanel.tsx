'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { BellOff, CheckCircle2, Clock, Lightbulb, MessageCircle, RotateCcw, X } from 'lucide-react';
import { AlertDocuments } from './AlertDocuments';
import {
  checkMeta,
  dateLabel,
  dateTimeLabel,
  DISMISS_REASONS,
  dueLabel,
  inr,
  recommendedAction,
  SEVERITY_STYLE,
  type GstAlert,
} from './alert-meta';

export type AlertView = 'active' | 'dismissed' | 'resolved';

interface Props {
  alert: GstAlert;
  view: AlertView;
  busy: boolean;
  assistantOn: boolean;
  onClose: () => void;
  onPostReversal: (alert: GstAlert) => void;
  onMarkFiled: (alert: GstAlert) => void;
  onAsk: (question: string) => void;
  onDismiss: (alert: GstAlert, reason: string) => void;
  onRestore: (alert: GstAlert) => void;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-t border-gray-100 first:border-t-0">
      <dt className="text-sm text-gray-500 shrink-0">{label}</dt>
      <dd className="text-sm text-gray-900 text-right min-w-0">{children}</dd>
    </div>
  );
}

function DismissForm({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [choice, setChoice] = useState(DISMISS_REASONS[0]);
  const [note, setNote] = useState('');
  const other = choice === 'other';
  const reason = other ? note.trim() : note.trim() ? `${choice}: ${note.trim()}` : choice;
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
      <p className="text-sm font-medium text-gray-900">Why are you dismissing this?</p>
      <p className="text-xs text-gray-500">
        It stays hidden until the alert reaches its next stage. Your reason is saved with your name.
      </p>
      <div className="space-y-1">
        {[...DISMISS_REASONS, 'other'].map((r) => (
          <label key={r} className="flex items-center gap-2 text-sm text-gray-700">
            <input type="radio" name="dismiss-reason" checked={choice === r} onChange={() => setChoice(r)} />
            {r === 'other' ? 'Other reason' : r}
          </label>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 200))}
        rows={2}
        placeholder={other ? 'Write the reason' : 'Add a note (optional)'}
        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm rounded-lg text-gray-700 hover:bg-white">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || reason.length < 3}
          onClick={() => onConfirm(reason)}
          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50"
        >
          Dismiss alert
        </button>
      </div>
    </div>
  );
}

export function AlertDetailPanel({ alert, view, busy, assistantOn, onClose, onPostReversal, onMarkFiled, onAsk, onDismiss, onRestore }: Props) {
  const [dismissing, setDismissing] = useState(false);
  useEffect(() => setDismissing(false), [alert.id]);

  const meta = checkMeta(alert.check_id);
  const style = SEVERITY_STYLE[alert.severity];
  const due = dueLabel(alert);
  const advice = view === 'resolved' ? null : recommendedAction(alert);
  const oldest = alert.details.bills?.[0];
  const isReversal = alert.alert_key === 'rule37:reversal_pending';

  return (
    <div className="bg-white lg:border lg:border-gray-200 lg:rounded-xl lg:shadow-sm">
      <div className="flex items-start justify-between gap-3 p-5 pb-0">
        <span className={`text-xs font-semibold px-2 py-1 rounded-md ${style.pill}`}>{meta.chip}</span>
        <button type="button" onClick={onClose} aria-label="Close alert details" className="p-1 -m-1 text-gray-500 hover:text-gray-900">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-5 space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{alert.title}</h2>
          <p className="mt-1.5 text-sm text-gray-700">{alert.message}</p>
        </div>

        <dl className="rounded-lg border border-gray-200 px-3 py-1">
          <Fact label="Status">
            {view === 'resolved' ? (
              <span className="text-green-700 font-medium">Resolved</span>
            ) : view === 'dismissed' ? (
              <span className="text-gray-700 font-medium">Dismissed</span>
            ) : (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${style.pill}`}>{style.label}</span>
            )}
          </Fact>
          {alert.due_date && !isReversal && <Fact label="Due date">{dateLabel(alert.due_date)}</Fact>}
          {due && view !== 'resolved' && (
            <Fact label="Deadline">
              <span className={due.late ? 'text-red-700 font-medium' : ''}>{due.text}</span>
            </Fact>
          )}
          {meta.impact && alert.amount != null && alert.amount > 0 && <Fact label={meta.impact}>{inr(alert.amount)}</Fact>}
          {isReversal && alert.details.interest_if_utilised ? (
            <Fact label="Interest if credit was used">about {inr(alert.details.interest_if_utilised)}</Fact>
          ) : null}
          {oldest && <Fact label="Oldest bill unpaid">{oldest.days_outstanding} days</Fact>}
          <Fact label="Legal reference">{alert.legal_ref}</Fact>
        </dl>

        {advice && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex gap-3">
            <Lightbulb className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-gray-900">Recommended action</p>
              <p className="mt-0.5 text-sm text-gray-700">{advice}</p>
            </div>
          </div>
        )}

        {view === 'active' && (
          <div className="flex flex-wrap gap-2">
            {isReversal ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onPostReversal(alert)}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60"
              >
                {alert.action_label || 'Post ITC reversal'}
              </button>
            ) : (
              alert.action_url && (
                <Link href={alert.action_url} className="px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700">
                  {alert.action_label || 'Open'}
                </Link>
              )
            )}
            {alert.details.can_mark_filed && alert.details.period && (
              <button
                type="button"
                onClick={() => onMarkFiled(alert)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-primary-600 text-primary-700 bg-white hover:bg-primary-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                Mark as filed
              </button>
            )}
            {assistantOn && alert.ask_question && (
              <button
                type="button"
                onClick={() => onAsk(alert.ask_question!)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
              >
                <MessageCircle className="w-4 h-4" />
                Ask why
              </button>
            )}
          </div>
        )}

        <AlertDocuments alert={alert} />

        {view === 'active' &&
          (dismissing ? (
            <DismissForm busy={busy} onCancel={() => setDismissing(false)} onConfirm={(reason) => onDismiss(alert, reason)} />
          ) : (
            <button
              type="button"
              onClick={() => setDismissing(true)}
              className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
            >
              <BellOff className="w-4 h-4" />
              Dismiss this alert
            </button>
          ))}

        {view === 'dismissed' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRestore(alert)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-60"
          >
            <RotateCcw className="w-4 h-4" />
            Show in active alerts again
          </button>
        )}

        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Clock className="w-4 h-4 text-gray-500" />
            Activity
          </p>
          <ol className="mt-2 ml-2 border-l border-gray-200 space-y-3">
            <ActivityItem label="Alert raised" at={alert.first_seen_at} />
            {alert.notified_at && <ActivityItem label="Notification sent" at={alert.notified_at} />}
            {alert.dismissed_at && (
              <ActivityItem
                label={`Dismissed${alert.dismissed_by_name ? ` by ${alert.dismissed_by_name}` : ''}`}
                at={alert.dismissed_at}
                note={alert.dismissed_reason}
              />
            )}
            {alert.resolved_at ? (
              <ActivityItem label="Resolved: the check no longer finds this" at={alert.resolved_at} done />
            ) : (
              <ActivityItem label="Last checked" at={alert.last_seen_at} />
            )}
          </ol>
        </div>

        <p className="text-xs text-gray-500">
          General information from the GST law applied to your books, not tax advice. Please check with your CA for your case.
        </p>
      </div>
    </div>
  );
}

function ActivityItem({ label, at, note, done }: { label: string; at: string; note?: string | null; done?: boolean }) {
  return (
    <li className="relative pl-4">
      <span className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${done ? 'bg-green-500' : 'bg-gray-300'}`} />
      <p className="text-sm text-gray-900">{label}</p>
      <p className="text-xs text-gray-500">{dateTimeLabel(at)}</p>
      {note && <p className="mt-0.5 text-xs text-gray-600">&ldquo;{note}&rdquo;</p>}
    </li>
  );
}
