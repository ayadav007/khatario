'use client';

import { useMobileBackNavigation } from '@/hooks/useMobileBackNavigation';

/** Mount once in the app shell to handle Android back / mobile swipe-back. */
export function MobileBackNavigation() {
  useMobileBackNavigation();
  return null;
}
