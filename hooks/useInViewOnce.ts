'use client';

import { useEffect, useRef, useState } from 'react';

type UseInViewOnceOptions = {
  threshold?: number;
  rootMargin?: string;
};

export function useInViewOnce(options: UseInViewOnceOptions = {}) {
  const ref = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      {
        threshold: options.threshold ?? 0.12,
        rootMargin: options.rootMargin ?? '0px 0px -48px 0px',
      },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, options.rootMargin, options.threshold]);

  return { ref, inView };
}
