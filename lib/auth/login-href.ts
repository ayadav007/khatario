/**
 * The Log in link for a page that carries a return path (sign-up's `next`): login's `redirect`, so an existing user
 * who picks Log in instead of signing up lands back where they started. Same-site paths only, like login's own check.
 */
export function loginHrefFor(next: string | null): string {
  if (!next || next === '/dashboard' || !/^\/(?![/\\])[^\s\\]*$/.test(next)) return '/login';
  return `/login?redirect=${encodeURIComponent(next)}`;
}
