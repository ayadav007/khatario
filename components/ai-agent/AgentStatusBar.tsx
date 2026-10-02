'use client';

import React, { useState } from 'react';
import { Bot, Check, MessageSquare, Pencil, X } from 'lucide-react';
import { clsx } from 'clsx';
import { Switch } from '@/components/ui/Switch';
import type { AgentMode, AgentProviderSummary, AgentUsage } from '@/lib/ai-agent/types';
import { UsageMeter } from './UsageMeter';

export function AgentStatusBar({
  agentName,
  onRename,
  provider,
  usage,
  busy,
  onToggleEnabled,
  onModeChange,
  onOpenTestChat,
  onUpgrade,
}: {
  agentName: string;
  onRename: (name: string) => void;
  provider: AgentProviderSummary;
  usage: AgentUsage;
  busy: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onModeChange: (mode: AgentMode) => void;
  onOpenTestChat: () => void;
  onUpgrade: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(agentName);

  const commit = () => {
    const name = draft.trim();
    if (name) onRename(name);
    setEditing(false);
  };

  return (
    <div className="sticky top-0 z-30 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white">
            <Bot className="h-5 w-5" />
          </div>
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={draft}
                maxLength={120}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') setEditing(false);
                }}
                className="input h-8 w-48 py-1 text-sm"
                aria-label="Agent name"
              />
              <button type="button" onClick={commit} className="rounded p-1 text-green-700 hover:bg-green-50" aria-label="Save name">
                <Check className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setEditing(false)} className="rounded p-1 text-text-muted hover:bg-gray-100" aria-label="Cancel">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(agentName);
                setEditing(true);
              }}
              className="group flex min-w-0 items-center gap-1.5"
            >
              <span className="truncate text-base font-semibold text-text-primary">{agentName || 'AI Agent'}</span>
              <Pencil className="h-3.5 w-3.5 text-text-muted group-hover:text-text-primary" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-text-secondary">AI</span>
          <Switch
            checked={provider.chatbotEnabled}
            onChange={onToggleEnabled}
            disabled={busy}
            aria-label="Turn the AI agent on or off"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-text-secondary">Mode</span>
          <div className="inline-flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Agent mode">
            {(['dev', 'prod'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={provider.mode === m}
                disabled={busy}
                onClick={() => provider.mode !== m && onModeChange(m)}
                className={clsx(
                  'rounded-md px-3 py-1 text-xs font-semibold transition-colors',
                  provider.mode === m
                    ? m === 'prod'
                      ? 'bg-green-600 text-white'
                      : 'bg-amber-500 text-white'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {m === 'dev' ? 'Test' : 'Live'}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenTestChat}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-gray-50 dark:hover:bg-slate-800 xl:hidden"
        >
          <MessageSquare className="h-4 w-4" /> Test chat
        </button>

        <div className="w-full sm:ml-auto sm:w-auto">
          <UsageMeter usage={usage} onUpgrade={onUpgrade} />
        </div>
      </div>
      {!provider.chatbotEnabled && (
        <p className="mt-2 text-xs text-amber-700">The AI is off — customers won&apos;t get automatic replies.</p>
      )}
      {provider.chatbotEnabled && provider.mode === 'dev' && (
        <p className="mt-2 text-xs text-amber-700">
          Test mode — only your test numbers get AI replies. Switch to Live when you&apos;re happy with the answers.
        </p>
      )}
    </div>
  );
}
