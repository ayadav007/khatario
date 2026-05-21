'use client';

import { useEffect, useState } from 'react';

/** Responsive SVG plot height for dashboard charts (mobile-dense). */
export function useDashboardChartHeight(mobile = 150, desktop = 240) {
  const [height, setHeight] = useState(desktop);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const apply = () => setHeight(mq.matches ? mobile : desktop);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [mobile, desktop]);

  return height;
}
