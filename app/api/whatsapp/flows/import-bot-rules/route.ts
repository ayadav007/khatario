export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { assertNotConnectAgentWrite } from '@/lib/security/whatsapp-api-gates';
import { botRulesToDefinition, loadBotRulesForImport } from '@/lib/whatsapp/flows/import-bot-rules';
import { createFlow } from '@/lib/whatsapp/flows/store';
import { parseFlowDefinition } from '@/lib/whatsapp/flows/schema';

export const POST = withWhatsAppPremiumApi({ managePermission: true }, async ({ businessId, userId, request }) => {
  const blocked = await assertNotConnectAgentWrite({ request, userId });
  if (blocked) return blocked;
  const { rules, chains } = await loadBotRulesForImport(businessId);
  if (!rules.length) return NextResponse.json({ error: 'No active keyword rules to import.' }, { status: 400 });
  const grouped = new Map<string, typeof rules>();
  for (const rule of rules) {
    const key = rule.name || rule.id;
    const list = grouped.get(key) ?? [];
    list.push(rule);
    grouped.set(key, list);
  }
  const created: Array<{ id: string; name: string }> = [];
  for (const [name, group] of grouped) {
    const def = botRulesToDefinition(group, chains.filter((c) => group.some((r) => r.id === c.rule_id || r.id === c.next_rule_id)));
    const parsed = parseFlowDefinition(def);
    if (!parsed.ok) continue;
    const flowName = `Imported: ${name}`.slice(0, 255);
    try {
      const flow = await createFlow(businessId, userId, { name: flowName, definition: parsed.data });
      created.push({ id: flow.id, name: flow.name });
    } catch {
      try {
        const flow = await createFlow(businessId, userId, {
          name: `${flowName} ${Date.now().toString().slice(-4)}`.slice(0, 255),
          definition: parsed.data,
        });
        created.push({ id: flow.id, name: flow.name });
      } catch {
        /* skip */
      }
    }
  }
  if (!created.length) return NextResponse.json({ error: 'Could not import those rules as a flow.' }, { status: 400 });
  return NextResponse.json({ flows: created });
});
