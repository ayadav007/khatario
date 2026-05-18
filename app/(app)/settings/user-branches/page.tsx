'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Plus, User, Building2, X, Loader2, CheckCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

interface UserBranch {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  branch_id: string;
  branch_name: string;
  permissions: string[];
  is_active: boolean;
}

interface User {
  id: string;
  name: string;
  email: string;
}

interface Branch {
  id: string;
  name: string;
  is_primary: boolean;
}

export default function UserBranchesPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [assignments, setAssignments] = useState<UserBranch[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    user_id: '',
    branch_id: '',
    permissions: [] as string[],
  });

  useEffect(() => {
    if (business?.id) {
      fetchAssignments();
      fetchUsers();
      fetchBranches();
    }
  }, [business]);

  async function fetchAssignments() {
    if (!business?.id || !user?.id) return;
    
    try {
      const response = await fetch(`/api/user-branches?business_id=${business.id}&user_id=${user.id}`);
      if (response.ok) {
        const data = await response.json();
        setAssignments(data.assignments || []);
      } else {
        const errorData = await response.json();
        console.error('Error fetching user-branch assignments:', errorData.error || response.statusText);
      }
    } catch (error) {
      console.error('Error fetching user-branch assignments:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchUsers() {
    if (!business?.id) return;
    
    try {
      const response = await fetch(`/api/settings/users?business_id=${business.id}&user_id=${user?.id}`);
      const data = await response.json();
      setUsers(data.users || []);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  }

  async function fetchBranches() {
    if (!business?.id || !user?.id) return;
    
    try {
      const response = await fetch(`/api/branches?business_id=${business.id}&user_id=${user.id}`);
      if (response.ok) {
        const data = await response.json();
        setBranches(data.branches || []);
      } else {
        console.error('Error fetching branches:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Error fetching branches:', error);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!business?.id) return;

    setSaving(true);
    try {
      const response = await fetch('/api/user-branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          user_id: formData.user_id,
          branch_id: formData.branch_id,
          permissions: formData.permissions,
          created_by_user_id: user?.id, // For authorization
        }),
      });

      if (response.ok) {
        await fetchAssignments();
        setShowForm(false);
        setFormData({
          user_id: '',
          branch_id: '',
          permissions: [],
        });
        toast.success('User assigned to branch successfully!');
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        const errorMessage = errorData.error || errorData.message || `Failed to assign user to branch (${response.status})`;
        console.error('Error assigning user to branch:', errorData);
        toast.error(errorMessage);
      }
    } catch (error: any) {
      console.error('Error assigning user to branch:', error);
      toast.error(`Failed to assign user to branch: ${error.message || 'Network error'}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(assignmentId: string) {
    if (!confirm('Are you sure you want to remove this assignment?')) {
      return;
    }

    try {
      const response = await fetch(`/api/user-branches?id=${assignmentId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchAssignments();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to remove assignment');
      }
    } catch (error) {
      console.error('Error removing assignment:', error);
      toast.error('Failed to remove assignment');
    }
  }

  const togglePermission = (permission: string) => {
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter(p => p !== permission)
        : [...prev.permissions, permission]
    }));
  };

  const availablePermissions = [
    { key: 'create_transactions', label: 'Create Transactions' },
    { key: 'view_reports', label: 'View Reports' },
    { key: 'manage_inventory', label: 'Manage Inventory' },
  ];

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      
    );
  }

  return (
      <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">User-Branch Assignments</h1>
            <p className="text-text-secondary text-sm mt-1">Assign users to branches and manage permissions</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          >
            <Plus className="w-5 h-5" />
            <span>Assign User</span>
          </button>
        </div>

        {/* Info Banner */}
        <div className="bg-gradient-to-r from-slate-50 to-indigo-50 border border-primary-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <User className="w-5 h-5 text-primary-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-primary-900">About User-Branch Assignments</p>
              <p className="text-sm text-primary-700 mt-1">
                Assign users to specific branches to control access. Users can only create transactions and view reports for branches they are assigned to.
              </p>
            </div>
          </div>
        </div>

        {/* Create Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-surface dark:bg-slate-900/70 rounded-xl max-w-2xl w-full p-6">
              <div className="flex justify-between items-start mb-6">
                <h2 className="text-xl font-bold text-text-primary">Assign User to Branch</h2>
                <button
                  onClick={() => setShowForm(false)}
                  className="text-text-muted hover:text-text-secondary"
                >
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    User *
                  </label>
                  <select
                    value={formData.user_id}
                    onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    required
                  >
                    <option value="">Select User</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} {user.email ? `(${user.email})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Branch *
                  </label>
                  <select
                    value={formData.branch_id}
                    onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    required
                  >
                    <option value="">Select Branch</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name} {branch.is_primary ? '(Primary)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Permissions
                  </label>
                  <div className="space-y-2">
                    {availablePermissions.map((perm) => (
                      <label key={perm.key} className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={formData.permissions.includes(perm.key)}
                          onChange={() => togglePermission(perm.key)}
                          className="w-4 h-4 text-primary-600 border-border dark:border-slate-500 bg-surface rounded focus:ring-primary-500"
                        />
                        <span className="text-sm text-text-secondary">{perm.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end space-x-3 pt-4 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="px-4 py-2 border border-border rounded-lg bg-surface hover:bg-gray-50 dark:hover:bg-slate-800/80"
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                    disabled={saving}
                  >
                    {saving ? 'Assigning...' : 'Assign User'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Assignments Table */}
        <div className="bg-surface dark:bg-slate-900/70 rounded-xl shadow-sm border border-border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-800/40 border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">User</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Branch</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Permissions</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Status</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {assignments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-muted">
                    No user-branch assignments found. Assign users to branches to control access.
                  </td>
                </tr>
              ) : (
                assignments.map((assignment) => (
                  <tr key={assignment.id} className="hover:bg-gray-50 dark:bg-slate-800/40 dark:hover:bg-slate-800/70">
                    <td className="px-4 py-3">
                      <div className="flex items-center space-x-2">
                        <User className="w-4 h-4 text-text-muted" />
                        <div>
                          <div className="text-sm font-medium text-text-primary">{assignment.user_name}</div>
                          <div className="text-xs text-text-muted">{assignment.user_email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center space-x-2">
                        <Building2 className="w-4 h-4 text-text-muted" />
                        <span className="text-sm text-text-primary">{assignment.branch_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {assignment.permissions.map((perm) => (
                          <span
                            key={perm}
                            className="px-2 py-1 bg-slate-100 text-primary-800 rounded text-xs"
                          >
                            {perm.replace('_', ' ')}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {assignment.is_active ? (
                        <span className="inline-flex items-center space-x-1 px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                          <CheckCircle className="w-3 h-3" />
                          <span>Active</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs font-medium">
                          <X className="w-3 h-3" />
                          <span>Inactive</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(assignment.id)}
                        className="text-sm text-red-600 hover:text-red-700 font-medium"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    
  );
}
