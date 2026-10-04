'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { FlowDefinition, FlowNode, FlowNodeType } from '@/lib/whatsapp/flows/schema';
import { flowNodeTypes } from './flowNodeTypes';
import { defaultData, fromRf, newNodeId, toRf } from './flow-convert';
import { FlowPalette } from './FlowPalette';
import { FlowInspector } from './FlowInspector';

export function FlowCanvas({
  definition,
  onChange,
}: {
  definition: FlowDefinition;
  onChange: (next: FlowDefinition) => void;
}) {
  const initial = useMemo(() => toRf(definition), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>(definition.viewport || { x: 0, y: 0, zoom: 1 });

  const emit = useCallback(
    (n: Node[] = nodes, e: Edge[] = edges, vp: Viewport = viewport) => {
      onChange(fromRf(n, e, { x: vp.x, y: vp.y, zoom: vp.zoom }));
    },
    [nodes, edges, viewport, onChange],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((eds) => {
        const next = addEdge({ ...c, id: `e_${c.source}_${c.sourceHandle || 'd'}_${c.target}` }, eds);
        emit(nodes, next);
        return next;
      });
    },
    [emit, nodes, setEdges],
  );

  const addNode = (type: FlowNodeType) => {
    const id = newNodeId();
    const node: Node = {
      id,
      type,
      position: { x: 80, y: 80 + nodes.length * 24 },
      data: defaultData(type) as unknown as Record<string, unknown>,
    };
    const next = [...nodes, node];
    setNodes(next);
    emit(next, edges);
  };

  const selected = nodes.find((n) => n.id === selectedId);
  const selectedFlow: FlowNode | null = selected
    ? ({ id: selected.id, type: selected.type, position: selected.position, data: selected.data } as FlowNode)
    : null;

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-1 overflow-hidden rounded-lg border border-border dark:border-border-dark">
      <FlowPalette onAdd={addNode} />
      <div className="relative min-h-[480px] flex-1 bg-[#f7f7f5] dark:bg-zinc-950">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={flowNodeTypes}
          onNodesChange={(c) => {
            onNodesChange(c);
          }}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={(_, _n, all) => emit(all, edges)}
          onSelectionChange={({ nodes: sel }) => setSelectedId(sel[0]?.id ?? null)}
          onMoveEnd={(_, vp) => {
            setViewport(vp);
            emit(nodes, edges, vp);
          }}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} size={1} />
          <Controls />
          <MiniMap pannable zoomable className="hidden md:!block" />
        </ReactFlow>
      </div>
      <FlowInspector
        node={selectedFlow}
        onChange={(n) => {
          const next = nodes.map((x) => (x.id === n.id ? { ...x, data: n.data as unknown as Record<string, unknown> } : x));
          setNodes(next);
          emit(next, edges);
        }}
      />
    </div>
  );
}
