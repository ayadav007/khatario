/**
 * The sales flow is a state machine: each inbound message moves the lead through the published
 * flow, sends that step's messages and updates the pipeline. Leads, sends and storage are mocked
 * in memory here.
 */
type Lead = Record<string, any>;

const mockState: { lead: Lead; exists: boolean } = { lead: {}, exists: true };
const mockSent: Array<{ type: string; body?: string; options?: string[]; mediaKey?: string }> = [];
const mockTexts: string[] = [];
const mockNotify = jest.fn();
const mockSchedule = jest.fn();
const mockCancel = jest.fn();

jest.mock('@/lib/db', () => ({ query: jest.fn(async () => ({ rows: [], rowCount: 0 })), queryOne: jest.fn(async () => null), queryRows: jest.fn(async () => []) }));
jest.mock('@/lib/rag/llm', () => ({ completeJson: jest.fn(async () => ({ data: { option: null } })) }));
jest.mock('@/lib/meta-whatsapp', () => ({
  ...jest.requireActual('@/lib/meta-whatsapp'),
  sendTextMessage: jest.fn(async ({ body }: { body: string }) => {
    mockTexts.push(body);
    return { messageId: `t${mockTexts.length}` };
  }),
}));
jest.mock('@/lib/sales-funnel/store', () => ({
  getPublishedFlow: async () => ({ version: 1, flow: jest.requireActual('@/lib/sales-funnel/default-flow').DEFAULT_FLOW }),
}));
jest.mock('@/lib/sales-funnel/notify', () => ({ notifySales: (...a: unknown[]) => mockNotify(...a) }));
jest.mock('@/lib/sales-funnel/render', () => {
  const actual = jest.requireActual('@/lib/sales-funnel/render');
  return {
    ...actual,
    sendFlowMessage: jest.fn(async (_to: string, msg: any, vars: Record<string, string>) => {
      const body = msg.body ? actual.fillVars(msg.body, vars) : undefined;
      mockSent.push({ type: msg.type, body, options: msg.options?.map((o: { id: string }) => o.id), mediaKey: msg.mediaKey });
      return [{ messageId: `m${mockSent.length}`, summary: body || msg.type }];
    }),
  };
});
jest.mock('@/lib/sales-funnel/leads', () => {
  const actual = jest.requireActual('@/lib/sales-funnel/leads');
  const order: string[] = actual.PIPELINE_STATUSES;
  return {
    ...actual,
    upsertInboundLead: async () => ({ lead: mockState.lead, isNew: false }),
    getLeadByPhone: async () => (mockState.exists ? mockState.lead : null),
    setLeadStep: async (l: Lead, step: string | null) => {
      l.flow_step = step;
    },
    setLeadFields: async (l: Lead, fields: Record<string, string>) => {
      for (const [k, v] of Object.entries(fields)) l[k === 'owner_name' ? 'name' : k] = v;
    },
    mergeFlowData: async (l: Lead, patch: Record<string, unknown>) => {
      l.flow_data = { ...l.flow_data, ...patch };
    },
    setPipelineStatus: async (l: Lead, to: string) => {
      if (to !== 'lost' && order.indexOf(to) <= order.indexOf(l.pipeline_status)) return false;
      l.pipeline_status = to;
      return true;
    },
    setOptOut: async (l: Lead, v: boolean) => {
      l.opted_out_at = v ? new Date() : null;
    },
    recordOutbound: async (l: Lead) => {
      l.last_outbound_at = new Date();
    },
    recordInboundEvent: async () => undefined,
    scheduleFollowup: (...a: unknown[]) => mockSchedule(...a),
    cancelFollowups: (...a: unknown[]) => mockCancel(...a),
    applyAttribution: async (l: Lead, input: { adId: string | null }) => {
      l.ad_id = input.adId;
    },
    adEntryKey: async () => null,
  };
});

import { handleFunnelMessage, HANDED_OFF, pickEntry } from '@/lib/sales-funnel/engine';
import { DEFAULT_FLOW } from '@/lib/sales-funnel/default-flow';

const PHONE = '919800000001';
const answer = jest.fn(async () => undefined);
let n = 0;

