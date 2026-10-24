'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';

export type Row = Record<string, any>;

/** Mirrors WA_LIMITS in lib/meta-whatsapp (server module, not importable here). */
export const LIMITS = {
  text: 4096,
  interactiveBody: 1024,
  footer: 60,
  headerText: 60,
  buttonsMax: 3,
  buttonTitle: 20,
  listRowsMax: 10,
  listRowTitle: 24,
  listRowDescription: 72,
  listButton: 20,
  caption: 1024,
};

export const PIPELINE_LABELS: Record<string, string> = {
  new: 'New',
  qualified: 'Qualified',
  demo_interested: 'Demo interested',
  trial_created: 'Trial created',
  activated: 'Activated',
  converted: 'Converted',
  lost: 'Lost',
};

export const PIPELINE_ORDER = ['new', 'qualified', 'demo_interested', 'trial_created', 'activated', 'converted', 'lost'];

export const BUSINESS_TYPE_OPTIONS = [
  ['retail', 'Retail / Kirana'],
  ['wholesale', 'Wholesale / Distribution'],
  ['trading', 'Trading'],
  ['manufacturing', 'Manufacturing'],
  ['restaurant', 'Restaurant / Food'],
  ['other', 'Other'],
] as const;

export const PAIN_POINT_OPTIONS = [
  ['billing_speed', 'Billing takes too long'],
  ['gst_accounting', 'GST and accounting'],
  ['inventory', 'Stock / inventory'],
  ['outstanding', 'Customer outstanding'],
  ['multi_activity', 'Too many activities'],
  ['switching', 'Using other software'],
] as const;

export function when(v?: string | null) {
  return v ? format(new Date(v), 'd MMM yyyy, h:mm a') : '—';
}

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...platformAdminFetchInit, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`) as Error & { errors?: string[] };
    if (Array.isArray(data.errors)) err.errors = data.errors;
    throw err;
  }
  return data as T;
}

export function sendJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  return getJson<T>(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function useJson<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getJson<T>(url));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, setData, error, loading, reload: load };
}

export function State({ loading, error }: { loading: boolean; error: string }) {
  if (error) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-primary-600" />;
  return null;
}

export function Notice({ tone, children }: { tone: 'error' | 'ok' | 'info' | 'warn'; children: React.ReactNode }) {
  const cls = {
    error: 'bg-red-50 text-red-700 border-red-200',
    ok: 'bg-green-50 text-green-700 border-green-200',
    info: 'bg-blue-50 text-blue-800 border-blue-200',
    warn: 'bg-amber-50 text-amber-800 border-amber-200',
  }[tone];
  return <div className={`rounded-lg border p-3 text-sm ${cls}`}>{children}</div>;
}

export function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {empty ? (
            <tr>
              <td colSpan={head.length} className="px-4 py-10 text-center text-gray-500">
                Nothing here yet.
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-gray-50';
export const btnCls =
  'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
export const primaryBtnCls =
  'inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50';
export const dangerBtnCls =
  'inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50';

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-700">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-gray-500">{hint}</span> : null}
    </label>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  const n = value.length;
  return <span className={`text-xs ${n > max ? 'font-semibold text-red-600' : 'text-gray-400'}`}>{n}/{max}</span>;
}

/** Text input with a WhatsApp length limit shown as a live counter. */
export function LimitedInput({
  label,
  value,
  max,
  onChange,
  placeholder,
  multiline,
  rows = 3,
  hint,
}: {
  label: string;
  value: string | undefined;
  max: number;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  hint?: React.ReactNode;
}) {
  const v = value ?? '';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <Counter value={v} max={max} />
      </div>
      {multiline ? (
        <textarea className={inputCls} rows={rows} value={v} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={inputCls} value={v} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint ? <span className="mt-1 block text-xs text-gray-500">{hint}</span> : null}
    </div>
  );
}

/** Comma-separated list editor for keywords and ids. */
export function ListInput({ label, value, onChange, hint, placeholder }: { label: string; value: string[] | undefined; onChange: (v: string[]) => void; hint?: string; placeholder?: string }) {
  const [text, setText] = useState((value || []).join(', '));
  useEffect(() => {
    setText((value || []).join(', '));
  }, [value]);
  return (
    <Field label={label} hint={hint}>
      <input
        className={inputCls}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() =>
          onChange(
            text
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
    </Field>
  );
}

export function Badge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'purple' }) {
  const cls = {
    gray: 'bg-gray-100 text-gray-700',
    green: 'bg-green-100 text-green-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-700',
    blue: 'bg-blue-100 text-blue-800',
    purple: 'bg-purple-100 text-purple-800',
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export function pipelineTone(status: string): 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'purple' {
  switch (status) {
    case 'qualified':
    case 'demo_interested':
      return 'blue';
    case 'trial_created':
      return 'amber';
    case 'activated':
      return 'purple';
    case 'converted':
      return 'green';
    case 'lost':
      return 'red';
    default:
      return 'gray';
  }
}

export function useStoredPhone(): [string, (v: string) => void] {
  const [phone, setPhone] = useState('');
  useEffect(() => {
    setPhone(window.localStorage.getItem('salesFlowTestPhone') || '');
  }, []);
  const update = (v: string) => {
    setPhone(v);
    window.localStorage.setItem('salesFlowTestPhone', v);
  };
  return [phone, update];
}
