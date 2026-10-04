import type { Edge, Node } from '@xyflow/react';
import type { FlowDefinition, FlowNode, FlowNodeType } from '@/lib/whatsapp/flows/schema';

export function toRf(def: FlowDefinition): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: def.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data as unknown as Record<string, unknown>,
    })),
    edges: def.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle || undefined,
    })),
  };
}

export function fromRf(nodes: Node[], edges: Edge[], viewport: FlowDefinition['viewport']): FlowDefinition {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (n.type || 'message') as FlowNode['type'],
      position: n.position,
      data: (n.data || {}) as FlowNode['data'],
    })) as FlowNode[],
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle || undefined,
    })),
    viewport,
  };
}

export function defaultData(type: FlowNodeType): FlowNode['data'] {
  switch (type) {
    case 'start':
      return { hardPhrases: ['hi'], hardRegex: [], firstMessage: false, softIntents: [] };
    case 'message':
      return { body: 'Hello! How can we help?', footer: '' };
    case 'buttons':
      return {
        body: 'Choose an option',
        footer: '',
        buttons: [
          { id: 'shop', title: 'Browse shop' },
          { id: 'human', title: 'Talk to team' },
        ],
      };
    case 'list':
      return {
        body: 'Pick from the list',
        footer: '',
        buttonText: 'Choose',
        rows: [{ id: 'one', title: 'Option 1', description: '' }],
      };
    case 'ask':
      return { body: 'What is your name?', input: 'text', storeAs: 'name', fallback: 'Please type a reply.' };
    case 'branch':
      return { field: 'name', exists: true };
    case 'action':
      return { kind: 'handoff', labelIds: [] };
    case 'end':
      return {};
    default:
      return { body: '…', footer: '' };
  }
}

export function newNodeId(): string {
  return `n_${Math.random().toString(36).slice(2, 10)}`;
}
