import { NextRequest } from 'next/server';
import { actingUserId, resolveCreatedByUserId } from '@/lib/auth-helpers';

// Staging QA F-001: a signed-in caller must not act as another user by naming them in the body.
function req(sessionUserId?: string, url = 'http://localhost/api/employees') {
  const headers = new Headers();
  if (sessionUserId) headers.set('x-authenticated-user-id', sessionUserId);
  return new NextRequest(url, { method: 'POST', headers });
}

describe('actingUserId', () => {
  it('uses the session user over any user named in the body', () => {
    expect(actingUserId(req('session-user'), 'other-business-owner')).toBe('session-user');
  });

  it('falls back to the first non-empty legacy value only without a session', () => {
    expect(actingUserId(req(), '', '  ', 'legacy-user')).toBe('legacy-user');
    expect(actingUserId(req(), undefined, null)).toBeNull();
  });
});

describe('resolveCreatedByUserId', () => {
  it('ignores body created_by_user_id and created_by when there is a session', () => {
    expect(resolveCreatedByUserId(req('session-user'), { created_by_user_id: 'x', created_by: 'y' })).toBe('session-user');
  });

  it('keeps the legacy body order without a session', () => {
    expect(resolveCreatedByUserId(req(), { created_by_user_id: 'x', created_by: 'y' })).toBe('x');
    expect(resolveCreatedByUserId(req(), { created_by: 'y' })).toBe('y');
    expect(resolveCreatedByUserId(req(), { user_id: 'z' })).toBe('z');
  });
});
