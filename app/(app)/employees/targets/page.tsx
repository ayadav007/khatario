'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Target, Plus, Edit, Trash2, Loader2, Calendar, DollarSign } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { EmployeeTarget } from '@/types/database';
import { format } from 'date-fns';
import { useToastContext } from '@/contexts/ToastContext';

interface TargetWithDetails extends EmployeeTarget {
  employee_code: string;
  employee_name: string;
}

export default function TargetsPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [targets, setTargets] = useState<TargetWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTarget, setEditingTarget] = useState<TargetWithDetails | null>(null);
  const [formData, setFormData] = useState({
    employee_id: '',
    target_period: 'monthly' as 'monthly' | 'quarterly' | 'yearly',
    target_year: new Date().getFullYear(),
    target_month: new Date().getMonth() + 1,
    target_amount: '',
    target_invoices: '',
  });
  const [employees, setEmployees] = useState<Array<{ id: string; name: string; employee_code: string }>>([]);

  useEffect(() => {
    if (business?.id) {
      fetchTargets();
      fetchEmployees();
    }
  }, [business?.id]);

  const fetchTargets = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/employees/targets?business_id=${business.id}`);
      if (res.ok) {
        const data = await res.json();
        setTargets(data.targets || []);
      }
    } catch (error) {
      console.error('Error fetching targets:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployees = async () => {
    if (!business?.id) return;

    try {
      const res = await fetch(`/api/employees?business_id=${business.id}&status=active&access_type=full&user_id=${user?.id}`);
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees.map((emp: any) => ({
          id: emp.id,
          name: emp.user_name || emp.employee_code,
          employee_code: emp.employee_code,
        })));
      }
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    try {
      const res = await fetch('/api/employees/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          ...formData,
          target_amount: parseFloat(formData.target_amount),
          target_invoices: formData.target_invoices ? parseInt(formData.target_invoices) : null,
          target_month: formData.target_period === 'monthly' ? formData.target_month : null,
        }),
      });

      if (res.ok) {
        await fetchTargets();
        setShowForm(false);
        setEditingTarget(null);
        setFormData({
          employee_id: '',
          target_period: 'monthly',
          target_year: new Date().getFullYear(),
          target_month: new Date().getMonth() + 1,
          target_amount: '',
          target_invoices: '',
        });
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to save target');
      }
    } catch (error) {
      console.error('Error saving target:', error);
      toast.error('Failed to save target. Please try again.');
    }
  };

  const handleDelete = async (targetId: string) => {
    if (!business?.id || !confirm('Are you sure you want to delete this target?')) return;

    try {
      const res = await fetch(`/api/employees/targets/${targetId}?business_id=${business.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await fetchTargets();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to delete target');
      }
    } catch (error) {
      console.error('Error deleting target:', error);
      toast.error('Failed to delete target. Please try again.');
    }
  };

  const handleEdit = (target: TargetWithDetails) => {
    setEditingTarget(target);
    setFormData({
      employee_id: target.employee_id,
      target_period: target.target_period,
      target_year: target.target_year,
      target_month: target.target_month || new Date().getMonth() + 1,
      target_amount: target.target_amount.toString(),
      target_invoices: target.target_invoices?.toString() || '',
    });
    setShowForm(true);
  };

  const getPeriodLabel = (target: TargetWithDetails) => {
    if (target.target_period === 'monthly' && target.target_month) {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${monthNames[target.target_month - 1]} ${target.target_year}`;
    }
    if (target.target_period === 'quarterly') {
      const quarter = Math.ceil((target.target_month || 1) / 3);
      return `Q${quarter} ${target.target_year}`;
    }
    return target.target_year.toString();
  };

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Employee Targets</h1>
            <p className="text-sm text-text-secondary mt-1">Set and manage sales targets for employees</p>
          </div>
          <Button onClick={() => {
            setShowForm(true);
            setEditingTarget(null);
            setFormData({
              employee_id: '',
              target_period: 'monthly',
              target_year: new Date().getFullYear(),
              target_month: new Date().getMonth() + 1,
              target_amount: '',
              target_invoices: '',
            });
          }}>
            <Plus className="w-4 h-4 mr-2" />
            Set Target
          </Button>
        </div>

        {/* Form Modal */}
        {showForm && (
          <Card>
            <h2 className="text-lg font-semibold text-text-primary mb-4">
              {editingTarget ? 'Edit Target' : 'Set New Target'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Employee *
                  </label>
                  <select
                    value={formData.employee_id}
                    onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                    className="input"
                    required
                    disabled={!!editingTarget}
                  >
                    <option value="">Select Employee</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.employee_code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Period Type *
                  </label>
                  <select
                    value={formData.target_period}
                    onChange={(e) => setFormData({ ...formData, target_period: e.target.value as any })}
                    className="input"
                    required
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Year *
                  </label>
                  <Input
                    type="number"
                    value={formData.target_year}
                    onChange={(e) => setFormData({ ...formData, target_year: parseInt(e.target.value) })}
                    required
                    min={2020}
                    max={2100}
                  />
                </div>
                {formData.target_period === 'monthly' && (
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1">
                      Month *
                    </label>
                    <select
                      value={formData.target_month}
                      onChange={(e) => setFormData({ ...formData, target_month: parseInt(e.target.value) })}
                      className="input"
                      required
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                        <option key={month} value={month}>
                          {new Date(2000, month - 1, 1).toLocaleString('default', { month: 'long' })}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Target Amount (₹) *
                  </label>
                  <Input
                    type="number"
                    value={formData.target_amount}
                    onChange={(e) => setFormData({ ...formData, target_amount: e.target.value })}
                    required
                    min="0"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Target Invoices (Optional)
                  </label>
                  <Input
                    type="number"
                    value={formData.target_invoices}
                    onChange={(e) => setFormData({ ...formData, target_invoices: e.target.value })}
                    min="0"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    setEditingTarget(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit">Save Target</Button>
              </div>
            </form>
          </Card>
        )}

        {/* Targets List */}
        <Card>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : targets.length === 0 ? (
            <div className="text-center py-12">
              <Target className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-text-secondary">No targets set</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Employee</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Period</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Target Amount</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Target Invoices</th>
                    <th className="text-center py-3 px-4 font-semibold text-text-primary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((target) => (
                    <tr
                      key={target.id}
                      className="border-b border-border hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-4 px-4">
                        <div>
                          <div className="font-medium text-text-primary">{target.employee_name}</div>
                          <div className="text-sm text-text-secondary font-mono">
                            {target.employee_code}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-text-secondary" />
                          <span>{getPeriodLabel(target)}</span>
                          <span className="text-xs text-text-secondary">
                            ({target.target_period})
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className="font-medium">₹{target.target_amount.toLocaleString('en-IN')}</span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        {target.target_invoices ? (
                          <span>{target.target_invoices}</span>
                        ) : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEdit(target)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(target.id)}
                          >
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

