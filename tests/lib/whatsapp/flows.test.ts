import { isHardStartMatch, matchOption, validateAsk } from '@/lib/whatsapp/flows/match';
import { extractTriggers, parseFlowDefinition, canPublish, emptyFlowDefinition } from '@/lib/whatsapp/flows/schema';
import { shopOrderStarterDefinition } from '@/lib/whatsapp/flows/starter';
import { messageLeadsOnlyToEnd, startWalk, walkFrom } from '@/lib/whatsapp/flows/walk';
import { isSilentHandledResult } from '@/lib/whatsapp/flows/send';
import { botRulesToDefinition } from '@/lib/whatsapp/flows/import-bot-rules';
import { createSimState, simStep } from '@/lib/whatsapp/flows/simulate';

describe('flow hard match', () => {
  const triggers = {
    hardPhrases: ['order', 'order now'],
    hardRegex: ['^buy\\s+now$'],
    regexCaseSensitive: false,
    firstMessage: false,
    softIntents: ['I want to purchase'],
  };

  it('matches exact phrases only, not substrings', () => {
    expect(isHardStartMatch(triggers, { text: 'order', isFirstMessage: false })).toBe(true);
    expect(isHardStartMatch(triggers, { text: 'ORDER NOW', isFirstMessage: false })).toBe(true);
    expect(isHardStartMatch(triggers, { text: 'I want to order a cake', isFirstMessage: false })).toBe(false);
    expect(isHardStartMatch(triggers, { text: 'I want to purchase', isFirstMessage: false })).toBe(false);
  });

  it('matches hard regex', () => {
    expect(isHardStartMatch(triggers, { text: 'buy now', isFirstMessage: false })).toBe(true);
  });
});

describe('flow options and ask', () => {
  const opts = [
    { id: 'shop', title: 'Browse shop' },
    { id: 'human', title: 'Talk to team' },
  ];
  it('matches reply id, title and 1-based index', () => {
    expect(matchOption(opts, { text: '', replyId: 'human' })?.optionId).toBe('human');
    expect(matchOption(opts, { text: 'browse shop' })?.optionId).toBe('shop');
    expect(matchOption(opts, { text: '2' })?.optionId).toBe('human');
    expect(matchOption(opts, { text: 'something else' })).toBeNull();
  });
  it('validates ask input', () => {
    expect(validateAsk('Ada', 'text')).toBe(true);
    expect(validateAsk('12', 'number')).toBe(true);
    expect(validateAsk('hi', 'number')).toBe(false);
    expect(validateAsk('not-mail', 'email')).toBe(false);
  });
});

describe('flow schema', () => {
  it('rejects a missing start', () => {
    const parsed = parseFlowDefinition({ nodes: [], edges: [] });
    expect(parsed.ok).toBe(false);
  });
  it('shop starter can publish', () => {
    const def = shopOrderStarterDefinition();
    expect(parseFlowDefinition(def).ok).toBe(true);
    expect(canPublish(def).ok).toBe(true);
    expect(extractTriggers(def).hardPhrases).toContain('order');
    const walk = startWalk(def, {});
    expect(walk.kind).toBe('send');
    if (walk.kind === 'send') expect(walk.node.type).toBe('buttons');
  });
  it('empty draft cannot publish', () => {
    expect(canPublish(emptyFlowDefinition()).ok).toBe(false);
  });
});

describe('bot rule import', () => {
  it('turns substring keywords into soft intents', () => {
    const def = botRulesToDefinition(
      [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Hi',
          trigger_type: 'keyword',
          trigger_value: 'price, timing',
          response_type: 'text',
          response_message: 'We open at 9',
          response_options: null,
          next_rule_id: null,
          auto_actions: null,
          end_flow: true,
        },
      ],
      [],
    );
    const start = def.nodes.find((n) => n.type === 'start');
    expect(start && start.type === 'start' && start.data.softIntents).toEqual(['price', 'timing']);
    expect(start && start.type === 'start' && start.data.hardPhrases).toEqual([]);
  });
});

describe('terminal handoff message', () => {
  it('marks handoff_msg → end as terminal so no session should stay open', () => {
    const def = shopOrderStarterDefinition();
    expect(messageLeadsOnlyToEnd(def, 'handoff_msg')).toBe(true);
    expect(messageLeadsOnlyToEnd(def, 'status_msg')).toBe(true);
    expect(messageLeadsOnlyToEnd(def, 'welcome')).toBe(false);
  });

  it('Talk to team walks handoff then a terminal message', () => {
    const def = shopOrderStarterDefinition();
    const walk = walkFrom(def, 'welcome', {}, 'human');
    expect(walk.kind).toBe('send');
    if (walk.kind !== 'send') return;
    expect(walk.actions.some((a) => a.data.kind === 'handoff')).toBe(true);
    expect(walk.node.id).toBe('handoff_msg');
    expect(messageLeadsOnlyToEnd(def, walk.node.id)).toBe(true);
  });

  it('silent handled results are detected so the AI can take over', () => {
    expect(isSilentHandledResult({ shouldStore: true, handled: true })).toBe(true);
    expect(isSilentHandledResult({ shouldStore: true, handled: true, response: 'Hi' })).toBe(false);
    expect(isSilentHandledResult({ openShop: true })).toBe(false);
    expect(isSilentHandledResult(null)).toBe(false);
  });
});

describe('flow simulate (draft preview)', () => {
  it('does not start on a non-matching keyword', () => {
    const def = shopOrderStarterDefinition();
    const next = simStep(def, createSimState(), { text: 'hello there' });
    expect(next.status).toBe('idle');
    expect(next.bubbles.some((b) => b.role === 'system' && b.text.includes('No start match'))).toBe(true);
  });

  it('walks shop starter after an exact keyword', () => {
    const def = shopOrderStarterDefinition();
    let state = simStep(def, createSimState(), { text: 'order' });
    expect(state.status).toBe('active');
    expect(state.bubbles.some((b) => b.role === 'bot')).toBe(true);

    const bot = [...state.bubbles].reverse().find((b) => b.role === 'bot');
    expect(bot && bot.role === 'bot' && bot.reply.buttons?.length).toBeTruthy();
    const first = bot && bot.role === 'bot' ? bot.reply.buttons![0] : null;
    expect(first).toBeTruthy();
    state = simStep(def, state, { text: first!.title, replyId: first!.id });
    expect(state.bubbles.length).toBeGreaterThan(2);
  });

  it('Talk to team ends the preview session after the handoff message', () => {
    const def = shopOrderStarterDefinition();
    let state = simStep(def, createSimState(), { text: 'order' });
    state = simStep(def, state, { text: 'Talk to team', replyId: 'human' });
    expect(state.status).toBe('ended');
    expect(state.currentNodeId).toBeNull();
    expect(state.bubbles.some((b) => b.role === 'bot' && b.reply.text.includes('Connecting you'))).toBe(true);
  });
});
