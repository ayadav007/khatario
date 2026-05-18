'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';
import type { BusinessEmailConfigPublic } from '@/lib/business-email';

interface EmailSettingsTabProps {
  businessId: string;
}

export function EmailSettingsTab({ businessId }: EmailSettingsTabProps) {
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [enabled, setEnabled] = useState(false);
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
      } else {
        setFromEmail(defaults?.from_email || '');
        setFromName(defaults?.from_name || '');
      }
      setSmtpPassword('');
    } catch {
      toast.error('Failed to load email settings');
    } finally {
      setLoading(false);
    }
  }, [businessId, toast]);

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
      setHasPassword(Boolean(data.config?.has_password));
      setSmtpPassword('');
      toast.success('Email settings saved');
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
        <p className="font-medium">Your business sends email through your own mail server</p>
        <p className="mt-1 text-blue-800/90">
          Use Gmail, Outlook, Zoho Mail, or any SMTP provider. Credentials are stored encrypted and
          only used when you send invoices, purchase orders, or reminders from this business.
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

      <div className="grid gap-4 md:grid-cols-2">
        <Input
          label="SMTP host"
          value={smtpHost}
          onChange={(e) => setSmtpHost(e.target.value)}
          placeholder="smtp.gmail.com"
        />
        <Input
          label="SMTP port"
          type="number"
          value={String(smtpPort)}
          onChange={(e) => setSmtpPort(parseInt(e.target.value, 10) || 587)}
        />
        <div className="md:col-span-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={smtpSecure}
              onChange={(e) => setSmtpSecure(e.target.checked)}
              className="rounded border-gray-300"
            />
            Use SSL/TLS (typically for port 465)
          </label>
        </div>
        <Input
          label="SMTP username"
          value={smtpUser}
          onChange={(e) => setSmtpUser(e.target.value)}
          placeholder="your-email@gmail.com"
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
              placeholder={hasPassword ? '••••••••' : 'App password or SMTP password'}
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
          <p className="mt-1 text-xs text-text-secondary">
            For Gmail, use an App Password if 2FA is enabled.
          </p>
        </div>
        <Input
          label="From email"
          type="email"
          value={fromEmail}
          onChange={(e) => setFromEmail(e.target.value)}
          required
        />
        <Input
          label="From name"
          value={fromName}
          onChange={(e) => setFromName(e.target.value)}
          placeholder="Your business name"
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
          Save settings
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
