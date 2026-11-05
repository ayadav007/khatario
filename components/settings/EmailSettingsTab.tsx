'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, Eye, EyeOff, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';
import type { BusinessEmailConfigPublic } from '@/lib/business-email';
import { isPublicEmailConfigReady } from '@/lib/business-email-client';
import {
  SMTP_PRESETS,
  detectSmtpProvider,
  getSmtpPreset,
  portForSecure,
  secureForPort,
  type SmtpProviderId,
} from '@/lib/smtp-presets';

const PRESET_HOSTS = new Set(SMTP_PRESETS.map((p) => p.host).filter(Boolean));

function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

interface EmailSettingsTabProps {
  businessId: string;
  /** When no config exists yet, start with "Enable outbound email" checked. */
  preferEnabledWhenEmpty?: boolean;
  /** After a successful save that leaves email ready, call this (e.g. open compose). */
  onReady?: () => void;
  /** Primary save button label when `onReady` is set. */
  readyActionLabel?: string;
}

export function EmailSettingsTab({
  businessId,
  preferEnabledWhenEmpty = false,
  onReady,
  readyActionLabel = 'Save & continue to email',
}: EmailSettingsTabProps) {
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [enabled, setEnabled] = useState(preferEnabledWhenEmpty);
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [testRecipient, setTestRecipient] = useState('');
  const [provider, setProvider] = useState<SmtpProviderId>('gmail');
  /** Once the user types a From email that differs from the username, stop copying the username into it. */
  const [fromEmailTouched, setFromEmailTouched] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/email?business_id=${businessId}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to load email settings');
        return;
      }
      const cfg = data.config as BusinessEmailConfigPublic | null;
      const defaults = data.defaults as { from_email?: string; from_name?: string };
      if (cfg) {
        setEnabled(cfg.enabled);
        setSmtpHost(cfg.smtp_host || 'smtp.gmail.com');
        setSmtpPort(cfg.smtp_port || 587);
        setSmtpSecure(cfg.smtp_secure);
        setSmtpUser(cfg.smtp_user || '');
        setHasPassword(cfg.has_password);
        setFromEmail(cfg.from_email || '');
        setFromName(cfg.from_name || '');
        setReplyTo(cfg.reply_to_email || '');
        setProvider(detectSmtpProvider(cfg.smtp_host));
        setFromEmailTouched(
          Boolean(cfg.from_email && cfg.smtp_user && !sameAddress(cfg.from_email, cfg.smtp_user))
        );
      } else {
        if (preferEnabledWhenEmpty) setEnabled(true);
        setFromEmail(defaults?.from_email || '');
        setFromName(defaults?.from_name || '');
        setProvider('gmail');
        setFromEmailTouched(false);
      }
      setSmtpPassword('');
    } catch {
      toast.error('Failed to load email settings');
    } finally {
      setLoading(false);
    }
  }, [businessId, preferEnabledWhenEmpty, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/email', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          enabled,
          smtp_host: smtpHost,
          smtp_port: smtpPort,
          smtp_secure: smtpSecure,
          smtp_user: smtpUser,
          smtp_password: smtpPassword || undefined,
          from_email: fromEmail,
          from_name: fromName || null,
          reply_to_email: replyTo || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to save');
        return;
      }
      const saved = data.config as BusinessEmailConfigPublic | null;
      const passwordJustSet = Boolean(smtpPassword.trim());
      setHasPassword(Boolean(saved?.has_password));
      setSmtpPassword('');
      toast.success('Email settings saved');
      if (onReady && isPublicEmailConfigReady(saved)) {
        onReady();
      } else if (onReady && enabled && !saved?.has_password && !passwordJustSet) {
        toast.warning('Enter an SMTP password, then save again to continue.');
      }
    } catch {
      toast.error('Failed to save email settings');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch('/api/settings/email', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          test_recipient: testRecipient.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || 'SMTP verified');
      } else {
        toast.error(data.message || data.error || 'Test failed');
      }
    } catch {
      toast.error('Test failed');
    } finally {
      setTesting(false);
    }
  }

  function handleProviderChange(id: SmtpProviderId) {
    setProvider(id);
    const preset = getSmtpPreset(id);
    if (id === 'custom') {
      // Keep a host the user typed; clear one that only came from a preset.
      if (PRESET_HOSTS.has(smtpHost.trim().toLowerCase())) setSmtpHost('');
      return;
    }
    setSmtpHost(preset.host);
    setSmtpPort(preset.port);
    setSmtpSecure(preset.secure);
  }

  function handleHostChange(value: string) {
    setSmtpHost(value);
    if (value.trim()) setProvider(detectSmtpProvider(value));
  }

  function handlePortChange(value: string) {
    const port = parseInt(value, 10) || 587;
    setSmtpPort(port);
    setSmtpSecure(secureForPort(port));
  }

  function handleSecureChange(secure: boolean) {
    setSmtpSecure(secure);
    setSmtpPort(portForSecure(secure));
  }

  function handleUserChange(value: string) {
    setSmtpUser(value);
    if (!fromEmailTouched) setFromEmail(value.trim());
  }

  function handleFromEmailChange(value: string) {
    setFromEmail(value);
    setFromEmailTouched(Boolean(value.trim()) && !sameAddress(value, smtpUser));
  }

  const preset = getSmtpPreset(provider);
  const fromMismatch = Boolean(smtpUser.trim() && fromEmail.trim() && !sameAddress(smtpUser, fromEmail));

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <p className="font-medium">Your business sends email through your own email account</p>
        <p className="mt-1 text-blue-800/90">
          Use Gmail, Zoho Mail, your web host&apos;s email, or any SMTP provider. Credentials are stored
          encrypted and only used when you send invoices, purchase orders, or reminders from this business.
        </p>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
        />
        <span className="text-sm font-medium text-gray-900">Enable outbound email for this business</span>
      </label>

      <div>
        <label htmlFor="email-provider" className="mb-1 block text-sm font-medium text-gray-700">
          Email provider
        </label>
        <select
          id="email-provider"
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value as SmtpProviderId)}
          className="input w-full md:w-1/2"
        >
          {SMTP_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-text-secondary">
          Choosing a provider fills in the server settings for you.
        </p>
      </div>

      {provider === 'gmail' && (
        <div className="rounded-lg border border-border bg-gray-50 p-4 text-sm text-gray-800">
          <p className="font-medium text-gray-900">Gmail needs an App Password (not your normal password)</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Turn on <strong>2-Step Verification</strong> in your{' '}
              <a
                href="https://myaccount.google.com/signinoptions/two-step-verification"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 underline"
              >
                Google account
              </a>{' '}
              (App Passwords only appear after this).
            </li>
            <li>
              Open{' '}
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary-600 underline"
              >
                myaccount.google.com/apppasswords
                <ExternalLink className="h-3 w-3" />
              </a>
              , type <em>Khatario</em> as the name and click <strong>Create</strong>.
            </li>
            <li>
              Copy the 16-character password and paste it into <strong>SMTP password</strong> below. Spaces
              don&apos;t matter.
            </li>
          </ol>
          <p className="mt-2 text-xs text-text-secondary">
            Google Workspace (company Gmail): your admin may need to allow App Passwords first. Free Gmail
            can send about 500 emails a day.
          </p>
        </div>
      )}

      {preset.unsupported && (
        <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Outlook and Microsoft 365 usually won&apos;t work here</p>
            <p className="mt-1">
              Microsoft has switched off password-based SMTP for Outlook.com and most Microsoft 365
              accounts, so the connection test will likely fail. Please use Gmail, Zoho Mail, or your
              web host&apos;s email instead.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Input
          label="SMTP host"
          value={smtpHost}
          onChange={(e) => handleHostChange(e.target.value)}
          placeholder={provider === 'custom' ? 'mail.yourdomain.com' : preset.host}
          helperText={provider === 'custom' ? 'Find this on your email host\'s "email settings" page.' : undefined}
        />
        <Input
          label="SMTP port"
          type="number"
          value={String(smtpPort)}
          onChange={(e) => handlePortChange(e.target.value)}
          helperText="465 with SSL/TLS ticked, or 587 with it unticked."
        />
        <div className="md:col-span-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={smtpSecure}
              onChange={(e) => handleSecureChange(e.target.checked)}
              className="rounded border-gray-300"
            />
            Use SSL/TLS (port 465)
          </label>
        </div>
        <Input
          label="SMTP username"
          value={smtpUser}
          onChange={(e) => handleUserChange(e.target.value)}
          placeholder="your-email@gmail.com"
          helperText="Your full email address."
        />
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            SMTP password {hasPassword && !smtpPassword ? '(saved — leave blank to keep)' : ''}
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
              className="input w-full pr-10"
              placeholder={hasPassword ? '••••••••' : preset.passwordHint}
              autoComplete="new-password"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500"
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {provider === 'gmail' && (
            <p className="mt-1 text-xs text-text-secondary">
              Use the App Password from the steps above, not your Gmail password.
            </p>
          )}
        </div>
        <div>
          <Input
            label="From email"
            type="email"
            value={fromEmail}
            onChange={(e) => handleFromEmailChange(e.target.value)}
            required
            helperText={fromMismatch ? undefined : 'Filled in from the username.'}
          />
          {fromMismatch && (
            <p className="mt-1.5 text-xs text-amber-700">
              This differs from the SMTP username. Most providers (Gmail especially) only send from the
              address you log in with, unless you have set it up as an alias.
            </p>
          )}
        </div>
        <Input
          label="From name"
          value={fromName}
          onChange={(e) => setFromName(e.target.value)}
          placeholder="Your business name"
          helperText="What customers see as the sender."
        />
        <Input
          label="Reply-to (optional)"
          type="email"
          value={replyTo}
          onChange={(e) => setReplyTo(e.target.value)}
          className="md:col-span-2"
        />
      </div>

      <div className="flex flex-wrap gap-3 border-t border-border pt-4">
        <Button onClick={handleSave} isLoading={saving}>
          {onReady ? readyActionLabel : 'Save settings'}
        </Button>
        <Button variant="secondary" onClick={handleTest} isLoading={testing}>
          Test connection
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-gray-50 p-4 space-y-3">
        <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Send test email (optional)
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            value={testRecipient}
            onChange={(e) => setTestRecipient(e.target.value)}
            placeholder="you@example.com"
            className="input flex-1"
          />
          <Button variant="secondary" onClick={handleTest} isLoading={testing} disabled={!testRecipient.trim()}>
            Send test
          </Button>
        </div>
      </div>
    </div>
  );
}
