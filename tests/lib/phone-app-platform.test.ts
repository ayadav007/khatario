import { isInsidePhoneApp, PHONE_APP_USER_AGENT_MARK } from '@/lib/capacitor/platform';

describe('isInsidePhoneApp', () => {
  it('spots the phone app web view by its user-agent mark', () => {
    expect(isInsidePhoneApp(`Mozilla/5.0 (Linux; Android 14; wv) Chrome/130 Mobile Safari/537.36 ${PHONE_APP_USER_AGENT_MARK}`)).toBe(true);
  });

  it('leaves ordinary browsers alone', () => {
    expect(isInsidePhoneApp('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36')).toBe(false);
    expect(isInsidePhoneApp('')).toBe(false);
  });
});
