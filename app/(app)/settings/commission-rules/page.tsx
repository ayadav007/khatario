'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Plus, Edit, Trash2, Loader2, DollarSign } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { CommissionRule } from '@/types/database';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

interface Role {
  id: string;
  role_name: string;
}

interface Employee {
  id: string;
  name: string;
  employee_code: string;
}

export default function CommissionRulesPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<CommissionRule | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [formData, setFormData] = useState({
    employee_id: '',
    role_id: '',
    commission_type: 'percentage' as 'percentage' | 'fixed' | 'tiered',
    commission_value: '',
    min_sale_amount: '0',
    max_commission: '',
    applies_to_item_category: '',
    applies_to_customer_type: '',
    effective_from: '',
    effective_to: '',
  });

  useEffect(() => {
    if (business?.id) {
      fetchRules();
      fetchRoles();
      fetchEmployees();
    }
  }, [business?.id]);

  const fetchRules = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/commission-rules?business_id=${business.id}`);
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules || []);
      }
    } catch (error) {
      console.error('Error fetching commission rules:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    if (!business?.id) return;

    try {
      const res = await fetch(`/api/settings/roles?business_id=${business.id}&user_id=${user?.id}`);
      if (res.ok) {
        const data = await res.json();
        setRoles(data.roles || []);
      }
    } catch (error) {
      console.error('Error fetching roles:', error);
    }
  };

  const fetchEmployees = async () => {
    if (!business?.id) return;

    try {
      const res = await fetch(`/api/employees?business_id=${business.id}&status=active`);
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

    if (!formData.employee_id && !formData.role_id) {
      toast.warning('Either employee or role must be selected');
      return;
    }

    try {
      const url = editingRule
        ? `/api/commission-rules/${editingRule.id}?business_id=${business.id}`
        : '/api/commission-rules';
      const method = editingRule ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          ...formData,
          employee_id: formData.employee_id || null,
          role_id: formData.role_id || null,
          commission_value: parseFloat(formData.commission_value),
          min_sale_amount: parseFloat(formData.min_sale_amount),
          max_commission: formData.max_commission ? parseFloat(formData.max_commission) : null,
          effective_from: formData.effective_from || null,
          effective_to: formData.effective_to || null,
        }),
      });

      if (res.ok) {
        await fetchRules();
        setShowForm(false);
        setEditingRule(null);
        setFormData({
          employee_id: '',
          role_id: '',
          commission_type: 'percentage',
          commission_value: '',
          min_sale_amount: '0',
          max_commission: '',
          applies_to_item_category: '',
          applies_to_customer_type: '',
          effective_from: '',
          effective_to: '',
        });
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to save commission rule');
      }
    } catch (error) {
      console.error('Error saving commission rule:', error);
      toast.error('Failed to save commission rule. Please try again.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!business?.id || !confirm('Are you sure you want to delete this commission rule?')) return;

    try {
      const res = await fetch(`/api/commission-rules/${id}?business_id=${business.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await fetchRules();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to delete commission rule');
      }
    } catch (error) {
      console.error('Error deleting commission rule:', error);
      toast.error('Failed to delete commission rule. Please try again.');
    }
  };

  return (
      <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Commission Rules</h1>
            <p className="text-sm text-text-secondary mt-1">Configure commission calculation rules</p>
          </div>
          <Button onClick={() => {
            setShowForm(true);
            setEditingRule(null);
            setFormData({
              employee_id: '',
              role_id: '',
              commission_type: 'percentage',
              commission_value: '',
              min_sale_amount: '0',
              max_commission: '',
              applies_to_item_category: '',
              applies_to_customer_type: '',
              effective_from: '',
              effective_to: '',
            });
          }}>
            <Plus className="w-4 h-4 mr-2" />
            Add Rule
          </Button>
        </div>

        {showForm && (
          <Card>
            <h2 className="text-lg font-semibold text-text-primary mb-4">
              {editingRule ? 'Edit Commission Rule' : 'Add New Commission Rule'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Apply To
                  </label>
                  <select
                    value={formData.employee_id ? 'employee' : formData.role_id ? 'role' : ''}
                    onChange={(e) => {
                      if (e.target.value === 'employee') {
                        setFormData({ ...formData, employee_id: '', role_id: '' });
                      } else if (e.target.value === 'role') {
                        setFormData({ ...formData, employee_id: '', role_id: '' });
                      }
                    }}
                    className="input"
                  >
                    <option value="">Select Type</option>
                    <option value="employee">Specific Employee</option>
                    <option value="role">Role-Based</option>
                  </select>
                </div>
                {formData.employee_id === '' && formData.role_id === '' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">
                        Employee
                      </label>
                      <select
                        value={formData.employee_id}
                        onChange={(e) => setFormData({ ...formData, employee_id: e.target.value, role_id: '' })}
                        className="input"
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
                        Role
                      </label>
                      <select
                        value={formData.role_id}
                        onChange={(e) => setFormData({ ...formData, role_id: e.target.value, employee_id: '' })}
                        className="input"
                      >
                        <option value="">Select Role</option>
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.role_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Commission Type *
                  </label>
                  <select
                    value={formData.commission_type}
                    onChange={(e) => setFormData({ ...formData, commission_type: e.target.value as any })}
                    className="input"
                    required
                  >
                    <option value="percentage">Percentage</option>
                    <option value="fixed">Fixed Amount</option>
                    <option value="tiered">Tiered</option>
                  </select>
                </div>
                <Input
                  label={`Commission Value ${formData.commission_type === 'percentage' ? '(%)' : '(₹)'} *`}
                  type="number"
                  value={formData.commission_value}
                  onChange={(e) => setFormData({ ...formData, commission_value: e.target.value })}
                  required
                  min="0"
                  step={formData.commission_type === 'percentage' ? '0.01' : '1'}
                />
                <Input
                  label="Min Sale Amount (₹)"
                  type="number"
                  value={formData.min_sale_amount}
                  onChange={(e) => setFormData({ ...formData, min_sale_amount: e.target.value })}
                  min="0"
                />
                <Input
                  label="Max Commission (₹)"
                  type="number"
                  value={formData.max_commission}
                  onChange={(e) => setFormData({ ...formData, max_commission: e.target.value })}
                  min="0"
                />
                <Input
                  label="Effective From"
                  type="date"
                  value={formData.effective_from}
                  onChange={(e) => setFormData({ ...formData, effective_from: e.target.value })}
                />
                <Input
                  label="Effective To"
                  type="date"
                  value={formData.effective_to}
                  onChange={(e) => setFormData({ ...formData, effective_to: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    setEditingRule(null);
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
          ) : rules.length === 0 ? (
            <div className="text-center py-12">
              <DollarSign className="w-12 h-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary">No commission rules configured</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Applies To</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Type</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Value</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Min Sale</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Max Commission</th>
                    <th className="text-center py-3 px-4 font-semibold text-text-primary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id} className="border-b border-border hover:bg-gray-50 dark:bg-slate-800/40 dark:hover:bg-slate-800/70">
                      <td className="py-4 px-4">
                        {rule.employee_id ? (
                          <span className="text-sm">Employee: {(rule as any).employee_code || rule.employee_id}</span>
                        ) : rule.role_id ? (
                          <span className="text-sm">Role: {(rule as any).role_name || rule.role_id}</span>
                        ) : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <span className="capitalize">{rule.commission_type}</span>
                      </td>
                      <td className="py-4 px-4">
                        {rule.commission_type === 'percentage' ? (
                          <span>{rule.commission_value}%</span>
                        ) : (
                          <span>₹{rule.commission_value}</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        ₹{rule.min_sale_amount.toLocaleString('en-IN')}
                      </td>
                      <td className="py-4 px-4">
                        {rule.max_commission ? (
                          <span>₹{rule.max_commission.toLocaleString('en-IN')}</span>
                        ) : (
                          <span className="text-text-secondary">Unlimited</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center justify-center gap-2">
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(rule.id)}>
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

