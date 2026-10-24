'use client';

import { createContext, useContext, type ReactNode } from 'react';

const MarketingEditingContext = createContext(false);

/** True inside the Site Builder canvas: entrance animations and auto-rotation are turned off there. */
export function MarketingEditingProvider({ editing, children }: { editing: boolean; children: ReactNode }) {
  return <MarketingEditingContext.Provider value={editing}>{children}</MarketingEditingContext.Provider>;
}

export function useMarketingEditing(): boolean {
  return useContext(MarketingEditingContext);
}
