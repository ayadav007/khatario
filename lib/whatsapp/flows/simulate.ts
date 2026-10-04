/**
 * Client-safe draft flow simulator — mirrors runtime walk/match without DB or WhatsApp send.
 */

import { matchHardStart, matchOption, validateAsk } from './match';
import { renderNode } from './render';
import { extractTriggers, type FlowDefinition, type FlowNode } from './schema';
import type { FlowReply } from './send';
import { nodeById, startWalk, walkFrom, type WalkStop } from './walk';

export type SimBubble =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'bot'; reply: FlowReply }
  | { id: string; role: 'system'; text: string };

export type SimState = {
  status: 'idle' | 'active' | 'ended';
  currentNodeId: string | null;
  context: Record<string, unknown>;
  bubbles: SimBubble[];
  /** Treat the next user message as the first message in a chat (START first-message trigger). */
  treatAsFirstMessage: boolean;
};

function optionsOf(node: FlowNode): Array<{ id: string; title: string }> {
  if (node.type === 'buttons') return node.data.buttons;
  if (node.type === 'list') return node.data.rows.map((r) => ({ id: r.id, title: r.title }));
  return [];
}

function actionNotes(actions: Extract<FlowNode, { type: 'action' }>[]): string[] {
  return actions.map((a) => {
    switch (a.data.kind) {
      case 'open_shop':
        return 'Action: Open shop';
      case 'handoff':
        return 'Action: Handoff to team';
      case 'assign_to_user_id':
        return 'Action: Assign agent';
      case 'add_labels':
        return 'Action: Add labels';
      case 'remove_labels':
        return 'Action: Remove labels';
      default:
        return `Action: ${a.data.kind}`;
    }
  });
}

function applyWalk(state: SimState, walk: WalkStop): SimState {
  const notes = actionNotes(walk.actions);
  const systemBubbles: SimBubble[] = notes.map((text) => ({
    id: `sys_${Math.random().toString(36).slice(2, 9)}`,
    role: 'system',
    text,
  }));

  if (walk.kind === 'open_shop') {
    return {
      ...state,
      status: 'ended',
      currentNodeId: null,
      bubbles: [
        ...state.bubbles,
        ...systemBubbles,
        { id: `sys_${Math.random().toString(36).slice(2, 9)}`, role: 'system', text: 'Shop opens (not run in preview). Flow ended.' },
      ],
    };
  }

  if (walk.kind === 'end') {
    return {
      ...state,
      status: 'ended',
      currentNodeId: null,
      bubbles: [
        ...state.bubbles,
        ...systemBubbles,
        { id: `sys_${Math.random().toString(36).slice(2, 9)}`, role: 'system', text: 'Flow ended.' },
      ],
    };
  }

  const reply = renderNode(walk.node, state.context);
  const bubbles = [...state.bubbles, ...systemBubbles];
  if (reply) {
    bubbles.push({ id: `bot_${Math.random().toString(36).slice(2, 9)}`, role: 'bot', reply });
  }

  return {
    ...state,
    status: 'active',
    currentNodeId: walk.node.id,
    bubbles,
  };
}

export function createSimState(opts?: { treatAsFirstMessage?: boolean }): SimState {
  return {
    status: 'idle',
    currentNodeId: null,
    context: {},
    bubbles: [],
    treatAsFirstMessage: opts?.treatAsFirstMessage ?? false,
  };
}

export function resetSimState(prev?: Pick<SimState, 'treatAsFirstMessage'>): SimState {
  return createSimState({ treatAsFirstMessage: prev?.treatAsFirstMessage ?? false });
}

/** Advance the simulator with a customer message (or a tapped button/list id). */
export function simStep(
  definition: FlowDefinition,
  state: SimState,
  input: { text: string; replyId?: string | null },
): SimState {
  const text = input.text.trim();
  const userBubble: SimBubble = {
    id: `u_${Math.random().toString(36).slice(2, 9)}`,
    role: 'user',
    text: input.replyId
      ? text || `[option: ${input.replyId}]`
      : text || '(empty)',
  };

  if (state.status === 'ended') {
    return {
      ...state,
      bubbles: [
        ...state.bubbles,
        userBubble,
        {
          id: `sys_${Math.random().toString(36).slice(2, 9)}`,
          role: 'system',
          text: 'Preview ended. Reset to try again.',
        },
      ],
    };
  }

  // Start: wait for a hard keyword / first-message trigger (same as live hard start).
  if (state.status === 'idle' || !state.currentNodeId) {
    const isFirst = state.treatAsFirstMessage && state.bubbles.filter((b) => b.role === 'user').length === 0;
    const triggers = extractTriggers(definition);
    const matched = matchHardStart(definition, { text, isFirstMessage: isFirst });
    if (!matched) {
      const hint =
        triggers.hardPhrases[0] ||
        (triggers.firstMessage ? '(first message in chat)' : null) ||
        triggers.softIntents[0] ||
        'a start keyword';
      return {
        ...state,
        bubbles: [
          ...state.bubbles,
          userBubble,
          {
            id: `sys_${Math.random().toString(36).slice(2, 9)}`,
            role: 'system',
            text: `No start match. Try exact keyword like “${hint}”. Soft intents only help the live AI router.`,
          },
        ],
      };
    }
    const withUser = { ...state, bubbles: [...state.bubbles, userBubble], context: {} };
    return applyWalk(withUser, startWalk(definition, {}));
  }

  const node = nodeById(definition, state.currentNodeId);
  if (!node) {
    return {
      ...state,
      status: 'ended',
      bubbles: [
        ...state.bubbles,
        userBubble,
        { id: `sys_${Math.random().toString(36).slice(2, 9)}`, role: 'system', text: 'Current step missing. Reset preview.' },
      ],
    };
  }

  let handle: string | null = null;
  const context = { ...state.context };
  let withUser: SimState = { ...state, bubbles: [...state.bubbles, userBubble], context };

  if (node.type === 'buttons' || node.type === 'list') {
    const hit = matchOption(optionsOf(node), { text, replyId: input.replyId });
    if (!hit) {
      const fallbackReply: FlowReply =
        node.type === 'buttons'
          ? { text: 'Please choose one of the options.', buttons: node.data.buttons }
          : {
              text: 'Please choose one of the options.',
              list: { buttonText: node.data.buttonText, rows: node.data.rows },
            };
      return {
        ...withUser,
        bubbles: [
          ...withUser.bubbles,
          { id: `bot_${Math.random().toString(36).slice(2, 9)}`, role: 'bot', reply: fallbackReply },
        ],
      };
    }
    handle = hit.optionId;
    context.last_option = hit.optionId;
    withUser = { ...withUser, context };
  } else if (node.type === 'ask') {
    if (!validateAsk(text, node.data.input)) {
      return {
        ...withUser,
        bubbles: [
          ...withUser.bubbles,
          {
            id: `bot_${Math.random().toString(36).slice(2, 9)}`,
            role: 'bot',
            reply: { text: node.data.fallback || 'Please reply with a valid answer.' },
          },
        ],
      };
    }
    context[node.data.storeAs] = text;
    withUser = { ...withUser, context };
  }

  return applyWalk(withUser, walkFrom(definition, node.id, context, handle));
}
