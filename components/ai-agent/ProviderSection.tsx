'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ExternalLink, KeyRound, RotateCcw, Settings2, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { useToastContext } from '@/contexts/ToastContext';
import type { AgentKeySource, AgentProviderSummary, AgentUsage } from '@/lib/ai-agent/types';
import { agentFetch, agentJson } from './api';
import { FieldLabel, SectionCard } from './SectionCard';

export const PROVIDERS: Array<{ value: string; label: string; keyUrl?: string; models: string[] }> = [
  { value: 'groq', label: 'Groq', keyUrl: 'https://console.groq.com/keys', models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'] },
  { value: 'openai', label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', models: ['gpt-4o-mini', 'gpt-4o'] },
  { value: 'gemini', label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/app/apikey', models: ['gemini-3.5-flash'] },
  { value: 'custom', label: 'Other (OpenAI-compatible)', models: [] },
];

export interface ProviderDraft {
  keySource: AgentKeySource;
  provider: string;
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  typingEnabled: boolean;
  typingDelaySeconds: number;
  dailyLimit: number;
}

function fromSummary(p: AgentProviderSummary): ProviderDraft {
  return {
    keySource: p.keySource,
    provider: p.provider || 'groq',
    apiKey: '',
    apiBaseUrl: p.apiBaseUrl || '',
    model: p.model || '',
    temperature: p.temperature,
    maxTokens: p.maxTokens,
    typingEnabled: p.typingEnabled,
    typingDelaySeconds: p.typingDelaySeconds,
    dailyLimit: p.dailyLimit,
  };
}

/** Key choice cards: shared by the wizard and the Advanced section. */
export function KeySourceCards({
  value,
  onChange,
  usage,
}: {
  value: AgentKeySource;
  onChange: (v: AgentKeySource) => void;
  usage: AgentUsage;
}) {
  const k = usage.khatarioAi;
  const cards: Array<{ v: AgentKeySource; icon: typeof Sparkles; title: string; badge?: string; body: string }> = [
    {
      v: 'khatario',
      icon: Sparkles,
      title: 'Khatario AI',
      badge: 'Recommended',
      body: k.active
        ? k.monthlyQuota === -1
          ? 'Active · unlimited replies included.'
          : `Active · ${k.monthlyQuota.toLocaleString('en-IN')} replies a month included with Connect.`
        : `No setup. ${k.trialTotal} free test replies. Live replies come with your Connect plan.`,
    },
    {
      v: 'own',
      icon: KeyRound,
      title: 'My own API key',
      body: 'Use your Groq, OpenAI or Gemini key. You pay the provider directly; Khatario charges nothing extra.',
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cards.map((c) => {
        const selected = value === c.v;
        const Icon = c.icon;
        return (
          <button
            key={c.v}
            type="button"
            onClick={() => onChange(c.v)}
            aria-pressed={selected}
            className={clsx(
              'relative rounded-xl border-2 p-4 text-left transition-all',
              selected ? 'border-primary-500 bg-primary-50/60 shadow-sm dark:bg-primary-900/20' : 'border-border hover:border-primary-400',
            )}
          >
            {selected && <CheckCircle2 className="absolute right-3 top-3 h-5 w-5 text-primary-600" />}
            <div className="flex items-center gap-2 pr-6">
              <Icon className="h-5 w-5 text-primary-600" />
              <span className="font-semibold text-text-primary">{c.title}</span>
              {c.badge && (
                <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary-800 dark:bg-primary-900/40 dark:text-primary-200">
                  {c.badge}
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-text-secondary">{c.body}</p>
          </button>
        );
      })}
    </div>
  );
}

/** Provider, key and model inputs for "My own API key". */
export function OwnKeyFields({
  businessId,
  draft,
  onChange,
  hasKey,
  keyLast4,
}: {
  businessId: string;
  draft: Pick<ProviderDraft, 'provider' | 'apiKey' | 'apiBaseUrl' | 'model'>;
  onChange: (patch: Partial<ProviderDraft>) => void;
  hasKey: boolean;
  keyLast4: string | null;
}) {
  const toast = useToastContext();
  const [replacing, setReplacing] = useState(!hasKey);
  const [testing, setTesting] = useState(false);
  const meta = PROVIDERS.find((p) => p.value === draft.provider) ?? PROVIDERS[0];

  const testKey = async () => {
    setTesting(true);
    try {
      const res = await agentFetch<{ ok: boolean; error?: string }>(businessId, '/api/ai-agent/provider', {
        method: 'POST',
        body: agentJson({ provider: draft.provider, apiKey: draft.apiKey, model: draft.model, apiBaseUrl: draft.apiBaseUrl }),
      });
      if (res.ok) toast.success('Key works.');
      else toast.error(res.error || 'The provider rejected this key.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Key test failed');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel>Provider</FieldLabel>
          <select className="input" value={draft.provider} onChange={(e) => onChange({ provider: e.target.value, model: '' })}>
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel>Model</FieldLabel>
          <input
            className="input"
            list={`models-${draft.provider}`}
            value={draft.model}
            placeholder={meta.models[0] || 'model-name'}
            onChange={(e) => onChange({ model: e.target.value })}
          />
          <datalist id={`models-${draft.provider}`}>
            {meta.models.map((m) => <option key={m} value={m} />)}
          </datalist>
        </div>
      </div>
      {draft.provider === 'custom' && (
        <div>
          <FieldLabel>API base URL</FieldLabel>
          <input
            className="input"
            value={draft.apiBaseUrl}
            placeholder="https://api.example.com/v1"
            onChange={(e) => onChange({ apiBaseUrl: e.target.value })}
          />
        </div>
      )}
      <div>
        <div className="flex items-end justify-between">
          <FieldLabel>API key</FieldLabel>
          {meta.keyUrl && (
            <a href={meta.keyUrl} target="_blank" rel="noreferrer" className="mb-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline">
              Get an API key <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        {hasKey && !replacing ? (
          <div className="flex items-center gap-3">
            <span className="input flex-1 font-mono text-text-secondary">•••• •••• •••• {keyLast4 || '····'}</span>
            <Button size="sm" variant="secondary" onClick={() => setReplacing(true)}>Replace key</Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              className="input flex-1 font-mono"
              value={draft.apiKey}
              placeholder="Paste your key"
              onChange={(e) => onChange({ apiKey: e.target.value })}
            />
            <Button size="sm" variant="secondary" onClick={testKey} disabled={!draft.apiKey.trim()} isLoading={testing}>
              Test key
            </Button>
          </div>
        )}
        <p className="mt-1 text-xs text-text-secondary">Stored encrypted. It is never shown again after saving.</p>
      </div>
    </div>
  );
}

export function ProviderSection({
  businessId,
  provider,
  usage,
  saving,
  onSave,
  onResetDefaults,
}: {
  businessId: string;
  provider: AgentProviderSummary;
  usage: AgentUsage;
  saving: boolean;
  onSave: (draft: ProviderDraft) => Promise<boolean>;
  onResetDefaults: () => void;
}) {
  const [open, setOpen] = useState(false);
  const initial = useMemo(() => fromSummary(provider), [provider]);
  const [draft, setDraft] = useState<ProviderDraft>(initial);
  useEffect(() => setDraft(initial), [initial]);
  const set = (patch: Partial<ProviderDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  return (
    <SectionCard
      id="advanced"
      icon={Settings2}
      title="Advanced"
      description="AI provider, model, typing indicator and daily reply cap."
      appliesImmediately
      actions={
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 text-sm font-medium text-text-secondary hover:text-text-primary"
          aria-expanded={open}
        >
          {open ? 'Hide' : 'Show'} <ChevronDown className={clsx('h-4 w-4 transition-transform', open && 'rotate-180')} />
        </button>
      }
    >
      {!open ? (
        <p className="text-sm text-text-secondary">
          Powered by {provider.keySource === 'khatario' ? 'Khatario AI' : `your ${PROVIDERS.find((p) => p.value === provider.provider)?.label ?? provider.provider} key`}.
        </p>
      ) : (
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-sm font-medium text-text-primary">Power your agent with</p>
            <KeySourceCards value={draft.keySource} onChange={(keySource) => set({ keySource })} usage={usage} />
          </div>

          {draft.keySource === 'own' && (
            <OwnKeyFields
              businessId={businessId}
              draft={draft}
              onChange={set}
              hasKey={provider.hasKey}
              keyLast4={provider.keyLast4}
            />
          )}

          {draft.keySource === 'own' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel hint="Lower is more predictable; higher is more creative.">Creativity ({draft.temperature.toFixed(1)})</FieldLabel>
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.1}
                  value={draft.temperature}
                  onChange={(e) => set({ temperature: parseFloat(e.target.value) })}
                  className="w-full accent-primary-600"
                />
              </div>
              <div>
                <FieldLabel hint="Upper limit on reply length (100–2000).">Max tokens</FieldLabel>
                <input
                  type="number"
                  min={100}
                  max={2000}
                  className="input"
                  value={draft.maxTokens}
                  onChange={(e) => set({ maxTokens: parseInt(e.target.value, 10) || 500 })}
                />
              </div>
            </div>
          )}

          <div className="space-y-4 border-t border-border pt-5">
            <Switch
              checked={draft.typingEnabled}
              onChange={(typingEnabled) => set({ typingEnabled })}
              label="Show typing before replying"
              description="Customers see “typing…” for a moment, which feels more natural."
            />
            {draft.typingEnabled && (
              <label className="flex items-center gap-2 text-sm text-text-primary">
                Delay
                <input
                  type="number"
                  min={1}
                  max={10}
                  className="input h-9 w-20 py-1"
                  value={draft.typingDelaySeconds}
                  onChange={(e) => set({ typingDelaySeconds: Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
                />
                seconds
              </label>
            )}
            <label className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
              Daily reply cap
              <input
                type="number"
                min={0}
                max={10000}
                className="input h-9 w-28 py-1"
                value={draft.dailyLimit}
                onChange={(e) => set({ dailyLimit: Math.max(0, parseInt(e.target.value, 10) || 0) })}
              />
              <span className="text-xs text-text-secondary">0 means no cap. Protects your API bill from spam.</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            <button
              type="button"
              onClick={onResetDefaults}
              className="inline-flex items-center gap-1 text-sm font-medium text-text-secondary hover:text-red-600"
            >
              <RotateCcw className="h-4 w-4" /> Reset behaviour to defaults
            </button>
            <Button
              size="sm"
              disabled={!dirty}
              isLoading={saving}
              onClick={async () => {
                if (await onSave(draft)) set({ apiKey: '' });
              }}
            >
              Save AI settings
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
