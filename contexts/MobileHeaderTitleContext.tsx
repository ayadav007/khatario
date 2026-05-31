'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type MobileHeaderTitleContextValue = {
  /** When set, shown in the mobile top bar center instead of route / business name */
  overrideTitle: string | null;
  setOverrideTitle: (title: string | null) => void;
  /** Optional icon/button row before bell + quick settings on mobile (< lg) */
  rightAccessory: React.ReactNode;
  setRightAccessory: (node: React.ReactNode) => void;
};

const MobileHeaderTitleContext = createContext<MobileHeaderTitleContextValue | undefined>(
  undefined
);

export function MobileHeaderTitleProvider({ children }: { children: React.ReactNode }) {
  const [overrideTitle, setOverrideTitle] = useState<string | null>(null);
  const [rightAccessory, setRightAccessoryState] = useState<React.ReactNode>(null);
  const setRightAccessory = useCallback((node: React.ReactNode) => {
    setRightAccessoryState(node ?? null);
  }, []);

  const value = useMemo(
    () => ({
      overrideTitle,
      setOverrideTitle,
      rightAccessory,
      setRightAccessory,
    }),
    [overrideTitle, rightAccessory, setRightAccessory]
  );
  return (
    <MobileHeaderTitleContext.Provider value={value}>{children}</MobileHeaderTitleContext.Provider>
  );
}

export function useMobileHeaderTitleContext(): MobileHeaderTitleContextValue | undefined {
  return useContext(MobileHeaderTitleContext);
}

/**
 * Sets a temporary title for the global mobile header (e.g. party name on detail).
 * Clears when the component unmounts. Updates when `title` changes without flashing to route title.
 */
export function useMobileHeaderTitleOverride(title: string | null | undefined) {
  const setOverrideTitle = useContext(MobileHeaderTitleContext)?.setOverrideTitle;
  useEffect(() => {
    if (!setOverrideTitle) return;
    setOverrideTitle(title?.trim() || null);
  }, [setOverrideTitle, title]);

  useEffect(() => {
    return () => {
      setOverrideTitle?.(null);
    };
  }, [setOverrideTitle]);
}

/**
 * Renders content in the mobile top bar beside notifications (cleared on unmount).
 * Pass `null` when the slot should be empty.
 */
export function useMobileHeaderRightAccessory(node: React.ReactNode | null | undefined) {
  const setRightAccessory = useContext(MobileHeaderTitleContext)?.setRightAccessory;
  useEffect(() => {
    if (!setRightAccessory) return;
    setRightAccessory(node ?? null);
    return () => {
      setRightAccessory(null);
    };
  }, [setRightAccessory, node]);
}
