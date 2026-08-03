import { describe, expect, it } from '@jest/globals';
import {
  assertBillingTransactionTransition,
  BillingTransactionStateError,
} from '@/lib/platform-billing-transaction-state';

describe('assertBillingTransactionTransition', () => {
  it('allows pending → completed', () => {
    expect(() => assertBillingTransactionTransition('pending', 'completed')).not.toThrow();
  });

  it('allows pending → failed', () => {
    expect(() => assertBillingTransactionTransition('pending', 'failed')).not.toThrow();
  });

  it('blocks completed → completed', () => {
    expect(() => assertBillingTransactionTransition('completed', 'completed')).toThrow(
      BillingTransactionStateError,
    );
  });

  it('blocks failed → completed', () => {
    expect(() => assertBillingTransactionTransition('failed', 'completed')).toThrow(
      BillingTransactionStateError,
    );
  });

  it('blocks refunded → completed', () => {
    expect(() => assertBillingTransactionTransition('refunded', 'completed')).toThrow(
      BillingTransactionStateError,
    );
  });

  it('blocks cancelled-like unknown from pending to refunded', () => {
    expect(() => assertBillingTransactionTransition('pending', 'refunded')).toThrow(
      BillingTransactionStateError,
    );
  });
});
