'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  ClipboardPaste,
  FileText,
  FileUp,
  HelpCircle,
  Loader2,
  Package,
  Pencil,
  RefreshCw,
  ScrollText,
  Trash2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';
import type { KnowledgeItem } from '@/lib/ai-agent/knowledge';
import type { KnowledgeSourceStatus } from '@/lib/ai-agent/knowledge-status';
import { agentFetch, agentJson } from './api';
import { FaqList } from './FaqList';
import { SectionCard } from './SectionCard';

type Badge = 'ready' | 'indexing' | 'error' | 'empty';

function StatusBadge({ status, title }: { status: Badge; title?: string }) {
  const map: Record<Badge, { label: string; cls: string }> = {
    ready: { label: 'Ready', cls: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
    indexing: { label: 'Indexing', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
    error: { label: 'Error', cls: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
    empty: { label: 'Nothing yet', cls: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300' },
  };
  const m = map[status];
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', m.cls)}>
      {status === 'indexing' && <Loader2 className="h-3 w-3 animate-spin" />}
      {m.label}
    </span>
  );
}

function sourceBadge(source: KnowledgeSourceStatus | undefined, changedAt?: string): Badge {
  if (!source) return changedAt ? 'indexing' : 'empty';
  if (source.status === 'error') return 'error';
  if (source.status === 'pending') return 'indexing';
  if (changedAt && (!source.lastIndexedAt || changedAt > source.lastIndexedAt)) return 'indexing';
  return source.chunkCount > 0 ? 'ready' : 'empty';
}

function ActionTile({
  icon: Icon,
  title,
  hint,
  onClick,
  busy,
}: {
  icon: typeof FileText;
  title: string;
  hint: string;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4 text-left transition-colors hover:border-primary-400 hover:bg-primary-50/40 disabled:opacity-60 dark:hover:bg-primary-900/10"
    >
      {busy ? <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-primary-600" /> : <Icon className="mt-0.5 h-5 w-5 text-primary-600" />}
      <span>
        <span className="block text-sm font-semibold text-text-primary">{title}</span>
        <span className="block text-xs text-text-secondary">{hint}</span>
      </span>
    </button>
  );
}

function TextEditor({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: { title: string; content: string };
  saving: boolean;
  onSave: (v: { title: string; content: string }) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <div className="space-y-2 rounded-lg border border-primary-300 bg-primary-50/40 p-3 dark:border-primary-700 dark:bg-primary-900/10">
      <input
        autoFocus
        className="input"
        value={v.title}
        maxLength={200}
        placeholder="Title, e.g. Delivery areas and charges"
        onChange={(e) => setV({ ...v, title: e.target.value })}
      />
      <textarea
        className="input font-mono text-xs"
        rows={8}
        value={v.content}
        maxLength={60000}
        placeholder="Paste anything customers ask about: price lists, service details, warranty terms…"
        onChange={(e) => setV({ ...v, content: e.target.value })}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-text-muted">{v.content.length.toLocaleString('en-IN')} / 60,000</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={() => onSave(v)} disabled={v.content.trim().length < 20} isLoading={saving}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function KnowledgeSection({
  businessId,
  onSourcesLoaded,
}: {
  businessId: string;
  onSourcesLoaded?: (sources: KnowledgeSourceStatus[]) => void;
}) {
  const toast = useToastContext();
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [sources, setSources] = useState<KnowledgeSourceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [pasting, setPasting] = useState(false);
  const [addingFaq, setAddingFaq] = useState(false);
  const [editing, setEditing] = useState<{ id: string; title: string; content: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const onSourcesRef = useRef(onSourcesLoaded);
  onSourcesRef.current = onSourcesLoaded;

  const load = useCallback(async () => {
    try {
      const [k, s] = await Promise.all([
        agentFetch<{ items: KnowledgeItem[] }>(businessId, '/api/ai-agent/knowledge'),
        agentFetch<{ sources: KnowledgeSourceStatus[] }>(businessId, '/api/ai-agent/knowledge/sources'),
      ]);
      setItems(k.items);
      setSources(s.sources);
      onSourcesRef.current?.(s.sources);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load knowledge');
    } finally {
      setLoading(false);
    }
  }, [businessId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const source = (kind: string) => sources.find((s) => s.kind === kind);
  const anyIndexing =
    sources.some((s) => s.status === 'pending') ||
    items.some((i) => {
      const s = source(i.kind === 'file' ? 'tenant_file' : i.kind === 'text' ? 'tenant_text' : 'tenant_faq');
      return sourceBadge(s, i.updatedAt) === 'indexing';
    });

  useEffect(() => {
    if (!anyIndexing) return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [anyIndexing, load]);

  const saveText = async (v: { title: string; content: string }, id?: string) => {
    setSaving(true);
    try {
      if (id) {
        await agentFetch(businessId, `/api/ai-agent/knowledge/${id}`, { method: 'PATCH', body: agentJson(v) });
        setEditing(null);
      } else {
        await agentFetch(businessId, '/api/ai-agent/knowledge', { method: 'POST', body: agentJson({ kind: 'text', ...v }) });
        setPasting(false);
      }
      toast.success('Saved. Your agent will use it in about a minute.');
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = async (id: string) => {
    try {
      const { item } = await agentFetch<{ item: KnowledgeItem }>(businessId, `/api/ai-agent/knowledge/${id}`);
      setEditing({ id, title: item.title, content: item.content });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open this item');
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Remove this from your agent’s knowledge?')) return;
    try {
      await agentFetch(businessId, `/api/ai-agent/knowledge/${id}`, { method: 'DELETE' });
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete');
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await agentFetch<{ warning?: string }>(businessId, '/api/ai-agent/knowledge/upload', { method: 'POST', body: form });
      toast.success(res.warning ? `Uploaded. ${res.warning}` : 'Uploaded. Your agent will use it in about a minute.');
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const reindex = async () => {
    setReindexing(true);
    try {
      await agentFetch(businessId, '/api/ai-agent/knowledge/reindex', { method: 'POST', body: agentJson({}) });
      toast.success('Rebuilding your knowledge. This takes a minute or two.');
      setTimeout(() => void load(), 5000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not rebuild');
    } finally {
      setReindexing(false);
    }
  };

  const catalog = source('tenant_catalog');
  const policy = source('tenant_policy');
  const docs = items.filter((i) => i.kind !== 'faq');
  const faqs = items.filter((i) => i.kind === 'faq');

  return (
    <SectionCard
      id="knowledge"
      icon={BookOpen}
      title="Knowledge"
      description="What your agent can answer from. It only uses this shop's information."
      appliesImmediately
      actions={
        <button
          type="button"
          onClick={reindex}
          disabled={reindexing}
          className="inline-flex items-center gap-1 text-sm font-medium text-text-secondary hover:text-text-primary disabled:opacity-50"
          title="Rebuild knowledge now"
        >
          <RefreshCw className={clsx('h-4 w-4', reindexing && 'animate-spin')} /> Rebuild
        </button>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <ActionTile icon={ClipboardPaste} title="Paste text" hint="Price lists, service details, terms" onClick={() => setPasting(true)} />
          <ActionTile icon={FileUp} title="Upload file" hint="PDF, TXT or CSV · up to 5 MB" onClick={() => fileRef.current?.click()} busy={uploading} />
          <ActionTile icon={HelpCircle} title="Add FAQ" hint="Answered word for word" onClick={() => setAddingFaq(true)} />
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.csv,.md,application/pdf,text/plain,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
        </div>

        {pasting && <TextEditor initial={{ title: '', content: '' }} saving={saving} onSave={(v) => saveText(v)} onCancel={() => setPasting(false)} />}

        <div>
          <p className="mb-2 text-sm font-semibold text-text-primary">Sources</p>
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-text-muted" /></div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <Package className="h-5 w-5 shrink-0 text-text-secondary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary">Product catalogue</p>
                  <p className="text-xs text-text-secondary">
                    {catalog ? `${catalog.documentCount.toLocaleString('en-IN')} items · ` : ''}Managed automatically ·{' '}
                    <Link href="/items" className="text-primary-700 hover:underline">Items</Link>
                  </p>
                </div>
                <StatusBadge status={sourceBadge(catalog)} title={catalog?.error ?? undefined} />
              </li>
              <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <ScrollText className="h-5 w-5 shrink-0 text-text-secondary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary">Store policies</p>
                  <p className="text-xs text-text-secondary">
                    About, contact, delivery, returns · Managed automatically ·{' '}
                    <Link href="/settings/online-store" className="text-primary-700 hover:underline">Online store</Link>
                  </p>
                </div>
                <StatusBadge status={sourceBadge(policy)} title={policy?.error ?? undefined} />
              </li>
              {docs.map((d) =>
                editing?.id === d.id ? (
                  <li key={d.id} className="p-2">
                    <TextEditor
                      initial={{ title: editing.title, content: editing.content }}
                      saving={saving}
                      onSave={(v) => saveText(v, d.id)}
                      onCancel={() => setEditing(null)}
                    />
                  </li>
                ) : (
                  <li key={d.id} className="group flex flex-wrap items-center gap-3 px-3 py-2.5">
                    {d.kind === 'file' ? <FileText className="h-5 w-5 shrink-0 text-text-secondary" /> : <ClipboardPaste className="h-5 w-5 shrink-0 text-text-secondary" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-primary">{d.title || d.fileName || 'Untitled'}</p>
                      <p className="truncate text-xs text-text-secondary">
                        {d.kind === 'file' ? `${d.fileName ?? 'File'}${d.fileSize ? ` · ${kb(d.fileSize)}` : ''}` : 'Pasted text'}
                        {' · '}
                        {d.content.slice(0, 80)}
                      </p>
                    </div>
                    <StatusBadge status={sourceBadge(source(d.kind === 'file' ? 'tenant_file' : 'tenant_text'), d.updatedAt)} />
                    <div className="flex gap-1">
                      <button type="button" onClick={() => startEdit(d.id)} className="rounded p-1.5 text-text-muted hover:bg-gray-100 hover:text-text-primary dark:hover:bg-slate-800" aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => remove(d.id)} className="rounded p-1.5 text-text-muted hover:bg-red-50 hover:text-red-600" aria-label="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
          {!loading && !catalog && !policy && (
            <p className="mt-2 text-xs text-text-secondary">
              Your catalogue and policies are read the first time a customer messages you, or now with Rebuild.
            </p>
          )}
        </div>

        <div className="border-t border-border pt-5">
          <FaqList businessId={businessId} faqs={faqs} onChanged={() => void load()} adding={addingFaq} setAdding={setAddingFaq} />
        </div>
      </div>
    </SectionCard>
  );
}
