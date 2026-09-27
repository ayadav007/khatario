'use client';

import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { CheckCircle2, Loader2, Mail, MessageCircle, Phone } from 'lucide-react';
import clsx from 'clsx';
import type { StoreContactForm as ContactFormSettings } from '@/lib/store/store-theme';
import { ENQUIRY_HONEYPOT_FIELD } from '@/lib/store/enquiry';
import { storeDraftToken } from '@/lib/store/store-context';

const fieldBase =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-gray-400 focus:border-[var(--store-accent)] focus:ring-1 focus:ring-[var(--store-accent)]';
const inputClass = `${fieldBase} text-gray-900`;

const BOX_CLASS: Record<ContactFormSettings['style'], string> = {
  card: 'rounded-xl border border-gray-200 bg-white p-5 shadow-sm',
  plain: '',
  filled: 'rounded-xl p-5',
};

const FILLED_STYLE: CSSProperties = {
  background: 'color-mix(in srgb, var(--store-accent) 8%, white)',
};

export function StoreContactForm({
  subdomain,
  settings,
  isDemo,
}: {
  subdomain: string;
  settings: ContactFormSettings;
  isDemo?: boolean;
}) {
  const [values, setValues] = useState({
    name: '',
    phone: '',
    email: '',
    topic: '',
    message: '',
    [ENQUIRY_HONEYPOT_FIELD]: '',
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const previewOnly = isDemo || Boolean(storeDraftToken());
  const inside = settings.labels_inside;
  const centered = settings.layout === 'stacked' && settings.align === 'center';

  const set = (key: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (previewOnly) {
      setSent(true);
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/public/store/${encodeURIComponent(subdomain)}/enquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, source_path: window.location.pathname }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not send your message. Please try again.');
        return;
      }
      setSent(true);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setSending(false);
    }
  };

  const boxProps = {
    className: clsx(BOX_CLASS[settings.style], centered && 'text-center'),
    style: settings.style === 'filled' ? FILLED_STYLE : undefined,
  };

  if (sent) {
    return (
      <div {...boxProps} className={clsx(boxProps.className, 'text-center', settings.style === 'plain' && 'py-6')}>
        <CheckCircle2 className="mx-auto h-10 w-10" style={{ color: 'var(--store-accent)' }} />
        <p className="mt-3 text-sm text-gray-700">{settings.success}</p>
        {previewOnly ? <p className="mt-2 text-xs text-gray-400">Preview only. No message was sent.</p> : null}
      </div>
    );
  }

  const field = (label: string, optional: boolean, control: (placeholder: string | undefined) => ReactNode) => {
    const text = optional ? `${label} (optional)` : label;
    return (
      <label className="block text-left">
        <span className={inside ? 'sr-only' : 'mb-1 block text-xs font-medium text-gray-600'}>
          {label}
          {optional ? <span className="font-normal text-gray-400"> (optional)</span> : null}
        </span>
        {control(inside ? text : undefined)}
      </label>
    );
  };

  return (
    <form onSubmit={submit} noValidate {...boxProps} className={clsx(boxProps.className, 'space-y-3')}>
      <div>
        <h2 className="text-base font-semibold text-gray-900">{settings.title}</h2>
        {settings.intro ? <p className="mt-1 text-sm text-gray-600">{settings.intro}</p> : null}
      </div>

      {field('Name', false, (ph) => (
        <input className={inputClass} placeholder={ph} value={values.name} onChange={set('name')} required maxLength={120} autoComplete="name" />
      ))}

      {settings.phone !== 'off'
        ? field('Phone', settings.phone === 'optional', (ph) => (
            <input
              className={inputClass}
              placeholder={ph}
              value={values.phone}
              onChange={set('phone')}
              required={settings.phone === 'required'}
              inputMode="tel"
              autoComplete="tel"
              maxLength={16}
            />
          ))
        : null}

      {settings.email !== 'off'
        ? field('Email', settings.email === 'optional', (ph) => (
            <input
              className={inputClass}
              placeholder={ph}
              type="email"
              value={values.email}
              onChange={set('email')}
              required={settings.email === 'required'}
              autoComplete="email"
              maxLength={255}
            />
          ))
        : null}

      {settings.topics.length > 0
        ? field('Topic', false, () => (
            <select
              className={clsx(fieldBase, values.topic ? 'text-gray-900' : 'text-gray-400')}
              value={values.topic}
              onChange={set('topic')}
              required
            >
              <option value="" disabled>
                {inside ? 'Topic' : 'Choose a topic'}
              </option>
              {settings.topics.map((t) => (
                <option key={t} value={t} className="text-gray-900">
                  {t}
                </option>
              ))}
            </select>
          ))
        : null}

      {field('Message', false, (ph) => (
        <textarea
          className={`${inputClass} min-h-[110px]`}
          placeholder={settings.message_placeholder || ph}
          value={values.message}
          onChange={set('message')}
          required
          maxLength={2000}
        />
      ))}

      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>
          Leave this empty
          <input tabIndex={-1} autoComplete="off" value={values[ENQUIRY_HONEYPOT_FIELD]} onChange={set(ENQUIRY_HONEYPOT_FIELD)} />
        </label>
      </div>

      {error ? <p className="text-left text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={sending}
        className={clsx(
          'inline-flex items-center justify-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-60',
          settings.button_full && 'w-full',
        )}
        style={{ background: 'var(--store-accent)' }}
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {settings.button}
      </button>
    </form>
  );
}

/** Tap-to-call / WhatsApp / email buttons shown beside the contact details. */
export function StoreQuickContact({
  phone,
  email,
  whatsappUrl,
  className,
}: {
  phone?: string | null;
  email?: string | null;
  whatsappUrl?: string | null;
  className?: string;
}) {
  const links = [
    phone ? { href: `tel:${phone.replace(/[^\d+]/g, '')}`, label: 'Call us', icon: Phone } : null,
    whatsappUrl ? { href: whatsappUrl, label: 'WhatsApp', icon: MessageCircle, external: true } : null,
    email ? { href: `mailto:${email}`, label: 'Email', icon: Mail } : null,
  ].filter(Boolean) as Array<{ href: string; label: string; icon: typeof Phone; external?: boolean }>;
  if (links.length === 0) return null;
  return (
    <div className={clsx('flex flex-wrap gap-2', className)}>
      {links.map(({ href, label, icon: Icon, external }) => (
        <a
          key={label}
          href={href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
          className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-50"
          style={{ borderColor: 'var(--store-accent)', color: 'var(--store-accent)' }}
        >
          <Icon className="h-4 w-4" />
          {label}
        </a>
      ))}
    </div>
  );
}
