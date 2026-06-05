'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { registerShellNavigate } from '@/lib/navigation/app-shell-navigate';

/** Wires imperative shell navigation to Next.js router.push. */
export function ShellNavigationBridge() {
  const router = useRouter();

  useEffect(() => {
    registerShellNavigate((href) => router.push(href));
    return () => registerShellNavigate(null);
  }, [router]);

  return null;
}
