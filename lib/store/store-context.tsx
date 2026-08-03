'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { StoreBusinessContext, StoreBranch } from './resolve-store';

interface StoreCartItem {
  itemId: string;
  variantId?: string;
  name: string;
  variantName?: string;
  price: number;
  quantity: number;
  imageUrl?: string;
  unit: string;
  maxStock: number;
}

interface StoreContextValue {
  store: StoreBusinessContext | null;
  branches: StoreBranch[];
  selectedBranchId: string | null;
  selectBranch: (branchId: string) => void;
  loading: boolean;
  error: string | null;

  cart: StoreCartItem[];
  addToCart: (item: StoreCartItem) => void;
  updateCartQuantity: (itemId: string, variantId: string | undefined, quantity: number) => void;
  removeFromCart: (itemId: string, variantId: string | undefined) => void;
  clearCart: () => void;
  cartTotal: number;
  cartCount: number;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

function cartKey(itemId: string, variantId?: string) {
  return variantId ? `${itemId}::${variantId}` : itemId;
}

export function StoreProvider({
  subdomain,
  children,
}: {
  subdomain: string;
  children: ReactNode;
}) {
  const [store, setStore] = useState<StoreBusinessContext | null>(null);
  const [branches, setBranches] = useState<StoreBranch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<StoreCartItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/public/store/${encodeURIComponent(subdomain)}`);
        if (!res.ok) {
          setError('Store not found');
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setStore(data.store);
          setBranches(data.branches ?? []);
          if (data.branches?.length === 1) {
            setSelectedBranchId(data.branches[0].id);
          }
        }
      } catch {
        if (!cancelled) setError('Failed to load store');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [subdomain]);

  const selectBranch = useCallback((branchId: string) => {
    setSelectedBranchId(branchId);
  }, []);

  const addToCart = useCallback((item: StoreCartItem) => {
    setCart((prev) => {
      const key = cartKey(item.itemId, item.variantId);
      const existing = prev.find(
        (c) => cartKey(c.itemId, c.variantId) === key,
      );
      if (existing) {
        return prev.map((c) =>
          cartKey(c.itemId, c.variantId) === key
            ? { ...c, quantity: Math.min(c.quantity + item.quantity, c.maxStock) }
            : c,
        );
      }
      return [...prev, item];
    });
  }, []);

  const updateCartQuantity = useCallback(
    (itemId: string, variantId: string | undefined, quantity: number) => {
      const key = cartKey(itemId, variantId);
      if (quantity <= 0) {
        setCart((prev) =>
          prev.filter((c) => cartKey(c.itemId, c.variantId) !== key),
        );
      } else {
        setCart((prev) =>
          prev.map((c) =>
            cartKey(c.itemId, c.variantId) === key
              ? { ...c, quantity: Math.min(quantity, c.maxStock) }
              : c,
          ),
        );
      }
    },
    [],
  );

  const removeFromCart = useCallback(
    (itemId: string, variantId: string | undefined) => {
      const key = cartKey(itemId, variantId);
      setCart((prev) =>
        prev.filter((c) => cartKey(c.itemId, c.variantId) !== key),
      );
    },
    [],
  );

  const clearCart = useCallback(() => setCart([]), []);

  const cartTotal = cart.reduce((sum, c) => sum + c.price * c.quantity, 0);
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);

  return (
    <StoreContext.Provider
      value={{
        store,
        branches,
        selectedBranchId,
        selectBranch,
        loading,
        error,
        cart,
        addToCart,
        updateCartQuantity,
        removeFromCart,
        clearCart,
        cartTotal,
        cartCount,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}
