'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, MessageSquare } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { SlideOverPanel } from '@/components/ui/SlideOverPanel';
import { SettingsFloatingSaveBar } from '@/components/settings/SettingsFloatingSaveBar';
import { useToastContext } from '@/contexts/ToastContext';
import { startAddonPurchase } from '@/lib/subscription/client-addon-purchase';
import { DefaultUIConfig } from '@/types/whatsapp-bot-config';
import type { AgentMode, AgentProviderSummary, AgentSettings, AgentUsage } from '@/lib/ai-agent/types';
import { AgentApiError, agentFetch, agentJson, type AgentSnapshot } from './api';
import { AgentStatusBar } from './AgentStatusBar';
import { GoLiveDialog } from './GoLiveDialog';
import { HandoffSection } from './HandoffSection';
import { KnowledgeSection } from './KnowledgeSection';
import type { StaffOption } from './LeadQualificationEditor';
import { PaymentsSection } from './PaymentsSection';
import { ProductsSection } from './ProductsSection';
import { ProfileSection } from './ProfileSection';
import { ProviderSection, type ProviderDraft } from './ProviderSection';
import { SetupWizard } from './SetupWizard';
import { SkillsSection } from './SkillsSection';
import { TestChatPanel } from './TestChatPanel';
import { TestNumbersSection } from './TestNumbersSection';
import { ToneSection } from './ToneSection';

type GroupId = 'identity' | 'knowledge' | 'abilities' | 'handoff' | 'golive';

const GROUPS: Array<{ id: GroupId; label: string; sections: string[] }> = [
  { id: 'identity', label: 'Profile & tone', sections: ['profile', 'tone'] },
  { id: 'knowledge', label: 'Knowledge & products', sections: ['knowledge', 'products'] },
  { id: 'abilities', label: 'Skills & payments', sections: ['skills', 'payments'] },
  { id: 'handoff', label: 'Hours & handoff', sections: ['handoff'] },
  { id: 'golive', label: 'Testing & AI model', sections: ['test-numbers', 'advanced'] },
];

