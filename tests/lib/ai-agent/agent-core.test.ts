/**
 * Shop WhatsApp AI agent: prompt built from owner settings, reply markers, settings clamping,
 * the pre-model gate (pause / handoff / after-hours / greeting), provider choice and key secrecy.
 */
const mockPerformHandoff = jest.fn();
const mockKhatarioAccess = jest.fn();

jest.mock('@/lib/db', () => ({ query: jest.fn(), queryOne: jest.fn(), queryRows: jest.fn().mockResolvedValue([]) }));
jest.mock('@/lib/ai-agent/conversation', () => ({
  performHandoff: (...a: unknown[]) => mockPerformHandoff(...a),
}));
jest.mock('@/lib/ai-agent/billing', () => ({
  khatarioAccess: (...a: unknown[]) => mockKhatarioAccess(...a),
  hasKhatarioAiAddon: jest.fn().mockResolvedValue(false),
}));
jest.mock('@/lib/whatsapp/customer-bot', () => ({ dailyLimit: jest.fn().mockResolvedValue(200) }));

import { query, queryOne } from '@/lib/db';
import { buildAgentPrompt, parseAgentReply } from '@/lib/ai-agent/prompt';
import { isOutsideBusinessHours, matchesTriggerPhrase, runAgentGate } from '@/lib/ai-agent/gate';
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_HANDOFF_MESSAGE,
  goLiveChecklist,
  normalizeAgentSettings,
  validateAgentSettings,
  type AgentSettings,
} from '@/lib/ai-agent/types';
import { loadProviderSummary } from '@/lib/ai-agent/settings';
import { currentModelId, geminiThinks, groqRequestBody, resolveAgentProvider } from '@/lib/services/ai-provider-factory';

const mQueryOne = queryOne as jest.Mock;
const mQuery = query as jest.Mock;
const BIZ = '11111111-1111-4111-8111-111111111111';
const CONV = '22222222-2222-4222-8222-222222222222';

const settings = (over: Partial<AgentSettings> = {}): AgentSettings => ({ ...normalizeAgentSettings({}), ...over });

beforeEach(() => {
  jest.clearAllMocks();
  mQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mQueryOne.mockResolvedValue(null);
});

describe('buildAgentPrompt', () => {
  const company = { name: 'Sharma Stores' };

  it("puts the owner's instructions in, marked as overriding the defaults", () => {
    const p = buildAgentPrompt(settings({ instructions: 'Never offer COD.' }), company, '');
    expect(p).toContain("OWNER'S INSTRUCTIONS");
    expect(p).toContain('Never offer COD.');
    expect(p.indexOf('Never offer COD.')).toBeGreaterThan(p.indexOf('BUSINESS RULES:'));
  });

  it('only mentions the payment link placeholder when the payment skill is on', () => {
    const on = buildAgentPrompt(settings(), company, '');
    expect(on).toContain('[insert payment link]');
    const off = buildAgentPrompt(settings({ skills: { takeOrders: true, orderStatus: true, paymentLinks: false } }), company, '');
    expect(off).not.toContain('[insert payment link]');
    expect(off).toContain('CREATE_ORDER');
  });

  it('drops the ordering flow when taking orders is off', () => {
    const p = buildAgentPrompt(settings({ skills: { takeOrders: false, orderStatus: true, paymentLinks: true } }), company, '');
    expect(p).not.toContain('CREATE_ORDER');
    expect(p).toContain('You do not take orders in chat');
  });

  it('adds lead questions with their field keys only when the skill is on', () => {
    const lead = {
      enabled: true,
      questions: [{ id: 'q1', text: 'What is your budget?', fieldKey: 'budget', required: true }],
      onQualify: { labels: [], leadStatus: 'interested' as const, assignTo: '', handoff: false },
    };
    expect(buildAgentPrompt(settings({ leadSkill: lead }), company, '')).toContain('field "budget"');
    expect(buildAgentPrompt(settings({ leadSkill: { ...lead, enabled: false } }), company, '')).not.toContain('LEAD QUALIFICATION');
  });

  it('asks for the handoff marker only when handoff is enabled', () => {
    expect(buildAgentPrompt(settings(), company, '')).toContain('HANDOFF_TO_HUMAN');
    const off = settings();
    off.handoff = { ...off.handoff, enabled: false };
    expect(buildAgentPrompt(off, company, '')).not.toContain('HANDOFF_TO_HUMAN');
  });

  it('places retrieved shop knowledge before the accuracy rules', () => {
    const p = buildAgentPrompt(settings(), company, 'SHOP INFO: Basmati rice ₹120/kg');
    expect(p.indexOf('Basmati rice')).toBeLessThan(p.indexOf('ACCURACY:'));
  });
});

