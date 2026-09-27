import { nationalPhone10, hashPlatformOtp, otpDebugAllowedFor } from '@/lib/platform-public-otp-core';

describe('otpDebugAllowedFor', () => {
  const staging = { NEXT_PUBLIC_APP_URL: 'https://staging.khatario.com', OTP_DEBUG_PHONES: '+91 77698 70606, 9000000001' };

  it('allows only listed phones on staging', () => {
    expect(otpDebugAllowedFor('7769870606', staging)).toBe(true);
    expect(otpDebugAllowedFor('+919000000001', staging)).toBe(true);
    expect(otpDebugAllowedFor('9876543210', staging)).toBe(false);
  });

  it('is off on staging when no phones are listed', () => {
    expect(otpDebugAllowedFor('7769870606', { NEXT_PUBLIC_APP_URL: 'https://staging.khatario.com' })).toBe(false);
  });

  it('is never on for the production host, even with debug flags', () => {
    for (const url of ['https://khatario.com', 'https://www.khatario.com', 'https://app.khatario.com']) {
      expect(
        otpDebugAllowedFor('7769870606', { NEXT_PUBLIC_APP_URL: url, SIGNUP_DEBUG: 'true', OTP_DEBUG_PHONES: '*' }),
      ).toBe(false);
    }
  });

  it('needs SIGNUP_DEBUG outside staging; "*" allows any phone', () => {
    const local = { NEXT_PUBLIC_APP_URL: 'http://localhost:3000', OTP_DEBUG_PHONES: '*' };
    expect(otpDebugAllowedFor('9876543210', local)).toBe(false);
    expect(otpDebugAllowedFor('9876543210', { ...local, SIGNUP_DEBUG: 'true' })).toBe(true);
  });
});

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
