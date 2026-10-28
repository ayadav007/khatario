import { NextRequest } from 'next/server';
import {
  actingUserId,
  getBusinessIdFromRequest,
  getUserIdFromRequest,
  resolveCreatedByUserId,
} from '@/lib/auth-helpers';

// Staging QA F-001 / security review Oct 2026: identity comes from the session only. A user or
// business named in the body or query is never used, with or without a session.
function req(sessionUserId?: string, url = 'http://localhost/api/employees') {
  const headers = new Headers();
  if (sessionUserId) headers.set('x-authenticated-user-id', sessionUserId);
  return new NextRequest(url, { method: 'POST', headers });
}

describe('actingUserId', () => {
  it('uses the session user over any user named in the body', () => {
    expect(actingUserId(req('session-user'), 'other-business-owner')).toBe('session-user');
  });

  it('never falls back to a body value without a session', () => {
    expect(actingUserId(req(), '', '  ', 'legacy-user')).toBeNull();
    expect(actingUserId(req(), undefined, null)).toBeNull();
  });
});

describe('resolveCreatedByUserId', () => {
  it('ignores body created_by_user_id and created_by when there is a session', () => {
    expect(resolveCreatedByUserId(req('session-user'), { created_by_user_id: 'x', created_by: 'y' })).toBe('session-user');
  });

  it('returns null without a session whatever the body says', () => {
    expect(resolveCreatedByUserId(req(), { created_by_user_id: 'x', created_by: 'y' })).toBeNull();
    expect(resolveCreatedByUserId(req(), { user_id: 'z' })).toBeNull();
  });
});

describe('getUserIdFromRequest / getBusinessIdFromRequest', () => {
  it('ignore user_id and business_id in the query and body', () => {
    const r = req(undefined, 'http://localhost/api/x?user_id=u1&business_id=b1');
    expect(getUserIdFromRequest(r, { user_id: 'u2', created_by: 'u3' })).toBeNull();
    expect(getBusinessIdFromRequest(r, { business_id: 'b2' })).toBeNull();
  });

  it('read the middleware session headers', () => {
    const headers = new Headers({
      'x-authenticated-user-id': 'session-user',
      'x-authenticated-business-id': 'session-biz',
    });
    const r = new NextRequest('http://localhost/api/x?business_id=other', { headers });
    expect(getUserIdFromRequest(r)).toBe('session-user');
    expect(getBusinessIdFromRequest(r, { business_id: 'other' })).toBe('session-biz');
  });
});
