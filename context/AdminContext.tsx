'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

interface PlatformAdmin {
  id: string;
  name: string;
  email: string;
  role: 'super_admin' | 'admin' | 'support' | 'viewer';
  permissions: Record<string, boolean>;
}

interface AdminContextType {
  admin: PlatformAdmin | null;
  loading: boolean;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
  isMinimumRole: (role: string) => boolean;
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);

const ROLE_HIERARCHY = ['viewer', 'support', 'admin', 'super_admin'];

export function AdminProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [admin, setAdmin] = useState<PlatformAdmin | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/auth/me', { credentials: 'include' });
        if (!res.ok) {
          if (!cancelled) {
            setAdmin(null);
            localStorage.removeItem('platform_admin');
          }
          return;
        }
        const data = await res.json();
        if (!cancelled && data.admin) {
          setAdmin(data.admin);
          localStorage.setItem('platform_admin', JSON.stringify(data.admin));
        }
      } catch {
        if (!cancelled) setAdmin(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    try {
      await fetch('/api/admin/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      /* still clear local state */
    }
    localStorage.removeItem('platform_admin');
    setAdmin(null);
    router.push('/admin/login');
  }

  function hasPermission(permission: string): boolean {
    return admin?.permissions?.[permission] === true;
  }

  function isMinimumRole(role: string): boolean {
    if (!admin) return false;
    const adminRoleLevel = ROLE_HIERARCHY.indexOf(admin.role);
    const minRoleLevel = ROLE_HIERARCHY.indexOf(role);
    return adminRoleLevel >= minRoleLevel;
  }

  return (
    <AdminContext.Provider value={{ admin, loading, logout, hasPermission, isMinimumRole }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const context = useContext(AdminContext);
  if (context === undefined) {
    throw new Error('useAdmin must be used within AdminProvider');
  }
  return context;
}

