'use client';

import type { FlowNode } from '@/lib/whatsapp/flows/schema';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';

export function FlowInspector({
  node,
  onChange,
}: {
  node: FlowNode | null;
  onChange: (node: FlowNode) => void;
}) {
  if (!node) {
    return (
      <aside className="hidden w-72 shrink-0 border-l border-border p-3 text-sm text-text-muted dark:border-border-dark md:block">
        Select a step to edit it.
      </aside>
    );
  }

  const setData = (data: FlowNode['data']) => onChange({ ...node, data } as FlowNode);

  return (
    <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-border p-3 dark:border-border-dark md:block">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{node.type}</p>
      {node.type === 'start' && (
        <div className="mt-3 space-y-3">
          <label className="block text-xs font-medium">Exact start words (comma separated)</label>
          <Input
            value={(node.data.hardPhrases || []).join(', ')}
            onChange={(e) => setData({ ...node.data, hardPhrases: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={!!node.data.firstMessage}
              onChange={(e) => setData({ ...node.data, firstMessage: e.target.checked })}
            />
            First message in a chat
          </label>
          <label className="block text-xs font-medium">Soft intents (for the AI router)</label>
          <Textarea
            rows={3}
            value={(node.data.softIntents || []).join('\n')}
            onChange={(e) => setData({ ...node.data, softIntents: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
          />
        </div>
      )}
      {(node.type === 'message' || node.type === 'buttons' || node.type === 'list' || node.type === 'ask') && (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-medium">Message</label>
          <Textarea
            rows={4}
            value={'body' in node.data ? node.data.body : ''}
            onChange={(e) => setData({ ...node.data, body: e.target.value })}
          />
        </div>
      )}
      {node.type === 'buttons' && (
        <div className="mt-3 space-y-2">
          {node.data.buttons.map((b, i) => (
            <Input
              key={b.id}
              value={b.title}
              onChange={(e) => {
                const buttons = node.data.buttons.map((x, j) => (j === i ? { ...x, title: e.target.value } : x));
                setData({ ...node.data, buttons });
              }}
            />
          ))}
        </div>
      )}
      {node.type === 'ask' && (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-medium">Save as</label>
          <Input value={node.data.storeAs} onChange={(e) => setData({ ...node.data, storeAs: e.target.value })} />
          <select
            className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-sm dark:border-border-dark dark:bg-surface-dark"
            value={node.data.input}
            onChange={(e) => setData({ ...node.data, input: e.target.value as typeof node.data.input })}
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="phone">Phone</option>
            <option value="email">Email</option>
          </select>
        </div>
      )}
      {node.type === 'action' && (
        <div className="mt-3">
          <select
            className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-sm dark:border-border-dark dark:bg-surface-dark"
            value={node.data.kind}
            onChange={(e) => setData({ ...node.data, kind: e.target.value as typeof node.data.kind })}
          >
            <option value="open_shop">Open shop</option>
            <option value="handoff">Handoff to team</option>
            <option value="assign_to_user_id">Assign agent</option>
            <option value="add_labels">Add labels</option>
            <option value="remove_labels">Remove labels</option>
          </select>
        </div>
      )}
      {node.type === 'branch' && (
        <div className="mt-3 space-y-2">
          <Input value={node.data.field} onChange={(e) => setData({ ...node.data, field: e.target.value })} />
          <Input
            placeholder="Equals (optional)"
            value={node.data.equals || ''}
            onChange={(e) => setData({ ...node.data, equals: e.target.value })}
          />
        </div>
      )}
    </aside>
  );
}
