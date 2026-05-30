'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IntlPhoneInput } from '@/components/ui/IntlPhoneInput';
import { ArrowLeft, Plus, Edit, Trash2, User, UserCheck, UserX, Loader2, Warehouse, Building2 } from 'lucide-react';
import { UserWarehouseAccess } from '@/components/settings/UserWarehouseAccess';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import Link from 'next/link';
import { format } from 'date-fns';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';
import { SubscriptionUsageBanner } from '@/components/subscription/SubscriptionUsageBanner';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

interface UserData {
  id: string;
  name: string;
  email?: string;
  phone: string;
  role_name: string | null;
  role_key: string | null;
  role_id: string | null;
  is_primary_admin: boolean;
  is_active: boolean;
  last_active_at?: string;
  created_at: string;
  display_role?: string;
  employee_id?: string;
  employee_code?: string;
  designation?: string;
  department?: string;
  access_type?: string;
}

interface Role {
  id: string;
  role_name: string;
  role_key: string;
  description: string;
}

interface Branch {
  id: string;
  name: string;
  branch_code: string | null;
  is_default: boolean;
  is_primary: boolean;
}

export default function ManageUsersPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [users, setUsers] = useState<UserData[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showWarehouseAccessModal, setShowWarehouseAccessModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  
  // Check authorization for creating users
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'settings',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [limitInfo, setLimitInfo] = useState<{ current: number; limit: number } | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    role_id: '',
    branch_id: '',
    allow_multidevice_sync: false
  });
  const [editFormData, setEditFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    role_id: '',
    allow_multidevice_sync: false
  });

  useEffect(() => {
    if (business?.id) {
      fetchUsers();
      fetchRoles();
      fetchBranches();
      // Auto-fix roles for users without roles
      fixUserRoles();
    }
  }, [business?.id]);

  const fixUserRoles = async () => {
    if (!business?.id) return;
    try {
      const res = await fetch('/api/settings/users/fix-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id })
      });
      const data = await res.json();
      if (data.success && data.fixed > 0) {
        // Refresh users list after fixing
        fetchUsers();
      }
    } catch (error) {
      console.error('Failed to fix user roles:', error);
    }
  };

  const fetchUsers = async () => {
    if (!business?.id || !user?.id) return;
    
    try {
      const res = await fetch(`/api/settings/users?business_id=${business.id}&user_id=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      } else {
        const errorData = await res.json().catch(() => ({}));
        console.error('Failed to fetch users:', errorData.error || 'Unknown error');
        setUsers([]);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    try {
      const res = await fetch(`/api/settings/roles?business_id=${business?.id}&user_id=${user?.id}`);
      if (res.ok) {
        const data = await res.json();
        setRoles(data.roles);
      }
    } catch (error) {
      console.error('Failed to fetch roles:', error);
    }
  };

  const fetchBranches = async () => {
    if (!business?.id || !user?.id) return;
    try {
      const res = await fetch(`/api/branches?business_id=${business.id}&user_id=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setBranches(data.branches || []);
      }
    } catch (error) {
      console.error('Failed to fetch branches:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.phone || !formData.password || !formData.role_id) {
      toast.error('Please fill in all required fields');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/settings/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          business_id: business?.id,
          created_by_user_id: user?.id
        }),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success('User created successfully');
        setShowAddModal(false);
        setFormData({
          name: '',
          email: '',
          phone: '',
          password: '',
          role_id: '',
          branch_id: '',
          allow_multidevice_sync: false
        });
        fetchUsers();
      } else {
        // Check if it's a subscription limit error
        if (res.status === 403 && data.current !== undefined && data.limit !== undefined) {
          setLimitInfo({ current: data.current, limit: data.limit });
          setShowUpgradeModal(true);
        } else {
          toast.error(`Failed to create user: ${data.error}`);
        }
      }
    } catch (error) {
      console.error('Failed to create user:', error);
      toast.error('Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (userId: string, currentStatus: boolean) => {
    const confirmed = confirm(
      `Are you sure you want to ${currentStatus ? 'deactivate' : 'activate'} this user?`
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/settings/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_active: !currentStatus,
          updated_by_user_id: user?.id
        }),
      });

      if (res.ok) {
        toast.success('User status updated successfully');
        fetchUsers();
      } else {
        const data = await res.json();
        toast.error(`Failed to update user: ${data.error}`);
      }
    } catch (error) {
      console.error('Failed to update user:', error);
      toast.error('Failed to update user');
    }
  };

  const handleEdit = (userData: UserData) => {
    setEditingUser(userData);
    setEditFormData({
      name: userData.name,
      email: userData.email || '',
      phone: userData.phone,
      password: '', // Leave blank - only update if provided
      role_id: userData.role_id || '',
      allow_multidevice_sync: false // Default, will be set from userData if available
    });
    setShowEditModal(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!editingUser || !editFormData.name || !editFormData.phone) {
      toast.error('Name and phone are required');
      return;
    }

    setLoading(true);
    try {
      const updatePayload: any = {
        name: editFormData.name,
        phone: editFormData.phone,
        updated_by_user_id: user?.id
      };

      // Only include fields that are being updated
      if (editFormData.email !== undefined) {
        updatePayload.email = editFormData.email || null;
      }
      if (editFormData.password) {
        updatePayload.password = editFormData.password;
      }
      if (editFormData.role_id !== undefined) {
        updatePayload.role_id = editFormData.role_id || null;
      }
      if (editFormData.allow_multidevice_sync !== undefined) {
        updatePayload.allow_multidevice_sync = editFormData.allow_multidevice_sync;
      }

      const res = await fetch(`/api/settings/users/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success('User updated successfully');
        setShowEditModal(false);
        setEditingUser(null);
        setEditFormData({
          name: '',
          email: '',
          phone: '',
          password: '',
          role_id: '',
          allow_multidevice_sync: false
        });
        fetchUsers();
      } else {
        toast.error(`Failed to update user: ${data.error}`);
      }
    } catch (error) {
      console.error('Failed to update user:', error);
      toast.error('Failed to update user');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (userId: string, userName: string) => {
    const confirmed = confirm(
      `Are you sure you want to delete ${userName}? This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      const res = await fetch(
        `/api/settings/users/${userId}?deleted_by_user_id=${user?.id}`,
        { method: 'DELETE' }
      );

      if (res.ok) {
        toast.success('User deleted successfully');
        fetchUsers();
      } else {
        const data = await res.json();
        toast.error(`Failed to delete user: ${data.error}`);
      }
    } catch (error) {
      console.error('Failed to delete user:', error);
      toast.error('Failed to delete user');
    }
  };

  return (
    <>
    <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/settings">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-text-primary">Manage Users</h1>
              <p className="text-text-secondary text-sm mt-1">Add and manage team members</p>
            </div>
          </div>
          <Button onClick={() => setShowAddModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add New User
          </Button>
        </div>

        <SubscriptionUsageBanner
          businessId={business?.id}
          variant="inline"
          highlightLimit="users"
        />

        {/* Users List */}
        <Card padding="none">
          {loading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr className="table-header">
                    <th className="table-cell text-left">User</th>
                    <th className="table-cell text-left">Contact</th>
                    <th className="table-cell text-left">Role</th>
                    <th className="table-cell text-left">Last Active</th>
                    <th className="table-cell text-center">Status</th>
                    <th className="table-cell text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length > 0 ? (
                    users.map((userData) => (
                      <tr key={userData.id} className="hover:bg-slate-50 transition-colors">
                        <td className="table-cell text-left">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                              <User className="w-5 h-5 text-primary-600" />
                            </div>
                            <div>
                              <p className="font-medium text-text-primary">{userData.name}</p>
                              <div className="flex items-center gap-2 mt-1">
                                {userData.is_primary_admin && (
                                  <span className="text-xs text-primary-600 font-semibold">
                                    Primary Admin
                                  </span>
                                )}
                                {userData.employee_code && (
                                  <Link
                                    href={`/employees/${userData.employee_id}`}
                                    className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {userData.employee_code}
                                  </Link>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="table-cell text-left">
                          <p className="text-sm text-text-primary">{userData.phone}</p>
                          {userData.email && (
                            <p className="text-xs text-text-muted">{userData.email}</p>
                          )}
                        </td>
                        <td className="table-cell text-left">
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex px-2 py-1 bg-purple-100 text-purple-700 rounded-md text-xs font-medium">
                              {userData.display_role || userData.role_name || (userData.is_primary_admin ? 'Primary Admin (No Role)' : 'No Role')}
                            </span>
                            {userData.designation && (
                              <span className="text-xs text-text-secondary">
                                {userData.designation}
                                {userData.department && ` • ${userData.department}`}
                              </span>
                            )}
                            {userData.access_type && (
                              <span className="text-xs text-text-muted">
                                {userData.access_type === 'full' ? 'Full Access' : 'Attendance Only'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="table-cell text-left text-sm text-text-secondary">
                          {userData.last_active_at
                            ? format(new Date(userData.last_active_at), 'dd MMM yyyy, hh:mm a')
                            : 'Never'}
                        </td>
                        <td className="table-cell text-center">
                          {userData.is_active ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-md text-xs font-medium">
                              <UserCheck className="w-3 h-3" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-md text-xs font-medium">
                              <UserX className="w-3 h-3" />
                              Inactive
                            </span>
                          )}
                        </td>
                        <td className="table-cell text-center">
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(userData)}
                              title="Edit User"
                            >
                              <Edit className="w-4 h-4 text-primary-600" />
                            </Button>
                            {!userData.is_primary_admin && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleToggleActive(userData.id, userData.is_active)}
                                  title={userData.is_active ? 'Deactivate' : 'Activate'}
                                >
                                  {userData.is_active ? (
                                    <UserX className="w-4 h-4 text-orange-600" />
                                  ) : (
                                    <UserCheck className="w-4 h-4 text-green-600" />
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDelete(userData.id, userData.name)}
                                  title="Delete User"
                                >
                                  <Trash2 className="w-4 h-4 text-red-600" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-text-secondary">
                        No users found. Add your first team member!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <h2 className="text-xl font-bold text-text-primary mb-4">Add New User</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  label="User Name *"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Enter user name"
                  required
                />

                <IntlPhoneInput
                  label="Phone Number"
                  value={formData.phone}
                  onChange={(full) => setFormData({ ...formData, phone: full })}
                  nationalPlaceholder="Mobile number"
                  required
                />

                <Input
                  label="Email (Optional)"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="Enter email"
                />

                <Input
                  label="Password *"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Set password for this user"
                  required
                />

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    User Role *
                  </label>
                  <select
                    value={formData.role_id}
                    onChange={(e) => setFormData({ ...formData, role_id: e.target.value })}
                    className="input"
                    required
                  >
                    <option value="">Select a role</option>
                    {roles.filter(r => r.role_key !== 'primary_admin').map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.role_name} - {role.description}
                      </option>
                    ))}
                  </select>
                </div>

                {branches.length > 1 && (
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1">
                      Assign to Branch (Optional)
                    </label>
                    <select
                      value={formData.branch_id}
                      onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                      className="input"
                    >
                      <option value="">Use Default Branch</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                          {branch.is_primary && ' (Primary)'}
                          {branch.is_default && ' (Default)'}
                          {branch.branch_code && ` - ${branch.branch_code}`}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-text-muted mt-1">
                      If not selected, user will be assigned to the default branch
                    </p>
                  </div>
                )}

                <div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.allow_multidevice_sync}
                      onChange={(e) => setFormData({ ...formData, allow_multidevice_sync: e.target.checked })}
                      className="w-4 h-4 text-primary-600 rounded"
                    />
                    <span className="text-sm text-text-secondary">Allow multidevice sync</span>
                  </label>
                  <p className="text-xs text-text-muted mt-1 ml-6 max-w-md">
                    When off, each new login invalidates other browsers and devices for this user. When on, multiple devices can stay signed in at once.
                  </p>
                </div>

                <div className="flex gap-3 mt-6">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" className="flex-1" disabled={loading}>
                    {loading ? 'Creating...' : 'Create User'}
                  </Button>
                </div>
              </form>
            </div>
          </Card>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && editingUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <h2 className="text-xl font-bold text-text-primary mb-4">Edit User</h2>
              <form onSubmit={handleUpdate} className="space-y-4">
                <Input
                  label="User Name *"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  placeholder="Enter user name"
                  required
                />

                <IntlPhoneInput
                  label="Phone Number"
                  value={editFormData.phone}
                  onChange={(full) => setEditFormData({ ...editFormData, phone: full })}
                  nationalPlaceholder="Mobile number"
                  required
                />

                <Input
                  label="Email (Optional)"
                  type="email"
                  value={editFormData.email}
                  onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                  placeholder="Enter email"
                />

                <Input
                  label="Password (Leave blank to keep current)"
                  type="password"
                  value={editFormData.password}
                  onChange={(e) => setEditFormData({ ...editFormData, password: e.target.value })}
                  placeholder="Enter new password (optional)"
                />

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    User Role {editingUser.is_primary_admin ? '(Cannot change Primary Admin role)' : '*'}
                  </label>
                  <select
                    value={editFormData.role_id}
                    onChange={(e) => setEditFormData({ ...editFormData, role_id: e.target.value })}
                    className="input"
                    disabled={editingUser.is_primary_admin}
                    required={!editingUser.is_primary_admin}
                  >
                    <option value="">Select a role</option>
                    {roles.filter(r => r.role_key !== 'primary_admin').map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.role_name} - {role.description}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editFormData.allow_multidevice_sync}
                      onChange={(e) => setEditFormData({ ...editFormData, allow_multidevice_sync: e.target.checked })}
                      className="w-4 h-4 text-primary-600 rounded"
                    />
                    <span className="text-sm text-text-secondary">Allow multidevice sync</span>
                  </label>
                  <p className="text-xs text-text-muted mt-1 ml-6 max-w-md">
                    When off, each new login invalidates other browsers and devices for this user. When on, multiple devices can stay signed in at once.
                  </p>
                </div>

                <div className="mt-4 pt-4 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowWarehouseAccessModal(true);
                    }}
                    className="w-full"
                  >
                    <Warehouse className="w-4 h-4 mr-2" />
                    Manage Warehouse Access
                  </Button>
                </div>

                <div className="flex gap-3 mt-6">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setShowEditModal(false);
                      setEditingUser(null);
                      setEditFormData({
                        name: '',
                        email: '',
                        phone: '',
                        password: '',
                        role_id: '',
                        allow_multidevice_sync: false
                      });
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" className="flex-1" disabled={loading}>
                    {loading ? 'Updating...' : 'Update User'}
                  </Button>
                </div>
              </form>
            </div>
          </Card>
        </div>
      )}

      {/* Upgrade Modal */}
      {showUpgradeModal && limitInfo && (
        <UpgradeModal
          limitType="users"
          currentCount={limitInfo.current}
          limit={limitInfo.limit}
          onClose={() => {
            setShowUpgradeModal(false);
          }}
          onUpgradeSuccess={() => {
            setShowUpgradeModal(false);
            window.location.reload();
          }}
        />
      )}

      {/* Warehouse Access Modal */}
      {showWarehouseAccessModal && editingUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <UserWarehouseAccess
                userId={editingUser.id}
                onClose={() => setShowWarehouseAccessModal(false)}
              />
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

