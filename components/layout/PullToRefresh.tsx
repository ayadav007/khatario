'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { isCapacitorNative } from '@/lib/capacitor/platform';

const THRESHOLD = 72;   // px to pull before releasing triggers refresh
const MAX_PULL = 100;   // max visual stretch in px

/** Pages where pull-to-refresh should be suppressed (forms, POS, chat). */
function isSuppressedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname.startsWith('/invoices/new') ||
    pathname.startsWith('/purchases/new') ||
    pathname.startsWith('/whatsapp') ||
    pathname.startsWith('/admin')
  );
}

/**
 * Global pull-to-refresh for the Capacitor mobile shell.
 * Renders only on native; desktop gets the browser's own refresh shortcut.
 */
export function PullToRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const startYRef = useRef(0);
  const pullingRef = useRef(false);
  const refreshingRef = useRef(false);

  const triggerRefresh = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    router.refresh();
    // Give the page time to re-fetch, then reset
    setTimeout(() => {
      refreshingRef.current = false;
      setRefreshing(false);
    }, 1500);
  }, [router]);

  useEffect(() => {
    if (!isCapacitorNative()) return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      const scrollTop =
        document.documentElement.scrollTop || document.body.scrollTop;
      if (scrollTop !== 0) return;
      startYRef.current = e.touches[0].clientY;
      pullingRef.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pullingRef.current || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0) {
        pullingRef.current = false;
        setPullY(0);
        return;
      }
      // Rubber-band: resistance increases as you pull further
      setPullY(Math.min(dy * 0.5, MAX_PULL));
    };

    const onTouchEnd = () => {
      if (!pullingRef.current) return;
      pullingRef.current = false;
      const captured = Math.min(
        (document.documentElement.scrollTop === 0
          ? startYRef.current
          : 0),
        MAX_PULL
      );
      // Use the state value via a functional update to read current pullY
      setPullY((current) => {
        if (current >= THRESHOLD) {
          triggerRefresh();
        }
        return 0;
      });
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd);

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [triggerRefresh]);

  // Don't render on web or suppressed pages
  if (!isCapacitorNative()) return null;
  if (isSuppressedPath(pathname)) return null;

  const progress = Math.min(pullY / THRESHOLD, 1);
  const visible = pullY > 4 || refreshing;

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-0 right-0 top-0 z-[70] flex justify-center"
      style={{ transform: `translateY(${refreshing ? 48 : pullY - 16}px)` }}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-black/5">
        <RefreshCw
          className="h-4 w-4 text-primary-600"
          style={{
            transform: `rotate(${progress * 360}deg)`,
            animation: refreshing ? 'spin 0.8s linear infinite' : 'none',
          }}
        />
      </div>
    </div>
  );
}
