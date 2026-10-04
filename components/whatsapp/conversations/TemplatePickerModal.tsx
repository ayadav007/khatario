'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, Loader2, Search, Send, X } from 'lucide-react';

export interface InboxTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  header_format: 'none' | 'text' | 'document' | 'image' | 'video';
  header_text: string | null;
  body_text: string;
  footer_text: string | null;
  example_vars: string[] | null;
  placeholder_count: number;
}

export interface TemplateSendInput {
  templateId: string;
  values: string[];
  headerFile?: File;
}

interface TemplatePickerModalProps {
  /** Pre-fills {{1}} when a template's first variable looks like a name. */
  contactName?: string | null;
  title?: string;
  onSend: (input: TemplateSendInput) => Promise<void>;
  onClose: () => void;
}

const HEADER_ACCEPT: Record<string, string> = {
  image: 'image/jpeg,image/png',
  video: 'video/mp4',
  document: 'application/pdf',
};

function fill(text: string | null | undefined, values: string[]): string {
  return String(text || '').replace(/\{\{(\d+)\}\}/g, (m, n) => values[Number(n) - 1]?.trim() || m);
}

export function TemplatePickerModal({ contactName, title = 'Send a template', onSend, onClose }: TemplatePickerModalProps) {
  const [templates, setTemplates] = useState<InboxTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<InboxTemplate | null>(null);
  const [values, setValues] = useState<string[]>([]);
  const [headerFile, setHeaderFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/whatsapp/inbox-templates', { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load templates');
        return data as { transport: string; templates: InboxTemplate[] };
      })
      .then((data) => {
        if (cancelled) return;
        if (data.transport !== 'cloud') {
          setLoadError('Templates need the WhatsApp Business API. Connect it under Settings → WhatsApp.');
          setTemplates([]);
          return;
        }
        setTemplates(data.templates || []);
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Could not load templates');
          setTemplates([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!templates) return [];
    if (!q) return templates;
    return templates.filter((t) => t.name.toLowerCase().includes(q) || t.body_text.toLowerCase().includes(q));
  }, [templates, search]);

  const choose = (t: InboxTemplate) => {
    setSelected(t);
    setHeaderFile(null);
    setSendError(null);
    const first = contactName?.trim().split(/\s+/)[0] || '';
    const example = (t.example_vars || [])[0] || '';
    const looksLikeName = /name|customer|sir|madam/i.test(example) || t.body_text.match(/(hi|hello|dear)\s+\{\{1\}\}/i);
    setValues(Array.from({ length: t.placeholder_count }, (_, i) => (i === 0 && looksLikeName ? first : '')));
  };

  const needsHeaderFile = selected && ['image', 'video', 'document'].includes(selected.header_format);
  const ready =
    !!selected && values.every((v) => v.trim()) && (!needsHeaderFile || !!headerFile) && !sending;

  const submit = async () => {
    if (!selected || !ready) return;
    setSending(true);
    setSendError(null);
    try {
      await onSend({ templateId: selected.id, values, headerFile: headerFile ?? undefined });
      onClose();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Template was not sent');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#008069]" />
            <h2 className="text-base font-semibold text-gray-900">{selected ? selected.name : title}</h2>
          </div>
          <div className="flex items-center gap-2">
            {selected && (
              <button type="button" onClick={() => setSelected(null)} className="text-sm text-gray-600 hover:text-gray-900">
                All templates
              </button>
            )}
            <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {!selected ? (
          <>
            <div className="border-b border-gray-100 px-5 py-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search approved templates"
                  className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-[#008069] focus:ring-2 focus:ring-[#008069]/30"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {templates === null ? (
                <div className="flex h-32 items-center justify-center text-gray-400">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : loadError ? (
                <p className="px-4 py-6 text-center text-sm text-gray-600">{loadError}</p>
              ) : filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-gray-600">
                  {search ? 'No approved template matches your search.' : 'No approved templates yet.'}{' '}
                  <Link href="/settings/whatsapp" className="font-medium text-[#008069] hover:underline">
                    Create one in Settings
                  </Link>
                </div>
              ) : (
                filtered.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => choose(t)}
                    className="w-full rounded-xl px-3 py-3 text-left transition-colors hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-gray-900">{t.name}</span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-600">
                        {t.category.toLowerCase()}
                      </span>
                      <span className="text-[10px] text-gray-400">{t.language}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{t.body_text}</p>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="grid flex-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2">
            <div className="space-y-3">
              {needsHeaderFile && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">
                    Header {selected.header_format} *
                  </span>
                  <input
                    type="file"
                    accept={HEADER_ACCEPT[selected.header_format]}
                    onChange={(e) => setHeaderFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm"
                  />
                </label>
              )}
              {values.length === 0 && !needsHeaderFile && (
                <p className="text-sm text-gray-600">This template has no variables. Check the preview and send.</p>
              )}
              {values.map((v, i) => (
                <label key={i} className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">
                    {`{{${i + 1}}}`}
                    {selected.example_vars?.[i] ? ` · e.g. ${selected.example_vars[i]}` : ''}
                  </span>
                  <input
                    value={v}
                    onChange={(e) => setValues((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#008069] focus:ring-2 focus:ring-[#008069]/30"
                  />
                </label>
              ))}
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-gray-600">Preview</span>
              <div className="rounded-lg bg-[#efeae2] p-3">
                <div className="rounded-lg bg-[#d9fdd3] px-3 py-2 text-sm text-[#111b21] shadow-sm">
                  {needsHeaderFile && (
                    <div className="mb-2 rounded bg-white/70 px-2 py-3 text-center text-xs text-gray-500">
                      {headerFile ? headerFile.name : `${selected.header_format} header`}
                    </div>
                  )}
                  {selected.header_format === 'text' && selected.header_text && (
                    <p className="mb-1 font-semibold">{selected.header_text}</p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{fill(selected.body_text, values)}</p>
                  {selected.footer_text && <p className="mt-1 text-xs text-gray-500">{selected.footer_text}</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {selected && (
          <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-5 py-3">
            {sendError && <p className="mr-auto text-sm text-red-600">{sendError}</p>}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!ready}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#008069] px-4 py-2 text-sm font-medium text-white hover:bg-[#006b57] disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send template
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
