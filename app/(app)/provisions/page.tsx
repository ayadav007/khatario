'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Plus, Edit, Trash2, DollarSign, Calendar, FileText, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { useToastContext } from '@/contexts/ToastContext';

interface Provision {
  id: string;
  provision_code: string;
  provision_name: string;
  provision_type: string;
  current_balance?: number;
  entries_count?: number;
}

interface ProvisionEntry {
  id: string;
  entry_date: string;
  entry_type: 'addition' | 'reversal' | 'utilization';
  amount: number;
  opening_balance: number;
  closing_balance: number;
  narration?: string;
}

export default function ProvisionsPage() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [provisions, setProvisions] = useState<Provision[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedProvision, setSelectedProvision] = useState<Provision | null>(null);
  const [entries, setEntries] = useState<ProvisionEntry[]>([]);
  const [showEntries, setShowEntries] = useState<string | null>(null);
  const [financialYear, setFinancialYear] = useState(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const month = now.getMonth();
    // Financial year: April to March
    if (month >= 3) {
      return `${currentYear}-${currentYear + 1}`;
    } else {
      return `${currentYear - 1}-${currentYear}`;
    }
  });

  const [formData, setFormData] = useState({
    provision_code: '',
    provision_name: '',
    provision_type: 'bad_debts',
    provision_account_id: '',
    expense_account_id: '',
    calculation_method: '',
    calculation_rate: '',
    description: '',
  });

  useEffect(() => {
    if (business?.id) {
      fetchProvisions();
    }
  }, [business?.id, financialYear]);

  const fetchProvisions = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const res = await fetch(
        `/api/provisions?business_id=${business.id}&financial_year=${financialYear}`
      );
      if (res.ok) {
        const data = await res.json();
        setProvisions(data.provisions || []);
      }
    } catch (error) {
      console.error('Error fetching provisions:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchEntries = async (provisionId: string) => {
    if (!business?.id) return;

    try {
      const res = await fetch(
        `/api/provisions/${provisionId}/entries?business_id=${business.id}&financial_year=${financialYear}`
      );
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch (error) {
      console.error('Error fetching entries:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    try {
      const payload = {
        business_id: business.id,
        ...formData,
        calculation_rate: formData.calculation_rate ? parseFloat(formData.calculation_rate) : null,
      };

      const res = await fetch('/api/provisions', {
        method: selectedProvision ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedProvision ? { ...payload, id: selectedProvision.id } : payload),
      });

      if (res.ok) {
        setShowForm(false);
        setSelectedProvision(null);
        setFormData({
          provision_code: '',
          provision_name: '',
          provision_type: 'bad_debts',
          provision_account_id: '',
          expense_account_id: '',
          calculation_method: '',
          calculation_rate: '',
          description: '',
        });
        fetchProvisions();
      }
    } catch (error) {
      console.error('Error saving provision:', error);
      toast.error('Failed to save provision');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this provision?')) return;
    if (!business?.id) return;

    try {
      const res = await fetch(`/api/provisions/${id}?business_id=${business.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        fetchProvisions();
      }
    } catch (error) {
      console.error('Error deleting provision:', error);
      toast.error('Failed to delete provision');
    }
  };

  const handleEdit = (provision: Provision) => {
    setSelectedProvision(provision);
    setFormData({
      provision_code: provision.provision_code,
      provision_name: provision.provision_name,
      provision_type: provision.provision_type,
      provision_account_id: '',
      expense_account_id: '',
      calculation_method: '',
      calculation_rate: '',
      description: '',
    });
    setShowForm(true);
  };

  const toggleEntries = (provisionId: string) => {
    if (showEntries === provisionId) {
      setShowEntries(null);
      setEntries([]);
    } else {
      setShowEntries(provisionId);
      fetchEntries(provisionId);
    }
  };

  const totalProvisions = provisions.reduce(
    (sum, p) => sum + (p.current_balance || 0),
    0
  );

  const provisionTypes = [
    { value: 'bad_debts', label: 'Bad Debts' },
    { value: 'warranty', label: 'Warranty' },
    { value: 'gratuity', label: 'Gratuity' },
    { value: 'leave_encashment', label: 'Leave Encashment' },
    { value: 'employee_benefits', label: 'Employee Benefits' },
    { value: 'litigation', label: 'Litigation' },
    { value: 'others', label: 'Others' },
  ];

  if (loading && provisions.length === 0) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
            <p className="mt-4 text-text-secondary">Loading provisions...</p>
          </div>
        </div>
      
    );
  }

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Provisions Management</h1>
            <p className="text-sm text-text-secondary mt-1">
              Manage provisions for financial reporting
            </p>
          </div>
          <Button onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Provision
          </Button>
        </div>

        {/* Financial Year Selector */}
        <Card>
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium text-text-primary">Financial Year:</label>
            <Input
              type="text"
              value={financialYear}
              onChange={(e) => setFinancialYear(e.target.value)}
              placeholder="e.g., 2024-2025"
              className="w-40"
            />
          </div>
        </Card>

        {/* Summary Card */}
        <Card className="bg-gradient-to-br from-slate-50 to-indigo-50 border-primary-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-primary-600 mb-1">Total Provisions</p>
              <p className="text-3xl font-bold text-text-primary">
                ₹{totalProvisions.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-text-secondary mt-1">
                {provisions.length} provision{provisions.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="bg-slate-100 p-3 rounded-lg">
              <DollarSign className="w-6 h-6 text-primary-600" />
            </div>
          </div>
        </Card>

        {/* Provisions List */}
        <Card>
          <div className="space-y-4">
            {provisions.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 text-text-secondary mx-auto mb-4" />
                <p className="text-text-secondary">No provisions found</p>
                <Button
                  onClick={() => setShowForm(true)}
                  className="mt-4"
                  variant="secondary"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Provision
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {provisions.map((provision) => (
                  <div
                    key={provision.id}
                    className="border border-border rounded-lg p-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-text-primary">
                            {provision.provision_name}
                          </h3>
                          <span className="text-xs px-2 py-1 bg-slate-100 text-primary-700 rounded">
                            {provision.provision_code}
                          </span>
                          <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded capitalize">
                            {provision.provision_type.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-text-secondary">
                          <span>
                            Balance: ₹
                            {(provision.current_balance || 0).toLocaleString('en-IN', {
                              minimumFractionDigits: 2,
                            })}
                          </span>
                          {provision.entries_count !== undefined && (
                            <span>{provision.entries_count} entries</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleEntries(provision.id)}
                        >
                          <Calendar className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(provision)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(provision.id)}
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </Button>
                      </div>
                    </div>

                    {/* Entries List */}
                    {showEntries === provision.id && entries.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-border">
                        <h4 className="text-sm font-semibold mb-2">Provision Entries</h4>
                        <div className="space-y-2">
                          {entries.map((entry) => (
                            <div
                              key={entry.id}
                              className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm"
                            >
                              <div className="flex items-center gap-4">
                                <span className="text-text-secondary">
                                  {format(new Date(entry.entry_date), 'dd MMM yyyy')}
                                </span>
                                <span className="capitalize">{entry.entry_type}</span>
                                {entry.narration && (
                                  <span className="text-text-secondary">{entry.narration}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-4">
                                <span className="text-text-secondary">
                                  Opening: ₹
                                  {entry.opening_balance.toLocaleString('en-IN', {
                                    minimumFractionDigits: 2,
                                  })}
                                </span>
                                <span
                                  className={
                                    entry.entry_type === 'addition'
                                      ? 'text-red-600'
                                      : 'text-green-600'
                                  }
                                >
                                  {entry.entry_type === 'addition' ? '+' : '-'}₹
                                  {entry.amount.toLocaleString('en-IN', {
                                    minimumFractionDigits: 2,
                                  })}
                                </span>
                                <span className="font-semibold">
                                  Closing: ₹
                                  {entry.closing_balance.toLocaleString('en-IN', {
                                    minimumFractionDigits: 2,
                                  })}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Create/Edit Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-text-primary">
                  {selectedProvision ? 'Edit Provision' : 'Create New Provision'}
                </h2>
                <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Provision Code"
                    value={formData.provision_code}
                    onChange={(e) =>
                      setFormData({ ...formData, provision_code: e.target.value })
                    }
                    required
                    placeholder="e.g., PROV-001"
                  />

                  <Input
                    label="Provision Name"
                    value={formData.provision_name}
                    onChange={(e) =>
                      setFormData({ ...formData, provision_name: e.target.value })
                    }
                    required
                    placeholder="e.g., Provision for Bad Debts"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Provision Type
                  </label>
                  <select
                    value={formData.provision_type}
                    onChange={(e) =>
                      setFormData({ ...formData, provision_type: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-border rounded-md bg-background"
                    required
                  >
                    {provisionTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Provision Account ID"
                    value={formData.provision_account_id}
                    onChange={(e) =>
                      setFormData({ ...formData, provision_account_id: e.target.value })
                    }
                    placeholder="Account ID for provision liability"
                  />

                  <Input
                    label="Expense Account ID"
                    value={formData.expense_account_id}
                    onChange={(e) =>
                      setFormData({ ...formData, expense_account_id: e.target.value })
                    }
                    placeholder="Account ID for provision expense"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Calculation Method"
                    value={formData.calculation_method}
                    onChange={(e) =>
                      setFormData({ ...formData, calculation_method: e.target.value })
                    }
                    placeholder="e.g., percentage, aging"
                  />

                  <Input
                    label="Calculation Rate (%)"
                    type="number"
                    step="0.01"
                    value={formData.calculation_rate}
                    onChange={(e) =>
                      setFormData({ ...formData, calculation_rate: e.target.value })
                    }
                    placeholder="e.g., 5.0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-border rounded-md bg-background"
                    rows={3}
                    placeholder="Additional notes about this provision"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-border">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setShowForm(false);
                      setSelectedProvision(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">
                    {selectedProvision ? 'Update' : 'Create'} Provision
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}
      </div>
    
  );
}

