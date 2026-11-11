'use client';

import React, { useState } from 'react';
import { Zap, Plus, X, Pencil } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';


interface Workflow {
  id?: string;
  name: string;
  triggerType: string;
  conditions: Array<{ field: string; operator: string; value: any }>;
  actions: Array<{ type: string; config: any }>;
  isActive: boolean;
}

export const WorkflowBuilder: React.FC<{ businessId: string }> = ({ businessId }) => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [editing, setEditing] = useState<Workflow | null>(null);

  const TRIGGERS = [
    { id: 'invoice_created', label: 'Invoice Created' },
    { id: 'payment_received', label: 'Payment Received' },
    { id: 'invoice_overdue', label: 'Invoice Overdue' },
    { id: 'low_stock', label: 'Low Stock Alert' },
  ];

  const ACTIONS = [
    { id: 'send_email', label: 'Send Email' },
    { id: 'send_whatsapp', label: 'Send WhatsApp' },
    { id: 'update_status', label: 'Update Status' },
    { id: 'create_task', label: 'Create Task' },
  ];

  const saveWorkflow = async () => {
    if (!editing) return;

    try {
      await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editing, business_id: businessId }),
      });
      setEditing(null);
    } catch (error) {
      console.error('Failed to save workflow:', error);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-text-secondary">
            {workflows.length === 1 ? '1 workflow' : `${workflows.length} workflows`}
          </p>
          <Button onClick={() => setEditing({ name: '', triggerType: '', conditions: [], actions: [], isActive: true })} className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Workflow
          </Button>
        </div>

        {workflows.length === 0 ? (
          <EmptyState
            icon={Zap}
            title="No workflows yet"
            description="A workflow runs actions for you when something happens, like sending a message when an invoice is overdue."
          />
        ) : null}
        {workflows.map((workflow) => (
          <div key={workflow.id} className="mb-3 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-semibold text-text-primary">{workflow.name}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  When {workflow.triggerType} → {workflow.actions.length} action(s)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-xs ${workflow.isActive ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                  {workflow.isActive ? 'Active' : 'Inactive'}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setEditing(workflow)} aria-label={`Edit ${workflow.name}`}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </Card>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <Card role="dialog" aria-modal="true" className="max-h-[90dvh] w-full max-w-xl overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4 dark:text-gray-100">
              {editing.id ? 'Edit Workflow' : 'Create Workflow'}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Workflow Name</label>
                <input
                  type="text"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="input w-full"
                  placeholder="e.g., Send payment reminder"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Trigger</label>
                <select
                  value={editing.triggerType}
                  onChange={(e) => setEditing({ ...editing, triggerType: e.target.value })}
                  className="input w-full"
                >
                  <option value="">Select trigger...</option>
                  {TRIGGERS.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Actions</label>
                <select className="input w-full">
                  <option value="">Select action...</option>
                  {ACTIONS.map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <Button onClick={saveWorkflow}>Save Workflow</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
