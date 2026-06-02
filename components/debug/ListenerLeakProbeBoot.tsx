'use client';

import { useEffect } from 'react';
import { installListenerLeakProbe } from '@/lib/debug/listener-leak-probe';

/**
 * Ensures probe is installed after hydration (primary install runs at module load in app/layout import).
 */
export function ListenerLeakProbeBoot() {
  useEffect(() => {
    installListenerLeakProbe();
  }, []);
  return null;
}
