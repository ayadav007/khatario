'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Plus, User, Warehouse, X, Loader2, CheckCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

interface UserWarehouse {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  warehouse_id: string;
  warehouse_name: string;
  is_active: boolean;
}

interface User {
  id: string;
  name: string;
  email: string;
}

interface Warehouse {
  id: string;
  name: string;
  is_primary: boolean;
}

export default function UserWarehousesPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [assignments, setAssignments] = useState<UserWarehouse[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    user_id: '',
    warehouse_id: '',
  });

  useEffect(() => {
    if (business?.id) {
      fetchAssignments();
      fetchUsers();
      fetchWarehouses();
    }
  }, [business]);

  async function fetchAssignments() {
    if (!business?.id) return;
    
    try {
      const response = await fetch(`/api/user-warehouses?business_id=${business.id}`);
      const data = await response.json();
      setAssignments(data.assignments || []);
    } catch (error) {
      console.error('Error fetching user-warehouse assignments:', error);
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

  async function fetchWarehouses() {
    if (!business?.id) return;
    
    try {
      const response = await fetch(`/api/warehouses?business_id=${business.id}`);
      const data = await response.json();
      setWarehouses(data.warehouses || []);
    } catch (error) {
      console.error('Error fetching warehouses:', error);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!business?.id) return;

    setSaving(true);
    try {
      const response = await fetch('/api/user-warehouses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          user_id: formData.user_id,
          warehouse_id: formData.warehouse_id,
        }),
      });

      if (response.ok) {
        await fetchAssignments();
        setShowForm(false);
        setFormData({
          user_id: '',
          warehouse_id: '',
        });
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to assign user to warehouse');
      }
    } catch (error) {
      console.error('Error assigning user to warehouse:', error);
      toast.error('Failed to assign user to warehouse');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(assignmentId: string) {
    if (!confirm('Are you sure you want to remove this assignment?')) {
      return;
    }

    try {
      const response = await fetch(`/api/user-warehouses?id=${assignmentId}`, {
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
            <h1 className="text-2xl font-bold text-text-primary">User-Warehouse Assignments</h1>
            <p className="text-text-secondary text-sm mt-1">Assign users to warehouses to control inventory access</p>
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
            <Warehouse className="w-5 h-5 text-primary-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-primary-900">About User-Warehouse Assignments</p>
              <p className="text-sm text-primary-700 mt-1">
                Assign users to specific warehouses to control which warehouses they can access when creating invoices, purchases, and inventory adjustments.
              </p>
            </div>
          </div>
        </div>

        {/* Create Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-surface dark:bg-slate-900/70 rounded-xl max-w-2xl w-full p-6">
              <div className="flex justify-between items-start mb-6">
                <h2 className="text-xl font-bold text-text-primary">Assign User to Warehouse</h2>
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
                    Warehouse *
                  </label>
                  <select
                    value={formData.warehouse_id}
                    onChange={(e) => setFormData({ ...formData, warehouse_id: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    required
                  >
                    <option value="">Select Warehouse</option>
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name} {warehouse.is_primary ? '(Primary)' : ''}
                      </option>
                    ))}
                  </select>
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
                <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Warehouse</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Status</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {assignments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-text-muted">
                    No user-warehouse assignments found. Assign users to warehouses to control access.
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
                        <Warehouse className="w-4 h-4 text-text-muted" />
                        <span className="text-sm text-text-primary">{assignment.warehouse_name}</span>
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
