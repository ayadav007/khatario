'use client';

import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, CheckCircle2, Loader2, PartyPopper } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { useToastContext } from '@/contexts/ToastContext';
import { INSTRUCTIONS_MAX, type AgentKeySource, type AgentSettings } from '@/lib/ai-agent/types';
import { agentFetch, agentJson, type AgentSnapshot } from './api';
import { applyIndustry, INDUSTRY_OPTIONS } from './ProfileSection';
import { KeySourceCards, OwnKeyFields, type ProviderDraft } from './ProviderSection';

const STEPS = ['About your business', 'Power your agent', 'Done'];

export function SetupWizard({
  businessId,
  snapshot,
  onFinished,
  onOpenEditor,
  onAddTestNumber,
}: {
  businessId: string;
  snapshot: AgentSnapshot;
  onFinished: (snap: AgentSnapshot) => void;
  onOpenEditor: () => void;
  onAddTestNumber: () => void;
}) {
  const toast = useToastContext();
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState<AgentSettings>(snapshot.settings);
  const [keySource, setKeySource] = useState<AgentKeySource>(snapshot.provider.hasKey ? snapshot.provider.keySource : 'khatario');
  const [own, setOwn] = useState<Pick<ProviderDraft, 'provider' | 'apiKey' | 'apiBaseUrl' | 'model'>>({
    provider: snapshot.provider.provider || 'groq',
    apiKey: '',
    apiBaseUrl: snapshot.provider.apiBaseUrl || '',
    model: snapshot.provider.model || '',
  });
  const [saving, setSaving] = useState(false);
  const industry = settings.behavior.advanced?.industryTemplate ?? 'retail';

  const canNext1 = settings.businessSummary.trim().length >= 20 && settings.agentName.trim().length > 0;
  const canNext2 = keySource === 'khatario' || snapshot.provider.hasKey || own.apiKey.trim().length > 0;

  const finish = async () => {
    setSaving(true);
    try {
      await agentFetch(businessId, '/api/ai-agent/provider', {
        method: 'PUT',
        body: agentJson({
          keySource,
          ...(keySource === 'own' ? { provider: own.provider, apiKey: own.apiKey, model: own.model, apiBaseUrl: own.apiBaseUrl } : {}),
          mode: 'dev',
          chatbotEnabled: true,
        }),
      });
      const snap = await agentFetch<AgentSnapshot>(businessId, '/api/ai-agent', {
        method: 'PUT',
        body: agentJson({ settings, completeSetup: true }),
      });
      void agentFetch(businessId, '/api/ai-agent/knowledge/reindex', { method: 'POST', body: agentJson({}) }).catch(() => undefined);
      onFinished(snap);
      setStep(2);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not finish setup');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padding="lg" className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-600 text-white">
          <Bot className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-text-primary">Set up your WhatsApp AI agent</h2>
          <p className="text-sm text-text-secondary">Three quick steps. You can change everything later.</p>
        </div>
      </div>

      <ol className="mb-6 flex items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={clsx(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                i < step ? 'bg-green-600 text-white' : i === step ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-slate-300',
              )}
            >
              {i < step ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </span>
            <span className={clsx('hidden text-sm sm:inline', i === step ? 'font-medium text-text-primary' : 'text-text-secondary')}>{label}</span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-5">
          <div>
            <Textarea
              label="Tell us about your business"
              rows={4}
              value={settings.businessSummary}
              maxLength={INSTRUCTIONS_MAX}
              onChange={(e) => setSettings({ ...settings, businessSummary: e.target.value })}
              placeholder="We are a family-run grocery store in Pune selling fresh produce, staples and household items. We deliver within 5 km."
              helperText="At least a couple of sentences: what you sell, who you sell to, where you are."
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-text-primary">What kind of business is it?</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {INDUSTRY_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setSettings({ ...settings, behavior: applyIndustry(settings.behavior, o.value) })}
                  aria-pressed={industry === o.value}
                  className={clsx(
                    'rounded-xl border-2 p-3 text-left transition-all',
                    industry === o.value ? 'border-primary-500 bg-primary-50/60 dark:bg-primary-900/20' : 'border-border hover:border-primary-400',
                  )}
                >
                  <p className="text-sm font-semibold text-text-primary">{o.label}</p>
                  <p className="mt-0.5 text-xs text-text-secondary">{o.hint}</p>
                </button>
              ))}
            </div>
          </div>
          <Input
            label="Agent name"
            value={settings.agentName}
            maxLength={120}
            onChange={(e) => setSettings({ ...settings, agentName: e.target.value })}
          />
          <div className="flex justify-end">
            <Button onClick={() => setStep(1)} disabled={!canNext1}>
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <KeySourceCards value={keySource} onChange={setKeySource} usage={snapshot.usage} />
          {keySource === 'own' && (
            <OwnKeyFields
              businessId={businessId}
              draft={own}
              onChange={(p) => setOwn((o) => ({ ...o, ...p }))}
              hasKey={snapshot.provider.hasKey}
              keyLast4={snapshot.provider.keyLast4}
            />
          )}
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            Your agent starts in <strong>Test mode</strong>: customers won&apos;t get AI replies until you switch to Live.
          </p>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(0)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button onClick={finish} disabled={!canNext2} isLoading={saving}>
              Create my agent
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5 text-center">
          <PartyPopper className="mx-auto h-12 w-12 text-primary-600" />
          <div>
            <h3 className="text-lg font-semibold text-text-primary">Your agent is ready in Test mode</h3>
            <p className="mt-1 text-sm text-text-secondary">Try it in the test chat, add your FAQs, then go Live.</p>
          </div>
          <div className="mx-auto flex max-w-sm items-center justify-center gap-2 rounded-lg bg-gray-50 px-4 py-3 text-sm text-text-secondary dark:bg-slate-800/50">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading your catalogue and store policies…
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={onAddTestNumber}>Add my number to test</Button>
            <Button onClick={onOpenEditor}>Open editor</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
