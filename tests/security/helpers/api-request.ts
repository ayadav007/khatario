import { NextRequest } from 'next/server';
import {
  BUSINESS_A,
  SESSION_VERSION,
  USER_A,
} from '../fixtures/identities';

export interface BuildApiRequestOptions {
  path: string;
  method?: string;
  businessId?: string | null;
  userId?: string | null;
  sessionVersion?: string | null;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

const BASE = 'http://localhost:3000';

export function buildApiRequest(options: BuildApiRequestOptions): NextRequest {
  const url = new URL(options.path, BASE);

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value);
    }
  }

  const headers = new Headers({ 'content-type': 'application/json' });

  if (options.businessId) {
    headers.set('x-authenticated-business-id', options.businessId);
  }
  if (options.userId) {
    headers.set('x-authenticated-user-id', options.userId);
  }
  if (options.sessionVersion !== null) {
    headers.set(
      'x-authenticated-session-version',
      options.sessionVersion ?? SESSION_VERSION,
    );
  }

  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
  };

  if (options.body && options.method !== 'GET') {
    init.body = JSON.stringify(options.body);
  }

  return new NextRequest(url.toString(), init);
}

/** Session for Business A (default authenticated tenant in tests). */
export function buildBusinessARequest(
  path: string,
  overrides: Omit<BuildApiRequestOptions, 'path' | 'businessId' | 'userId'> & {
    claimedBusinessId?: string;
  } = {},
): NextRequest {
  const query = { ...overrides.query };
  if (overrides.claimedBusinessId) {
    query.business_id = overrides.claimedBusinessId;
  }

  const body =
    overrides.body && overrides.claimedBusinessId
      ? { ...overrides.body, business_id: overrides.claimedBusinessId }
      : overrides.body;

  return buildApiRequest({
    path,
    method: overrides.method,
    businessId: BUSINESS_A,
    userId: USER_A,
    query,
    body,
  });
}

export function buildUnauthenticatedRequest(
  path: string,
  query?: Record<string, string>,
): NextRequest {
  return buildApiRequest({
    path,
    businessId: null,
    userId: null,
    sessionVersion: null,
    query,
  });
}
