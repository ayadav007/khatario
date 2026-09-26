'use client';

import { useEffect, useState } from 'react';

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
  title: string;
  description: string;
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

  return (
    <div className="rounded-lg border border-gray-200 p-4 space-y-4 bg-white">
      <div>
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-600 mt-1">{description}</p>
      </div>
      {!credentials?.ready && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Save all five fields here (leave a secret blank only if it is already stored). Missing:{' '}
          {(credentials?.missing || ['credentials']).join(', ')}.
        </p>
      )}
      {credentials?.ready && (
        <p className="text-sm text-green-800">Cloud API credentials are saved. Leave secret fields blank to keep the current values.</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="font-medium text-gray-700">WhatsApp Business Account ID</span>
          <input
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value)}
            className="mt-1 w-full px-3 py-2 border rounded-lg"
            autoComplete="off"
          />
        </label>
        <label className="text-sm">
          <span className="font-medium text-gray-700">Phone number ID</span>
          <input
            value={phoneId}
            onChange={(e) => setPhoneId(e.target.value)}
            className="mt-1 w-full px-3 py-2 border rounded-lg"
            autoComplete="off"
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="font-medium text-gray-700">
            Access token {credentials?.has_access_token ? '(saved — paste a new token to replace)' : ''}
          </span>
          <input
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            className="mt-1 w-full px-3 py-2 border rounded-lg"
            autoComplete="new-password"
            placeholder={credentials?.has_access_token ? '••••••••' : ''}
          />
        </label>
        <label className="text-sm">
          <span className="font-medium text-gray-700">
            App secret {credentials?.has_app_secret ? '(saved)' : ''}
          </span>
          <input
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            className="mt-1 w-full px-3 py-2 border rounded-lg"
            autoComplete="new-password"
            placeholder={credentials?.has_app_secret ? '••••••••' : ''}
          />
        </label>
        <label className="text-sm">
          <span className="font-medium text-gray-700">
            Webhook verify token {credentials?.has_verify_token ? '(saved)' : ''}
          </span>
          <input
            type="password"
            value={verifyToken}
            onChange={(e) => setVerifyToken(e.target.value)}
            className="mt-1 w-full px-3 py-2 border rounded-lg"
            autoComplete="new-password"
            placeholder={credentials?.has_verify_token ? '••••••••' : ''}
          />
        </label>
      </div>
      <p className="text-xs text-gray-500">
        Webhook URL (subscribe to <code>message_template_status_update</code>):{' '}
        <code className="break-all">{webhookUrl}</code>
      </p>
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
        className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save credentials'}
      </button>
    </div>
  );
}