describe('parseAgentReply', () => {
  it('strips markers and returns handoff, quick replies and lead data', () => {
    const r = parseAgentReply(
      'Sure, connecting you.\nHANDOFF_TO_HUMAN\nQUICK_REPLIES: ["Yes","No","Maybe","Extra"]\nLEAD_DATA: {"budget":"5000","city":" Pune "}',
    );
    expect(r.text).toBe('Sure, connecting you.');
    expect(r.handoff).toBe(true);
    expect(r.quickReplies).toEqual(['Yes', 'No', 'Maybe']);
    expect(r.leadData).toEqual({ budget: '5000', city: 'Pune' });
  });

  it('drops malformed markers instead of sending them to the customer', () => {
    const r = parseAgentReply('Hello!\nQUICK_REPLIES: [oops\nLEAD_DATA: {bad json}');
    expect(r.text).not.toContain('LEAD_DATA');
    expect(r.quickReplies).toEqual([]);
    expect(r.leadData).toEqual({});
  });

  it('caps quick reply length', () => {
    expect(parseAgentReply('Hi QUICK_REPLIES: ["A very very long option label"]').quickReplies[0]).toHaveLength(20);
  });
});

describe('settings normalisation', () => {
  it('fills defaults and clamps unsafe values', () => {
    const s = normalizeAgentSettings({
      instructions: 'x'.repeat(5000),
      handoff: { pauseMinutes: 99999, triggerPhrases: ['  call me  ', '', 42] },
      leadSkill: { questions: [{ text: 'Your City?' }, { text: '' }] },
    });
    expect(s.instructions).toHaveLength(2000);
    expect(s.handoff.pauseMinutes).toBe(1440);
    expect(s.handoff.triggerPhrases).toEqual(['call me']);
    expect(s.leadSkill.questions).toEqual([{ id: 'q1', text: 'Your City?', fieldKey: 'your_city', required: false }]);
    expect(normalizeAgentSettings(null)).toEqual(normalizeAgentSettings({}));
  });

  it('flags handoff with no phrases and duplicate lead fields', () => {
    const s = settings();
    s.handoff = { ...s.handoff, triggerPhrases: [] };
    s.leadSkill = {
      ...s.leadSkill,
      enabled: true,
      questions: [
        { id: 'a', text: 'City', fieldKey: 'city', required: true },
        { id: 'b', text: 'Town', fieldKey: 'city', required: false },
      ],
    };
    const fields = validateAgentSettings(s).map((e) => e.field);
    expect(fields).toContain('handoff.triggerPhrases');
    expect(fields).toContain('leadSkill.questions');
  });

  it('go-live checklist needs summary, knowledge, fallback and a provider', () => {
    const provider = { keySource: 'own', configured: false } as Parameters<typeof goLiveChecklist>[1];
    expect(goLiveChecklist(DEFAULT_AGENT_SETTINGS, provider, false).every((c) => !c.ok)).toBe(true);
    const ready = settings({ businessSummary: 'We sell fresh groceries in Pune.', fallbackMessage: 'We will call you.' });
    expect(goLiveChecklist(ready, { ...provider, configured: true }, true).every((c) => c.ok)).toBe(true);
  });
});

