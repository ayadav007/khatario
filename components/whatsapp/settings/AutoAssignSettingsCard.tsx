'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { useToastContext } from '@/contexts/ToastContext';

interface Agent {
  id: string;
  name: string;
  email?: string;
}

export function AutoAssignSettingsCard({ businessId }: { businessId: string }) {
  const toast = useToastContext();
  const [enabled, setEnabled] = useState(false);
  const [pool, setPool] = useState<string[]>([]);
  const [saved, setSaved] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, usersRes] = await Promise.all([
        fetch(`/api/whatsapp/auto-assign?business_id=${businessId}`),
        fetch(`/api/whatsapp/users?business_id=${businessId}`),
      ]);
      const [settingsData, usersData] = await Promise.all([settingsRes.json(), usersRes.json()]);
      const nextEnabled = settingsData.enabled ?? false;
      const nextPool: string[] = settingsData.agent_ids ?? [];
      setEnabled(nextEnabled);
      setPool(nextPool);
      setSaved(JSON.stringify({ e: nextEnabled, p: nextPool }));
      setAgents(usersData.users ?? []);
    } catch {
      toast.error('Failed to load assignment settings');
    } finally {
      setLoading(false);
    }
  }, [businessId, toast]);

  useEffect(() => {
    if (businessId) void fetchSettings();
  }, [businessId, fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/whatsapp/auto-assign?business_id=${businessId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, agent_ids: pool }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setSaved(JSON.stringify({ e: enabled, p: pool }));
      toast.success('Assignment settings saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const toggleAgent = (id: string) =>
    setPool((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const dirty = saved !== JSON.stringify({ e: enabled, p: pool });

  return (
    <div className="space-y-4">
      <Switch
        checked={enabled}
        onChange={setEnabled}
        label="Assign new chats automatically"
        description="Each new conversation without an owner goes to the next person in the list below, in turn."
      />

      {enabled ? (
        <div className="space-y-2 border-t border-border pt-4 dark:border-border-dark">
          <p className="type-label">
            Who gets chats <span className="font-normal text-text-muted">({pool.length} selected)</span>
          </p>
          {agents.length === 0 ? (
            <p className="text-sm text-text-secondary">No team members yet. Invite users under Users &amp; access first.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {agents.map((agent) => {
                const selected = pool.includes(agent.id);
                return (
                  <label
                    key={agent.id}
                    className={clsx(
                      'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition-colors',
                      selected
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                        : 'border-border hover:bg-gray-50 dark:border-border-dark dark:hover:bg-slate-800/50',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleAgent(agent.id)}
                      className="h-4 w-4 rounded accent-primary-600"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-text-primary">{agent.name}</span>
                      {agent.email ? <span className="block truncate text-xs text-text-muted">{agent.email}</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <p className="text-xs text-text-secondary">Chats are handed out in the order you tick people.</p>
        </div>
      ) : null}

      <div className="flex justify-end border-t border-border pt-4 dark:border-border-dark">
        <Button size="sm" onClick={() => void handleSave()} disabled={!dirty} isLoading={saving}>
          Save
        </Button>
      </div>
    </div>
  );
}
