'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Hand, Headphones, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { useToastContext } from '@/contexts/ToastContext';

interface Agent {
  id: string;
  name: string;
  email?: string;
  can_receive?: boolean;
}

interface Label {
  id: string;
  name: string;
  color: string;
}

type Rules = Record<string, string[]>;

const STATES = [
  {
    icon: Bot,
    name: 'Active',
    body: 'The bot or AI agent is handling the chat. Everyone can read it; anyone can click Intervene to step in.',
  },
  {
    icon: Hand,
    name: 'Requesting',
    body: 'The customer needs a person (asked for one, or no automatic reply was sent). The first agent to click Intervene gets it.',
  },
  {
    icon: Headphones,
    name: 'Intervened',
    body: 'One agent owns the chat and the bot stays quiet. Only they can reply. They can transfer it or click Resolve to hand it back to the bot. Supervisors can take over or transfer any chat.',
  },
];

function serialize(autoResolve: boolean, rules: Rules): string {
  const sorted = Object.keys(rules)
    .sort()
    .map((k) => [k, [...rules[k]].sort()]);
  return JSON.stringify({ a: autoResolve, r: sorted });
}

export function InboxOwnershipSettingsCard({ businessId }: { businessId: string }) {
  const toast = useToastContext();
  const [autoResolve, setAutoResolve] = useState(true);
  const [rules, setRules] = useState<Rules>({});
  const [saved, setSaved] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const q = `business_id=${encodeURIComponent(businessId)}`;
      const [settingsRes, usersRes, labelsRes] = await Promise.all([
        fetch(`/api/whatsapp/inbox-settings?${q}`),
        fetch(`/api/whatsapp/users?${q}`),
        fetch(`/api/whatsapp/labels?${q}`),
      ]);
      const settings = await settingsRes.json();
      if (!settingsRes.ok) throw new Error(settings.error || 'Failed to load inbox settings');
      const users = usersRes.ok ? await usersRes.json() : { users: [] };
      const labelData = labelsRes.ok ? await labelsRes.json() : { labels: [] };
      const nextRules: Rules = {};
      for (const r of settings.agent_rules ?? []) nextRules[r.user_id] = r.label_ids ?? [];
      const nextAuto = settings.auto_resolve_enabled ?? true;
      setAutoResolve(nextAuto);
      setRules(nextRules);
      setSaved(serialize(nextAuto, nextRules));
      setAgents((users.users ?? []).filter((u: Agent) => u.can_receive !== false));
      setLabels(labelData.labels ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load inbox settings');
    } finally {
      setLoading(false);
    }
  }, [businessId, toast]);

  useEffect(() => {
    if (businessId) void fetchAll();
  }, [businessId, fetchAll]);

  const toggleLabel = (userId: string, labelId: string) =>
    setRules((prev) => {
      const current = prev[userId] ?? [];
      const next = current.includes(labelId) ? current.filter((l) => l !== labelId) : [...current, labelId];
      const copy = { ...prev };
      if (next.length) copy[userId] = next;
      else delete copy[userId];
      return copy;
    });

  const dirty = useMemo(() => saved !== serialize(autoResolve, rules), [saved, autoResolve, rules]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/whatsapp/inbox-settings?business_id=${encodeURIComponent(businessId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_resolve_enabled: autoResolve,
          agent_rules: Object.entries(rules).map(([user_id, label_ids]) => ({ user_id, label_ids })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setSaved(serialize(autoResolve, rules));
      toast.success('Inbox settings saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {STATES.map(({ icon: Icon, name, body }) => (
          <div key={name} className="rounded-lg border border-border p-3 dark:border-border-dark">
            <p className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Icon className="h-4 w-4 text-primary-600" aria-hidden />
              {name}
            </p>
            <p className="mt-1 text-xs text-text-secondary">{body}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-text-secondary">
        Supervisors see every chat. Give a role the &ldquo;Supervise WhatsApp chats&rdquo; permission under Users &amp; access to make
        someone a supervisor; the primary admin always is one.
      </p>

      <div className="border-t border-border pt-4 dark:border-border-dark">
        <Switch
          checked={autoResolve}
          onChange={setAutoResolve}
          label="Auto-resolve quiet chats"
          description="If the customer hasn't replied for 24 hours, the chat goes back to the bot and the agent is freed up."
        />
      </div>

      <div className="space-y-3 border-t border-border pt-4 dark:border-border-dark">
        <div>
          <p className="type-label">Which chats each agent sees</p>
          <p className="mt-0.5 text-xs text-text-secondary">
            Pick labels to limit an agent to unowned chats with those labels. Leave an agent with no labels to let them see all
            unowned chats. Chats they are handling are always visible to them.
          </p>
        </div>
        {agents.length === 0 ? (
          <p className="text-sm text-text-secondary">No team members can use WhatsApp chats yet. Invite users under Users &amp; access first.</p>
        ) : labels.length === 0 ? (
          <p className="text-sm text-text-secondary">Create labels in the inbox first, then come back to limit agents by label.</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border dark:divide-border-dark dark:border-border-dark">
            {agents.map((agent) => {
              const selected = rules[agent.id] ?? [];
              return (
                <div key={agent.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 sm:w-48">
                    <p className="truncate text-sm font-medium text-text-primary">{agent.name}</p>
                    <p className="text-xs text-text-muted">{selected.length ? `${selected.length} label${selected.length === 1 ? '' : 's'}` : 'All unowned chats'}</p>
                  </div>
                  <div className="flex flex-1 flex-wrap gap-1.5">
                    {labels.map((label) => {
                      const on = selected.includes(label.id);
                      return (
                        <button
                          key={label.id}
                          type="button"
                          onClick={() => toggleLabel(agent.id, label.id)}
                          aria-pressed={on}
                          className={clsx(
                            'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                            on ? 'border-transparent' : 'border-border text-text-secondary hover:bg-gray-50 dark:border-border-dark dark:hover:bg-slate-800/50',
                          )}
                          style={on ? { backgroundColor: `${label.color}25`, color: label.color, borderColor: label.color } : undefined}
                        >
                          {label.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex justify-end border-t border-border pt-4 dark:border-border-dark">
        <Button size="sm" onClick={() => void handleSave()} disabled={!dirty} isLoading={saving}>
          Save
        </Button>
      </div>
    </div>
  );
}
