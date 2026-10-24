'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mail } from 'lucide-react';

type Settings = {
  notify_new_signup: boolean;
  notify_subscription_changes: boolean;
  notify_payment_failures: boolean;
  notify_incidents: boolean;
  notify_push_signup: boolean;
  notify_push_incident: boolean;
  platform_notify_email: string | null;
};

export function AdminNotificationSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/settings/notifications', { credentials: 'include' });
      const data = await res.json();
      if (res.ok) setSettings(data.settings);
      else setMessage(data.error || 'Failed to load settings');
    } catch {
      setMessage('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/settings/notifications', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (res.ok) {
        setSettings(data.settings);
        setMessage('Saved.');
      } else {
        setMessage(data.error || 'Save failed');
      }
    } catch {
      setMessage('Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-600">Loading notification settings…</p>;
  }

  if (!settings) {
    return <p className="text-sm text-red-600">{message || 'Could not load settings.'}</p>;
  }

  const toggle = (key: keyof Settings) => {
    if (key === 'platform_notify_email') return;
    setSettings((s) => (s ? { ...s, [key]: !s[key] } : s));
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-900">Notification Settings</h2>
      <p className="text-sm text-gray-600">
        Emails use SMTP from the server env (<code className="text-xs">SMTP_USER</code>,{' '}
        <code className="text-xs">SMTP_PASSWORD</code>). The customer does not get a welcome email unless they
        entered a business email. You get an admin email only if an active platform admin has an email, or you
        set the inbox override below. Check <strong>Email logs</strong> on this page if a signup was silent.
      </p>
      <p className="text-sm text-gray-600">
        Install this admin console on your phone from Chrome (not WhatsApp/Gmail in-app browser). Staging
        installs as <strong>Khatario STG</strong>. Then open that icon and tap <strong>Enable alerts</strong>{' '}
        while logged in. After a deploy, tap Enable alerts again so the phone re-subscribes. Test with the app
        fully closed (not just in the background). If Android battery settings restrict Chrome or Khatario STG,
        background alerts will wait until you open the app.
      </p>

      <div className="space-y-4">
        {(
          [
            {
              key: 'notify_new_signup' as const,
              title: 'New Business Registration',
              desc: 'Email when a new business signs up',
            },
            {
              key: 'notify_subscription_changes' as const,
              title: 'Subscription Changes',
              desc: 'Plan upgrades and changes from tenants',
            },
            {
              key: 'notify_payment_failures' as const,
              title: 'Payment Failures (email)',
              desc: 'Alert when a subscription payment fails',
            },
            {
              key: 'notify_incidents' as const,
              title: 'Incidents (email)',
              desc: 'Demo bookings and other operator incidents',
            },
            {
              key: 'notify_push_signup' as const,
              title: 'Push: new signup',
              desc: 'Phone notification when a business registers',
            },
            {
              key: 'notify_push_incident' as const,
              title: 'Push: incidents',
              desc: 'Phone notification for demo bookings and payment failures',
            },
          ] as const
        ).map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-border"
          >
            <div className="flex items-center space-x-3">
              <Mail className="w-5 h-5 text-gray-600" />
              <div>
                <p className="font-medium text-gray-900">{item.title}</p>
                <p className="text-sm text-gray-600">{item.desc}</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings[item.key]}
              onChange={() => toggle(item.key)}
              className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
            />
          </div>
        ))}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Notification inbox override (optional)
        </label>
        <input
          type="email"
          value={settings.platform_notify_email || ''}
          onChange={(e) =>
            setSettings((s) =>
              s ? { ...s, platform_notify_email: e.target.value.trim() || null } : s,
            )
          }
          placeholder="Leave empty → all active admin emails"
          className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
        />
      </div>

      {message && (
        <p className={`text-sm ${message === 'Saved.' ? 'text-green-700' : 'text-red-600'}`}>{message}</p>
      )}

      <div className="pt-2 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button
          type="button"
          onClick={async () => {
            setMessage(null);
            const res = await fetch('/api/admin/push/test', { method: 'POST', credentials: 'include' });
            const data = await res.json();
            if (res.ok) setMessage(data.sent ? `Test push sent to ${data.sent} device(s).` : 'No phones subscribed yet. Enable alerts in the top bar.');
            else setMessage(data.error || 'Test push failed');
          }}
          className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
        >
          Send test push
        </button>
      </div>
    </div>
  );
}
