'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';
import { DOCUMENT_LANGUAGES, type DocumentLanguage } from '@/lib/print-language';

export function DocumentLanguageCard() {
  const toast = useToastContext();
  const [language, setLanguage] = useState<DocumentLanguage>('en');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings/document-language');
        const data = await res.json();
        if (!cancelled && res.ok && data.document_language) {
          setLanguage(data.document_language);
        }
      } catch {
        if (!cancelled) toast.error('Could not load the print language');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  async function save(next: DocumentLanguage) {
    const previous = language;
    setLanguage(next);
    setSaving(true);
    try {
      const res = await fetch('/api/settings/document-language', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_language: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLanguage(previous);
        toast.error(data.error || 'Could not save the print language');
        return;
      }
      setLanguage(data.document_language);
      toast.success('Print language saved');
    } catch {
      toast.error('Could not save the print language');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="scroll-mt-24 grid grid-cols-1 gap-3 border-b border-border pb-6 dark:border-border-dark lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-10">
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-text-primary">Print language</h3>
        <p className="mt-1 text-sm leading-relaxed text-text-secondary">
          Headings on invoices, challans, receipts, reports, payslips, and offer letters use this language for the whole business.
          Names, item text, notes, and GST codes such as GSTIN, HSN, CGST, SGST, and IGST stay as entered.
        </p>
      </div>
      <div className="card min-w-0 px-4 py-4 md:px-5">
        <label className="type-label mb-1.5 block" htmlFor="document-language">
          Document language
        </label>
        <select
          id="document-language"
          className="input"
          value={language}
          disabled={loading || saving}
          onChange={(event) => save(event.target.value as DocumentLanguage)}
        >
          {DOCUMENT_LANGUAGES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.native} ({option.label})
            </option>
          ))}
        </select>
        <p className="type-body-sm mt-1.5 text-text-secondary">
          The app screens stay in English. On a server without Indian fonts, install Nirmala UI or Noto fonts so PDFs render the script.
        </p>
        {saving ? (
          <Button type="button" size="sm" variant="ghost" className="mt-3" disabled>
            Saving…
          </Button>
        ) : null}
      </div>
    </section>
  );
}
