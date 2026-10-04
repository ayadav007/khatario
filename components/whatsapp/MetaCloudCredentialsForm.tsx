'use client';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';

export type MetaCloudPublic = {
  waba_id: string;
  phone_number_id: string;
  has_access_token: boolean;
  has_app_secret: boolean;
  has_verify_token: boolean;
  ready: boolean;
  missing: string[];
};

export function MetaCloudCredentialsForm({
  credentials,
  webhookUrl,
  saving,
  onSave,
  title,
  description,
  bare = false,
}: {
  credentials: MetaCloudPublic | null;
  webhookUrl: string;
  saving: boolean;
  onSave: (payload: {
    waba_id: string;
    phone_number_id: string;
    access_token: string;
    app_secret: string;
    verify_token: string;
  }) => Promise<void>;
  title?: string;
  description?: string;
  /** Tenant settings: no outer box or heading, app input styles, simpler guidance. */
  bare?: boolean;
}) {
  const [wabaId, setWabaId] = useState('');
  const [phoneId, setPhoneId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [verifyToken, setVerifyToken] = useState('');

  useEffect(() => {
    setWabaId(credentials?.waba_id || '');
    setPhoneId(credentials?.phone_number_id || '');
    setAccessToken('');
    setAppSecret('');
    setVerifyToken('');
  }, [credentials?.waba_id, credentials?.phone_number_id]);

  const labelClass = bare ? 'type-label mb-1.5 block' : 'font-medium text-gray-700';
  const inputClass = bare ? 'input w-full' : 'mt-1 w-full px-3 py-2 border rounded-lg text-gray-900 bg-white';

  return (
    <div
      className={clsx(
        'space-y-4',
        !bare && 'admin-light-surface rounded-lg border border-gray-200 p-4 bg-white text-gray-900',
      )}
    >
      {!bare && (title || description) ? (
        <div>
          {title ? <h3 className="text-base font-semibold text-gray-900">{title}</h3> : null}
          {description ? <p className="text-sm text-gray-600 mt-1">{description}</p> : null}
        </div>
      ) : null}
      {!bare && !credentials?.ready && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          To create templates on Meta you need WABA ID, Phone number ID, and Access token (same three as Digitable).
          Missing: {(credentials?.missing || ['credentials']).join(', ')}. App secret and verify token are optional
          (only for Khatario webhooks — leave Digitable&apos;s webhook URL unchanged).
        </p>
      )}
      {!bare && credentials?.ready && (
        <p className="text-sm text-green-800">
          Cloud API can submit and send. App secret / verify token are optional while Digitable keeps the Meta webhook.
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="text-sm">
          <span className={labelClass}>WhatsApp Business Account ID</span>
          <input value={wabaId} onChange={(e) => setWabaId(e.target.value)} className={inputClass} autoComplete="off" />
        </label>
        <label className="text-sm">
          <span className={labelClass}>Phone number ID</span>
          <input value={phoneId} onChange={(e) => setPhoneId(e.target.value)} className={inputClass} autoComplete="off" />
        </label>
        <label className="text-sm md:col-span-2">
          <span className={labelClass}>
            Access token {credentials?.has_access_token ? '(saved — paste a new token to replace)' : ''}
          </span>
          <input
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            className={inputClass}
            autoComplete="new-password"
            placeholder={credentials?.has_access_token ? '••••••••' : ''}
          />
        </label>
        <label className="text-sm">
          <span className={labelClass}>
            App secret {credentials?.has_app_secret ? '(saved)' : '(optional)'}
          </span>
          <input
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            className={inputClass}
            autoComplete="new-password"
            placeholder={credentials?.has_app_secret ? '••••••••' : ''}
          />
        </label>
        <label className="text-sm">
          <span className={labelClass}>
            Webhook verify token {credentials?.has_verify_token ? '(saved)' : '(optional)'}
          </span>
          <input
            type="password"
            value={verifyToken}
            onChange={(e) => setVerifyToken(e.target.value)}
            className={inputClass}
            autoComplete="new-password"
            placeholder={credentials?.has_verify_token ? '••••••••' : ''}
          />
        </label>
      </div>
      <p className={clsx('text-xs', bare ? 'text-text-secondary' : 'text-gray-500')}>
        Webhook URL (subscribe to <code>message_template_status_update</code>):{' '}
        <code className="break-all">{webhookUrl}</code>
      </p>
      <div className={clsx(bare && 'flex justify-end border-t border-border pt-4 dark:border-border-dark')}>
        <button
          type="button"
          disabled={saving}
          onClick={() =>
            void onSave({
              waba_id: wabaId,
              phone_number_id: phoneId,
              access_token: accessToken,
              app_secret: appSecret,
              verify_token: verifyToken,
            })
          }
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save credentials'}
        </button>
      </div>
    </div>
  );
}
