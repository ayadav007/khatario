'use client';

import type { ReactNode } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { FlowNode } from '@/lib/whatsapp/flows/schema';
import { FlowNodeEditor } from './FlowNodeEditor';

const card =
  'rounded-xl border border-border bg-white px-3 py-2 shadow-sm dark:border-border-dark dark:bg-surface-dark min-w-[260px] max-w-[300px]';
const label = 'text-[10px] font-semibold uppercase tracking-wide text-text-muted';

type Patchable = { onPatch?: (data: FlowNode['data']) => void };

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

function asFlow<T extends FlowNode['type']>(
  type: T,
  id: string,
  data: NodeProps['data'],
): Extract<FlowNode, { type: T }> {
  const { onPatch: _onPatch, ...rest } = (data || {}) as Record<string, unknown> & Patchable;
  return { id, type, position: { x: 0, y: 0 }, data: rest } as Extract<FlowNode, { type: T }>;
}

function EditableCard({
  selected,
  title,
  node,
  onPatch,
  extraHandles,
}: {
  selected?: boolean;
  title: string;
  node: FlowNode;
  onPatch?: (data: FlowNode['data']) => void;
  extraHandles?: ReactNode;
}) {
  return (
    <div className={`${card} ${selected ? 'ring-2 ring-primary-500' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <p className={label}>{title}</p>
      <div className="mt-2">
        {onPatch ? (
          <FlowNodeEditor compact node={node} onChange={(n) => onPatch(n.data)} />
        ) : (
          <p className="line-clamp-3 text-xs text-text-secondary">Select to edit</p>
        )}
      </div>
      {extraHandles}
      {node.type !== 'buttons' && node.type !== 'list' && node.type !== 'branch' ? (
        <Handle type="source" position={Position.Bottom} />
      ) : null}
    </div>
  );
}

function StartNode({ id, data, selected }: NodeProps) {
  const patch = (data as Patchable).onPatch;
  const node = asFlow('start', id, data);
  return (
    <div className={`${card} ${selected ? 'ring-2 ring-primary-500' : ''}`}>
      <p className={label}>Flow start</p>
      <div className="mt-2">
        {patch ? <FlowNodeEditor compact node={node} onChange={(n) => patch(n.data)} /> : null}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function MessageNode({ id, data, selected }: NodeProps) {
  return (
    <EditableCard
      selected={selected}
      title="Message"
      node={asFlow('message', id, data)}
      onPatch={(data as Patchable).onPatch}
    />
  );
}

function ButtonsNode({ id, data, selected }: NodeProps) {
  const node = asFlow('buttons', id, data);
  return (
    <EditableCard
      selected={selected}
      title="Buttons"
      node={node}
      onPatch={(data as Patchable).onPatch}
      extraHandles={
        <div className="relative mt-1">
          {(node.data.buttons || []).map((b) => (
            <Handle key={b.id} type="source" position={Position.Right} id={b.id} />
          ))}
        </div>
      }
    />
  );
}

function ListNode({ id, data, selected }: NodeProps) {
  const node = asFlow('list', id, data);
  return (
    <EditableCard
      selected={selected}
      title="List"
      node={node}
      onPatch={(data as Patchable).onPatch}
      extraHandles={
        <div className="relative mt-1">
          {(node.data.rows || []).map((r) => (
            <Handle key={r.id} type="source" position={Position.Right} id={r.id} />
          ))}
        </div>
      }
    />
  );
}

function AskNode({ id, data, selected }: NodeProps) {
  return (
    <EditableCard
      selected={selected}
      title="Ask"
      node={asFlow('ask', id, data)}
      onPatch={(data as Patchable).onPatch}
    />
  );
}

function BranchNode({ id, data, selected }: NodeProps) {
  return (
    <EditableCard
      selected={selected}
      title="Branch"
      node={asFlow('branch', id, data)}
      onPatch={(data as Patchable).onPatch}
      extraHandles={
        <>
          <Handle type="source" position={Position.Right} id="yes" style={{ top: '40%' }} />
          <Handle type="source" position={Position.Right} id="no" style={{ top: '70%' }} />
        </>
      }
    />
  );
}

function ActionNode({ id, data, selected }: NodeProps) {
  const node = asFlow('action', id, data);
  const title = node.data.kind === 'open_shop' ? 'Catalogue' : 'Action';
  return (
    <EditableCard
      selected={selected}
      title={title}
      node={node}
      onPatch={(data as Patchable).onPatch}
    />
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
