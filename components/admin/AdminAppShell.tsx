'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AdminProvider, useAdmin } from '@/context/AdminContext';
import {
  LayoutDashboard,
  Building2,
  CreditCard,
  Package,
  Users,
  Settings,
  LogOut,
  Shield,
  FileText,
  Hash,
  Calendar,
  BarChart3,
  CircleDollarSign,
  Menu,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { AdminPwaChrome } from '@/components/admin/AdminPwaChrome';

const navigation = [
  { name: 'Overview', href: '/admin', icon: LayoutDashboard },
  { name: 'Businesses', href: '/admin/businesses', icon: Building2 },
  { name: 'Subscriptions', href: '/admin/subscriptions', icon: CreditCard },
  { name: 'Billing', href: '/admin/billing', icon: CircleDollarSign },
  { name: 'Plans', href: '/admin/plans', icon: Package },
  { name: 'Reports', href: '/admin/reports', icon: BarChart3 },
  { name: 'Bookings', href: '/admin/bookings', icon: Calendar },
  { name: 'Platform Users', href: '/admin/users', icon: Users, requiresSuper: true },
  { name: 'PBAC Policies', href: '/admin/policies', icon: Shield },
  { name: 'HSN/SAC Codes', href: '/admin/hsn-codes', icon: Hash },
  { name: 'Logs', href: '/admin/logs', icon: FileText },
  { name: 'Settings', href: '/admin/settings', icon: Settings },
];

function AdminNavLinks({
  onNavigate,
  role,
  pathname,
}: {
  onNavigate?: () => void;
  role: string;
  pathname: string;
}) {
  return (
    <nav className="flex-1 space-y-1 p-4">
      {navigation.map((item) => {
        if (item.requiresSuper && role !== 'super_admin') return null;
        const isActive = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.name}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center space-x-3 rounded-lg px-4 py-3 transition ${
              isActive
                ? 'bg-primary-600 text-white'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'
            }`}
          >
            <Icon className="h-5 w-5" />
            <span className="font-medium">{item.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function AdminLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { admin, loading, logout } = useAdmin();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading && !admin && pathname !== '/admin/login') {
      router.push('/admin/login');
    }
  }, [admin, loading, pathname, router]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary-600" />
      </div>
    );
  }

  if (pathname === '/admin/login') {
    return (
      <>
        <div className="fixed left-0 right-0 top-0 z-20 border-b border-gray-800 bg-gray-900 px-3 py-2">
          <AdminPwaChrome />
        </div>
        <div className="pt-14">{children}</div>
      </>
    );
  }

  if (!admin) {
    return null;
  }

  const sidebar = (
    <>
      <div className="border-b border-gray-800 p-6">
        <div className="flex items-center space-x-3">
          <Shield className="h-8 w-8 text-primary-500" />
          <div>
            <h1 className="text-xl font-bold">Khatario</h1>
            <p className="text-xs text-gray-400">Platform Admin</p>
          </div>
        </div>
      </div>
      <AdminNavLinks role={admin.role} pathname={pathname} onNavigate={() => setMenuOpen(false)} />
      <div className="border-t border-gray-800 p-4">
        <div className="mb-3 px-4">
          <p className="text-sm font-medium text-white">{admin.name}</p>
          <p className="text-xs text-gray-400">{admin.email}</p>
          <p className="mt-1 text-xs uppercase text-primary-400">{admin.role.replace('_', ' ')}</p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="flex w-full items-center space-x-2 rounded-lg bg-red-600 px-4 py-2 transition hover:bg-red-700"
        >
          <LogOut className="h-4 w-4" />
          <span className="font-medium">Logout</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-gray-100">
      <aside className="hidden w-64 flex-col bg-gray-900 text-white md:flex">{sidebar}</aside>

      {menuOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="relative z-50 flex h-full w-64 flex-col bg-gray-900 text-white">{sidebar}</aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-gray-200 bg-gray-900 px-3 py-2 text-white md:px-4">
          <button
            type="button"
            className="rounded-md p-2 hover:bg-gray-800 md:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <AdminPwaChrome />
        </header>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

export function AdminAppShell({ children }: { children: React.ReactNode }) {
  return (
    <AdminProvider>
      <AdminLayoutContent>{children}</AdminLayoutContent>
    </AdminProvider>
  );
}
