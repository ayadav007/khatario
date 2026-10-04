'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { FlowNode } from '@/lib/whatsapp/flows/schema';

const card = 'rounded-lg border border-border bg-white px-3 py-2 shadow-sm dark:border-border-dark dark:bg-surface-dark min-w-[180px] max-w-[240px]';
const label = 'text-[10px] font-semibold uppercase tracking-wide text-text-muted';

export const flowNodeTypes = {
  start: StartNode,
  message: MessageNode,
  buttons: ButtonsNode,
  list: ListNode,
  ask: AskNode,
  branch: BranchNode,
  action: ActionNode,
  end: EndNode,
};

function StartNode({ data, selected }: NodeProps) {
  const d = data as Extract<FlowNode, { type: 'start' }>['data'];
  return (
    <div className={`${card} ${selected ? 'ring-2 ring-primary-500' : ''}`}>
      <p className={label}>Start</p>
      <p className="mt-1 text-xs text-text-secondary">
        {(d.hardPhrases || []).slice(0, 3).join(', ') || (d.firstMessage ? 'First message' : 'No keywords yet')}
      </p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function MessageNode({ data, selected }: NodeProps) {
  const d = data as Extract<FlowNode, { type: 'message' }>['data'];
  return (
    <div className={`${card} ${selected ? 'ring-2 ring-primary-500' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <p className={label}>Message</p>
      <p className="mt-1 line-clamp-3 text-sm text-text-primary">{d.body}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function ButtonsNode({ data, selected }: NodeProps) {
  const d = data as Extract<FlowNode, { type: 'buttons' }>['data'];
  return (
    <div className={`${card} ${selected ? 'ring-2 ring-primary-500' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <p className={label}>Buttons</p>
      <p className="mt-1 line-clamp-2 text-sm">{d.body}</p>
      <div className="relative mt-2 space-y-1">
        {(d.buttons || []).map((b, i) => (
          <div key={b.id} className="relative rounded border border-border px-2 py-1 text-xs dark:border-border-dark">
            {b.title}
            <Handle type="source" position={Position.Right} id={b.id} style={{ top: 12 + i * 28 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ListNode({ data, selected }: NodeProps) {
  const d = data as Extract<FlowNode, { type: 'list' }>['data'];
  return (
    <div className={`${card} ${selected ? 'ring-2 ring-primary-500' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <p className={label}>List</p>
      <p className="mt-1 line-clamp-2 text-sm">{d.body}</p>
      {(d.rows || []).slice(0, 4).map((r) => (
        <div key={r.id} className="relative mt-1 rounded border border-border px-2 py-1 text-xs dark:border-border-dark">
          {r.title}
          <Handle type="source" position={Position.Right} id={r.id} />
        </div>
      ))}
    </div>
  );
}

function AskNode({ data, selected }: NodeProps) {
  const d = data as Extract<FlowNode, { type: 'ask' }>['data'];
  return (
    <div className={`${card} ${selected ? 'ring-2 ring-primary-500' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <p className={label}>Ask · {d.input}</p>
      <p className="mt-1 line-clamp-2 text-sm">{d.body}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function BranchNode({ data, selected }: NodeProps) {
  const d = data as Extract<FlowNode, { type: 'branch' }>['data'];
  return (
    <div className={`${card} ${selected ? 'ring-2 ring-primary-500' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <p className={label}>Branch</p>
      <p className="mt-1 text-xs">{d.field}{d.equals ? ` = ${d.equals}` : d.exists ? ' exists' : ''}</p>
      <Handle type="source" position={Position.Right} id="yes" style={{ top: '40%' }} />
      <Handle type="source" position={Position.Right} id="no" style={{ top: '70%' }} />
    </div>
  );
}

function ActionNode({ data, selected }: NodeProps) {
  const d = data as Extract<FlowNode, { type: 'action' }>['data'];
  return (
    <div className={`${card} ${selected ? 'ring-2 ring-primary-500' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <p className={label}>Action</p>
      <p className="mt-1 text-sm">{d.kind.replace(/_/g, ' ')}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function EndNode({ selected }: NodeProps) {
  return (
    <div className={`${card} ${selected ? 'ring-2 ring-primary-500' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <p className={label}>End</p>
    </div>
  );
}
