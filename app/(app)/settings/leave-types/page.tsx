'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Plus, Edit, Trash2, Loader2, Calendar } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { LeaveType } from '@/types/database';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

export default function LeaveTypesPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  
  // Check authorization for creating/updating leave types
  const { allowed: canCreate, loading: authLoading } = useAuthorizationGuard({
    resource: 'settings',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  const [editingType, setEditingType] = useState<LeaveType | null>(null);
  const [formData, setFormData] = useState({
    leave_name: '',
    leave_code: '',
    max_days_per_year: '',
    carry_forward: false,
    max_carry_forward_days: '',
    requires_approval: true,
    is_paid: true,
    description: '',
  });

  useEffect(() => {
    if (business?.id) {
      fetchLeaveTypes();
    }
  }, [business?.id]);

  const fetchLeaveTypes = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/leave-types?business_id=${business.id}`);
      if (res.ok) {
        const data = await res.json();
        setLeaveTypes(data.leave_types || []);
      }
    } catch (error) {
      console.error('Error fetching leave types:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    try {
      const url = editingType
        ? `/api/leave-types/${editingType.id}?business_id=${business.id}`
        : '/api/leave-types';
      const method = editingType ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          ...formData,
          max_days_per_year: formData.max_days_per_year ? parseInt(formData.max_days_per_year) : null,
          max_carry_forward_days: formData.max_carry_forward_days ? parseInt(formData.max_carry_forward_days) : null,
        }),
      });

      if (res.ok) {
        await fetchLeaveTypes();
        setShowForm(false);
        setEditingType(null);
        setFormData({
          leave_name: '',
          leave_code: '',
          max_days_per_year: '',
          carry_forward: false,
          max_carry_forward_days: '',
          requires_approval: true,
          is_paid: true,
          description: '',
        });
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to save leave type');
      }
    } catch (error) {
      console.error('Error saving leave type:', error);
      toast.error('Failed to save leave type. Please try again.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!business?.id || !confirm('Are you sure you want to delete this leave type?')) return;

    try {
      const res = await fetch(`/api/leave-types/${id}?business_id=${business.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await fetchLeaveTypes();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to delete leave type');
      }
    } catch (error) {
      console.error('Error deleting leave type:', error);
      toast.error('Failed to delete leave type. Please try again.');
    }
  };

  const handleEdit = (type: LeaveType) => {
    // Check authorization before editing
    if (!canCreate) {
      toast.error('You do not have permission to edit leave types. Please contact your administrator.');
      return;
    }
    setEditingType(type);
    setFormData({
      leave_name: type.leave_name,
      leave_code: type.leave_code,
      max_days_per_year: type.max_days_per_year?.toString() || '',
      carry_forward: type.carry_forward,
      max_carry_forward_days: type.max_carry_forward_days?.toString() || '',
      requires_approval: type.requires_approval,
      is_paid: type.is_paid,
      description: type.description || '',
    });
    setShowForm(true);
  };

  return (
      <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Leave Types</h1>
            <p className="text-sm text-text-secondary mt-1">Configure leave types for your business</p>
          </div>
          <Button onClick={() => {
            // Check authorization before showing form
            if (!canCreate) {
              toast.error('You do not have permission to create leave types. Please contact your administrator.');
              return;
            }
            setShowForm(true);
            setEditingType(null);
            setFormData({
              leave_name: '',
              leave_code: '',
              max_days_per_year: '',
              carry_forward: false,
              max_carry_forward_days: '',
              requires_approval: true,
              is_paid: true,
              description: '',
            });
          }}>
            <Plus className="w-4 h-4 mr-2" />
            Add Leave Type
          </Button>
        </div>

        {showForm && (
          <Card>
            <h2 className="text-lg font-semibold text-text-primary mb-4">
              {editingType ? 'Edit Leave Type' : 'Add New Leave Type'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Leave Name *"
                  value={formData.leave_name}
                  onChange={(e) => setFormData({ ...formData, leave_name: e.target.value })}
                  required
                />
                <Input
                  label="Leave Code *"
                  value={formData.leave_code}
                  onChange={(e) => setFormData({ ...formData, leave_code: e.target.value.toUpperCase() })}
                  required
                  placeholder="CL, SL, PL, etc."
                />
                <Input
                  label="Max Days Per Year"
                  type="number"
                  value={formData.max_days_per_year}
                  onChange={(e) => setFormData({ ...formData, max_days_per_year: e.target.value })}
                  min="0"
                />
                <Input
                  label="Max Carry Forward Days"
                  type="number"
                  value={formData.max_carry_forward_days}
                  onChange={(e) => setFormData({ ...formData, max_carry_forward_days: e.target.value })}
                  min="0"
                />
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.carry_forward}
                    onChange={(e) => setFormData({ ...formData, carry_forward: e.target.checked })}
                  />
                  <span className="text-sm text-text-primary">Allow Carry Forward</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.requires_approval}
                    onChange={(e) => setFormData({ ...formData, requires_approval: e.target.checked })}
                  />
                  <span className="text-sm text-text-primary">Requires Approval</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_paid}
                    onChange={(e) => setFormData({ ...formData, is_paid: e.target.checked })}
                  />
                  <span className="text-sm text-text-primary">Paid Leave</span>
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input"
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    setEditingType(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit">Save</Button>
              </div>
            </form>
          </Card>
        )}

        <Card>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : leaveTypes.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-12 h-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary">No leave types configured</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Leave Name</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Code</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Max Days</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Carry Forward</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Settings</th>
                    <th className="text-center py-3 px-4 font-semibold text-text-primary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveTypes.map((type) => (
                    <tr key={type.id} className="border-b border-border hover:bg-gray-50 dark:bg-slate-800/40 dark:hover:bg-slate-800/70">
                      <td className="py-4 px-4">
                        <div className="font-medium">{type.leave_name}</div>
                        {type.description && (
                          <div className="text-sm text-text-secondary">{type.description}</div>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <span className="font-mono text-sm">{type.leave_code}</span>
                      </td>
                      <td className="py-4 px-4">
                        {type.max_days_per_year || '—'}
                      </td>
                      <td className="py-4 px-4">
                        {type.carry_forward ? (
                          <span className="text-green-600">Yes ({type.max_carry_forward_days || 'Unlimited'} days)</span>
                        ) : (
                          <span className="text-text-secondary">No</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <div className="text-sm space-y-1">
                          {type.requires_approval && <div>Requires Approval</div>}
                          {type.is_paid ? <div>Paid</div> : <div>Unpaid</div>}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center justify-center gap-2">
                          <Button size="sm" variant="ghost" onClick={() => handleEdit(type)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(type.id)}>
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    
  );
}

