'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { DollarSign, Loader2, ArrowLeft, Plus, Filter } from 'lucide-react';
import { format } from 'date-fns';
import { useToastContext } from '@/contexts/ToastContext';

interface TDSPayment {
  id: string;
  financial_year: string;
  quarter: string;
  challan_number: string;
  challan_date: string;
  deposit_date: string;
  total_tds_amount: number;
  bank_name?: string;
  payment_mode?: string;
  payment_reference?: string;
  status: string;
  notes?: string;
  created_at: string;
}

export default function TDSPaymentsPage() {
  const router = useRouter();
  const { business } = useAuth();
  const toast = useToastContext();
  const [payments, setPayments] = useState<TDSPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState({
    financial_year: '',
    quarter: ''
  });
  const [formData, setFormData] = useState({
    financial_year: '',
    quarter: '',
    challan_number: '',
    challan_date: '',
    deposit_date: '',
    total_tds_amount: '',
    bank_name: '',
    payment_mode: '',
    payment_reference: '',
    notes: ''
  });

  useEffect(() => {
    if (business?.id) {
      fetchPayments();
    }
  }, [business?.id, filters]);

  const fetchPayments = async () => {
    if (!business?.id) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams({ business_id: business.id });
      if (filters.financial_year) params.append('financial_year', filters.financial_year);
      if (filters.quarter) params.append('quarter', filters.quarter);

      const response = await fetch(`/api/tds/payments?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setPayments(data.payments || []);
      } else {
        toast.error('Failed to load TDS payments');
      }
    } catch (error) {
      console.error('Error fetching TDS payments:', error);
      toast.error('Failed to load TDS payments');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    if (!formData.financial_year || !formData.quarter || !formData.challan_number || 
        !formData.challan_date || !formData.deposit_date || !formData.total_tds_amount) {
      toast.warning('Please fill all required fields');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/tds/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          financial_year: formData.financial_year,
          quarter: formData.quarter,
          challan_number: formData.challan_number.trim(),
          challan_date: formData.challan_date,
          deposit_date: formData.deposit_date,
          total_tds_amount: parseFloat(formData.total_tds_amount),
          bank_name: formData.bank_name.trim() || null,
          payment_mode: formData.payment_mode.trim() || null,
          payment_reference: formData.payment_reference.trim() || null,
          notes: formData.notes.trim() || null
        })
      });

      if (response.ok) {
        toast.success('TDS payment recorded successfully');
        setFormData({
          financial_year: '',
          quarter: '',
          challan_number: '',
          challan_date: '',
          deposit_date: '',
          total_tds_amount: '',
          bank_name: '',
          payment_mode: '',
          payment_reference: '',
          notes: ''
        });
        setShowAddForm(false);
        fetchPayments();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to record payment');
      }
    } catch (error) {
      console.error('Error recording payment:', error);
      toast.error('Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  const currentYear = new Date().getFullYear();
  const financialYears = Array.from({ length: 5 }, (_, i) => currentYear - i);
  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];

  return (
    
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/tds')}
              className="p-2 rounded-lg hover:bg-gray-100 transition"
              title="Back to TDS"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">TDS Payments</h1>
              <p className="text-gray-600 text-sm mt-1">Record TDS deposits to government</p>
            </div>
          </div>
          <Button onClick={() => setShowAddForm(!showAddForm)} variant={showAddForm ? 'secondary' : 'primary'}>
            <Plus className="w-4 h-4 mr-2" />
            {showAddForm ? 'Close' : 'Record Payment'}
          </Button>
        </div>

        {/* Add Form */}
        {showAddForm && (
          <Card padding="lg">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Record TDS Payment</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Financial Year *</label>
                  <select
                    value={formData.financial_year}
                    onChange={(e) => setFormData({ ...formData, financial_year: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    required
                  >
                    <option value="">Select Year</option>
                    {financialYears.map(year => (
                      <option key={year} value={year}>{year}-{year + 1}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quarter *</label>
                  <select
                    value={formData.quarter}
                    onChange={(e) => setFormData({ ...formData, quarter: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    required
                  >
                    <option value="">Select Quarter</option>
                    {quarters.map(q => (
                      <option key={q} value={q}>{q}</option>
                    ))}
                  </select>
                </div>
                <Input
                  label="Challan Number *"
                  value={formData.challan_number}
                  onChange={(e) => setFormData({ ...formData, challan_number: e.target.value })}
                  placeholder="e.g., CH123456"
                  required
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input
                  label="Challan Date *"
                  type="date"
                  value={formData.challan_date}
                  onChange={(e) => setFormData({ ...formData, challan_date: e.target.value })}
                  required
                />
                <Input
                  label="Deposit Date *"
                  type="date"
                  value={formData.deposit_date}
                  onChange={(e) => setFormData({ ...formData, deposit_date: e.target.value })}
                  required
                />
                <Input
                  label="Total TDS Amount *"
                  type="number"
                  step="0.01"
                  value={formData.total_tds_amount}
                  onChange={(e) => setFormData({ ...formData, total_tds_amount: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input
                  label="Bank Name"
                  value={formData.bank_name}
                  onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                  placeholder="Optional"
                />
                <Input
                  label="Payment Mode"
                  value={formData.payment_mode}
                  onChange={(e) => setFormData({ ...formData, payment_mode: e.target.value })}
                  placeholder="e.g., NEFT, RTGS"
                />
                <Input
                  label="Payment Reference"
                  value={formData.payment_reference}
                  onChange={(e) => setFormData({ ...formData, payment_reference: e.target.value })}
                  placeholder="Transaction reference"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Optional notes"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Recording...' : 'Record Payment'}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setShowAddForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Filters */}
        <Card padding="md">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-5 h-5 text-gray-600" />
            <h3 className="font-semibold text-gray-900">Filters</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Financial Year</label>
              <select
                value={filters.financial_year}
                onChange={(e) => setFilters({ ...filters, financial_year: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">All Years</option>
                {financialYears.map(year => (
                  <option key={year} value={year}>{year}-{year + 1}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quarter</label>
              <select
                value={filters.quarter}
                onChange={(e) => setFilters({ ...filters, quarter: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">All Quarters</option>
                {quarters.map(q => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <Button
                variant="secondary"
                onClick={() => setFilters({ financial_year: '', quarter: '' })}
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </Card>

        {/* Payments List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
          </div>
        ) : payments.length === 0 ? (
          <Card padding="lg">
            <div className="text-center text-gray-500">
              <DollarSign className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>No TDS payments recorded</p>
              <p className="text-sm mt-1">Record a payment to get started</p>
            </div>
          </Card>
        ) : (
          <Card padding="none">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Challan Number</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Challan Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Deposit Date</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">FY/Quarter</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bank</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {payments.map((payment) => (
                    <tr key={payment.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {payment.challan_number}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {format(new Date(payment.challan_date), 'dd MMM yyyy')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {format(new Date(payment.deposit_date), 'dd MMM yyyy')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                        ₹{Number(payment.total_tds_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {payment.financial_year} {payment.quarter}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {payment.bank_name || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                          {payment.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
              <div className="flex justify-between items-center">
                <p className="text-sm text-gray-600">
                  Total: {payments.length} payment{payments.length !== 1 ? 's' : ''}
                </p>
                <p className="text-sm font-semibold text-gray-900">
                  Total Amount: ₹{payments.reduce((sum, p) => sum + Number(p.total_tds_amount), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </Card>
        )}
      </div>
    
  );
}

