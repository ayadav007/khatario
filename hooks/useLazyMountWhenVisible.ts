'use client';

import { useEffect, useState } from 'react';

/**
 * Defer mounting heavy children until the placeholder enters (or nears) the viewport.
 * Reduces idle work for below-the-fold dashboard charts/widgets.
 */
export function useLazyMountWhenVisible(rootMargin = '120px') {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted || !node) return;

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

    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted, node, rootMargin]);

  return { ref: setNode, mounted };
}
