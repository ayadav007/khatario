'use client';

import type { FlowNode } from '@/lib/whatsapp/flows/schema';
import { FlowNodeEditor } from './FlowNodeEditor';

export function FlowInspector({
  node,
  onChange,
  onDelete,
}: {
  node: FlowNode | null;
  onChange: (node: FlowNode) => void;
  onDelete?: (id: string) => void;
}) {
  if (!node) {
    return (
      <aside className="hidden w-80 shrink-0 border-l border-border p-3 text-sm text-text-muted dark:border-border-dark md:block">
        Select a step. Fields also appear on the card. Delete or Backspace removes a step (not Start).
      </aside>
    );
  }

  return (
    <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-border p-3 dark:border-border-dark md:block">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{node.type}</p>
      <div className="mt-3">
        <FlowNodeEditor node={node} onChange={onChange} />
      </div>
      {onDelete ? (
        <div className="mt-6 border-t border-border pt-3 dark:border-border-dark">
          {node.type === 'start' ? (
            <p className="text-xs text-text-muted">Start cannot be deleted. A flow needs exactly one Start.</p>
          ) : (
            <button
              type="button"
              className="w-full rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
              onClick={() => onDelete(node.id)}
            >
              Delete this step
            </button>
          )}
        </div>
      ) : null}
    </aside>
  );
}
