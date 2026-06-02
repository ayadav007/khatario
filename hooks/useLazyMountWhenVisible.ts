'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Defer mounting heavy children until the placeholder enters (or nears) the viewport.
 * Reduces idle work for below-the-fold dashboard charts/widgets.
 */
export function useLazyMountWhenVisible(rootMargin = '120px') {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted) return;
    const el = ref.current;
    if (!el) return;

    if (typeof IntersectionObserver === 'undefined') {
      setMounted(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setMounted(true);
        observer.disconnect();
      },
      { rootMargin }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [mounted, rootMargin]);

  return { ref, mounted };
}
