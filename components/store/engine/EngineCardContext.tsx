'use client';

import { createContext, useContext } from 'react';
import type { EngineCardLook } from '@/lib/store/engine/card-look';

/** Set by EngineShell so product cards follow the engine preset (productCardLook). Null off the engine. */
export const EngineCardContext = createContext<EngineCardLook | null>(null);

export function useEngineCardLook(): EngineCardLook | null {
  return useContext(EngineCardContext);
}
