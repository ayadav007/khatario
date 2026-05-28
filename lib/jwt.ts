import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { NextRequest, NextResponse } from 'next/server';

const ACCESS_COOKIE = 'khatario_session';
const REFRESH_COOKIE = 'khatario_refresh';
const ACCESS_MAX_AGE = 15 * 60;         // 15 minutes
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

export interface SessionPayload extends JWTPayload {
  userId: string;
  businessId: string;
  type?: 'access' | 'refresh';
  /** Session generation; must match users.auth_session_version */
  sv?: number;
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(payload: {
  userId: string;
  businessId: string;
  sessionVersion: number;
}): Promise<string> {
  return new SignJWT({
    userId: payload.userId,
    businessId: payload.businessId,
    type: 'access',
    sv: payload.sessionVersion,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_MAX_AGE}s`)
    .sign(getSecret());
}

export async function signRefreshToken(payload: {
  userId: string;
  businessId: string;
  sessionVersion: number;
}): Promise<string> {
  return new SignJWT({
    userId: payload.userId,
    businessId: payload.businessId,
    type: 'refresh',
    sv: payload.sessionVersion,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_MAX_AGE}s`)
    .sign(getSecret());
}

/** Backward-compatible alias used by login/signup */
export async function signToken(payload: {
  userId: string;
  businessId: string;
  sessionVersion: number;
}): Promise<string> {
  return signAccessToken(payload);
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  if (typeof token !== 'string' || token.length < 10 || !token.includes('.')) {
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Set both access and refresh cookies.
 */
export function setSessionCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string
): void {
  const secure = process.env.NODE_ENV === 'production';
  response.cookies.set(ACCESS_COOKIE, accessToken, {
    httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: ACCESS_MAX_AGE,
  });
  response.cookies.set(REFRESH_COOKIE, refreshToken, {
    httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: REFRESH_MAX_AGE,
  });
}

/** Backward-compatible single-cookie setter */
export function setSessionCookie(response: NextResponse, token: string): void {
  const secure = process.env.NODE_ENV === 'production';
  response.cookies.set(ACCESS_COOKIE, token, {
    httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: ACCESS_MAX_AGE,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  const secure = process.env.NODE_ENV === 'production';
  response.cookies.set(ACCESS_COOKIE, '', {
    httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0,
  });
  response.cookies.set(REFRESH_COOKIE, '', {
    httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0,
  });
}

/**
 * Read and verify session from request.
 * Tries access token first, then refresh token.
 * Returns payload + which token was valid.
 */
export async function getSessionFromRequest(
  request: NextRequest
): Promise<SessionPayload | null> {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  if (accessToken) {
    const payload = await verifyToken(accessToken);
    if (payload) return payload;
  }
  // Access token expired — try refresh token (middleware will issue new access token)
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    const payload = await verifyToken(refreshToken);
    if (payload && payload.type === 'refresh') {
      return payload;
    }
  }
  return null;
}

/**
 * Check if the access token is expired but refresh token is valid.
 * Used by middleware to decide when to rotate.
 */
export async function shouldRotateTokens(
  request: NextRequest
): Promise<{ rotate: boolean; payload: SessionPayload | null }> {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  if (accessToken) {
    const payload = await verifyToken(accessToken);
    if (payload) return { rotate: false, payload };
  }
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    const payload = await verifyToken(refreshToken);
    if (payload && payload.type === 'refresh') {
      return { rotate: true, payload };
    }
  }
  return { rotate: false, payload: null };
}

export { ACCESS_COOKIE, REFRESH_COOKIE };