function freshLead(): Lead {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    name: null,
    phone: '9800000001',
    wa_phone: PHONE,
    business_name: null,
    business_type: null,
    pain_point: null,
    city: null,
    status: 'new',
    pipeline_status: 'new',
    flow_step: null,
    flow_data: { profile_name: 'Ramesh Kumar' },
    entry_key: null,
    ad_id: null,
    business_id: null,
    last_inbound_at: new Date(),
    last_outbound_at: null,
    opted_out_at: null,
    demo_sent_at: null,
  };
}

const say = (text: string, extra: Record<string, unknown> = {}, opts = {}) =>
  handleFunnelMessage({ from: PHONE, profileName: 'Ramesh Kumar', text, messageId: `w${++n}`, ...extra }, answer, opts);
const tap = (replyId: string, text = replyId) => say(text, { replyId });

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.NEXT_PUBLIC_APP_URL = 'https://khatario.com';
});

beforeEach(() => {
  jest.clearAllMocks();
  mockState.lead = freshLead();
  mockState.exists = true;
  mockSent.length = 0;
  mockTexts.length = 0;
});

describe('pickEntry', () => {
  it('chooses the opening from the ad, then the prefilled text, then the default', () => {
    expect(pickEntry(DEFAULT_FLOW, { adEntry: 'inventory_ad', adId: null, text: '' }).entry.id).toBe('inventory_ad');
    expect(pickEntry(DEFAULT_FLOW, { adEntry: null, adId: null, text: 'I want to know about GST billing.' }).entry.id).toBe('gst_ad');
    expect(pickEntry(DEFAULT_FLOW, { adEntry: null, adId: null, text: 'Hi' })).toEqual({ entry: expect.objectContaining({ id: 'general' }), matched: false });
  });
});

describe('happy path to the signup link', () => {
  it('qualifies, pitches, demos and sends a signed signup link', async () => {
    await expect(say('I want to know about GST billing.', { referral: { sourceId: '120200', sourceType: 'ad', sourceUrl: null, headline: null, body: null, ctwaClid: 'c1' } })).resolves.toBe(true);
    const lead = mockState.lead;
    expect(lead.ad_id).toBe('120200');
    expect(lead.pain_point).toBe('gst_accounting');
    expect(lead.flow_step).toBe('business_type');
    expect(mockSent[0].body).toContain('Hi Ramesh! Welcome to Khatario');
    expect(mockSent[1]).toMatchObject({ type: 'list', options: expect.arrayContaining(['bt_retail']) });
    expect(mockSchedule).toHaveBeenCalledWith(lead.id, 'nudge_5m', expect.any(Date));

    mockSent.length = 0;
    await tap('bt_trading', 'Trading Business');
    expect(lead.business_type).toBe('trading');
    // Pain point came from the ad, so the question is skipped and the trading + GST pitch goes out.
    expect(lead.flow_step).toBe('pitch');
    expect(lead.pipeline_status).toBe('qualified');
    expect(mockSent).toHaveLength(1);
    expect(mockSent[0].body).toContain('Trading means many purchases');
    expect(mockSent[0].options).toEqual(['cta_demo', 'cta_trial', 'cta_expert']);

    mockSent.length = 0;
    await say('demo dikhao');
    expect(lead.flow_step).toBe('demo');
    expect(lead.pipeline_status).toBe('demo_interested');
    expect(lead.demo_sent_at).toBeTruthy();
    expect(mockSent.map((m) => m.type)).toEqual(['video', 'buttons']);
    expect(mockSchedule).toHaveBeenCalledWith(lead.id, 'demo_no_trial', expect.any(Date));

    await tap('demo_trial');
    expect(lead.flow_step).toBe('trial_business_name');
    await say('Sharma Traders');
    expect(lead.business_name).toBe('Sharma Traders');
    expect(lead.flow_step).toBe('trial_owner_name');

    mockSent.length = 0;
    await say('Ramesh Kumar');
    expect(lead.name).toBe('Ramesh Kumar');
    expect(lead.flow_step).toBe('trial_link');
    expect(mockSent[0].body).toContain('Thank you Ramesh! Your free trial for *Sharma Traders*');
    expect(mockSent[0].body).toMatch(/https:\/\/khatario\.com\/signup\?src=whatsapp&lead=[\w.%-]+/);
    expect(answer).not.toHaveBeenCalled();
  });

  it('answers a real question first, then starts the flow', async () => {
    await say('What is the price of Khatario?');
    expect(answer).toHaveBeenCalledWith('What is the price of Khatario?');
    expect(mockState.lead.flow_step).toBe('business_type');
  });
});

