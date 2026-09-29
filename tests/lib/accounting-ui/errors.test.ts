import {
  canManagePeriodLocks,
  describeAccountingError,
  PERIOD_LOCKS_HREF,
} from '@/lib/accounting-ui/errors';
import { buildReversalUrl, REVERSAL_COPY } from '@/lib/accounting-ui/reversal';

describe('describeAccountingError: purchase cancellation codes', () => {
  const cancel = (code: string, status = 409) =>
    describeAccountingError(status, { code, error: 'server text' }, { context: 'purchase', verb: 'cancelled' });

  it('PURCHASE_HAS_PAYMENTS names the payment and never offers void/refund', () => {
    const view = cancel('PURCHASE_HAS_PAYMENTS');
    expect(view.message).toContain('cannot be cancelled because a payment has already been recorded');
    expect(view.message).not.toMatch(/void|refund/i);
    expect(view.message).not.toContain('server text');
  });

  it('PURCHASE_HAS_RETURNS', () => {
    expect(cancel('PURCHASE_HAS_RETURNS').message).toContain(
      'cannot be cancelled because a purchase return has already been recorded'
    );
  });

  it('BILL_TDS_DEPOSITED', () => {
    expect(cancel('BILL_TDS_DEPOSITED').message).toBe(
      'This bill cannot be cancelled because its TDS has already been deposited.'
    );
  });

  it('PURCHASE_STOCK_CONSUMED', () => {
    expect(cancel('PURCHASE_STOCK_CONSUMED').message).toBe(
      'This bill cannot be cancelled because the purchased stock has already been consumed or sold.'
    );
  });

  it('uses "deleted" for the draft-delete flow', () => {
    const view = describeAccountingError(400, { code: 'PURCHASE_HAS_RETURNS' }, { context: 'purchase', verb: 'deleted' });
    expect(view.message).toContain('cannot be deleted because a purchase return');
  });
});

describe('describeAccountingError: period locks', () => {
  it.each(['expense', 'journal', 'purchase'] as const)('%s PERIOD_LOCKED maps to the lock message', (context) => {
    const view = describeAccountingError(403, { code: 'PERIOD_LOCKED', error: 'raw' }, { context });
    expect(view.message).toBe('This accounting period is locked, so this correction cannot be made.');
    expect(view.action).toBeUndefined();
  });

  it('offers the period-lock settings link only to users who can manage locks', () => {
    const view = describeAccountingError(403, { code: 'PERIOD_LOCKED' }, { context: 'expense', canManagePeriods: true });
    expect(view.action).toEqual({ label: 'Manage period locks', href: PERIOD_LOCKS_HREF });
  });

  it.each(['expense', 'journal', 'purchase'] as const)('%s GST_PERIOD_FILED maps with correction guidance', (context) => {
    const view = describeAccountingError(403, { code: 'GST_PERIOD_FILED' }, { context, canManagePeriods: true });
    expect(view.message).toMatch(
      /^This GST period has already been filed, so this correction cannot be made directly\. .+/
    );
    expect(view.action).toBeUndefined();
  });

  it('JOURNAL_LOCKED explains the entry must be unlocked', () => {
    expect(describeAccountingError(403, { code: 'JOURNAL_LOCKED' }, { context: 'journal', verb: 'reversed' }).message).toBe(
      'This journal entry is locked. Unlock it before it can be reversed.'
    );
  });
});

describe('describeAccountingError: auth and fallbacks', () => {
  it('401 without a code becomes a session message with a login action', () => {
    const view = describeAccountingError(401, { error: 'Unauthorized' }, { context: 'expense', currentPath: '/expenses' });
    expect(view.message).toMatch(/session has expired/i);
    expect(view.action?.href).toBe('/login?redirect=%2Fexpenses');
  });

  it('403 authorization denial keeps the permission message', () => {
    const view = describeAccountingError(403, { code: 'ACCESS_DENIED' }, { context: 'purchase' });
    expect(view.message).toBe('You do not have permission to perform this action.');
  });

  it('unknown codes fall back to the server message, then the fallback', () => {
    expect(describeAccountingError(500, { error: 'boom' }, { context: 'purchase' }).message).toBe('boom');
    expect(describeAccountingError(500, null, { context: 'purchase', fallback: 'Try again' }).message).toBe('Try again');
  });

  it('canManagePeriodLocks mirrors settings.update', () => {
    expect(canManagePeriodLocks(true, {})).toBe(true);
    expect(canManagePeriodLocks(false, { settings: { can_modify: true } })).toBe(true);
    expect(canManagePeriodLocks(false, { settings: { can_modify: false } })).toBe(false);
    expect(canManagePeriodLocks(false, null)).toBe(false);
  });
});

describe('reversal wording and request', () => {
  it('describes reversal, not deletion', () => {
    for (const copy of [REVERSAL_COPY.expense.description, REVERSAL_COPY.journal.description]) {
      expect(copy).toContain('will be reversed by posting corresponding reversing entries');
      expect(copy).toContain('The original entry will remain available for audit history.');
      expect(copy).not.toMatch(/ledger entries (will be )?(deleted|removed)/i);
    }
    expect(REVERSAL_COPY.success).toBe('Entry reversed successfully.');
  });

  it('sends the reason as ?reason= alongside business_id', () => {
    const url = buildReversalUrl('/api/expenses/e1', 'b1', '  Entered twice & wrong ');
    const parsed = new URL(url, 'http://x');
    expect(parsed.pathname).toBe('/api/expenses/e1');
    expect(parsed.searchParams.get('business_id')).toBe('b1');
    expect(parsed.searchParams.get('reason')).toBe('Entered twice & wrong');
  });
});
