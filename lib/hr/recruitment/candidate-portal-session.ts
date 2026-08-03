import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export const CANDIDATE_PORTAL_COOKIE = 'khatario_candidate_portal';
const SESSION_HOURS = 24 * 7;

export type CandidatePortalSession = {
  session_token: string;
  business_id: string;
  candidate_id: string;
  candidate_name: string;
  email: string;
  expires_at: Date;
};

export function generateCandidateOtp(): string {
  return String(crypto.randomInt(100000, 999999));
}

export async function createCandidatePortalSession(
  businessId: string,
  candidateId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + SESSION_HOURS);

  await query(
    `INSERT INTO candidate_portal_sessions (session_token, business_id, candidate_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [token, businessId, candidateId, expiresAt.toISOString()],
  );

  return { token, expiresAt };
}

export async function resolveCandidatePortalSession(
  token: string | null | undefined,
): Promise<CandidatePortalSession | null> {
  if (!token?.trim()) return null;

  const row = await queryOne<{
    session_token: string;
    business_id: string;
    candidate_id: string;
    expires_at: string;
    full_name: string;
    email: string;
  }>(
    `SELECT s.session_token, s.business_id, s.candidate_id, s.expires_at,
            c.full_name, c.email
     FROM candidate_portal_sessions s
     INNER JOIN recruitment_candidates c ON c.id = s.candidate_id
     WHERE s.session_token = $1 AND s.expires_at > CURRENT_TIMESTAMP`,
    [token.trim()],
  );

  if (!row) return null;

  return {
    session_token: row.session_token,
    business_id: row.business_id,
    candidate_id: row.candidate_id,
    candidate_name: row.full_name,
    email: row.email,
    expires_at: new Date(row.expires_at),
  };
}

export function getCandidatePortalTokenFromRequest(request: NextRequest): string | null {
  const header = request.headers.get('x-candidate-portal-session');
  if (header?.trim()) return header.trim();
  return request.cookies.get(CANDIDATE_PORTAL_COOKIE)?.value ?? null;
}

export async function getCandidatePortalSessionFromRequest(
  request: NextRequest,
): Promise<CandidatePortalSession | null> {
  return resolveCandidatePortalSession(getCandidatePortalTokenFromRequest(request));
}

export function setCandidatePortalCookie(response: NextResponse, token: string, expiresAt: Date): void {
  response.cookies.set(CANDIDATE_PORTAL_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearCandidatePortalCookie(response: NextResponse): void {
  response.cookies.set(CANDIDATE_PORTAL_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export async function readCandidatePortalCookieSession(): Promise<CandidatePortalSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CANDIDATE_PORTAL_COOKIE)?.value;
  return resolveCandidatePortalSession(token);
}
