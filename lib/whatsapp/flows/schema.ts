import { z } from 'zod';
import { WA_LIMITS } from '@/lib/whatsapp/wa-limits';

export const FLOW_NODE_TYPES = [
  'start',
  'message',
  'buttons',
  'list',
  'ask',
  'branch',
  'action',
  'end',
] as const;

export type FlowNodeType = (typeof FLOW_NODE_TYPES)[number];

const pos = z.object({ x: z.number(), y: z.number() });

const startData = z.object({
  hardPhrases: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  hardRegex: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  firstMessage: z.boolean().optional().default(false),
  softIntents: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
});

const messageData = z.object({
  body: z.string().trim().min(1).max(WA_LIMITS.interactiveBody),
  footer: z.string().trim().max(WA_LIMITS.interactiveFooter).optional().default(''),
});

const buttonItem = z.object({
  id: z.string().trim().min(1).max(WA_LIMITS.replyId),
  title: z.string().trim().min(1).max(WA_LIMITS.buttonTitle),
});

const buttonsData = z.object({
  body: z.string().trim().min(1).max(WA_LIMITS.interactiveBody),
  footer: z.string().trim().max(WA_LIMITS.interactiveFooter).optional().default(''),
  buttons: z.array(buttonItem).min(1).max(WA_LIMITS.buttonsMax),
});

const listRow = z.object({
  id: z.string().trim().min(1).max(WA_LIMITS.replyId),
  title: z.string().trim().min(1).max(WA_LIMITS.listRowTitle),
  description: z.string().trim().max(WA_LIMITS.listRowDescription).optional().default(''),
});

const listData = z.object({
  body: z.string().trim().min(1).max(WA_LIMITS.interactiveBody),
  footer: z.string().trim().max(WA_LIMITS.interactiveFooter).optional().default(''),
  buttonText: z.string().trim().min(1).max(WA_LIMITS.listButton),
  rows: z.array(listRow).min(1).max(WA_LIMITS.listRowsMax),
});

const askData = z.object({
  body: z.string().trim().min(1).max(WA_LIMITS.interactiveBody),
  input: z.enum(['text', 'number', 'phone', 'email']).default('text'),
  storeAs: z.string().trim().min(1).max(64),
  fallback: z.string().trim().max(WA_LIMITS.interactiveBody).optional().default('Please reply with a valid answer.'),
});

const branchData = z.object({
  field: z.string().trim().min(1).max(64),
  equals: z.string().max(200).optional(),
  exists: z.boolean().optional(),
});

const actionData = z.object({
  kind: z.enum(['add_labels', 'remove_labels', 'assign_to_user_id', 'handoff', 'open_shop']),
  labelIds: z.array(z.string().uuid()).max(20).optional().default([]),
  userId: z.string().uuid().optional().nullable(),
});

const endData = z.object({}).default({});

export const flowNodeSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1).max(64), type: z.literal('start'), position: pos, data: startData }),
  z.object({ id: z.string().min(1).max(64), type: z.literal('message'), position: pos, data: messageData }),
  z.object({ id: z.string().min(1).max(64), type: z.literal('buttons'), position: pos, data: buttonsData }),
  z.object({ id: z.string().min(1).max(64), type: z.literal('list'), position: pos, data: listData }),
  z.object({ id: z.string().min(1).max(64), type: z.literal('ask'), position: pos, data: askData }),
  z.object({ id: z.string().min(1).max(64), type: z.literal('branch'), position: pos, data: branchData }),
  z.object({ id: z.string().min(1).max(64), type: z.literal('action'), position: pos, data: actionData }),
  z.object({ id: z.string().min(1).max(64), type: z.literal('end'), position: pos, data: endData.optional().default({}) }),
]);

export const flowEdgeSchema = z.object({
  id: z.string().min(1).max(80),
  source: z.string().min(1).max(64),
  target: z.string().min(1).max(64),
  /** Button/list option id, or `yes`/`no` for branch, or empty for default. */
  sourceHandle: z.string().max(WA_LIMITS.replyId).optional().nullable(),
});

export const flowDefinitionSchema = z.object({
  nodes: z.array(flowNodeSchema).min(1).max(80),
  edges: z.array(flowEdgeSchema).max(160),
  viewport: z
    .object({ x: z.number(), y: z.number(), zoom: z.number() })
    .optional()
    .default({ x: 0, y: 0, zoom: 1 }),
});

export type FlowDefinition = z.infer<typeof flowDefinitionSchema>;
export type FlowNode = z.infer<typeof flowNodeSchema>;
export type FlowEdge = z.infer<typeof flowEdgeSchema>;

export type FlowTriggers = {
  hardPhrases: string[];
  hardRegex: string[];
  firstMessage: boolean;
  softIntents: string[];
};

export function emptyFlowDefinition(): FlowDefinition {
  return {
    nodes: [
      {
        id: 'start',
        type: 'start',
        position: { x: 40, y: 40 },
        data: { hardPhrases: [], hardRegex: [], firstMessage: false, softIntents: [] },
      },
      { id: 'end', type: 'end', position: { x: 40, y: 220 }, data: {} },
    ],
    edges: [{ id: 'e-start-end', source: 'start', target: 'end' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function extractTriggers(definition: FlowDefinition): FlowTriggers {
  const start = definition.nodes.find((n) => n.type === 'start');
  if (!start || start.type !== 'start') {
    return { hardPhrases: [], hardRegex: [], firstMessage: false, softIntents: [] };
  }
  return {
    hardPhrases: start.data.hardPhrases.map((p) => p.trim().toLowerCase()).filter(Boolean),
    hardRegex: start.data.hardRegex.map((p) => p.trim()).filter(Boolean),
    firstMessage: !!start.data.firstMessage,
    softIntents: start.data.softIntents.map((p) => p.trim()).filter(Boolean),
  };
}

export function parseFlowDefinition(raw: unknown): { ok: true; data: FlowDefinition } | { ok: false; error: string } {
  const parsed = flowDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path?.join('.') || 'definition';
    return { ok: false, error: `${path}: ${first?.message || 'Invalid flow'}` };
  }
  const ids = new Set(parsed.data.nodes.map((n) => n.id));
  if (ids.size !== parsed.data.nodes.length) return { ok: false, error: 'Duplicate node ids' };
  const starts = parsed.data.nodes.filter((n) => n.type === 'start');
  if (starts.length !== 1) return { ok: false, error: 'A flow must have exactly one Start node' };
  for (const e of parsed.data.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) return { ok: false, error: 'Edge points at a missing node' };
  }
  return { ok: true, data: parsed.data };
}

export function canPublish(definition: FlowDefinition): { ok: true } | { ok: false; error: string } {
  const parsed = parseFlowDefinition(definition);
  if (!parsed.ok) return parsed;
  const t = extractTriggers(parsed.data);
  if (!t.hardPhrases.length && !t.hardRegex.length && !t.firstMessage && !t.softIntents.length) {
    return { ok: false, error: 'Add a start keyword, regex, first-message trigger or a soft intent before publishing.' };
  }
  const start = parsed.data.nodes.find((n) => n.type === 'start')!;
  const out = parsed.data.edges.filter((e) => e.source === start.id);
  if (!out.length) return { ok: false, error: 'Connect Start to the first step.' };
  return { ok: true };
}

const ROUTER_HANDLERS = ['flow', 'ai_agent', 'fallback'] as const;
export const routerDecisionSchema = z.object({
  handler: z.enum(ROUTER_HANDLERS),
  flowId: z.string().uuid().optional().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(240).optional().default(''),
});
export type RouterDecision = z.infer<typeof routerDecisionSchema>;
