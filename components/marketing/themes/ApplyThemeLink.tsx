'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { LOCAL_SESSION_COOKIE } from '@/lib/auth/local-session-cookie';
import { applyHref } from '@/lib/store/engine/theme-store';

/**
 * Apply theme: a signed-in merchant goes to the app's apply page; a visitor signs up first and comes back to it.
 * Signed in is read from the app's own session marker cookie after mount (the page itself reads no business data).
 */
export function ApplyThemeLink({ slug, className, children }: { slug: string; className?: string; children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    setSignedIn(document.cookie.split(';').some((c) => c.trim().startsWith(`${LOCAL_SESSION_COOKIE}=1`)));
  }, []);
  return (
    <Link href={applyHref(slug, signedIn)} className={className}>
      {children}
    </Link>
  );
}
