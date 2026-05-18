'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { PaymentProviderCatalogEntry } from '@/lib/payment-providers-catalog';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';

export type PaymentProviderStatusRow = {
  id: string;
  displayName: string;
  description: string;
  configured: boolean;
  environment: string | null;
  client_id_masked: string | null;
  secret_configured: boolean;
};

const SELECT_CLASS =
  'flex h-11 w-full max-w-xs rounded-lg border border-border bg-white px-3 text-sm text-text-primary shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 dark:bg-slate-900';

function buildFormDefaults(
  definition: PaymentProviderCatalogEntry,
  env: 'sandbox' | 'production'
): Record<string, string> {
  const o: Record<string, string> = {};
  for (const f of definition.fields) {
    if (f.type === 'select') {
      o[f.key] = env;
    } else {
      o[f.key] = '';
    }
  }
  return o;
}

export type PaymentProviderCardProps = {
  definition: PaymentProviderCatalogEntry;
  status: PaymentProviderStatusRow | undefined;
  businessId: string;
  userId: string;
  origin: string;
  isSaving: boolean;
  onSavingChange: (saving: boolean) => void;
  onSaved: () => Promise<void>;
};

export function PaymentProviderCard({
  definition,
  status,
  businessId,
  userId,
  origin,
  isSaving,
  onSavingChange,
  onSaved,
}: PaymentProviderCardProps) {
  const toast = useToastContext();
  const [form, setForm] = useState<Record<string, string>>(() =>
    buildFormDefaults(definition, 'sandbox')
  );

  const syncFormFromStatus = useCallback(() => {
    const env =
      status?.environment === 'production' ? 'production' : 'sandbox';
    setForm(buildFormDefaults(definition, env));
  }, [definition, status?.environment]);

  useEffect(() => {
    syncFormFromStatus();
  }, [syncFormFromStatus]);

  const configured = Boolean(status?.configured);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!businessId.trim() || !userId.trim()) {
      toast.error('Missing business or user');
      return;
    }
    onSavingChange(true);
    try {
      const client_id = form.client_id ?? '';
      const client_secret = form.client_secret ?? '';
      const environment =
        form.environment === 'production' ? 'production' : 'sandbox';

      const res = await fetch('/api/settings/payment-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          business_id: businessId,
          user_id: userId,
          provider: definition.id,
          client_id,
          client_secret,
          environment,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Save failed');
        return;
      }
      toast.success(data.message || 'Saved');
      await onSaved();
    } catch {
      toast.error('Save failed');
    } finally {
      onSavingChange(false);
    }
  };

  const setField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const summary = definition.summary;
  const webhook = definition.webhookUrl;

  return (
    <Card className="border border-border bg-white p-6 shadow-sm">
      <div className="mb-6 flex flex-col gap-2 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            {status?.displayName ?? definition.displayName}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            {status?.description ?? definition.description}
          </p>
        </div>
        <div className="shrink-0">
          {configured ? (
            <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-800">
              Connected
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700">
              Not configured
            </span>
          )}
        </div>
      </div>

      {configured && status && summary && (
        <div className="mb-6 rounded-lg border border-border bg-gray-50 p-4 text-sm dark:bg-slate-900/40">
          <p className="text-text-secondary">
            <span className="font-medium text-text-primary">
              {summary.clientIdCaption}
            </span>{' '}
            {status.client_id_masked || '—'}
          </p>
          <p className="mt-1 text-text-secondary">
            <span className="font-medium text-text-primary">Environment:</span>{' '}
            {status.environment ?? '—'}
          </p>
          <p className="mt-1 text-text-secondary">
            <span className="font-medium text-text-primary">
              {summary.secretCaption}
            </span>{' '}
            {status.secret_configured ? '•••••••• (stored)' : 'Not set'}
          </p>
        </div>
      )}

      {webhook && businessId && origin ? (
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-100">
          <p className="font-medium text-blue-800 dark:text-blue-100">
            {webhook.title}
          </p>
          <p className="mt-1 break-all font-mono text-xs">
            {origin}/api/payments/webhook/{webhook.pathSegment}?business_id=
            {businessId}
          </p>
          {webhook.hint ? (
            <p className="mt-2 text-xs text-blue-800 dark:text-blue-200">
              {webhook.hint}
            </p>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
        {definition.fields.map((field) => {
          const fid = `${definition.id}-${field.key}`;
          if (field.type === 'select') {
            return (
              <div key={field.key}>
                <label
                  htmlFor={fid}
                  className="mb-1 block text-sm font-medium text-text-primary"
                >
                  {field.label}
                </label>
                <select
                  id={fid}
                  value={form.environment ?? 'sandbox'}
                  onChange={(e) =>
                    setField(
                      'environment',
                      e.target.value === 'production' ? 'production' : 'sandbox'
                    )
                  }
                  className={SELECT_CLASS}
                >
                  {field.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          }

          if (field.type === 'password') {
            return (
              <div key={field.key}>
                <label
                  htmlFor={fid}
                  className="mb-1 block text-sm font-medium text-text-primary"
                >
                  {field.label}
                </label>
                <Input
                  id={fid}
                  type="password"
                  autoComplete="new-password"
                  value={form[field.key] ?? ''}
                  onChange={(e) => setField(field.key, e.target.value)}
                  placeholder={
                    configured
                      ? field.placeholderConfigured
                      : field.placeholderNew
                  }
                  className="w-full"
                />
                {field.hint ? (
                  <p className="mt-1 text-xs text-text-muted">{field.hint}</p>
                ) : null}
              </div>
            );
          }

          return (
            <div key={field.key}>
              <label
                htmlFor={fid}
                className="mb-1 block text-sm font-medium text-text-primary"
              >
                {field.label}
              </label>
              <Input
                id={fid}
                type="text"
                autoComplete="off"
                value={form[field.key] ?? ''}
                onChange={(e) => setField(field.key, e.target.value)}
                placeholder={
                  configured
                    ? field.placeholderConfigured
                    : field.placeholderNew
                }
                className="w-full"
              />
            </div>
          );
        })}

        <Button
          type="submit"
          variant={definition.saveButtonVariant}
          isLoading={isSaving}
        >
          {definition.saveButtonLabel}
        </Button>
      </form>
    </Card>
  );
}
