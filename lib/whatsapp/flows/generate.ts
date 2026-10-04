import { helperCompletion, HelperAiError } from '@/lib/ai-agent/helper-ai';
import { parseFlowDefinition, type FlowDefinition } from './schema';
import { loadShopMaterial } from './shop-material';
import { shopOrderStarterDefinition } from './starter';

const SYSTEM = `You design WhatsApp shop/order Flows for Khatario.
Reply with JSON only matching this shape:
{"nodes":[...],"edges":[...],"viewport":{"x":0,"y":0,"zoom":1}}
Node types: start, message, buttons, list, ask, branch, action, end.
Start data: hardPhrases (exact whole-message keywords), hardRegex, firstMessage, softIntents (natural language for a router).
Buttons: 1-3 items, title max 20 chars, id short slug.
List: up to 10 rows, title max 24 chars, buttonText max 20.
Ask: input text|number|phone|email, storeAs snake_case.
Action kind: add_labels|remove_labels|assign_to_user_id|handoff|open_shop. No HTTP. No prices you invent. No template or ad nodes.
Exactly one start. Prefer a shop/order journey: welcome buttons (browse shop / talk to team), then open_shop or handoff.
Positions: x/y numbers, increment y by ~140.`;

function extractObject(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function generateFlowDefinition(
  businessId: string,
  prompt: string,
): Promise<{ definition: FlowDefinition } | { error: string; status: number }> {
  const material = await loadShopMaterial(businessId);
  const user = `Owner request:\n${prompt.slice(0, 2000)}\n\nShop material (facts only; do not invent prices):\n${material || '(none yet)'}\n\nStarter shape to follow:\n${JSON.stringify(shopOrderStarterDefinition())}`;

  const run = async (extra: string) => {
    const raw = await helperCompletion(businessId, SYSTEM, extra);
    const obj = extractObject(raw);
    return parseFlowDefinition(obj);
  };

  try {
    let parsed = await run(user);
    if (!parsed.ok) parsed = await run(`${user}\n\nYour last JSON was invalid (${parsed.error}). Fix it. JSON only.`);
    if (!parsed.ok) return { error: "Couldn't build a valid flow. Try a simpler prompt.", status: 502 };
    return { definition: parsed.data };
  } catch (err) {
    if (err instanceof HelperAiError) return { error: err.message, status: err.status };
    console.error('[flows] generate failed:', err);
    return { error: "Couldn't build a valid flow this time.", status: 502 };
  }
}
