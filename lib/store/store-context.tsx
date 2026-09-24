'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { StoreBusinessContext, StoreBranch } from './resolve-store';
import { sanitizeStoreTheme } from './store-theme';

export interface StoreCartItem {
  itemId: string;
  variantId?: string;
  name: string;
  variantName?: string;
  price: number;
  quantity: number;
  imageUrl?: string;
  unit: string;
  maxStock: number;
  taxRate?: number;
}

export type StoreShopper = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  last_address?: string | null;
  last_pincode?: string | null;
};

interface StoreContextValue {
  store: StoreBusinessContext | null;
  branches: StoreBranch[];
  selectedBranchId: string | null;
  selectBranch: (branchId: string) => void;
  loading: boolean;
  error: string | null;
  customer: StoreShopper | null;
  refreshCustomer: () => Promise<StoreShopper | null>;
  signOutCustomer: () => Promise<void>;

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

function storageKey(subdomain: string) {
  return `khatario-store-cart:${subdomain}`;
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
  const [cartReady, setCartReady] = useState(false);
  const [customer, setCustomer] = useState<StoreShopper | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(subdomain));
      if (raw) setCart(JSON.parse(raw) as StoreCartItem[]);
    } catch {
      /* ignore */
    }
    setCartReady(true);
  }, [subdomain]);

  useEffect(() => {
    if (!cartReady) return;
    try {
      localStorage.setItem(storageKey(subdomain), JSON.stringify(cart));
    } catch {
      /* ignore */
    }
  }, [cart, cartReady, subdomain]);

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

  const refreshCustomer = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/store/${encodeURIComponent(subdomain)}/account`, {
        credentials: 'include',
      });
      if (!res.ok) {
        setCustomer(null);
        return null;
      }
      const data = await res.json();
      const next = (data.customer as StoreShopper) ?? null;
      setCustomer(next);
      return next;
    } catch {
      setCustomer(null);
      return null;
    }
  }, [subdomain]);

  useEffect(() => {
    void refreshCustomer();
  }, [refreshCustomer]);

  const signOutCustomer = useCallback(async () => {
    await fetch(`/api/public/store/${encodeURIComponent(subdomain)}/account`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
    setCustomer(null);
  }, [subdomain]);

  const cartTotal = cart.reduce((sum, c) => sum + c.price * c.quantity, 0);
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);
  const accent = sanitizeStoreTheme(store?.store_theme).accent;

  return (
    <StoreContext.Provider
      value={{
        store,
        branches,
        selectedBranchId,
        selectBranch,
        loading,
        error,
        customer,
        refreshCustomer,
        signOutCustomer,
        cart,
        addToCart,
        updateCartQuantity,
        removeFromCart,
        clearCart,
        cartTotal,
        cartCount,
      }}
    >
      <div style={{ ['--store-accent' as string]: accent }}>{children}</div>
    </StoreContext.Provider>
  );
}
