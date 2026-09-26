import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { NextRequest, NextResponse } from 'next/server';

const PLATFORM_ACCESS_COOKIE = 'khatario_platform_session';
const ACCESS_MAX_AGE = 24 * 60 * 60; // 24 hours

// Read at module scope so Next.js Edge middleware inlines these (nested
// process.env lookups inside getSecret() can be undefined on Edge).
const PLATFORM_JWT_SECRET = process.env.PLATFORM_JWT_SECRET;
const APP_JWT_SECRET = process.env.JWT_SECRET;

export interface PlatformSessionPayload extends JWTPayload {
  adminId: string;
  type: 'platform_access';
  sv: number;
}

function getSecret(): Uint8Array {
  const secret = PLATFORM_JWT_SECRET || APP_JWT_SECRET;
  if (!secret) {
    throw new Error('PLATFORM_JWT_SECRET or JWT_SECRET must be set');
  }
  return new TextEncoder().encode(secret);
}

function cookieSecure(): boolean {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  return process.env.NODE_ENV === 'production' && appUrl.startsWith('https://');
}

export async function signPlatformAccessToken(payload: {
  adminId: string;
  sessionVersion: number;
}): Promise<string> {
  return new SignJWT({
    adminId: payload.adminId,
    type: 'platform_access',
    sv: payload.sessionVersion,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_MAX_AGE}s`)
    .sign(getSecret());
}

export async function verifyPlatformAccessToken(
  token: string
): Promise<PlatformSessionPayload | null> {
  if (typeof token !== 'string' || token.length < 10 || !token.includes('.')) {
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const p = payload as PlatformSessionPayload;
    const sv = Number(p.sv);
    if (p.type !== 'platform_access' || typeof p.adminId !== 'string' || !Number.isFinite(sv)) {
      return null;
    }
    return { ...p, sv };
  } catch {
    return null;
  }
}

export function setPlatformSessionCookie(response: NextResponse, token: string): void {
  const secure = cookieSecure();
  response.cookies.set(PLATFORM_ACCESS_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_MAX_AGE,
  });
}

export function clearPlatformSessionCookie(response: NextResponse): void {
  const secure = cookieSecure();
  response.cookies.set(PLATFORM_ACCESS_COOKIE, '', {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/** Verify platform cookie on Edge (middleware). Returns payload or null. */
export async function getPlatformSessionFromRequest(
  request: NextRequest
): Promise<PlatformSessionPayload | null> {
  const token = request.cookies.get(PLATFORM_ACCESS_COOKIE)?.value;
  if (!token) return null;
  return verifyPlatformAccessToken(token);
}

export { PLATFORM_ACCESS_COOKIE };
