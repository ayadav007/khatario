'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Copy, Loader2 } from 'lucide-react';

type ProviderId = 'razorpay' | 'easebuzz';
type Source = 'saved' | 'env' | 'none';

type Settings = {
  active_provider: ProviderId;
  active_source: 'saved' | 'env' | 'default';
  active_ready: boolean;
  razorpay: {
    key_id: string;
    mode: 'test' | 'live' | null;
    has_key_secret: boolean;
    has_webhook_secret: boolean;
    source: Source;
    ready: boolean;
    missing: string[];
  };
  easebuzz: {
    key_masked: string | null;
    has_salt: boolean;
    environment: 'sandbox' | 'production';
    source: Source;
    ready: boolean;
    missing: string[];
  };
  webhook_urls: Record<ProviderId, string>;
};

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm';

function SourceBadge({ source }: { source: Source }) {
  if (source === 'saved') {
    return <span className="text-xs rounded-full bg-green-100 text-green-800 px-2 py-0.5">Saved here</span>;
  }
  if (source === 'env') {
    return <span className="text-xs rounded-full bg-blue-100 text-blue-800 px-2 py-0.5">From server .env</span>;
  }
  return <span className="text-xs rounded-full bg-gray-100 text-gray-700 px-2 py-0.5">Not set up</span>;
}

function ReadyLine({ ready, missing }: { ready: boolean; missing: string[] }) {
  return ready ? (
    <p className="flex items-center gap-1.5 text-sm text-green-700">
      <CheckCircle2 className="w-4 h-4" /> Ready to take payments
    </p>
  ) : (
    <p className="flex items-center gap-1.5 text-sm text-amber-700">
      <AlertTriangle className="w-4 h-4" /> Missing: {missing.join(', ')}
    </p>
  );
}

function WebhookUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
      <div className="flex gap-2">
        <input readOnly value={url} className={`${inputClass} bg-gray-50`} />
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-1"
        >
          <Copy className="w-4 h-4" /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function AdminPlatformPaymentSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [activeProvider, setActiveProvider] = useState<ProviderId>('razorpay');
  const [rzpKeyId, setRzpKeyId] = useState('');
  const [rzpKeySecret, setRzpKeySecret] = useState('');
  const [rzpWebhookSecret, setRzpWebhookSecret] = useState('');
  const [ebKey, setEbKey] = useState('');
  const [ebSalt, setEbSalt] = useState('');
  const [ebEnv, setEbEnv] = useState<'sandbox' | 'production'>('sandbox');

  const apply = useCallback((s: Settings) => {
    setSettings(s);
    setActiveProvider(s.active_provider);
    setRzpKeyId(s.razorpay.key_id);
    setRzpKeySecret('');
    setRzpWebhookSecret('');
    setEbKey('');
    setEbSalt('');
    setEbEnv(s.easebuzz.environment);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/platform-payments', { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load payment settings');
        apply(data.settings);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load payment settings');
      } finally {
        setLoading(false);
      }
    })();
  }, [apply]);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/platform-payments', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          active_provider: activeProvider,
          razorpay: {
            key_id: rzpKeyId,
            key_secret: rzpKeySecret,
            webhook_secret: rzpWebhookSecret,
          },
          easebuzz: { key: ebKey, salt: ebSalt, environment: ebEnv },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save');
      apply(data.settings);
      setNotice(
        `Saved. New subscription and add-on payments will use ${
          data.settings.active_provider === 'easebuzz' ? 'Easebuzz' : 'Razorpay'
        }.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-600">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading payment settings…
      </div>
    );
  }

  if (!settings) {
    return <p className="text-sm text-red-700">{error || 'Could not load payment settings'}</p>;
  }

  const providers: { id: ProviderId; label: string; ready: boolean }[] = [
    { id: 'razorpay', label: 'Razorpay', ready: settings.razorpay.ready },
    { id: 'easebuzz', label: 'Easebuzz', ready: settings.easebuzz.ready },
  ];

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Subscription payments</h2>
        <p className="text-sm text-gray-600 mt-1">
          The gateway businesses use to pay Khatario for plans and WhatsApp add-ons. This is Khatario&apos;s
          own merchant account, not the businesses&apos; payment settings. Secrets are stored encrypted and
          never shown again after saving.
        </p>
      </div>

      <section className="space-y-3">
        <h3 className="font-medium text-gray-900">Active gateway</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {providers.map((p) => (
            <label
              key={p.id}
              className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer ${
                activeProvider === p.id ? 'border-primary-600 ring-1 ring-primary-600' : 'border-gray-200'
              }`}
            >
              <input
                type="radio"
                name="platform-provider"
                value={p.id}
                checked={activeProvider === p.id}
                onChange={() => setActiveProvider(p.id)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium text-gray-900">{p.label}</span>
                <span className={`block text-xs mt-0.5 ${p.ready ? 'text-green-700' : 'text-gray-500'}`}>
                  {p.ready ? 'Configured' : 'Needs credentials'}
                </span>
              </span>
            </label>
          ))}
        </div>
        {settings.active_source !== 'saved' && (
          <p className="text-xs text-gray-500">
            Currently using {settings.active_provider === 'easebuzz' ? 'Easebuzz' : 'Razorpay'} from{' '}
            {settings.active_source === 'env' ? 'the server .env' : 'the default'}. Saving here overrides it.
          </p>
        )}
        <p className="text-xs text-gray-500">
          Switching only affects new checkouts. Payments already started on the other gateway still complete,
          so keep its credentials and webhook in place for a few days.
        </p>
      </section>

      <section className="space-y-4 border-t pt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-gray-900">Razorpay</h3>
          <SourceBadge source={settings.razorpay.source} />
        </div>
        <ReadyLine ready={settings.razorpay.ready} missing={settings.razorpay.missing} />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Key ID{' '}
            {settings.razorpay.mode && (
              <span className="text-xs text-gray-500">({settings.razorpay.mode} mode)</span>
            )}
          </label>
          <input
            value={rzpKeyId}
            onChange={(e) => setRzpKeyId(e.target.value)}
            placeholder="rzp_test_…"
            autoComplete="off"
            className={inputClass}
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Key secret</label>
            <input
              type="password"
              value={rzpKeySecret}
              onChange={(e) => setRzpKeySecret(e.target.value)}
              placeholder={settings.razorpay.has_key_secret ? '•••••• (leave blank to keep)' : 'Enter key secret'}
              autoComplete="new-password"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Webhook secret</label>
            <input
              type="password"
              value={rzpWebhookSecret}
              onChange={(e) => setRzpWebhookSecret(e.target.value)}
              placeholder={
                settings.razorpay.has_webhook_secret ? '•••••• (leave blank to keep)' : 'Enter webhook secret'
              }
              autoComplete="new-password"
              className={inputClass}
            />
          </div>
        </div>
        <WebhookUrl url={settings.webhook_urls.razorpay} />
      </section>

      <section className="space-y-4 border-t pt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-gray-900">Easebuzz</h3>
          <SourceBadge source={settings.easebuzz.source} />
        </div>
        <ReadyLine ready={settings.easebuzz.ready} missing={settings.easebuzz.missing} />
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Merchant key</label>
            <input
              type="password"
              value={ebKey}
              onChange={(e) => setEbKey(e.target.value)}
              placeholder={
                settings.easebuzz.key_masked
                  ? `${settings.easebuzz.key_masked} (leave blank to keep)`
                  : 'Enter merchant key'
              }
              autoComplete="new-password"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Salt</label>
            <input
              type="password"
              value={ebSalt}
              onChange={(e) => setEbSalt(e.target.value)}
              placeholder={settings.easebuzz.has_salt ? '•••••• (leave blank to keep)' : 'Enter salt'}
              autoComplete="new-password"
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Environment</label>
          <select
            value={ebEnv}
            onChange={(e) => setEbEnv(e.target.value as 'sandbox' | 'production')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
          >
            <option value="sandbox">Sandbox (testpay.easebuzz.in)</option>
            <option value="production">Production (pay.easebuzz.in)</option>
          </select>
        </div>
        <WebhookUrl url={settings.webhook_urls.easebuzz} />
      </section>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}
      {notice && (
        <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg p-3">{notice}</p>
      )}

      <div className="pt-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-60 flex items-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save payment settings
        </button>
      </div>
    </div>
  );
}
