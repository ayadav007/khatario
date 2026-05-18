'use client';

import React, { useState } from 'react';
import { Zap, Plus, X, Play } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';


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
      <Card className="dark:bg-gray-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Zap className="w-6 h-6 text-primary-600 dark:text-primary-400" />
            <h2 className="text-xl font-bold dark:text-gray-100">Workflow Automation</h2>
          </div>
          <Button onClick={() => setEditing({ name: '', triggerType: '', conditions: [], actions: [], isActive: true })} className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Workflow
          </Button>
        </div>

        {workflows.map((workflow) => (
          <div key={workflow.id} className="p-4 border dark:border-gray-700 rounded-lg mb-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold dark:text-gray-100">{workflow.name}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  When {workflow.triggerType} → {workflow.actions.length} action(s)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-xs ${workflow.isActive ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                  {workflow.isActive ? 'Active' : 'Inactive'}
                </span>
                <button onClick={() => setEditing(workflow)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                  <Play className="w-4 h-4 dark:text-gray-400" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </Card>

      {editing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-[600px] max-h-[80vh] overflow-y-auto dark:bg-gray-800">
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
                  className="w-full px-3 py-2 border dark:border-gray-600 rounded-lg dark:bg-gray-900 dark:text-gray-200"
                  placeholder="e.g., Send payment reminder"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Trigger</label>
                <select
                  value={editing.triggerType}
                  onChange={(e) => setEditing({ ...editing, triggerType: e.target.value })}
                  className="w-full px-3 py-2 border dark:border-gray-600 rounded-lg dark:bg-gray-900 dark:text-gray-200"
                >
                  <option value="">Select trigger...</option>
                  {TRIGGERS.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Actions</label>
                <select className="w-full px-3 py-2 border dark:border-gray-600 rounded-lg dark:bg-gray-900 dark:text-gray-200">
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
