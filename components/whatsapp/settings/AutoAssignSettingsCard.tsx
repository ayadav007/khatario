'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Users, Loader2, Save, Plus, X, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';

interface Agent {
  id: string;
  name: string;
  email?: string;
}

interface AutoAssignSettingsCardProps {
  businessId: string;
}

export function AutoAssignSettingsCard({ businessId }: AutoAssignSettingsCardProps) {
  const [enabled, setEnabled] = useState(false);
  const [pool, setPool] = useState<string[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, usersRes] = await Promise.all([
        fetch(`/api/whatsapp/auto-assign?business_id=${businessId}`),
        fetch(`/api/whatsapp/users?business_id=${businessId}`),
      ]);
      const [settingsData, usersData] = await Promise.all([settingsRes.json(), usersRes.json()]);

      setEnabled(settingsData.enabled ?? false);
      setPool(settingsData.agent_ids ?? []);
      setAgents(usersData.users ?? []);
    } catch {
      setToast({ message: 'Failed to load settings.', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (businessId) fetchSettings();
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
      setToast({ message: 'Auto-assignment settings saved!', type: 'success' });
    } catch (e: any) {
      setToast({ message: e.message || 'Failed to save.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const toggleAgent = (id: string) => {
    setPool((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-gray-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading auto-assignment settings…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-900">Auto-Assign New Conversations</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Round-robin assignment when a new chat arrives with no assigned agent.
          </p>
        </div>
        <button
          onClick={() => setEnabled((v) => !v)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            enabled ? 'bg-primary-600' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Agent pool */}
      {enabled && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Users className="w-4 h-4 text-gray-500" />
            <span className="text-xs font-semibold text-gray-700">Assignment Pool</span>
            <span className="text-xs text-gray-400 ml-1">({pool.length} selected)</span>
          </div>
          {agents.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No team members found. Invite users first.</p>
          ) : (
            <div className="grid grid-cols-1 gap-1.5">
              {agents.map((agent) => {
                const selected = pool.includes(agent.id);
                return (
                  <label
                    key={agent.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                      selected
                        ? 'bg-slate-50 border-primary-300 text-primary-800'
                        : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleAgent(agent.id)}
                      className="rounded accent-primary-600"
                    />
                    <span className="text-sm font-medium">{agent.name}</span>
                    {agent.email && (
                      <span className="text-xs text-gray-400 truncate">{agent.email}</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
          <div className="flex items-start gap-1.5 mt-2 text-xs text-gray-400">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Conversations are assigned in the order shown. You can reorder by selecting the agents
            in your preferred priority.
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
          size="sm"
          variant="primary"
          className="gap-1.5"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save
        </Button>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
