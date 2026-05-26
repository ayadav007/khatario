/** Non-httpOnly hint so middleware can allow offline app-shell navigation without JWT. */
export const LOCAL_SESSION_COOKIE = 'khatario_local_session';

const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

export function markLocalSessionCookie(active: boolean): void {
  if (typeof document === 'undefined') return;
  if (active) {
    document.cookie = `${LOCAL_SESSION_COOKIE}=1; path=/; max-age=${MAX_AGE_SEC}; SameSite=Lax`;
  } else {
    document.cookie = `${LOCAL_SESSION_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  }
}
