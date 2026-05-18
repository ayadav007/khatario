'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Plus, Edit, Trash2, Loader2, Shield, CheckSquare } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import Link from 'next/link';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

interface Role {
  id: string;
  role_name: string;
  role_key: string;
  description?: string;
}

interface Permission {
  id: string;
  permission_key: string;
  permission_name: string;
  module_key: string;
  module_name: string;
}

export default function RolesPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [rolePermissions, setRolePermissions] = useState<Record<string, boolean>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');

  useEffect(() => {
    if (business?.id) {
      fetchRoles();
      fetchPermissions();
    }
  }, [business?.id]);

  useEffect(() => {
    if (selectedRole && business?.id) {
      fetchRolePermissions();
    }
  }, [selectedRole, business?.id]);

  const fetchRoles = async () => {
    if (!business?.id || !user?.id) return;

    try {
      const res = await fetch(`/api/settings/roles?business_id=${business.id}&user_id=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setRoles(data.roles || []);
      } else {
        const errorData = await res.json().catch(() => ({}));
        console.error('Error fetching roles:', errorData.error || 'Unknown error');
        // Still set empty array to show "no roles" message
        setRoles([]);
      }
    } catch (error) {
      console.error('Error fetching roles:', error);
      setRoles([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchPermissions = async () => {
    try {
      const res = await fetch('/api/permissions');
      if (res.ok) {
        const data = await res.json();
        setPermissions(data.permissions || []);
        if (!data.permissions || data.permissions.length === 0) {
          console.warn('No permissions found. Make sure migration 059_rbac.sql has been run.');
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        console.error('Error fetching permissions:', errorData.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Error fetching permissions:', error);
    }
  };

  const fetchRolePermissions = async () => {
    if (!selectedRole) return;

    setLoadingPermissions(true);
    try {
      const res = await fetch(`/api/settings/roles/${selectedRole}/permissions`);
      if (res.ok) {
        const data = await res.json();
        const permMap: Record<string, boolean> = {};
        if (data.permissions && Array.isArray(data.permissions)) {
          data.permissions.forEach((rp: any) => {
            permMap[rp.permission_id] = rp.granted === true;
          });
        }
        setRolePermissions(permMap);
      } else {
        const errorData = await res.json().catch(() => ({}));
        console.error('Error fetching role permissions:', errorData.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Error fetching role permissions:', error);
    } finally {
      setLoadingPermissions(false);
    }
  };

  const handlePermissionToggle = async (permissionId: string) => {
    if (!selectedRole) return;

    const newValue = !rolePermissions[permissionId];
    setRolePermissions(prev => ({ ...prev, [permissionId]: newValue }));

    try {
      const currentPerms = Object.keys(rolePermissions).map(pid => ({
        permission_id: pid,
        granted: rolePermissions[pid],
      }));
      
      const updatedPerms = currentPerms.map(p => 
        p.permission_id === permissionId ? { ...p, granted: newValue } : p
      );

      // Add new permission if it wasn't in the list
      if (!currentPerms.find(p => p.permission_id === permissionId)) {
        updatedPerms.push({ permission_id: permissionId, granted: newValue });
      }

      const res = await fetch(`/api/roles/${selectedRole}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: updatedPerms }),
      });

      if (!res.ok) {
        // Revert on error
        setRolePermissions(prev => ({ ...prev, [permissionId]: !newValue }));
        const errorData = await safeJsonParse(res);
        toast.error(getApiErrorMessage(errorData, 'Failed to update permission'));
      }
    } catch (error) {
      console.error('Error updating permission:', error);
      setRolePermissions(prev => ({ ...prev, [permissionId]: !newValue }));
      toast.error('Failed to update permission. Please try again.');
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id || !user?.id || !newRoleName.trim()) return;

    setCreating(true);
    try {
      const res = await fetch('/api/settings/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          role_name: newRoleName.trim(),
          description: newRoleDescription.trim() || null,
          created_by_user_id: user.id,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setRoles([...roles, data.role]);
        setNewRoleName('');
        setNewRoleDescription('');
        setShowCreateModal(false);
        setSelectedRole(data.role.id);
      } else {
        const errorData = await safeJsonParse(res);
        toast.error(getApiErrorMessage(errorData, 'Failed to create role'));
      }
    } catch (error) {
      console.error('Error creating role:', error);
      toast.error('Failed to create role. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  // Group permissions by module
  const permissionsByModule = permissions.reduce((acc, perm) => {
    if (!acc[perm.module_key]) {
      acc[perm.module_key] = {
        module_name: perm.module_name,
        permissions: [],
      };
    }
    acc[perm.module_key].permissions.push(perm);
    return acc;
  }, {} as Record<string, { module_name: string; permissions: Permission[] }>);

  return (
      <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Roles & Permissions</h1>
          <p className="text-sm text-text-secondary mt-1">Manage role-based access control</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Roles List */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-text-primary">Roles</h2>
              <Button
                onClick={() => setShowCreateModal(true)}
                size="sm"
                className="flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Create Role
              </Button>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
              </div>
            ) : (
              <div className="space-y-2">
                {roles.map((role) => (
                  <button
                    key={role.id}
                    onClick={() => setSelectedRole(role.id)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selectedRole === role.id
                        ? 'bg-slate-50 text-primary-600 font-medium'
                        : 'hover:bg-gray-50 dark:bg-slate-800/40 dark:hover:bg-slate-800/70 text-text-primary'
                    }`}
                  >
                    <div className="font-medium">{role.role_name}</div>
                    {role.description && (
                      <div className="text-xs text-text-secondary mt-1">{role.description}</div>
                    )}
                  </button>
                ))}
                {roles.length === 0 && (
                  <div className="text-center py-4">
                    <p className="text-sm text-text-secondary mb-3">
                      No roles found. Create your first role.
                    </p>
                    <div className="bg-slate-50 border border-primary-200 rounded-lg p-3 text-left">
                      <p className="text-xs text-primary-800">
                        <strong>First-time setup:</strong> You can create your first role without specific permissions. 
                        After creating your first role, normal permission checks will apply.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Permissions */}
          {selectedRole && (
            <Card className="lg:col-span-2">
              <h2 className="text-lg font-semibold text-text-primary mb-4">Permissions</h2>
              {loadingPermissions ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
                </div>
              ) : permissions.length === 0 ? (
                <div className="text-center py-12">
                  <Shield className="w-12 h-12 text-text-muted mx-auto mb-4" />
                  <p className="text-text-secondary mb-2">No permissions available</p>
                  <p className="text-xs text-text-secondary">
                    Permissions need to be seeded. Please run migration 059_rbac.sql
                  </p>
                </div>
              ) : (
                <div className="space-y-6 max-h-[600px] overflow-y-auto">
                  {(() => {
                    const selectedRoleData = roles.find(r => r.id === selectedRole);
                    const isPrimaryAdminRole = selectedRoleData?.role_key === 'primary_admin';
                    
                    return (
                      <>
                        {isPrimaryAdminRole && (
                          <div className="bg-slate-50 border border-primary-200 rounded-lg p-3 mb-4">
                            <p className="text-sm text-primary-800">
                              <strong>Primary Admin:</strong> This role has all permissions enabled by default and cannot be modified.
                            </p>
                          </div>
                        )}
                        {Object.entries(permissionsByModule).map(([moduleKey, moduleData]) => (
                          <div key={moduleKey} className="border-b border-border pb-4 last:border-b-0">
                            <h3 className="font-semibold text-text-primary mb-3">{moduleData.module_name}</h3>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              {moduleData.permissions.map((perm) => (
                                <label
                                  key={perm.id}
                                  className={`flex items-center gap-2 p-2 rounded-lg ${
                                    isPrimaryAdminRole ? 'cursor-not-allowed opacity-75' : 'hover:bg-gray-50 dark:bg-slate-800/40 dark:hover:bg-slate-800/70 cursor-pointer'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isPrimaryAdminRole ? true : (rolePermissions[perm.id] || false)}
                                    onChange={() => handlePermissionToggle(perm.id)}
                                    disabled={isPrimaryAdminRole}
                                    className="w-4 h-4"
                                  />
                                  <span className="text-sm text-text-primary">{perm.permission_name}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                      </>
                    );
                  })()}
                </div>
              )}
            </Card>
          )}

          {!selectedRole && (
            <Card className="lg:col-span-2">
              <div className="text-center py-12">
                <Shield className="w-12 h-12 text-text-muted mx-auto mb-4" />
                <p className="text-text-secondary">Select a role to manage permissions</p>
              </div>
            </Card>
          )}
        </div>

        {/* Create Role Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <Card className="w-full max-w-md mx-4">
              <h2 className="text-xl font-semibold text-text-primary mb-4">Create New Role</h2>
              <form onSubmit={handleCreateRole}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">
                      Role Name *
                    </label>
                    <Input
                      type="text"
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                      placeholder="e.g., Manager, Supervisor"
                      required
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">
                      Description
                    </label>
                    <textarea
                      value={newRoleDescription}
                      onChange={(e) => setNewRoleDescription(e.target.value)}
                      placeholder="Brief description of this role's responsibilities"
                      className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                      rows={3}
                    />
                  </div>
                  <div className="bg-slate-50 border border-primary-200 rounded-lg p-3">
                    <p className="text-xs text-primary-800">
                      <strong>Note:</strong> After creating the role, you can assign permissions by selecting it from the list.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 mt-6">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setShowCreateModal(false);
                      setNewRoleName('');
                      setNewRoleDescription('');
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" className="flex-1" disabled={creating || !newRoleName.trim()}>
                    {creating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        Creating...
                      </>
                    ) : (
                      'Create Role'
                    )}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}
      </div>
    
  );
}
