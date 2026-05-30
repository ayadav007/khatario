'use client';

import { useEffect, useState } from 'react';

/** True after the first client effect — use to skip SSR/client mismatches for browser-only UI. */
export function useClientMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
