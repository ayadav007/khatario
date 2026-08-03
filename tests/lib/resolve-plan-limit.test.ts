import { describe, it, expect } from '@jest/globals';
import { resolvePlanLimitValue } from '@/lib/subscription';

describe('resolvePlanLimitValue', () => {
  it('returns plan override when subscription_plan_limits row exists', async () => {
    const mockQuery = async () => ({ limit_value: 42 });
    const value = await resolvePlanLimitValue('trial', 'max_customers', mockQuery as never);
    expect(value).toBe(42);
  });

  it('falls back to platform default when no plan override', async () => {
    const mockQuery = async () => ({ limit_value: 100 });
    const value = await resolvePlanLimitValue('free', 'max_customers', mockQuery as never);
    expect(value).toBe(100);
  });

  it('returns null when limit is missing', async () => {
    const mockQuery = async () => null;
    const value = await resolvePlanLimitValue('unknown', 'max_customers', mockQuery as never);
    expect(value).toBeNull();
  });

  it('parses string limit values from DB', async () => {
    const mockQuery = async () => ({ limit_value: '25' });
    const value = await resolvePlanLimitValue('starter', 'max_items', mockQuery as never);
    expect(value).toBe(25);
  });
});
