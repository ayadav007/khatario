/**
 * Typed replies map onto flow options deterministically first (AI only as a last resort, and only
 * to an existing option id); signup links are signed, phone-bound and expire.
 */
const mockCompleteJson = jest.fn();
jest.mock('@/lib/rag/llm', () => ({ completeJson: (...a: unknown[]) => mockCompleteJson(...a) }));

import { classifyReply, looksLikeQuestion, matchOption } from '@/lib/sales-funnel/classify';
import { findStep } from '@/lib/sales-funnel/definition';
import { DEFAULT_FLOW } from '@/lib/sales-funnel/default-flow';
import { createSignupToken, SIGNUP_LINK_TTL_MS, signupLinkUrl, verifySignupToken } from '@/lib/sales-funnel/signup-link';

const options = (stepId: string) => {
  const step = findStep(DEFAULT_FLOW, stepId)!;
  const m = step.messages.find((x) => x.type === 'buttons' || x.type === 'list');
  return m && (m.type === 'buttons' || m.type === 'list') ? m.options : [];
};

describe('matchOption', () => {
  const business = options('business_type');
  const pitch = options('pitch');

  it('matches a title, an option number or a single keyword', () => {
    expect(matchOption('Manufacturing', business)).toEqual({ optionId: 'bt_manufacturing', via: 'title' });
    expect(matchOption('2', business)).toEqual({ optionId: 'bt_wholesale', via: 'number' });
    expect(matchOption('I have a kirana dukaan', business)).toEqual({ optionId: 'bt_retail', via: 'keyword' });
    expect(matchOption('demo dikhao', pitch)).toEqual({ optionId: 'cta_demo', via: 'keyword' });
  });

  it('returns none when the reply is ambiguous or unrelated', () => {
    expect(matchOption('demo or a call', pitch).optionId).toBeNull();
    expect(matchOption('hello', pitch).optionId).toBeNull();
    expect(matchOption('42', business).optionId).toBeNull();
  });
});

describe('looksLikeQuestion', () => {
  it('spots questions in English and Hinglish', () => {
    expect(looksLikeQuestion('price kitna hai')).toBe(true);
    expect(looksLikeQuestion('Does it work offline?')).toBe(true);
    expect(looksLikeQuestion('I want to know about GST billing.')).toBe(false);
    expect(looksLikeQuestion('Sharma Traders')).toBe(false);
  });
});

describe('classifyReply', () => {
  beforeEach(() => mockCompleteJson.mockReset());

  it('does not call the AI when a rule matches', async () => {
    await expect(classifyReply('trial', options('pitch'), 'q')).resolves.toEqual({ optionId: 'cta_trial', via: 'keyword' });
    expect(mockCompleteJson).not.toHaveBeenCalled();
  });

  it('accepts only an option id from the list', async () => {
    mockCompleteJson.mockResolvedValueOnce({ data: { option: 'cta_expert' } });
    await expect(classifyReply('mujhe kisi se milna hai please', options('pitch'), 'q')).resolves.toEqual({ optionId: 'cta_expert', via: 'ai' });
    mockCompleteJson.mockResolvedValueOnce({ data: { option: 'create_account_now' } });
    await expect(classifyReply('something else entirely here', options('pitch'), 'q')).resolves.toEqual({ optionId: null, via: 'none' });
  });

  it('survives an AI failure', async () => {
    mockCompleteJson.mockRejectedValueOnce(new Error('rate limited'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(classifyReply('hmm not sure what to say', options('pitch'), 'q')).resolves.toEqual({ optionId: null, via: 'none' });
  });
});

describe('signup link token', () => {
  const LEAD = '33333333-3333-4333-8333-333333333333';
  const prev = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
  });
  afterAll(() => {
    process.env.JWT_SECRET = prev;
  });

  it('round-trips the lead and phone', () => {
    const t = createSignupToken(LEAD, '9800000001');
    expect(verifySignupToken(t)).toEqual({ leadId: LEAD, phone10: '9800000001' });
    expect(signupLinkUrl('https://khatario.com/', t)).toBe(`https://khatario.com/signup?src=whatsapp&lead=${encodeURIComponent(t)}`);
  });

  it('rejects tampered, expired or foreign tokens', () => {
    const t = createSignupToken(LEAD, '9800000001');
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ l: LEAD, p: '9999999999', e: Date.now() + 1000 })).toString('base64url');
    expect(verifySignupToken(`${forged}.${sig}`)).toBeNull();
    expect(verifySignupToken(`${body}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`)).toBeNull();
    expect(verifySignupToken(t, Date.now() + SIGNUP_LINK_TTL_MS + 1000)).toBeNull();
    process.env.JWT_SECRET = 'other-secret';
    expect(verifySignupToken(t)).toBeNull();
    process.env.JWT_SECRET = 'test-secret';
    expect(verifySignupToken('garbage')).toBeNull();
    expect(verifySignupToken(null)).toBeNull();
  });
});
