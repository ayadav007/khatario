'use client';

import { useEffect } from 'react';
import { installListenerLeakProbe } from '@/lib/debug/listener-leak-probe';

/** Loads listener instrumentation when localStorage flag is set. */
export function ListenerLeakProbeBoot() {
  useEffect(() => {
    installListenerLeakProbe();
  }, []);
  return null;
}
