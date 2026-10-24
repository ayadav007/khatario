'use client';

import React, { useState } from 'react';
import { GripVertical, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Switch } from '@/components/ui/Switch';
import { useToastContext } from '@/contexts/ToastContext';
import {
  MAX_LEAD_QUESTIONS,
  slugFieldKey,
  type ConversationLeadStatus,
  type LeadQuestion,
  type LeadSkill,
} from '@/lib/ai-agent/types';
import { agentFetch, agentJson } from './api';
import { ChipInput } from './ChipInput';
import { FieldLabel } from './SectionCard';

export interface StaffOption {
  id: string;
  name: string;
}

const LEAD_STATUSES: Array<{ value: ConversationLeadStatus | ''; label: string }> = [
  { value: '', label: "Don't change" },
  { value: 'new', label: 'New' },
  { value: 'interested', label: 'Interested' },
  { value: 'follow_up', label: 'Follow up' },
  { value: 'converted', label: 'Converted' },
  { value: 'lost', label: 'Lost' },
];

function newQuestion(text = ''): LeadQuestion {
  return {
    id: `q_${Math.random().toString(36).slice(2, 10)}`,
    text,
    fieldKey: slugFieldKey(text) || '',
    required: true,
  };
}

export function LeadQualificationEditor({
  businessId,
  lead,
  onChange,
  staff,
}: {
  businessId: string;
  lead: LeadSkill;
  onChange: (lead: LeadSkill) => void;
  staff: StaffOption[];
}) {
  const toast = useToastContext();
  const [suggesting, setSuggesting] = useState(false);

  const setQuestions = (questions: LeadQuestion[]) => onChange({ ...lead, questions });
  const updateQuestion = (id: string, patch: Partial<LeadQuestion>) =>
    setQuestions(lead.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  const setQualify = (patch: Partial<LeadSkill['onQualify']>) =>
    onChange({ ...lead, onQualify: { ...lead.onQualify, ...patch } });

  const suggest = async () => {
    setSuggesting(true);
    try {
      const data = await agentFetch<{ questions: string[] }>(businessId, '/api/ai-agent/lead-questions/suggest', {
        method: 'POST',
        body: agentJson({}),
      });
      const existing = new Set(lead.questions.map((q) => q.text.toLowerCase()));
      const fresh = data.questions.filter((t) => !existing.has(t.toLowerCase())).map((t) => newQuestion(t));
      const room = MAX_LEAD_QUESTIONS - lead.questions.length;
      if (!fresh.length || room <= 0) {
        toast.info('No new questions to add.');
        return;
      }
      setQuestions([...lead.questions, ...fresh.slice(0, room)]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not suggest questions');
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <FieldLabel hint="The agent asks these one at a time during the chat and saves the answers on the conversation.">
            Questions to ask
          </FieldLabel>
          <button
            type="button"
            onClick={suggest}
            disabled={suggesting || lead.questions.length >= MAX_LEAD_QUESTIONS}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" /> {suggesting ? 'Thinking…' : 'Suggest questions'}
          </button>
        </div>

        {lead.questions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-text-secondary">
            No questions yet. Add what you need to know before your team follows up — for example budget, city or
            quantity.
          </p>
        ) : (
          <ul className="space-y-2">
            {lead.questions.map((q, i) => (
              <li key={q.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start gap-2">
                  <GripVertical className="mt-2.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />
                  <div className="min-w-0 flex-1 space-y-2">
                    <input
                      className="input"
                      value={q.text}
                      maxLength={200}
                      placeholder={`Question ${i + 1}, e.g. What is your budget?`}
                      onChange={(e) => {
                        const text = e.target.value;
                        const autoKey = !q.fieldKey || q.fieldKey === slugFieldKey(q.text);
                        updateQuestion(q.id, { text, ...(autoKey ? { fieldKey: slugFieldKey(text) } : {}) });
                      }}
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                        Save to field
                        <input
                          className="input h-8 w-40 py-1 text-xs"
                          value={q.fieldKey}
                          maxLength={40}
                          onChange={(e) => updateQuestion(q.id, { fieldKey: slugFieldKey(e.target.value) })}
                          placeholder="budget"
                        />
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <input
                          type="checkbox"
                          checked={q.required}
                          onChange={(e) => updateQuestion(q.id, { required: e.target.checked })}
                          className="h-4 w-4 rounded border-border text-primary-600"
                        />
                        Required to qualify
                      </label>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setQuestions(lead.questions.filter((x) => x.id !== q.id))}
                    className="rounded p-1.5 text-text-muted hover:bg-red-50 hover:text-red-600"
                    aria-label="Remove question"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {lead.questions.length < MAX_LEAD_QUESTIONS && (
          <button
            type="button"
            onClick={() => setQuestions([...lead.questions, newQuestion()])}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:underline"
          >
            <Plus className="h-4 w-4" /> Add question
          </button>
        )}
      </div>

      <div className="space-y-4 rounded-lg bg-gray-50 p-4 dark:bg-slate-800/50">
        <p className="text-sm font-semibold text-text-primary">When a lead qualifies</p>
        <p className="-mt-3 text-xs text-text-secondary">Runs once, when every required question has an answer.</p>
        <div>
          <FieldLabel>Add labels</FieldLabel>
          <ChipInput
            values={lead.onQualify.labels}
            onChange={(labels) => setQualify({ labels })}
            placeholder="e.g. Hot lead"
            max={10}
            maxLength={40}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel>Set lead status</FieldLabel>
            <select
              className="input"
              value={lead.onQualify.leadStatus}
              onChange={(e) => setQualify({ leadStatus: e.target.value as ConversationLeadStatus | '' })}
            >
              {LEAD_STATUSES.map((s) => (
                <option key={s.value || 'none'} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Assign to</FieldLabel>
            <select className="input" value={lead.onQualify.assignTo} onChange={(e) => setQualify({ assignTo: e.target.value })}>
              <option value="">Don&apos;t change</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>
        <Switch
          checked={lead.onQualify.handoff}
          onChange={(handoff) => setQualify({ handoff })}
          label="Hand the chat to a person"
          description="Pause the AI and notify your team so someone follows up."
        />
      </div>
    </div>
  );
}