const groupOf = (sectionId: string): GroupId => GROUPS.find((g) => g.sections.includes(sectionId))?.id ?? 'identity';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function AiAgentPage({ businessId }: { businessId: string }) {
  const toast = useToastContext();
  const [snap, setSnap] = useState<AgentSnapshot | null>(null);
  const [draft, setDraft] = useState<AgentSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testHidden, setTestHidden] = useState(false);
  const [goLiveOpen, setGoLiveOpen] = useState(false);
  const [group, setGroup] = useState<GroupId>('identity');
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await agentFetch<AgentSnapshot>(businessId, '/api/ai-agent');
      setSnap(s);
      setDraft(s.settings);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load AI agent');
    }
  }, [businessId]);

  useEffect(() => {
    void load();
    agentFetch<{ users?: Array<{ id: string; name?: string | null; email?: string | null }> }>(businessId, '/api/whatsapp/users')
      .then((r) => setStaff((r.users ?? []).map((u) => ({ id: u.id, name: u.name || u.email || 'Team member' }))))
      .catch(() => setStaff([]));
  }, [businessId, load]);

  const dirty = !!snap && !!draft && !same(draft, snap.settings);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const inWizard = !!snap && !snap.settings.setupCompletedAt && !showEditor;

  useEffect(() => {
    if (!scrollTarget || inWizard) return;
    const id = scrollTarget;
    const raf = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-agent-section="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setScrollTarget(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollTarget, group, inWizard]);

  const goToSection = (id: string) => {
    setGroup(groupOf(id));
    setScrollTarget(id);
  };

  const patch = (p: Partial<AgentSettings>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const upgrade = useCallback(async () => {
    try {
      await startAddonPurchase({ businessId, addonType: 'khatario_ai' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start checkout');
    }
  }, [businessId, toast]);

  const refreshUsage = useCallback(() => {
    agentFetch<AgentUsage>(businessId, '/api/ai-agent/usage')
      .then((usage) => setSnap((s) => (s ? { ...s, usage } : s)))
      .catch(() => undefined);
  }, [businessId]);

  const saveSettings = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const s = await agentFetch<AgentSnapshot>(businessId, '/api/ai-agent', {
        method: 'PUT',
        body: agentJson({ settings: draft }),
      });
      setSnap(s);
      setDraft(s.settings);
      toast.success('AI agent saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  /** Provider changes apply immediately and are not part of the draft. */
  const updateProvider = async (body: Record<string, unknown>, successMsg?: string): Promise<boolean> => {
    setProviderBusy(true);
    try {
      const res = await agentFetch<{ provider: AgentProviderSummary }>(businessId, '/api/ai-agent/provider', {
        method: 'PUT',
        body: agentJson(body),
      });
      const fresh = await agentFetch<AgentSnapshot>(businessId, '/api/ai-agent').catch(() => null);
      setSnap((s) => (fresh ? { ...fresh } : s ? { ...s, provider: res.provider } : s));
      if (successMsg) toast.success(successMsg);
      return true;
    } catch (e) {
      if (e instanceof AgentApiError && e.code === 'KHATARIO_AI_REQUIRED') {
        toast.warning(e.message);
        void upgrade();
      } else {
        toast.error(e instanceof Error ? e.message : 'Failed to update');
      }
      return false;
    } finally {
      setProviderBusy(false);
    }
  };

  const onModeChange = (mode: AgentMode) => {
    if (mode === 'prod') setGoLiveOpen(true);
    else void updateProvider({ mode: 'dev' }, 'Switched to Test mode');
  };

  const onProviderSave = (d: ProviderDraft) =>
    updateProvider(
      {
        keySource: d.keySource,
        provider: d.provider,
        model: d.model,
        apiBaseUrl: d.apiBaseUrl,
        temperature: d.temperature,
        maxTokens: d.maxTokens,
        typingEnabled: d.typingEnabled,
        typingDelaySeconds: d.typingDelaySeconds,
        dailyLimit: d.dailyLimit,
        ...(d.apiKey.trim() ? { apiKey: d.apiKey.trim() } : {}),
      },
      'AI settings saved',
    );

  if (loadError && !snap) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface p-10 text-center">
        <AlertCircle className="h-8 w-8 text-red-500" />
        <p className="text-sm text-text-secondary">{loadError}</p>
        <Button variant="secondary" onClick={() => void load()}>Try again</Button>
      </div>
    );
  }

  if (!snap || !draft) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (inWizard) {
    return (
      <SetupWizard
        businessId={businessId}
        snapshot={snap}
        onFinished={(s) => {
          setSnap(s);
          setDraft(s.settings);
        }}
        onOpenEditor={() => setShowEditor(true)}
        onAddTestNumber={() => {
          setShowEditor(true);
          goToSection('test-numbers');
        }}
      />
    );
  }

  const groupClass = (id: GroupId) => clsx('space-y-6', group !== id && 'hidden');

  return (
    <div className="space-y-4">
      <AgentStatusBar
        agentName={draft.agentName}
        onRename={(agentName) => patch({ agentName })}
        provider={snap.provider}
        usage={snap.usage}
        busy={providerBusy}
        testChatDocked={!testHidden}
        onToggleEnabled={(chatbotEnabled) =>
          void updateProvider({ chatbotEnabled }, chatbotEnabled ? 'AI replies turned on' : 'AI replies turned off')
        }
        onModeChange={onModeChange}
        onOpenTestChat={() => setTestOpen(true)}
        onUpgrade={() => void upgrade()}
      />

      <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="AI agent sections">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGroup(g.id)}
            aria-current={group === g.id ? 'true' : undefined}
            className={clsx(
              'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
              group === g.id
                ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                : 'border-border text-text-secondary hover:bg-gray-50 hover:text-text-primary dark:border-border-dark dark:hover:bg-slate-800',
            )}
          >
            {g.label}
          </button>
        ))}
        {testHidden && (
          <button
            type="button"
            onClick={() => setTestHidden(false)}
            className="ml-auto hidden shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border px-3.5 py-1.5 text-sm text-text-secondary hover:text-text-primary xl:inline-flex"
          >
            <MessageSquare className="h-4 w-4" /> Show test chat
          </button>
        )}
      </nav>

      <div className={clsx('grid gap-8', !testHidden && 'xl:grid-cols-[minmax(0,1fr)_360px]')}>
        <div className={clsx('min-w-0', dirty && 'pb-4')}>
          <div className={groupClass('identity')}>
            <ProfileSection settings={draft} onChange={patch} companyIntroduction={snap.companyIntroduction} />
            <ToneSection behavior={draft.behavior} onChange={(behavior) => patch({ behavior })} />
          </div>
          <div className={groupClass('knowledge')}>
            <KnowledgeSection businessId={businessId} />
            <ProductsSection behavior={draft.behavior} onChange={(behavior) => patch({ behavior })} catalogItems={snap.catalogItems} />
          </div>
          <div className={groupClass('abilities')}>
            <SkillsSection businessId={businessId} settings={draft} onChange={patch} staff={staff} />
            <PaymentsSection settings={draft} onChange={patch} paymentsConfigured={snap.paymentsConfigured} />
          </div>
          <div className={groupClass('handoff')}>
            <HandoffSection settings={draft} onChange={patch} staff={staff} />
          </div>
          <div className={groupClass('golive')}>
            <TestNumbersSection
              phones={snap.provider.devAllowedPhones}
              saving={providerBusy}
              onSave={async (devAllowedPhones) => {
                await updateProvider({ devAllowedPhones }, 'Test numbers saved');
              }}
            />
            <ProviderSection
              businessId={businessId}
              provider={snap.provider}
              usage={snap.usage}
              saving={providerBusy}
              onSave={onProviderSave}
              onResetDefaults={() => {
                patch({ behavior: DefaultUIConfig });
                toast.info('Behaviour reset. Save to apply.');
              }}
            />
          </div>
        </div>

        {!testHidden && (
          <aside className="hidden min-h-0 xl:block">
            <div className="sticky top-24 h-[calc(100vh-8rem)]">
              <TestChatPanel
                businessId={businessId}
                draftSettings={draft}
                agentName={draft.agentName}
                onUsageChanged={refreshUsage}
                onHide={() => setTestHidden(true)}
              />
            </div>
          </aside>
        )}
      </div>

      <SlideOverPanel open={testOpen} onClose={() => setTestOpen(false)} title="Test your agent" widthClass="max-w-md">
        <div className="h-full p-2">
          <TestChatPanel
            businessId={businessId}
            draftSettings={draft}
            agentName={draft.agentName}
            onUsageChanged={refreshUsage}
          />
        </div>
      </SlideOverPanel>

      <GoLiveDialog
        open={goLiveOpen}
        checklist={snap.checklist}
        dirty={dirty}
        busy={providerBusy}
        onClose={() => setGoLiveOpen(false)}
        onFix={(id) => {
          setGoLiveOpen(false);
          goToSection(id);
        }}
        onConfirm={async () => {
          if (await updateProvider({ mode: 'prod', chatbotEnabled: true }, 'Your AI agent is live')) setGoLiveOpen(false);
        }}
      />

      {dirty && (
        <SettingsFloatingSaveBar align="between">
          <span className="text-sm text-text-secondary">You have unsaved changes</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDraft(snap.settings)} disabled={saving}>
              Discard
            </Button>
            <Button size="sm" onClick={() => void saveSettings()} isLoading={saving}>
              Save changes
            </Button>
          </div>
        </SettingsFloatingSaveBar>
      )}
    </div>
  );
}
