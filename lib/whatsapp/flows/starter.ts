import type { FlowDefinition } from './schema';

/** Unpublished shop/order starter cloned into a draft. Does not invent prices. */
export function shopOrderStarterDefinition(): FlowDefinition {
  return {
    nodes: [
      {
        id: 'start',
        type: 'start',
        position: { x: 40, y: 20 },
        data: {
          hardPhrases: ['order', 'order now', 'place order'],
          hardRegex: [],
          regexCaseSensitive: false,
          firstMessage: false,
          softIntents: ['I want to buy', 'checkout', 'place an order'],
        },
      },
      {
        id: 'welcome',
        type: 'buttons',
        position: { x: 40, y: 160 },
        data: {
          header: '',
          body: 'Welcome! How can we help you today?',
          footer: '',
          buttons: [
            { id: 'shop', title: 'Browse shop' },
            { id: 'status', title: 'Order status' },
            { id: 'human', title: 'Talk to team' },
          ],
        },
      },
      {
        id: 'open_shop',
        type: 'action',
        position: { x: 280, y: 320 },
        data: { kind: 'open_shop', labelIds: [], catalogBody: 'Browse our catalogue', catalogFooter: '' },
      },
      {
        id: 'status_msg',
        type: 'message',
        position: { x: 40, y: 320 },
        data: {
          header: '',
          body: 'Please share your order number or tell us what you ordered. Our team or AI assistant can look it up.',
          footer: '',
          mediaType: 'none',
          mediaUrl: '',
          delaySeconds: 0,
        },
      },
      {
        id: 'handoff',
        type: 'action',
        position: { x: -200, y: 320 },
        data: { kind: 'handoff', labelIds: [], catalogBody: '', catalogFooter: '' },
      },
      {
        id: 'handoff_msg',
        type: 'message',
        position: { x: -200, y: 460 },
        data: { header: '', body: 'Connecting you with our team. Someone will reply here shortly.', footer: '', mediaType: 'none', mediaUrl: '', delaySeconds: 0 },
      },
      { id: 'end', type: 'end', position: { x: 40, y: 600 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'welcome' },
      { id: 'e2', source: 'welcome', target: 'open_shop', sourceHandle: 'shop' },
      { id: 'e3', source: 'welcome', target: 'status_msg', sourceHandle: 'status' },
      { id: 'e4', source: 'welcome', target: 'handoff', sourceHandle: 'human' },
      { id: 'e5', source: 'open_shop', target: 'end' },
      { id: 'e6', source: 'status_msg', target: 'end' },
      { id: 'e7', source: 'handoff', target: 'handoff_msg' },
      { id: 'e8', source: 'handoff_msg', target: 'end' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}
