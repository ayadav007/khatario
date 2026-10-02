'use client';

import React, { useState } from 'react';
import { Check, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';
import type { KnowledgeItem } from '@/lib/ai-agent/knowledge';
import { agentFetch, agentJson } from './api';

interface Draft {
  question: string;
  answer: string;
}

function FaqEditor({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: Draft;
  saving: boolean;
  onSave: (d: Draft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState(initial);
  return (
    <div className="space-y-2 rounded-lg border border-primary-300 bg-primary-50/40 p-3 dark:border-primary-700 dark:bg-primary-900/10">
      <input
        autoFocus
        className="input"
        value={d.question}
        maxLength={300}
        placeholder="Question, e.g. Do you deliver on Sundays?"
        onChange={(e) => setD({ ...d, question: e.target.value })}
      />
      <textarea
        className="input"
        rows={3}
        value={d.answer}
        maxLength={2000}
        placeholder="Answer, exactly as the agent should say it"
        onChange={(e) => setD({ ...d, answer: e.target.value })}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => onSave(d)} disabled={!d.question.trim() || !d.answer.trim()} isLoading={saving}>
          Save FAQ
        </Button>
      </div>
    </div>
  );
}

export function FaqList({
  businessId,
  faqs,
  onChanged,
  adding,
  setAdding,
}: {
  businessId: string;
  faqs: KnowledgeItem[];
  onChanged: () => void;
  adding: boolean;
  setAdding: (v: boolean) => void;
}) {
  const toast = useToastContext();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const create = async (d: Draft) => {
    setSaving(true);
    try {
      await agentFetch(businessId, '/api/ai-agent/knowledge', {
        method: 'POST',
        body: agentJson({ kind: 'faq', question: d.question, answer: d.answer }),
      });
      setAdding(false);
      onChanged();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the FAQ');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const update = async (id: string, d: Draft) => {
    setSaving(true);
    try {
      await agentFetch(businessId, `/api/ai-agent/knowledge/${id}`, { method: 'PATCH', body: agentJson(d) });
      setEditingId(null);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the FAQ');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this FAQ?')) return;
    try {
      await agentFetch(businessId, `/api/ai-agent/knowledge/${id}`, { method: 'DELETE' });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the FAQ');
    }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const data = await agentFetch<{ faqs: Draft[] }>(businessId, '/api/ai-agent/knowledge/generate-faqs', {
        method: 'POST',
        body: agentJson({}),
      });
      setDrafts(data.faqs);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not write FAQs');
    } finally {
      setGenerating(false);
    }
  };

  const acceptDraft = async (i: number) => {
    if (await create(drafts[i])) setDrafts((ds) => ds.filter((_, j) => j !== i));
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-text-primary">FAQs</p>
          <p className="text-xs text-text-secondary">When a question matches, the agent answers exactly as you wrote it.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={generate} isLoading={generating}>
            {!generating && <Sparkles className="h-4 w-4" />} Generate FAQs
          </Button>
          {!adding && (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add FAQ
            </Button>
          )}
        </div>
      </div>

      {drafts.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-900/10">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-text-primary">Suggested FAQs — review before adding</p>
            <button type="button" onClick={() => setDrafts([])} className="text-xs text-text-secondary hover:underline">
              Dismiss all
            </button>
          </div>
          <ul className="space-y-2">
            {drafts.map((d, i) => (
              <li key={`${d.question}-${i}`} className="rounded-lg bg-white p-3 text-sm dark:bg-slate-900">
                <p className="font-medium text-text-primary">{d.question}</p>
                <p className="mt-1 text-text-secondary">{d.answer}</p>
                <div className="mt-2 flex gap-3">
                  <button type="button" onClick={() => acceptDraft(i)} disabled={saving} className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:underline">
                    <Check className="h-3.5 w-3.5" /> Add
                  </button>
                  <button type="button" onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))} className="inline-flex items-center gap-1 text-xs text-text-secondary hover:underline">
                    <X className="h-3.5 w-3.5" /> Skip
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {adding && (
        <div className="mb-3">
          <FaqEditor initial={{ question: '', answer: '' }} saving={saving} onSave={create} onCancel={() => setAdding(false)} />
        </div>
      )}

      {faqs.length === 0 && !adding ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-secondary">
          No FAQs yet. Add the questions customers ask you most — delivery areas, timings, returns — or let us draft some from
          your catalogue.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {faqs.map((f) =>
            editingId === f.id ? (
              <li key={f.id} className="p-2">
                <FaqEditor
                  initial={{ question: f.question, answer: f.answer }}
                  saving={saving}
                  onSave={(d) => update(f.id, d)}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li key={f.id} className="group flex items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary">{f.question}</p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-text-secondary">{f.answer}</p>
                </div>
                <div className="flex shrink-0 gap-1 opacity-70 group-hover:opacity-100">
                  <button type="button" onClick={() => setEditingId(f.id)} className="rounded p-1.5 text-text-muted hover:bg-gray-100 hover:text-text-primary dark:hover:bg-slate-800" aria-label="Edit FAQ">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => remove(f.id)} className="rounded p-1.5 text-text-muted hover:bg-red-50 hover:text-red-600" aria-label="Delete FAQ">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
