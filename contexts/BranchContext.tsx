'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { useRouter } from 'next/navigation';
import {
  consumeLegacyBranchIfValid,
  getNamespacedBranchId,
  invalidateStaleNamespacedBranch,
  isBranchStorageKeyForBusiness,
  setNamespacedBranchId,
} from '@/lib/branch-storage';

interface Branch {
  id: string;
  name: string;
  branch_code?: string;
  gstin?: string;
  is_default?: boolean;
  is_active?: boolean;
}

interface BranchContextType {
  currentBranchId: string | 'ALL';
  accessibleBranches: Branch[];
  isAdmin: boolean;
  currentBranch: Branch | null;
  isLoading: boolean;
  setCurrentBranchId: (branchId: string | 'ALL') => void;
  refreshBranches: () => Promise<void>;
}

const BranchContext = createContext<BranchContextType>({
  currentBranchId: 'ALL',
  accessibleBranches: [],
  isAdmin: false,
  currentBranch: null,
  isLoading: true,
  setCurrentBranchId: () => {},
  refreshBranches: async () => {},
});

export const useBranch = () => useContext(BranchContext);

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const { user, business, branches: sessionBranches, permissions, isPrimaryAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const [currentBranchId, setCurrentBranchIdState] = useState<string | 'ALL'>('ALL');
  const [accessibleBranches, setAccessibleBranches] = useState<Branch[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Derive branch state from AuthContext session data (no extra API calls).
  // Branch selection is stored per businessId so switching tenants cannot reuse
  // another business's branch UUID from localStorage.
  const initFromSession = useCallback(() => {
    if (authLoading || !user?.id || !business?.id) {
      if (!authLoading) setIsLoading(false);
      return;
    }

    const businessId = business.id;
    const branchList = (sessionBranches || []).filter((b: Branch) => b.is_active !== false);
    setAccessibleBranches(branchList);

    let adminStatus = isPrimaryAdmin;
    if (!adminStatus && branchList.length === 0) {
      adminStatus = permissions?.settings?.can_view === true;
    }
    if (!adminStatus && branchList.length > 0) {
      adminStatus = false;
    }
    setIsAdmin(adminStatus);

    // Do not validate/migrate against an empty branch list (session still loading) — avoids
    // wiping a valid stored id before branches arrive.
    let stored: string | 'ALL' | null = getNamespacedBranchId(businessId);
    if (branchList.length > 0) {
      invalidateStaleNamespacedBranch(businessId, branchList);
      stored = getNamespacedBranchId(businessId);
      if (!stored) {
        const migrated = consumeLegacyBranchIfValid(businessId, branchList, adminStatus);
        if (migrated) stored = migrated;
      }
    }

    let defaultBranchId: string | 'ALL' = 'ALL';

    if (adminStatus) {
      if (branchList.length === 1) {
        defaultBranchId = branchList[0].id;
      } else {
        if (stored && (stored === 'ALL' || branchList.some((b: Branch) => b.id === stored))) {
          defaultBranchId = stored;
        } else {
          defaultBranchId = 'ALL';
        }
      }
    } else {
      if (branchList.length === 1) {
        defaultBranchId = branchList[0].id;
      } else if (branchList.length > 1) {
        if (stored && branchList.some((b: Branch) => b.id === stored)) {
          defaultBranchId = stored;
        } else {
          defaultBranchId = branchList[0].id;
        }
      } else {
        defaultBranchId = 'ALL';
      }
    }

    if (!adminStatus && defaultBranchId === 'ALL' && branchList.length > 0) {
      defaultBranchId = branchList[0].id;
    }

    setCurrentBranchIdState(defaultBranchId);
    try {
      if (typeof window !== 'undefined') {
        setNamespacedBranchId(businessId, defaultBranchId);
      }
    } catch {
      /* localStorage full — branch still works in-memory */
    }
    setIsLoading(false);
  }, [user?.id, business?.id, sessionBranches, permissions, isPrimaryAdmin, authLoading]);

  const setCurrentBranchId = useCallback(
    (branchId: string | 'ALL') => {
      if (!business?.id) return;

      if (!isAdmin && branchId === 'ALL') {
        if (accessibleBranches.length > 0) {
          branchId = accessibleBranches[0].id;
        } else {
          return;
        }
      }

      if (branchId !== 'ALL' && !accessibleBranches.some((b) => b.id === branchId)) {
        if (!isAdmin && accessibleBranches.length > 0) {
          branchId = accessibleBranches[0].id;
        } else {
          return;
        }
      }

      setCurrentBranchIdState(branchId);
      try {
        if (typeof window !== 'undefined') {
          setNamespacedBranchId(business.id, branchId);
        }
      } catch {
        /* ignore */
      }
      router.refresh();
    },
    [isAdmin, accessibleBranches, router, business?.id]
  );

  useEffect(() => {
    initFromSession();
  }, [initFromSession]);

  // Other tabs: localStorage updates do not fire the same-tab storage event; `storage` fires
  // here when another tab changes branch selection for this business.
  useEffect(() => {
    if (typeof window === 'undefined' || !business?.id) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key && isBranchStorageKeyForBusiness(e.key, business.id)) {
        initFromSession();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [business?.id, initFromSession]);

  const currentBranch =
    currentBranchId === 'ALL' ? null : accessibleBranches.find((b) => b.id === currentBranchId) || null;

  const { refresh: authRefresh } = useAuth();

  return (
    <BranchContext.Provider
      value={{
        currentBranchId,
        accessibleBranches,
        isAdmin,
        currentBranch,
        isLoading,
        setCurrentBranchId,
        refreshBranches: authRefresh,
      }}
    >
      {children}
    </BranchContext.Provider>
  );
}
