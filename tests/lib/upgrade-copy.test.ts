import { buildUpgradeCopy, LIMIT_NOUNS, planBenefitLines } from '@/lib/upgrade/upgrade-copy';
import { LIMIT_KEY_BY_TYPE } from '@/lib/subscription/limit-registry';
import { getFeatureDisplayName } from '@/lib/feature-upgrade-labels';

const growth = { planId: 'billing_growth', planLabel: 'Growth', priceMonthly: 499 };
const starter = { planId: 'billing_starter', planLabel: 'Starter', priceMonthly: 299, planLimit: -1 };

describe('buildUpgradeCopy', () => {
  it('feature: names the feature and the plan', () => {
    const c = buildUpgradeCopy({ variant: 'feature', featureKey: 'profit_reports_basic' }, growth);
    expect(c.title).toBe("Sorry, Profit by invoice isn't in your plan");
    expect(c.ctaLabel).toBe('Upgrade to Growth');
    expect(c.tag).toBe('Not in your plan');
    expect(c.closable).toBe(true);
    expect(c.object).toBe('bill');
    expect(c.badge).toBe('lock');
  });

  it('feature: without a key or plan still reads well', () => {
    const c = buildUpgradeCopy({ variant: 'feature' }, null);
    expect(c.title).toBe("Sorry, this feature isn't in your plan");
    expect(c.ctaLabel).toBe('See plans');
  });

  it('feature: an unlabelled key reads in sentence case', () => {
    expect(buildUpgradeCopy({ variant: 'feature', featureKey: 'xyz_abc' }, null).title).toBe(
      "Sorry, Xyz abc isn't in your plan",
    );
  });

  it('limit: counts with the period', () => {
    const c = buildUpgradeCopy({ variant: 'limit', limitType: 'estimates', limit: 20, current: 20 }, starter);
    expect(c.title).toBe("Sorry, you've used all 20 estimates this month");
    expect(c.chips[0].subtitle).toBe('Unlimited on Starter');
    expect(c.ctaLabel).toBe('Upgrade to Starter');
  });

  it('limit: daily limits say today', () => {
    expect(buildUpgradeCopy({ variant: 'limit', limitType: 'whatsapp', limit: 20, current: 20 }, null).title).toBe(
      "Sorry, you've used all 20 WhatsApp messages today",
    );
  });

  it('limit: users read as room for people', () => {
    const one = buildUpgradeCopy({ variant: 'limit', limitType: 'users', limit: 1, current: 1 }, starter);
    expect(one.title).toBe('Sorry, your plan has room for 1 user');
    expect(one.object).toBe('users');
    expect(one.badge).toBe('full');
    expect(buildUpgradeCopy({ variant: 'limit', limitType: 'users', limit: 3, current: 3 }, null).title).toBe(
      'Sorry, your plan has room for 3 users',
    );
  });

  it('limit: without a type falls back', () => {
    expect(buildUpgradeCopy({ variant: 'limit' }, null).title).toBe("Sorry, you've reached your plan's limit");
  });

  it('addon: points to Khatario Connect', () => {
    const c = buildUpgradeCopy({ variant: 'addon', featureKey: 'integration_whatsapp_bot' }, null);
    expect(c.title).toBe('Sorry, WhatsApp inbox needs Khatario Connect');
    expect(c.ctaLabel).toBe('Add Khatario Connect');
    expect(c.object).toBe('chat');
    expect(c.badge).toBe('plus');
    expect(c.benefits).toHaveLength(3);
  });

  it('addon: never names Connect twice', () => {
    expect(buildUpgradeCopy({ variant: 'addon', featureName: 'Khatario Connect' }, null).title).toBe(
      'Sorry, this needs Khatario Connect',
    );
    expect(buildUpgradeCopy({ variant: 'addon' }, null).title).toBe('Sorry, this needs Khatario Connect');
  });

  it('trial: counts down', () => {
    expect(buildUpgradeCopy({ variant: 'trial', trialDaysLeft: 3 }, starter).title).toBe('Your free trial ends in 3 days');
    expect(buildUpgradeCopy({ variant: 'trial', trialDaysLeft: 1 }, starter).title).toBe('Your free trial ends in 1 day');
    expect(buildUpgradeCopy({ variant: 'trial', trialDaysLeft: 0 }, starter).title).toBe('Your free trial ends today');
    const ended = buildUpgradeCopy({ variant: 'trial', trialDaysLeft: -1 }, starter);
    expect(ended.title).toBe('Your free trial has ended');
    expect(ended.laterLabel).toBe('Remind me tomorrow');
    expect(ended.ctaLabel).toBe('Choose a plan');
  });

  it('web: cannot be closed', () => {
    const c = buildUpgradeCopy({ variant: 'web' }, starter);
    expect(c.title).toBe("Sorry, Khatario Free doesn't open on a computer");
    expect(c.closable).toBe(false);
    expect(c.laterLabel).toBe('Sign out');
    expect(c.object).toBe('laptop');
  });

  it('every body reassures and ends with a full stop', () => {
    const reqs = [
      { variant: 'feature' as const },
      { variant: 'limit' as const, limitType: 'items', limit: 50, current: 50 },
      { variant: 'addon' as const },
      { variant: 'trial' as const, trialDaysLeft: 2 },
      { variant: 'web' as const },
    ];
    for (const r of reqs) {
      const body = buildUpgradeCopy(r, starter).body;
      expect(body.endsWith('.')).toBe(true);
      expect(body).toMatch(/stays/);
    }
  });
});

describe('planBenefitLines', () => {
  it('lists what the plan adds, the asked feature first, labelled ones only', () => {
    const lines = planBenefitLines(
      ['sales_invoices', 'advanced_ledger', 'unlabelled_thing', 'profit_reports_basic', 'accounting_bank', 'accounting_tds'],
      ['sales_invoices'],
      'profit_reports_basic',
    );
    expect(lines).toEqual(['Profit by invoice', 'Ledger', 'Bank accounts']);
  });

  it('is empty when the plan adds nothing labelled', () => {
    expect(planBenefitLines(['sales_invoices'], ['sales_invoices'])).toEqual([]);
  });
});

describe('LIMIT_NOUNS', () => {
  it('covers every limit the server can enforce', () => {
    for (const type of Object.keys(LIMIT_KEY_BY_TYPE)) {
      expect(LIMIT_NOUNS[type]).toBeDefined();
    }
  });
});

describe('getFeatureDisplayName', () => {
  it('uses sentence case, never Title Case', () => {
    expect(getFeatureDisplayName('settings_template_customization')).toBe('Template customisation');
    expect(getFeatureDisplayName('settings_backup')).toBe('Backup and restore');
  });
});
