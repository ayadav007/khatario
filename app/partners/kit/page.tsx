'use client';

import { useEffect, useState } from 'react';
import { PartnerShell } from '@/components/partners/PartnerShell';
import { Download, ExternalLink } from 'lucide-react';

type Item = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  url: string | null;
  body_text: string | null;
  file_name: string | null;
  downloadUrl: string | null;
};

export default function PartnerKitPage() {
  const [name, setName] = useState('');
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    (async () => {
      const [meRes, kitRes] = await Promise.all([
        fetch('/api/partners/me', { credentials: 'include' }),
        fetch('/api/partners/kit', { credentials: 'include' }),
      ]);
      if (!meRes.ok) {
        window.location.href = '/partners/login';
        return;
      }
      setName((await meRes.json()).partner?.name || '');
      setItems((await kitRes.json()).items || []);
    })();
  }, []);

  return (
    <PartnerShell partnerName={name}>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">Sales kit</h1>
      <p className="mb-6 text-sm text-slate-600">
        Use these assets in Facebook ads, WhatsApp, and demos. Always send customers to your
        Khatario <code className="rounded bg-slate-100 px-1">?ref=</code> link.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">No kit items published yet.</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="rounded-xl border bg-white p-4">
              <div className="text-xs uppercase text-slate-500">{item.kind}</div>
              <h2 className="mt-1 font-semibold text-slate-900">{item.title}</h2>
              {item.description ? (
                <p className="mt-1 text-sm text-slate-600">{item.description}</p>
              ) : null}
              {item.kind === 'text' && item.body_text ? (
                <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">
                  {item.body_text}
                </pre>
              ) : null}
              {item.kind === 'link' && item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700"
                >
                  Open <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
              {item.kind === 'file' && item.downloadUrl ? (
                <a
                  href={item.downloadUrl}
                  className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700"
                >
                  <Download className="h-3.5 w-3.5" />
                  {item.file_name || 'Download'}
                </a>
              ) : null}
            </div>
          ))
        )}
      </div>
    </PartnerShell>
  );
}
