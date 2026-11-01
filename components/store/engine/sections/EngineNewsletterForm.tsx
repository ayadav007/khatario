'use client';

import { useState } from 'react';

/** A real form whose submit is intercepted: posts the email to the store enquiries API. */
export function EngineNewsletterForm({
  subdomain,
  buttonLabel,
  successText,
}: {
  subdomain: string;
  buttonLabel: string;
  successText: string;
}) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === 'sending') return;
    setState('sending');
    setError('');
    try {
      const res = await fetch(`/api/public/store/${encodeURIComponent(subdomain)}/enquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: 'newsletter', email, message: 'Newsletter signup', source_path: window.location.pathname }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body?.error === 'string' && body.error ? body.error : 'Could not sign you up. Please try again.');
        setState('idle');
        return;
      }
      setState('done');
    } catch {
      setError('Could not sign you up. Please try again.');
      setState('idle');
    }
  }

  if (state === 'done') return <p className="eng-news-done" role="status">{successText}</p>;
  return (
    <form className="eng-news-form" onSubmit={submit} method="post" noValidate>
      <input
        type="email"
        name="email"
        required
        autoComplete="email"
        placeholder="Your email"
        aria-label="Email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button type="submit" className="st-btn" disabled={state === 'sending'}>
        {buttonLabel}
      </button>
      {error ? <p className="eng-news-error" role="alert">{error}</p> : null}
    </form>
  );
}
