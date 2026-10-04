import { queryRows } from '@/lib/db';
import { emptyFlowDefinition, type FlowDefinition, type FlowNode, type FlowEdge } from './schema';

type RuleRow = {
  id: string;
  name: string;
  trigger_type: string;
  trigger_value: string;
  response_type: string;
  response_message: string;
  response_options: unknown;
  next_rule_id: string | null;
  auto_actions: unknown;
  end_flow: boolean | null;
};

function nid(prefix: string, id: string) {
  return `${prefix}_${id.replace(/-/g, '').slice(0, 12)}`;
}

function optionsFrom(raw: unknown): Array<{ id: string; title: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b) => b && typeof b === 'object' && b.id !== '__footer__')
    .map((b: { id?: string; title?: string }, i: number) => ({
      id: String(b.id || `opt_${i}`).slice(0, 256),
      title: String(b.title || `Option ${i + 1}`).slice(0, 20),
    }))
    .slice(0, 3);
}

/**
 * Convert a bot-rule chain into a draft Flow definition. Substring keywords become soft intents.
 */
export function botRulesToDefinition(rules: RuleRow[], chains: Array<{ rule_id: string; option_id: string; next_rule_id: string }>): FlowDefinition {
  if (!rules.length) return emptyFlowDefinition();
  const root = rules[0];
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const hard = root.trigger_type === 'exact_match' ? root.trigger_value.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const soft =
    root.trigger_type === 'keyword' || root.trigger_type === 'match_any_keyword' || root.trigger_type === 'all'
      ? root.trigger_value.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  const regex = root.trigger_type === 'regex' ? [root.trigger_value] : [];

  nodes.push({
    id: 'start',
    type: 'start',
    position: { x: 40, y: 20 },
    data: {
      hardPhrases: hard,
      hardRegex: regex,
      firstMessage: root.trigger_type === 'first_message',
      softIntents: soft,
    },
  });

  let y = 160;
  const byId = new Map(rules.map((r) => [r.id, r]));
  const placed = new Set<string>();

  function place(rule: RuleRow, x: number, depth: number) {
    if (placed.has(rule.id) || depth > 12) return;
    placed.add(rule.id);
    const nodeId = nid('n', rule.id);
    const opts = optionsFrom(rule.response_options);
    if (opts.length && rule.response_type === 'button') {
      nodes.push({
        id: nodeId,
        type: 'buttons',
        position: { x, y },
        data: { body: (rule.response_message || 'Choose:').slice(0, 1024), footer: '', buttons: opts },
      });
    } else if (opts.length && rule.response_type === 'list') {
      nodes.push({
        id: nodeId,
        type: 'list',
        position: { x, y },
        data: {
          body: (rule.response_message || 'Choose:').slice(0, 1024),
          footer: '',
          buttonText: 'Choose',
          rows: opts.map((o) => ({ id: o.id, title: o.title.slice(0, 24), description: '' })),
        },
      });
    } else {
      nodes.push({
        id: nodeId,
        type: 'message',
        position: { x, y },
        data: { body: (rule.response_message || '...').slice(0, 1024), footer: '' },
      });
    }
    y += 140;
    const ruleChains = chains.filter((c) => c.rule_id === rule.id);
    if (!ruleChains.length) {
      edges.push({ id: `e_${nodeId}_end`, source: nodeId, target: 'end' });
      return;
    }
    ruleChains.forEach((c, i) => {
      const next = byId.get(c.next_rule_id);
      if (!next) return;
      const nextId = nid('n', next.id);
      edges.push({ id: `e_${nodeId}_${c.option_id}`, source: nodeId, target: nextId, sourceHandle: c.option_id });
      place(next, x + i * 220, depth + 1);
    });
  }

  const firstId = nid('n', root.id);
  edges.push({ id: 'e_start', source: 'start', target: firstId });
  place(root, 40, 0);
  nodes.push({ id: 'end', type: 'end', position: { x: 40, y }, data: {} });
  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } };
}

export async function loadBotRulesForImport(businessId: string): Promise<{ rules: RuleRow[]; chains: Array<{ rule_id: string; option_id: string; next_rule_id: string }> }> {
  const rules = await queryRows<RuleRow>(
    `SELECT id, name, trigger_type, trigger_value, response_type, response_message, response_options, next_rule_id, auto_actions, end_flow
       FROM whatsapp_bot_rules WHERE business_id = $1 AND is_active = true ORDER BY priority DESC, name ASC`,
    [businessId],
  );
  const ids = rules.map((r) => r.id);
  const chains = ids.length
    ? await queryRows<{ rule_id: string; option_id: string; next_rule_id: string }>(
        `SELECT rule_id, option_id, next_rule_id FROM whatsapp_bot_rule_chains WHERE rule_id = ANY($1::uuid[])`,
        [ids],
      )
    : [];
  return { rules, chains };
}
