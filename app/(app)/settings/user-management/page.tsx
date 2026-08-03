'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { Shield } from 'lucide-react';

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
    <SettingsPageShell
      title="User Management"
      description="Enable and configure user roles & permissions"
      icon={Shield}
    >
      <Card padding="lg">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
              <Shield className="h-6 w-6 text-text-secondary" />
            </div>
            <div>
              <h3 className="settings-section-title mb-1">User Roles & Permissions</h3>
              <p className="type-body-sm mb-3 text-text-secondary">
                When enabled, you can assign roles and fine-grained permissions to team members.
                Disable this if you prefer a simpler single-user setup.
              </p>
              <p className="type-body-sm text-text-muted">
                After enabling, configure roles under{' '}
                <strong className="text-text-primary">Roles & Permissions</strong> and assign users
                under <strong className="text-text-primary">Manage Users</strong>.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleUserManagement}
            disabled={loading}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
              userManagementEnabled ? 'bg-primary-600' : 'bg-gray-200 dark:bg-slate-600'
            } ${loading ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                userManagementEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </Card>
    </SettingsPageShell>
  );
}
