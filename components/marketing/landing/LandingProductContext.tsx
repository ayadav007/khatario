'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  getSignupHref,
  normalizeProductLine,
  type ProductLine,
} from '@/lib/product-lines';

type LandingProductContextValue = {
  productLine: ProductLine;
  setProductLine: (line: ProductLine) => void;
  signupHref: string;
};

const LandingProductContext = createContext<LandingProductContextValue | null>(null);

export function LandingProductProvider({
  initialProductLine,
  children,
}: {
  initialProductLine?: ProductLine;
  children: React.ReactNode;
}) {
  const [productLine, setProductLineState] = useState<ProductLine>(
    () => initialProductLine ?? 'billing',
  );

  const setProductLine = useCallback((line: ProductLine) => {
    setProductLineState(line);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('product', line);
      window.history.replaceState(null, '', url.toString());
    }
  }, []);

  const value = useMemo(
    () => ({
      productLine,
      setProductLine,
      signupHref: getSignupHref(productLine),
    }),
    [productLine, setProductLine],
  );

  return (
    <LandingProductContext.Provider value={value}>{children}</LandingProductContext.Provider>
  );
}

export function useLandingProduct(): LandingProductContextValue {
  const ctx = useContext(LandingProductContext);
  if (!ctx) {
    return {
      productLine: 'billing',
      setProductLine: () => {},
      signupHref: getSignupHref('billing'),
    };
  }
  return ctx;
}

export function readProductLineFromSearchParam(
  value: string | null | undefined,
): ProductLine {
  return normalizeProductLine(value);
}
