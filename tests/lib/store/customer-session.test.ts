import { storePhoneDigits, storePhonesMatch } from '@/lib/store/store-phone';

describe('store phone identity', () => {
  it('normalizes to last 10 digits', () => {
    expect(storePhoneDigits('+91 98765 43210')).toBe('9876543210');
    expect(storePhoneDigits('09876543210')).toBe('9876543210');
  });

  it('matches checkout phone to verified customer', () => {
    expect(storePhonesMatch('9876543210', '+919876543210')).toBe(true);
    expect(storePhonesMatch('9876543210', '9999999999')).toBe(false);
    expect(storePhonesMatch('123', '123')).toBe(false);
  });
});
