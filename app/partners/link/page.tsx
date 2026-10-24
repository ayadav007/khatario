'use client';

import { useEffect, useState } from 'react';
import { PartnerShell } from '@/components/partners/PartnerShell';
import { Copy, Check } from 'lucide-react';

export default function PartnerLinkPage() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/partners/me', { credentials: 'include' });
      if (!res.ok) {
        window.location.href = '/partners/login';
        return;
      }
      const data = await res.json();
      setName(data.partner?.name || '');
      setCode(data.partner?.referral_code || '');
      setUrl(data.signupUrl || '');
    })();
  }, []);

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <PartnerShell partnerName={name}>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">My referral link</h1>
      <p className="mb-6 max-w-2xl text-sm text-slate-600">
        Use this URL in Facebook ads and WhatsApp. The customer always lands on Khatario signup
        (<code className="rounded bg-slate-100 px-1">?ref={code || 'CODE'}</code>). If they sign up
        without your link or code, you are not credited — unless you claim the business before they
        pay.
      </p>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="text-xs font-medium uppercase text-slate-500">Referral code</div>
        <div className="mt-1 text-2xl font-bold tracking-wide text-emerald-700">{code || '—'}</div>

        <div className="mt-6 text-xs font-medium uppercase text-slate-500">Signup URL</div>
        <code className="mt-2 block break-all rounded-lg bg-slate-50 px-3 py-3 text-sm">
          {url || 'Loading…'}
        </code>

        <button
          type="button"
          onClick={copy}
          disabled={!url}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </PartnerShell>
  );
}