describe('gate helpers', () => {
  it('matches trigger phrases on word boundaries, ignoring case and punctuation', () => {
    expect(matchesTriggerPhrase('Can I TALK to a human, please?', ['talk to a human'])).toBe(true);
    expect(matchesTriggerPhrase('I need an agentic workflow', ['agent'])).toBe(false);
    expect(matchesTriggerPhrase('anything', ['  '])).toBe(false);
  });

  it('works out business hours in the shop timezone, including overnight shifts', () => {
    const hours = {
      timezone: 'Asia/Kolkata',
      schedule: [
        { day: 'monday' as const, isOpen: true, openTime: '09:00', closeTime: '18:00' },
        { day: 'tuesday' as const, isOpen: true, openTime: '20:00', closeTime: '02:00' },
        { day: 'wednesday' as const, isOpen: false },
      ],
    };
    // Monday 2026-10-05 10:00 IST = 04:30 UTC
    expect(isOutsideBusinessHours(hours, new Date('2026-10-05T04:30:00Z'))).toBe(false);
    // Monday 19:00 IST
    expect(isOutsideBusinessHours(hours, new Date('2026-10-05T13:30:00Z'))).toBe(true);
    // Tuesday 23:00 IST (overnight shift)
    expect(isOutsideBusinessHours(hours, new Date('2026-10-06T17:30:00Z'))).toBe(false);
    // Wednesday closed
    expect(isOutsideBusinessHours(hours, new Date('2026-10-07T06:30:00Z'))).toBe(true);
    expect(isOutsideBusinessHours({ timezone: 'Asia/Kolkata', schedule: [] })).toBe(false);
  });
});

describe('runAgentGate', () => {
  const conv = (over: Record<string, unknown> = {}) => ({ paused: false, after_hours_notified_on: null, incoming: '1', outgoing: '0', ...over });
  const run = (s: AgentSettings, message = 'hello', now?: Date) =>
    runAgentGate({ businessId: BIZ, conversationId: CONV, message, settings: s, now });

  it('stays quiet while the chat is paused, even for trigger phrases', async () => {
    mQueryOne.mockResolvedValue(conv({ paused: true }));
    await expect(run(settings(), 'talk to a human')).resolves.toEqual({ action: 'stop', reason: 'paused' });
    expect(mockPerformHandoff).not.toHaveBeenCalled();
  });

  it('scopes the conversation lookup to the business', async () => {
    mQueryOne.mockResolvedValue(conv());
    await run(settings());
    const [sql, params] = mQueryOne.mock.calls[0];
    expect(sql).toContain('c.business_id = $2');
    expect(params).toEqual([CONV, BIZ]);
  });

  it('hands off on a trigger phrase with the default message', async () => {
    mQueryOne.mockResolvedValue(conv({ incoming: '4', outgoing: '3' }));
    const r = await run(settings(), 'please call me');
    expect(r).toEqual({ action: 'reply', response: DEFAULT_HANDOFF_MESSAGE, reason: 'handoff' });
    expect(mockPerformHandoff).toHaveBeenCalledWith(BIZ, CONV, expect.any(Object), expect.any(Object));
  });

  it('sends the after-hours notice once per local day', async () => {
    const s = settings({ afterHoursMessage: 'We are closed.' });
    s.behavior = { ...s.behavior, businessHours: { timezone: 'Asia/Kolkata', schedule: [{ day: 'monday', isOpen: false }] } };
    const mondayNight = new Date('2026-10-05T16:30:00Z');
    mQueryOne.mockResolvedValue(conv());
    await expect(run(s, 'hi', mondayNight)).resolves.toMatchObject({ action: 'reply', reason: 'after_hours', response: 'We are closed.' });
    expect(mQuery.mock.calls[0][1]).toEqual([CONV, BIZ, '2026-10-05']);

    mQueryOne.mockResolvedValue(conv({ after_hours_notified_on: '2026-10-05' }));
    await expect(run(s, 'hi again', mondayNight)).resolves.toMatchObject({ action: 'continue' });
  });

  it('opens a brand-new chat with the greeting', async () => {
    mQueryOne.mockResolvedValue(conv());
    await expect(run(settings({ greetingMessage: 'Namaste!' }))).resolves.toEqual({ action: 'continue', greeting: 'Namaste!' });
    mQueryOne.mockResolvedValue(conv({ incoming: '3', outgoing: '2' }));
    await expect(run(settings({ greetingMessage: 'Namaste!' }))).resolves.toEqual({ action: 'continue' });
  });
});

