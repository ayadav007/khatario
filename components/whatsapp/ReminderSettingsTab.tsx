'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useFeatureUpgradeModal } from '@/contexts/FeatureUpgradeModalContext';
import { PlanFeatureDeniedCallout } from '@/components/subscription/PlanFeatureDeniedCallout';
import { SettingsFloatingSaveBar } from '@/components/settings/SettingsFloatingSaveBar';
import { SettingsBlock } from '@/components/whatsapp/settings/SettingsBlock';
import { FeatureKeys } from '@/lib/featureKeys';
import { getApiErrorMessage } from '@/lib/api-utils';

type DueRule = {
  enabled: boolean;
  days_before: number | null;
  message_template: string;
  include_pdf: boolean;
};

type OverdueRule = {
  enabled: boolean;
  interval_days: number | null;
  message_template: string;
  include_pdf: boolean;
};

interface ReminderSettings {
  payment_due: DueRule | null;
  overdue: OverdueRule | null;
}

/** Local clock time + IANA zone for the daily auto reminder run (see business_settings). */
interface ReminderSchedule {
  reminder_send_time: string;
  reminder_send_timezone: string;
}

const DEFAULT_SCHEDULE: ReminderSchedule = {
  reminder_send_time: '09:00',
  reminder_send_timezone: 'Asia/Kolkata',
};

const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Dubai', label: 'UAE' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Bangkok', label: 'Bangkok' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Paris', label: 'Paris' },
  { value: 'America/New_York', label: 'US Eastern' },
  { value: 'America/Chicago', label: 'US Central' },
  { value: 'America/Los_Angeles', label: 'US Pacific' },
  { value: 'Australia/Sydney', label: 'Sydney' },
  { value: 'Pacific/Auckland', label: 'Auckland' },
];

const DEFAULT_PAYMENT_DUE_TEMPLATE = `Hi {customer_name},

This is a friendly reminder that invoice {invoice_no} for {amount} is due on {due_date}.

Please arrange payment at your earliest convenience.

Thank you!
{business_name}`;

const DEFAULT_OVERDUE_TEMPLATE = `Hi {customer_name},

Invoice {invoice_no} for {balance_amount} is now overdue. The due date was {due_date}.

Please arrange payment immediately to avoid any inconvenience.

Thank you!
{business_name}`;

const DEFAULT_DUE: DueRule = { enabled: false, days_before: 1, message_template: DEFAULT_PAYMENT_DUE_TEMPLATE, include_pdf: true };
const DEFAULT_OVERDUE: OverdueRule = { enabled: false, interval_days: 7, message_template: DEFAULT_OVERDUE_TEMPLATE, include_pdf: true };

const PLACEHOLDERS = '{customer_name}, {invoice_no}, {amount}, {due_date}, {balance_amount}, {business_name}';

function MessageFields({
  template,
  includePdf,
  onTemplate,
  onIncludePdf,
}: {
  template: string;
  includePdf: boolean;
  onTemplate: (v: string) => void;
  onIncludePdf: (v: boolean) => void;
}) {
  return (
    <>
      <div>
        <label className="type-label mb-1.5 block">Message</label>
        <Textarea rows={7} value={template} onChange={(e) => onTemplate(e.target.value)} />
        <p className="mt-1 text-xs text-text-secondary">You can use: {PLACEHOLDERS}</p>
      </div>
      <Switch
        checked={includePdf}
        onChange={onIncludePdf}
        label="Attach the invoice PDF"
        description="Sends the invoice along with the message."
      />
    </>
  );
}

