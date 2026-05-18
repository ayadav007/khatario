'use client';

import { useEffect } from 'react';
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
} from 'lucide-react';
import Link from 'next/link';

function AdminLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { admin, loading, logout } = useAdmin();

  useEffect(() => {
    // Redirect to login if not authenticated (except on login page)
    if (!loading && !admin && pathname !== '/admin/login') {
      router.push('/admin/login');
    }
  }, [admin, loading, pathname, router]);

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  // Show login page without layout
  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  // Redirect if not authenticated
  if (!admin) {
    return null;
  }

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

  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-white flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-gray-800">
          <div className="flex items-center space-x-3">
            <Shield className="w-8 h-8 text-primary-500" />
            <div>
              <h1 className="text-xl font-bold">Khatario</h1>
              <p className="text-xs text-gray-400">Platform Admin</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {navigation.map((item) => {
            // Hide super_admin-only items for non-super admins
            if (item.requiresSuper && admin.role !== 'super_admin') {
              return null;
            }

            const isActive = pathname === item.href;
            const Icon = item.icon;

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* User Info & Logout */}
        <div className="p-4 border-t border-gray-800">
          <div className="mb-3 px-4">
            <p className="text-sm font-medium text-white">{admin.name}</p>
            <p className="text-xs text-gray-400">{admin.email}</p>
            <p className="text-xs text-primary-400 mt-1 uppercase">{admin.role.replace('_', ' ')}</p>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition"
          >
            <LogOut className="w-4 h-4" />
            <span className="font-medium">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminProvider>
      <AdminLayoutContent>{children}</AdminLayoutContent>
    </AdminProvider>
  );
}