describe('resolveAgentProvider', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, GROQ_API_KEY: 'platform-key' };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  const row = (over: Record<string, unknown> = {}) => ({
    provider: 'groq',
    api_key: 'gsk_shop_key_1234',
    api_key_encrypted: null,
    key_source: 'own',
    api_base_url: null,
    model: null,
    temperature: null,
    max_tokens: null,
    chatbot_enabled: true,
    ...over,
  });

  it("uses the shop's own key without touching the Khatario quota", async () => {
    mQueryOne.mockResolvedValue(row());
    await expect(resolveAgentProvider(BIZ, { live: true })).resolves.toMatchObject({ via: 'own' });
    expect(mockKhatarioAccess).not.toHaveBeenCalled();
  });

  it('reports a missing own key and a disabled agent', async () => {
    mQueryOne.mockResolvedValue(row({ api_key: null }));
    await expect(resolveAgentProvider(BIZ, { live: false })).resolves.toEqual({ provider: null, reason: 'no_key' });
    mQueryOne.mockResolvedValue(row({ chatbot_enabled: false }));
    await expect(resolveAgentProvider(BIZ, { live: false })).resolves.toEqual({ provider: null, reason: 'disabled' });
  });

  it('lets the test chat run while the agent is off', async () => {
    mQueryOne.mockResolvedValue(row({ chatbot_enabled: false }));
    await expect(resolveAgentProvider(BIZ, { live: false, ignoreDisabled: true })).resolves.toMatchObject({ via: 'own' });
  });

  it('routes Khatario AI through the add-on or trial check', async () => {
    mQueryOne.mockResolvedValue(row({ key_source: 'khatario', api_key: null }));
    mockKhatarioAccess.mockResolvedValue({ ok: true, via: 'trial' });
    await expect(resolveAgentProvider(BIZ, { live: false })).resolves.toMatchObject({ via: 'khatario_trial' });
    expect(mockKhatarioAccess).toHaveBeenCalledWith(BIZ, { live: false });

    mockKhatarioAccess.mockResolvedValue({ ok: false, reason: 'live_needs_addon' });
    await expect(resolveAgentProvider(BIZ, { live: true })).resolves.toEqual({ provider: null, reason: 'live_needs_addon' });
  });
});

describe('model request bodies', () => {
  const msgs = [{ role: 'user' as const, content: 'hi' }];

  it('gives gpt-oss low reasoning and room beyond the reply budget', () => {
    expect(groqRequestBody('openai/gpt-oss-120b', msgs, 0.5, 600)).toMatchObject({
      max_completion_tokens: 1624,
      reasoning_effort: 'low',
      include_reasoning: false,
    });
  });

  it('leaves non-reasoning Groq models at the plain budget', () => {
    const body = groqRequestBody('llama-3.3-70b-versatile', msgs, 0.5, 600);
    expect(body).toMatchObject({ max_completion_tokens: 600 });
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('maps shut-down model IDs to their replacements', () => {
    expect(currentModelId('llama-3.1-8b-instant')).toBe('openai/gpt-oss-20b');
    expect(currentModelId('llama-3.3-70b-versatile')).toBe('openai/gpt-oss-120b');
    expect(currentModelId('gemini-2.0-flash')).toBe('gemini-3.5-flash');
    expect(currentModelId('gpt-4o-mini')).toBe('gpt-4o-mini');
    expect(currentModelId(undefined)).toBeUndefined();
  });

  it('treats Gemini 2.5 and later as thinking models', () => {
    expect(geminiThinks('gemini-3.5-flash')).toBe(true);
    expect(geminiThinks('gemini-2.5-flash')).toBe(true);
    expect(geminiThinks('gemini-2.0-flash')).toBe(false);
    expect(geminiThinks('gemini-pro')).toBe(false);
  });
});

describe('API key secrecy', () => {
  it('the provider summary never carries the key', async () => {
    mQueryOne.mockImplementation(async (sql: string) =>
      sql.includes('FROM ai_provider_config')
        ? {
            provider: 'openai',
            api_key: 'sk-legacy-plain-secret-9999',
            api_key_encrypted: 'v1:encrypted-blob',
            api_key_last4: '9999',
            key_source: 'own',
            chatbot_enabled: true,
            mode: 'dev',
            dev_allowed_phones: [],
          }
        : null,
    );
    const summary = await loadProviderSummary(BIZ, async () => false);
    const json = JSON.stringify(summary);
    expect(json).not.toContain('sk-legacy-plain-secret');
    expect(json).not.toContain('encrypted-blob');
    expect(summary).not.toHaveProperty('apiKey');
    expect(summary).toMatchObject({ hasKey: true, keyLast4: '9999', configured: true });
  });
});