export function ReminderSettingsTab() {
  const { business } = useAuth();
  const toast = useToastContext();
  const { openIfFeatureDeniedResponse } = useFeatureUpgradeModal();
  const [settings, setSettings] = useState<ReminderSettings>({ payment_due: null, overdue: null });
  const [schedule, setSchedule] = useState<ReminderSchedule>(DEFAULT_SCHEDULE);
  const [saved, setSaved] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [planDenied, setPlanDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (business?.id) void fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]);

  const snapshot = (s: ReminderSettings, sch: ReminderSchedule) => JSON.stringify({ s, sch });

  const fetchSettings = async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/reminders?business_id=${business.id}`);
      if (res.ok) {
        const data = await res.json();
        const next: ReminderSettings = {
          payment_due: data.settings.payment_due || DEFAULT_DUE,
          overdue: data.settings.overdue || DEFAULT_OVERDUE,
        };
        const nextSchedule: ReminderSchedule = data.schedule
          ? {
              reminder_send_time: (data.schedule.reminder_send_time as string) || '09:00',
              reminder_send_timezone: (data.schedule.reminder_send_timezone as string) || 'Asia/Kolkata',
            }
          : DEFAULT_SCHEDULE;
        setSettings(next);
        setSchedule(nextSchedule);
        setSaved(snapshot(next, nextSchedule));
      } else {
        const data = await res.json().catch(() => null);
        if (openIfFeatureDeniedResponse(res.status, data)) setPlanDenied(true);
        else setError(getApiErrorMessage(data, 'Failed to load reminder settings'));
      }
    } catch {
      setError('Failed to load reminder settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!business?.id) return;
    setSaving(true);
    setError(null);
    setPlanDenied(false);

    try {
      const normalizedSchedule = {
        reminder_send_time: schedule.reminder_send_time,
        reminder_send_timezone: schedule.reminder_send_timezone.trim() || 'Asia/Kolkata',
      };
      const res = await fetch('/api/whatsapp/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          payment_due: settings.payment_due,
          overdue: settings.overdue,
          schedule: normalizedSchedule,
        }),
      });

      const text = await res.text();
      let data: Record<string, unknown> | null = null;
      try {
        if (text.trim()) {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
        }
      } catch {
        if (!res.ok) {
          setError('Failed to save settings');
          return;
        }
      }

      if (res.ok) {
        setSaved(snapshot(settings, schedule));
        toast.success('Reminder settings saved');
        return;
      }
      if (openIfFeatureDeniedResponse(res.status, data)) {
        setPlanDenied(true);
        return;
      }
      setError(getApiErrorMessage(data, 'Failed to save settings'));
    } catch {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SettingsBlock title="Payment reminders" description="Automatic WhatsApp reminders for unpaid invoices.">
        <p className="text-sm text-text-secondary">Loading…</p>
      </SettingsBlock>
    );
  }

  const due = settings.payment_due ?? DEFAULT_DUE;
  const overdue = settings.overdue ?? DEFAULT_OVERDUE;
  const setDue = (p: Partial<DueRule>) => setSettings((s) => ({ ...s, payment_due: { ...(s.payment_due ?? DEFAULT_DUE), ...p } }));
  const setOverdue = (p: Partial<OverdueRule>) =>
    setSettings((s) => ({ ...s, overdue: { ...(s.overdue ?? DEFAULT_OVERDUE), ...p } }));
  const dirty = saved !== '' && saved !== snapshot(settings, schedule);

  return (
    <>
      {planDenied || error ? (
        <div className="space-y-3">
          {planDenied ? (
            <PlanFeatureDeniedCallout
              featureKey={FeatureKeys.WHATSAPP_AUTO_REMINDERS}
              title="WhatsApp auto reminders are not on your plan"
            />
          ) : null}
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}

      <SettingsBlock
        id="reminder-time"
        title="When reminders go out"
        description="Both reminder types are sent once a day at this local time. A Cloud API number uses the approved template chosen under Templates."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Local time"
            type="time"
            value={schedule.reminder_send_time.length === 5 ? schedule.reminder_send_time : '09:00'}
            onChange={(e) => setSchedule((s) => ({ ...s, reminder_send_time: e.target.value || '09:00' }))}
          />
          <div>
            <Input
              label="Time zone"
              type="text"
              list="reminder-tz-datalist"
              value={schedule.reminder_send_timezone}
              onChange={(e) =>
                setSchedule((s) => ({ ...s, reminder_send_timezone: e.target.value.trim() || 'Asia/Kolkata' }))
              }
              placeholder="e.g. Asia/Kolkata"
              autoComplete="off"
              helperText="Pick a suggestion or type any IANA zone, like Asia/Kolkata."
            />
            <datalist id="reminder-tz-datalist">
              {TIMEZONE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} label={o.label} />
              ))}
            </datalist>
          </div>
        </div>
      </SettingsBlock>

      <SettingsBlock
        id="reminder-due"
        title="Before the due date"
        description="A friendly nudge a few days before an invoice is due."
      >
        <Switch
          checked={due.enabled}
          onChange={(enabled) => setDue({ enabled })}
          label="Send a reminder before the due date"
        />
        {due.enabled ? (
          <div className="space-y-4 border-t border-border pt-4 dark:border-border-dark">
            <div className="max-w-xs">
              <Input
                label="Days before the due date"
                type="number"
                min="1"
                max="30"
                value={due.days_before || 1}
                onChange={(e) => setDue({ days_before: parseInt(e.target.value) || 1 })}
              />
            </div>
            <MessageFields
              template={due.message_template}
              includePdf={due.include_pdf !== false}
              onTemplate={(message_template) => setDue({ message_template })}
              onIncludePdf={(include_pdf) => setDue({ include_pdf })}
            />
          </div>
        ) : null}
      </SettingsBlock>

      <SettingsBlock
        id="reminder-overdue"
        title="After the due date"
        description="Repeats until the invoice is paid."
      >
        <Switch
          checked={overdue.enabled}
          onChange={(enabled) => setOverdue({ enabled })}
          label="Remind customers about overdue invoices"
        />
        {overdue.enabled ? (
          <div className="space-y-4 border-t border-border pt-4 dark:border-border-dark">
            <div className="max-w-xs">
              <Input
                label="Repeat every (days)"
                type="number"
                min="1"
                max="30"
                value={overdue.interval_days || 7}
                onChange={(e) => setOverdue({ interval_days: parseInt(e.target.value) || 7 })}
              />
            </div>
            <MessageFields
              template={overdue.message_template}
              includePdf={overdue.include_pdf !== false}
              onTemplate={(message_template) => setOverdue({ message_template })}
              onIncludePdf={(include_pdf) => setOverdue({ include_pdf })}
            />
          </div>
        ) : null}
      </SettingsBlock>

      {dirty ? (
        <SettingsFloatingSaveBar align="between">
          <span className="text-sm text-text-secondary">You have unsaved reminder changes</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => void fetchSettings()} disabled={saving}>
              Discard
            </Button>
            <Button size="sm" onClick={() => void handleSave()} isLoading={saving}>
              Save reminders
            </Button>
          </div>
        </SettingsFloatingSaveBar>
      ) : null}
    </>
  );
}
