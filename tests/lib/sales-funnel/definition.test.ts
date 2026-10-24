/**
 * The built-in v1 flow must always be valid and publishable, and the helpers that read it must
 * pick the right messages and options for a lead.
 */
import {
  findOption,
  findOptionByTitle,
  findStep,
  isKeyword,
  isWaitingStep,
  stepMessages,
  stepOptions,
  validateFlow,
  type FlowDefinition,
} from '@/lib/sales-funnel/definition';
import { BUILTIN_MEDIA, DEFAULT_FLOW } from '@/lib/sales-funnel/default-flow';
import { FUNNEL_TEMPLATES } from '@/lib/sales-funnel/templates';
import { existsSync } from 'fs';
import path from 'path';

const clone = (): FlowDefinition => JSON.parse(JSON.stringify(DEFAULT_FLOW));

describe('default flow', () => {
  it('passes validation', () => {
    const r = validateFlow(DEFAULT_FLOW);
    if (!r.ok) throw new Error(r.errors.join('\n'));
  });

  it('reaches every step from an entry', () => {
    const seen = new Set<string>();
    const queue = DEFAULT_FLOW.entries.map((e) => e.step);
    while (queue.length) {
      const id = queue.shift() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      const step = findStep(DEFAULT_FLOW, id);
      if (!step) continue;
      for (const next of [step.next, step.skipTo]) if (next) queue.push(next);
      for (const m of [...step.messages, ...(step.variants || []).flatMap((v) => v.messages)]) {
        if (m.type === 'buttons' || m.type === 'list') for (const o of m.options) if (o.next) queue.push(o.next);
      }
    }
    expect(DEFAULT_FLOW.steps.map((s) => s.id).filter((id) => !seen.has(id))).toEqual([]);
  });

  it('ships the built-in screenshots it refers to', () => {
    for (const m of Object.values(BUILTIN_MEDIA)) {
      expect(existsSync(path.join(process.cwd(), m.path))).toBe(true);
    }
  });

  it('uses template quick-reply labels that continue the flow', () => {
    for (const t of FUNNEL_TEMPLATES) {
      for (const label of t.quick_replies) {
        const handled = findOptionByTitle(DEFAULT_FLOW, label) || isKeyword(label, DEFAULT_FLOW.settings.helpKeywords);
        expect({ template: t.name, label, handled: Boolean(handled) }).toEqual({ template: t.name, label, handled: true });
      }
    }
  });

  it('has a template for every follow-up that falls back to one', () => {
    const keys = new Set(FUNNEL_TEMPLATES.map((t) => t.event_key));
    for (const f of DEFAULT_FLOW.followups) if (f.templateEventKey) expect(keys.has(f.templateEventKey as never)).toBe(true);
  });
});

describe('validation catches broken edits', () => {
  it('rejects a button pointing to a missing step', () => {
    const f = clone();
    const demo = findStep(f, 'demo');
    const buttons = demo?.messages.find((m) => m.type === 'buttons');
    if (buttons?.type === 'buttons') buttons.options[0].next = 'nowhere';
    const r = validateFlow(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('missing step "nowhere"');
  });

  it('rejects button titles over 20 characters and more than 3 buttons', () => {
    const f = clone();
    const pitch = findStep(f, 'pitch');
    const m = pitch?.messages[0];
    if (m?.type === 'buttons') {
      m.options[0].title = 'This title is too long';
      m.options.push({ id: 'extra', title: 'Extra' });
    }
    expect(validateFlow(f).ok).toBe(false);
  });

  it('rejects the same option id in two steps', () => {
    const f = clone();
    const demo = findStep(f, 'demo');
    const buttons = demo?.messages.find((m) => m.type === 'buttons');
    if (buttons?.type === 'buttons') buttons.options[0].id = 'bt_retail';
    const r = validateFlow(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('bt_retail');
  });

  it('rejects actions outside the fixed list', () => {
    const f = clone() as unknown as { steps: Array<{ actions?: string[] }> };
    f.steps[0].actions = ['create_subscription'];
    expect(validateFlow(f).ok).toBe(false);
  });
});

describe('step helpers', () => {
  const pitch = findStep(DEFAULT_FLOW, 'pitch')!;

  it('picks the most specific personalised pitch', () => {
    const body = (lead: Record<string, string>) => {
      const m = stepMessages(pitch, lead)[0];
      return m.type === 'buttons' ? m.body : '';
    };
    expect(body({ business_type: 'wholesale', pain_point: 'outstanding' })).toContain('In wholesale');
    expect(body({ business_type: 'retail', pain_point: 'outstanding' })).toContain('Unpaid dues');
    expect(body({})).toBe((pitch.messages[0] as { body: string }).body);
  });

  it('lists the options of the last interactive message', () => {
    expect(stepOptions(pitch, {}).map((o) => o.id)).toEqual(['cta_demo', 'cta_trial', 'cta_expert']);
    expect(stepOptions(findStep(DEFAULT_FLOW, 'welcome_gst')!, {})).toEqual([]);
  });

  it('knows which steps wait for the lead', () => {
    expect(isWaitingStep(findStep(DEFAULT_FLOW, 'business_type')!, {})).toBe(true);
    expect(isWaitingStep(findStep(DEFAULT_FLOW, 'trial_business_name')!, {})).toBe(true);
    expect(isWaitingStep(findStep(DEFAULT_FLOW, 'welcome_general')!, {})).toBe(false);
    expect(isWaitingStep(findStep(DEFAULT_FLOW, 'trial_link')!, {})).toBe(false);
  });

  it('finds options by id or by title anywhere in the flow', () => {
    expect(findOption(DEFAULT_FLOW, 'demo_trial')?.step.id).toBe('demo');
    expect(findOption(DEFAULT_FLOW, 'nope')).toBeNull();
    expect(findOptionByTitle(DEFAULT_FLOW, 'watch demo')?.option.id).toBe('cta_demo');
  });

  it('matches keywords against the whole message only', () => {
    expect(isKeyword('STOP', ['stop'])).toBe(true);
    expect(isKeyword('Stop!', ['stop'])).toBe(true);
    expect(isKeyword("please don't stop", ['stop'])).toBe(false);
  });
});
