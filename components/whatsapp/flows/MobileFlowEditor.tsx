'use client';

import type { FlowDefinition, FlowNode, FlowNodeType } from '@/lib/whatsapp/flows/schema';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { defaultData, newNodeId } from './flow-convert';

export function MobileFlowEditor({
  definition,
  onChange,
}: {
  definition: FlowDefinition;
  onChange: (next: FlowDefinition) => void;
}) {
  const update = (id: string, data: FlowNode['data']) => {
    onChange({
      ...definition,
      nodes: definition.nodes.map((n) => (n.id === id ? ({ ...n, data } as FlowNode) : n)),
    });
  };

  const add = (type: FlowNodeType) => {
    const id = newNodeId();
    const prev = definition.nodes[definition.nodes.length - 2] || definition.nodes[0];
    onChange({
      ...definition,
      nodes: [
        ...definition.nodes.filter((n) => n.type !== 'end'),
        { id, type, position: { x: 40, y: 80 + definition.nodes.length * 120 }, data: defaultData(type) } as FlowNode,
        definition.nodes.find((n) => n.type === 'end') || { id: 'end', type: 'end', position: { x: 40, y: 900 }, data: {} },
      ],
      edges: [...definition.edges, { id: `e_${prev.id}_${id}`, source: prev.id, target: id }],
    });
  };

  return (
    <div className="space-y-3 md:hidden">
      <div className="flex flex-wrap gap-1">
        {(['message', 'buttons', 'ask', 'action'] as FlowNodeType[]).map((t) => (
          <Button key={t} type="button" size="sm" variant="secondary" onClick={() => add(t)}>
            Add {t}
          </Button>
        ))}
      </div>
      {definition.nodes.map((node) => (
        <div key={node.id} className="rounded-lg border border-border p-3 dark:border-border-dark">
          <p className="text-[10px] font-semibold uppercase text-text-muted">{node.type}</p>
          {node.type === 'start' && (
            <Input
              className="mt-2"
              value={node.data.hardPhrases.join(', ')}
              onChange={(e) =>
                update(node.id, { ...node.data, hardPhrases: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
              }
            />
          )}
          {(node.type === 'message' || node.type === 'buttons' || node.type === 'ask') && (
            <Textarea
              className="mt-2"
              rows={3}
              value={node.data.body}
              onChange={(e) => update(node.id, { ...node.data, body: e.target.value })}
            />
          )}
        </div>
      ))}
    </div>
  );
}
