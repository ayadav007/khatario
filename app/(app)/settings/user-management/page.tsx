'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import Link from 'next/link';
import { ChevronRight, Shield, Users } from 'lucide-react';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

export default function UserManagementPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [userManagementEnabled, setUserManagementEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (business?.id) {
      fetchSettings();
    }
  }, [business?.id]);

  const fetchSettings = async () => {
    try {
      const res = await fetch(`/api/settings/user-management?business_id=${business?.id}`);
      if (res.ok) {
        const data = await res.json();
        setUserManagementEnabled(data.settings?.user_management_enabled || false);
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    }
  };

  const toggleUserManagement = async () => {
    if (!business?.id || !user?.id) return;

    setLoading(true);
    try {
      const res = await fetch('/api/settings/user-management', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          user_management_enabled: !userManagementEnabled,
          updated_by_user_id: user.id
        }),
      });

      if (res.ok) {
        setUserManagementEnabled(!userManagementEnabled);
        toast.success(`User Management ${!userManagementEnabled ? 'enabled' : 'disabled'} successfully`);
      } else {
        const data = await res.json();
        toast.error(`Failed to update settings: ${data.error}`);
      }
    } catch (error) {
      console.error('Failed to toggle user management:', error);
      toast.error('Failed to update settings');
    } finally {
      setLoading(false);
    }
  };

  return (
      <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Link href="/settings" className="hover:text-primary-600 transition">Settings</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-text-muted">Users & Access</span>
          <ChevronRight className="w-4 h-4" />
          <span className="text-text-primary font-medium">User Management</span>
        </div>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-3 bg-pink-100 rounded-xl">
            <Shield className="w-6 h-6 text-pink-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">User Management</h1>
            <p className="text-sm text-text-secondary">Enable and configure user roles & permissions</p>
          </div>
        </div>

        {/* User Management Toggle */}
        <Card padding="lg">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-slate-100 rounded-lg">
                <Shield className="w-6 h-6 text-primary-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-text-primary mb-1">
                  User Roles & Permissions
                </h3>
                <p className="text-sm text-text-secondary mb-3">
                  Add team members and give them limited control with role-based permissions
                </p>
                <div className="space-y-2 text-sm text-text-secondary">
                  <p>• Create multiple users (Sales, Accountant, Inventory Manager)</p>
                  <p>• Set individual passwords for each user</p>
                  <p>• Define granular permissions (View, Add, Modify, Delete, Share)</p>
                  <p>• Track all user activities</p>
                </div>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={userManagementEnabled}
                onChange={toggleUserManagement}
                disabled={loading}
                className="sr-only peer"
              />
              <div className="w-14 h-8 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-6 after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-surface dark:bg-slate-900/70 after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-primary-500"></div>
            </label>
          </div>
        </Card>

        {/* User Management UI */}
        {userManagementEnabled ? (
          <div className="grid grid-cols-2 gap-4">
            <Link href="/settings/users">
              <Card padding="md" className="hover:shadow-md transition cursor-pointer">
                <div className="flex items-center gap-3">
                  <Users className="w-8 h-8 text-primary-600" />
                  <div>
                    <h4 className="font-semibold text-text-primary">Manage Users</h4>
                    <p className="text-sm text-text-secondary">Add, edit, or remove team members</p>
                  </div>
                </div>
              </Card>
            </Link>

            <Link href="/settings/roles">
              <Card padding="md" className="hover:shadow-md transition cursor-pointer">
                <div className="flex items-center gap-3">
                  <Shield className="w-8 h-8 text-purple-600" />
                  <div>
                    <h4 className="font-semibold text-text-primary">Manage Roles</h4>
                    <p className="text-sm text-text-secondary">Configure role permissions</p>
                  </div>
                </div>
              </Card>
            </Link>
          </div>
        ) : (
          <Card padding="lg">
            <div className="text-center py-8">
              <p className="text-text-secondary">
                Enable User Management to add team members and manage permissions
              </p>
            </div>
          </Card>
        )}
      </div>
    
  );
}

