/**
 * The inbound path's known-number cache (lib/leads/known-number.ts): a number found known is not
 * looked up again for ten minutes; unknown numbers are never cached.
 */
const mockIsKnownNumber = jest.fn();
jest.mock('@/lib/whatsapp/lead-sources', () => ({
  isKnownNumber: (...args: unknown[]) => mockIsKnownNumber(...args),
}));

import { clearKnownNumberCache, isKnownNumberCached, KNOWN_NUMBER_TTL_MS } from '@/lib/leads/known-number';

describe('isKnownNumberCached', () => {
  beforeEach(() => {
    clearKnownNumberCache();
    mockIsKnownNumber.mockReset();
    jest.useRealTimers();
  });

  test('a known number is looked up once within the TTL, on its last 10 digits', async () => {
    mockIsKnownNumber.mockResolvedValue(true);
    expect(await isKnownNumberCached('b1', '919876500001')).toBe(true);
    expect(await isKnownNumberCached('b1', '+91 98765 00001')).toBe(true);
    expect(mockIsKnownNumber).toHaveBeenCalledTimes(1);
  });

  test('the cache is per business', async () => {
    mockIsKnownNumber.mockResolvedValue(true);
    await isKnownNumberCached('b1', '919876500002');
    await isKnownNumberCached('b2', '919876500002');
    expect(mockIsKnownNumber).toHaveBeenCalledTimes(2);
  });

  test('an unknown number is asked again every time', async () => {
    mockIsKnownNumber.mockResolvedValue(false);
    expect(await isKnownNumberCached('b1', '919876500003')).toBe(false);
    expect(await isKnownNumberCached('b1', '919876500003')).toBe(false);
    expect(mockIsKnownNumber).toHaveBeenCalledTimes(2);
  });

  test('an entry expires after the TTL', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-30T10:00:00Z') });
    mockIsKnownNumber.mockResolvedValue(true);
    await isKnownNumberCached('b1', '919876500004');
    jest.setSystemTime(Date.now() + KNOWN_NUMBER_TTL_MS + 1);
    await isKnownNumberCached('b1', '919876500004');
    expect(mockIsKnownNumber).toHaveBeenCalledTimes(2);
  });

  test('a short number goes straight to the lookup and is not cached', async () => {
    mockIsKnownNumber.mockResolvedValue(false);
    await isKnownNumberCached('b1', '12345');
    await isKnownNumberCached('b1', '12345');
    expect(mockIsKnownNumber).toHaveBeenCalledTimes(2);
  });
});
