'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { Toast } from '@/components/ui/Toast';
import { useFeatureUpgradeModal } from '@/contexts/FeatureUpgradeModalContext';
import { PlanFeatureDeniedCallout } from '@/components/subscription/PlanFeatureDeniedCallout';
import { FeatureKeys } from '@/lib/featureKeys';
import { getApiErrorMessage } from '@/lib/api-utils';

interface ReminderSettings {
  payment_due: {
    enabled: boolean;
    days_before: number | null;
    message_template: string;
    include_pdf: boolean;
  } | null;
  overdue: {
    enabled: boolean;
    interval_days: number | null;
    message_template: string;
    include_pdf: boolean;
  } | null;
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

export function ReminderSettingsTab() {
  const { business } = useAuth();
  const { openIfFeatureDeniedResponse } = useFeatureUpgradeModal();
  const [settings, setSettings] = useState<ReminderSettings>({
    payment_due: null,
    overdue: null
  });
  const [schedule, setSchedule] = useState<ReminderSchedule>(DEFAULT_SCHEDULE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [planDenied, setPlanDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);

  useEffect(() => {
    if (business?.id) {
      fetchSettings();
    }
  }, [business?.id]);

  const fetchSettings = async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/reminders?business_id=${business.id}`);
      if (res.ok) {
        const data = await res.json();
        setSettings({
          payment_due: data.settings.payment_due || {
            enabled: false,
            days_before: 1,
            message_template: DEFAULT_PAYMENT_DUE_TEMPLATE,
            include_pdf: true
          },
          overdue: data.settings.overdue || {
            enabled: false,
            interval_days: 7,
            message_template: DEFAULT_OVERDUE_TEMPLATE,
            include_pdf: true
          }
        });
        if (data.schedule) {
          setSchedule({
            reminder_send_time: (data.schedule.reminder_send_time as string) || '09:00',
            reminder_send_timezone: (data.schedule.reminder_send_timezone as string) || 'Asia/Kolkata',
          });
        } else {
          setSchedule(DEFAULT_SCHEDULE);
        }
      }
    } catch (error) {
      console.error('Failed to fetch reminder settings:', error);
      setError('Failed to load settings');
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
      const res = await fetch('/api/whatsapp/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          payment_due: settings.payment_due,
          overdue: settings.overdue,
          schedule: {
            reminder_send_time: schedule.reminder_send_time,
            reminder_send_timezone: schedule.reminder_send_timezone.trim() || 'Asia/Kolkata',
          },
        })
      });

      const text = await res.text();
      let data: Record<string, unknown> | null = null;
      try {
        if (text.trim()) {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            data = parsed as Record<string, unknown>;
          }
        }
      } catch {
        if (!res.ok) {
          setError('Failed to save settings');
          return;
        }
      }

      if (res.ok) {
        setToast({ message: 'Settings saved successfully', type: 'success' });
        return;
      }

      if (openIfFeatureDeniedResponse(res.status, data)) {
        setPlanDenied(true);
        return;
      }

      setError(getApiErrorMessage(data, 'Failed to save settings'));
    } catch (error) {
      console.error('Failed to save settings:', error);
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-500">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {planDenied && (
        <PlanFeatureDeniedCallout
          featureKey={FeatureKeys.WHATSAPP_AUTO_REMINDERS}
          title="WhatsApp auto reminders are not on your plan"
        />
      )}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      <Card padding="lg">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">When to send auto reminders</h3>
        <p className="text-sm text-gray-600 mb-4">
          Choose the local time and time zone for your business. Payment-due and overdue runs both use
          this window once per day (checked every 15 minutes on the server).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Local time</label>
            <input
              type="time"
              value={schedule.reminder_send_time.length === 5 ? schedule.reminder_send_time : '09:00'}
              onChange={(e) =>
                setSchedule((s) => ({ ...s, reminder_send_time: e.target.value || '09:00' }))
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-text-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Time zone (IANA)</label>
            <input
              type="text"
              list="reminder-tz-datalist"
              value={schedule.reminder_send_timezone}
              onChange={(e) =>
                setSchedule((s) => ({
                  ...s,
                  reminder_send_timezone: (e.target.value || 'Asia/Kolkata').trim() || 'Asia/Kolkata',
                }))
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="e.g. Asia/Kolkata"
              autoComplete="off"
            />
            <datalist id="reminder-tz-datalist">
              {TIMEZONE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} label={o.label} />
              ))}
            </datalist>
            <p className="text-xs text-gray-500 mt-1">Pick a suggestion or type any valid IANA zone id.</p>
          </div>
        </div>
      </Card>

      {/* Payment Due Reminder */}
      <Card padding="lg">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Payment Due Reminder</h3>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={settings.payment_due?.enabled || false}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    payment_due: {
                      ...(settings.payment_due || {
                        days_before: 1,
                        message_template: DEFAULT_PAYMENT_DUE_TEMPLATE,
                        include_pdf: true
                      }),
                      enabled: e.target.checked
                    }
                  })
                }
                className="mr-2"
              />
              <span className="text-sm text-gray-700">Enable</span>
            </label>
          </div>

          {settings.payment_due?.enabled && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Days Before Due Date
                </label>
                <Input
                  type="number"
                  min="1"
                  max="30"
                  value={settings.payment_due?.days_before || 1}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      payment_due: {
                        ...settings.payment_due!,
                        days_before: parseInt(e.target.value) || 1
                      }
                    })
                  }
                />
                <p className="text-xs text-gray-500 mt-1">Send reminder X days before the due date</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Message Template
                </label>
                <textarea
                  value={settings.payment_due?.message_template || ''}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      payment_due: {
                        ...settings.payment_due!,
                        message_template: e.target.value
                      }
                    })
                  }
                  rows={8}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Available placeholders: {'{customer_name}'}, {'{invoice_no}'}, {'{amount}'}, {'{due_date}'}, {'{balance_amount}'}, {'{business_name}'}
                </p>
              </div>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={settings.payment_due?.include_pdf !== false}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      payment_due: {
                        ...settings.payment_due!,
                        include_pdf: e.target.checked
                      }
                    })
                  }
                  className="mr-2"
                />
                <span className="text-sm text-gray-700">Include PDF attachment</span>
              </label>
            </>
          )}
        </div>
      </Card>

      {/* Overdue Reminder */}
      <Card padding="lg">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Overdue Reminder</h3>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={settings.overdue?.enabled || false}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    overdue: {
                      ...(settings.overdue || {
                        interval_days: 7,
                        message_template: DEFAULT_OVERDUE_TEMPLATE,
                        include_pdf: true
                      }),
                      enabled: e.target.checked
                    }
                  })
                }
                className="mr-2"
              />
              <span className="text-sm text-gray-700">Enable</span>
            </label>
          </div>

          {settings.overdue?.enabled && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Interval (Days)
                </label>
                <Input
                  type="number"
                  min="1"
                  max="30"
                  value={settings.overdue?.interval_days || 7}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      overdue: {
                        ...settings.overdue!,
                        interval_days: parseInt(e.target.value) || 7
                      }
                    })
                  }
                />
                <p className="text-xs text-gray-500 mt-1">Send reminder every X days for overdue invoices</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Message Template
                </label>
                <textarea
                  value={settings.overdue?.message_template || ''}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      overdue: {
                        ...settings.overdue!,
                        message_template: e.target.value
                      }
                    })
                  }
                  rows={8}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Available placeholders: {'{customer_name}'}, {'{invoice_no}'}, {'{amount}'}, {'{due_date}'}, {'{balance_amount}'}, {'{business_name}'}
                </p>
              </div>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={settings.overdue?.include_pdf !== false}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      overdue: {
                        ...settings.overdue!,
                        include_pdf: e.target.checked
                      }
                    })
                  }
                  className="mr-2"
                />
                <span className="text-sm text-gray-700">Include PDF attachment</span>
              </label>
            </>
          )}
        </div>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

