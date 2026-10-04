'use client';

import { MessageSquare, List, MousePointerClick, HelpCircle, GitBranch, Zap, StopCircle, Play } from 'lucide-react';
import type { FlowNodeType } from '@/lib/whatsapp/flows/schema';

const ITEMS: Array<{ type: FlowNodeType; label: string; icon: typeof Play }> = [
  { type: 'start', label: 'Start', icon: Play },
  { type: 'message', label: 'Message', icon: MessageSquare },
  { type: 'buttons', label: 'Buttons', icon: MousePointerClick },
  { type: 'list', label: 'List', icon: List },
  { type: 'ask', label: 'Ask', icon: HelpCircle },
  { type: 'branch', label: 'Branch', icon: GitBranch },
  { type: 'action', label: 'Action', icon: Zap },
  { type: 'end', label: 'End', icon: StopCircle },
];

export function FlowPalette({ onAdd }: { onAdd: (type: FlowNodeType) => void }) {
  return (
    <aside className="hidden w-44 shrink-0 border-r border-border bg-surface-secondary/40 p-2 dark:border-border-dark md:block">
      <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Steps</p>
      <div className="space-y-1">
        {ITEMS.filter((i) => i.type !== 'start').map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.type}
              type="button"
              onClick={() => onAdd(item.type)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text-secondary hover:bg-white hover:text-text-primary dark:hover:bg-surface-dark"
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
