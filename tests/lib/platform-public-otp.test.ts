import { nationalPhone10, hashPlatformOtp } from '@/lib/platform-public-otp-core';

describe('platform public OTP', () => {
  it('takes the last 10 digits', () => {
    expect(nationalPhone10('+91 98765 43210')).toBe('9876543210');
    expect(nationalPhone10('98')).toBeNull();
  });

  it('hashes codes deterministically', () => {
    const pepper = 'test-secret';
    expect(hashPlatformOtp('signup', '9876543210', '123456', pepper)).toBe(
      hashPlatformOtp('signup', '9876543210', '123456', pepper),
    );
    expect(hashPlatformOtp('signup', '9876543210', '123456', pepper)).not.toBe(
      hashPlatformOtp('password_reset_wa', '9876543210', '123456', pepper),
    );
    expect(hashPlatformOtp('password_reset_wa', '9876543210', '123456', pepper)).not.toBe(
      hashPlatformOtp('password_reset_email', '9876543210', '123456', pepper),
    );
  });
});
