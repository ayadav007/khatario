import type { FlowDefinition, FlowNode } from './schema';

export function nodeById(def: FlowDefinition, id: string): FlowNode | undefined {
  return def.nodes.find((n) => n.id === id);
}

export function outgoing(def: FlowDefinition, source: string, handle?: string | null) {
  const edges = def.edges.filter((e) => e.source === source);
  if (handle) {
    const hit = edges.find((e) => (e.sourceHandle || '') === handle);
    if (hit) return hit;
  }
  return edges.find((e) => !e.sourceHandle) || edges[0] || null;
}

function branchHandle(node: Extract<FlowNode, { type: 'branch' }>, context: Record<string, unknown>): 'yes' | 'no' {
  const raw = context[node.data.field];
  if (node.data.exists) return raw != null && String(raw).trim() !== '' ? 'yes' : 'no';
  if (node.data.equals != null && node.data.equals !== '') {
    return String(raw ?? '').trim().toLowerCase() === node.data.equals.trim().toLowerCase() ? 'yes' : 'no';
  }
  return raw != null && String(raw).trim() !== '' ? 'yes' : 'no';
}

export type WalkStop =
  | { kind: 'send'; node: FlowNode; actions: Extract<FlowNode, { type: 'action' }>[] }
  | { kind: 'end'; actions: Extract<FlowNode, { type: 'action' }>[] }
  | { kind: 'open_shop'; actions: Extract<FlowNode, { type: 'action' }>[]; shopNode: Extract<FlowNode, { type: 'action' }> };

/** Follow edges through action/branch until a customer-facing node or end. */
export function walkFrom(
  def: FlowDefinition,
  fromId: string,
  context: Record<string, unknown>,
  handle?: string | null,
): WalkStop {
  const actions: Extract<FlowNode, { type: 'action' }>[] = [];
  let id = outgoing(def, fromId, handle)?.target;
  const seen = new Set<string>();
  while (id) {
    if (seen.has(id)) return { kind: 'end', actions };
    seen.add(id);
    const node = nodeById(def, id);
    if (!node) return { kind: 'end', actions };
    if (node.type === 'action') {
      actions.push(node);
      if (node.data.kind === 'open_shop') return { kind: 'open_shop', actions, shopNode: node };
      id = outgoing(def, node.id)?.target;
      continue;
    }
    if (node.type === 'branch') {
      id = outgoing(def, node.id, branchHandle(node, context))?.target;
      continue;
    }
    if (node.type === 'end' || node.type === 'start') return { kind: 'end', actions };
    return { kind: 'send', node, actions };
  }
  return { kind: 'end', actions };
}

export function startWalk(def: FlowDefinition, context: Record<string, unknown>): WalkStop {
  const start = def.nodes.find((n) => n.type === 'start');
  if (!start) return { kind: 'end', actions: [] };
  return walkFrom(def, start.id, context);
}
