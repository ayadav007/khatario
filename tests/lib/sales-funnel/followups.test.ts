/**
 * Follow-ups respect WhatsApp's 24-hour window and only go out while their condition still holds.
 */
jest.mock('@/lib/db', () => ({ query: jest.fn(), queryOne: jest.fn(), queryRows: jest.fn() }));

import { followupConditionMet, insideSessionWindow } from '@/lib/sales-funnel/followups';
import { HANDED_OFF } from '@/lib/sales-funnel/engine';
import type { FunnelLead } from '@/lib/sales-funnel/leads';

const HOUR = 60 * 60 * 1000;
const now = Date.now();

function lead(patch: Partial<FunnelLead> = {}): FunnelLead {
  return {
    id: 'l1',
    name: null,
    phone: '9800000001',
    wa_phone: '919800000001',
    business_name: null,
    business_type: null,
    pain_point: null,
    city: null,
    status: 'new',
    pipeline_status: 'qualified',
    flow_step: 'pitch',
    flow_version: 1,
    flow_data: {},
    entry_key: null,
    ad_id: null,
    campaign_id: null,
    campaign_name: null,
    ctwa_clid: null,
    business_id: null,
    last_inbound_at: new Date(now - 2 * HOUR),
    last_outbound_at: null,
    last_funnel_message_id: null,
    demo_sent_at: null,
    demo_read_at: null,
    opted_out_at: null,
    trial_created_at: null,
    activated_at: null,
    converted_at: null,
    created_at: new Date(now - 3 * HOUR),
    ...patch,
  };
}

describe('insideSessionWindow', () => {
  it('allows free-form messages until just before 24 hours', () => {
    expect(insideSessionWindow({ last_inbound_at: new Date(now - 23 * HOUR) }, now)).toBe(true);
    expect(insideSessionWindow({ last_inbound_at: new Date(now - 23.9 * HOUR) }, now)).toBe(false);
    expect(insideSessionWindow({ last_inbound_at: null }, now)).toBe(false);
  });
});

describe('followupConditionMet', () => {
  const scheduledAt = new Date(now - HOUR);

  it('no_reply: only if the lead stayed silent since scheduling, before a trial, and not with sales', () => {
    expect(followupConditionMet({ condition: 'no_reply' }, lead(), scheduledAt)).toBe(true);
    expect(followupConditionMet({ condition: 'no_reply' }, lead({ last_inbound_at: new Date(now - 30 * 60 * 1000) }), scheduledAt)).toBe(false);
    expect(followupConditionMet({ condition: 'no_reply' }, lead({ flow_step: HANDED_OFF }), scheduledAt)).toBe(false);
    expect(followupConditionMet({ condition: 'no_reply' }, lead({ pipeline_status: 'trial_created' }), scheduledAt)).toBe(false);
  });

  it('no_trial: until the lead has a business', () => {
    expect(followupConditionMet({ condition: 'no_trial' }, lead({ pipeline_status: 'demo_interested' }), scheduledAt)).toBe(true);
    expect(followupConditionMet({ condition: 'no_trial' }, lead({ business_id: 'b1', pipeline_status: 'trial_created' }), scheduledAt)).toBe(false);
  });

  it('no_invoice and activated_not_paid follow the trial lifecycle', () => {
    expect(followupConditionMet({ condition: 'no_invoice' }, lead({ business_id: 'b1' }), scheduledAt)).toBe(true);
    expect(followupConditionMet({ condition: 'no_invoice' }, lead({ business_id: 'b1', activated_at: new Date() }), scheduledAt)).toBe(false);
    expect(followupConditionMet({ condition: 'activated_not_paid' }, lead({ business_id: 'b1', activated_at: new Date() }), scheduledAt)).toBe(true);
    expect(followupConditionMet({ condition: 'activated_not_paid' }, lead({ activated_at: new Date(), converted_at: new Date() }), scheduledAt)).toBe(false);
  });
});