describe('typed replies the flow cannot place', () => {
  it('re-asks the question up to the limit, then lets the assistant answer', async () => {
    mockState.lead.flow_step = 'business_type';
    await say('hmm');
    expect(mockTexts[0]).toContain('did not catch that');
    expect(mockSent.at(-1)?.type).toBe('list');
    expect(mockState.lead.flow_data.reasks).toBe(1);
    await say('hmm');
    expect(mockState.lead.flow_data.reasks).toBe(2);
    mockTexts.length = 0;
    mockSent.length = 0;
    await say('hmm');
    expect(answer).toHaveBeenCalledWith('hmm');
    expect(mockTexts).toEqual([]);
    expect(mockSent).toEqual([]);
    expect(mockState.lead.flow_step).toBe('business_type');
  });

  it('continues the flow from a template quick-reply tap', async () => {
    mockState.lead.flow_step = 'trial_link';
    mockState.lead.business_type = 'retail';
    mockState.lead.pain_point = 'inventory';
    await tap('Watch Demo');
    expect(mockState.lead.flow_step).toBe('demo');
  });
});

describe('opt-out and handover', () => {
  it('stops on STOP, stays silent until START', async () => {
    mockState.lead.flow_step = 'pitch';
    await say('STOP');
    expect(mockState.lead.opted_out_at).toBeTruthy();
    expect(mockTexts[0]).toContain('will not receive further messages');
    mockTexts.length = 0;
    await expect(say('hello?')).resolves.toBe(true);
    expect(mockTexts).toEqual([]);
    expect(answer).not.toHaveBeenCalled();
    await say('start');
    expect(mockState.lead.opted_out_at).toBeNull();
    expect(mockTexts[0]).toContain('Welcome back');
  });

  it('hands over to sales on HELP and stays quiet while sales owns the chat', async () => {
    mockState.lead.flow_step = 'pitch';
    await say('help');
    expect(mockState.lead.flow_step).toBe(HANDED_OFF);
    expect(mockNotify).toHaveBeenCalledWith(mockState.lead, expect.anything(), { reason: 'handoff' });
    expect(mockSent.at(-1)?.body).toContain('expert will message you');
    mockSent.length = 0;
    await say('when will they call?');
    expect(mockNotify).toHaveBeenLastCalledWith(mockState.lead, expect.anything(), { reason: 'message_while_handed_off', text: 'when will they call?' });
    expect(mockSent).toEqual([]);
    expect(answer).not.toHaveBeenCalled();
  });

  it('starts over on "menu"', async () => {
    mockState.lead.flow_step = 'trial_owner_name';
    await say('menu');
    expect(mockState.lead.flow_step).toBe('business_type');
  });
});

describe('registered users and signed-up leads', () => {
  it('ignores ordinary messages from registered users', async () => {
    await expect(say('how do I add an item?', {}, { knownUser: true })).resolves.toBe(false);
    expect(mockSent).toEqual([]);
  });

  it('handles a funnel button from a registered user who is a lead', async () => {
    mockState.lead.flow_step = 'trial_link';
    await expect(say('Talk to Expert', { replyId: 'trial_help' }, { knownUser: true })).resolves.toBe(true);
    expect(mockState.lead.flow_step).toBe(HANDED_OFF);
  });

  it('sends a signed-up lead with no step straight to the assistant', async () => {
    mockState.lead.business_id = '55555555-5555-4555-8555-555555555555';
    mockState.lead.pipeline_status = 'trial_created';
    await say('how do I add GST?');
    expect(answer).toHaveBeenCalledWith('how do I add GST?');
    expect(mockSent).toEqual([]);
  });
});
