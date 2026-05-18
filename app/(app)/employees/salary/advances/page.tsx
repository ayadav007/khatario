'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Plus, CheckCircle, XCircle, Loader2, DollarSign, Search, Calendar } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { SalaryAdvance } from '@/types/database';
import { format } from 'date-fns';
import Link from 'next/link';
import { useToastContext } from '@/contexts/ToastContext';

interface AdvanceWithEmployee extends SalaryAdvance {
  employee_name: string;
  employee_code: string;
}

export default function SalaryAdvancesPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [advances, setAdvances] = useState<AdvanceWithEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'recovered' | 'partially_recovered'>('all');

  useEffect(() => {
    if (business?.id) {
      fetchAdvances();
    }
  }, [business?.id, statusFilter]);

  const fetchAdvances = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user?.id || '', // Required for authorization
        ...(statusFilter !== 'all' && { status: statusFilter }),
      });

      const res = await fetch(`/api/employees/salary/advances?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAdvances(data.advances || []);
      }
    } catch (error) {
      console.error('Error fetching salary advances:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string, approved: boolean, rejectionReason?: string) => {
    if (!business?.id) return;

    try {
      const res = await fetch(`/api/employees/salary/advances/${id}/approve?business_id=${business.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approved,
          approved_by: user?.id,
          rejection_reason: rejectionReason,
          payment_mode: approved ? 'bank_transfer' : undefined,
        }),
      });

      if (res.ok) {
        await fetchAdvances();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to update advance');
      }
    } catch (error) {
      console.error('Error updating advance:', error);
      toast.error('An unexpected error occurred');
    }
  };

  const filteredAdvances = advances.filter(advance => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      advance.employee_name?.toLowerCase().includes(searchLower) ||
      advance.employee_code?.toLowerCase().includes(searchLower)
    );
  });

  return (
    
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Salary Advances</h1>
            <p className="text-sm text-text-secondary mt-1">Manage employee salary advances</p>
          </div>
          <Link href="/employees/salary/advances/new">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Request Advance
            </Button>
          </Link>
        </div>

        <Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-secondary w-4 h-4" />
              <Input
                placeholder="Search by employee name or code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="input"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="partially_recovered">Partially Recovered</option>
                <option value="recovered">Recovered</option>
              </select>
            </div>
          </div>
        </Card>

        <Card>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : filteredAdvances.length === 0 ? (
            <div className="text-center py-12">
              <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-text-secondary">No salary advances found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Employee</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Advance Date</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Amount</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Recovered</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Remaining</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Status</th>
                    <th className="text-center py-3 px-4 font-semibold text-text-primary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAdvances.map((advance) => (
                    <tr key={advance.id} className="border-b border-border hover:bg-gray-50">
                      <td className="py-4 px-4">
                        <div className="font-medium">{advance.employee_name}</div>
                        <div className="text-sm text-text-secondary">{advance.employee_code}</div>
                      </td>
                      <td className="py-4 px-4">
                        {format(new Date(advance.advance_date), 'dd MMM yyyy')}
                      </td>
                      <td className="py-4 px-4 text-right">
                        ₹{Number(advance.advance_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-4 text-right">
                        ₹{Number(advance.recovered_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-4 text-right font-semibold">
                        ₹{Number(advance.remaining_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-4">
                        <span className={`px-2 py-1 rounded-md text-xs font-medium ${
                          advance.status === 'approved' ? 'bg-green-100 text-green-800' :
                          advance.status === 'recovered' ? 'bg-slate-100 text-primary-800' :
                          advance.status === 'partially_recovered' ? 'bg-yellow-100 text-yellow-800' :
                          advance.status === 'rejected' ? 'bg-red-100 text-red-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {advance.status.replace('_', ' ').charAt(0).toUpperCase() + advance.status.replace('_', ' ').slice(1)}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        {advance.status === 'pending' && (
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleApprove(advance.id, true)}
                              className="text-green-600 hover:text-green-700"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                const reason = prompt('Enter rejection reason:');
                                if (reason) {
                                  handleApprove(advance.id, false, reason);
                                }
                              }}
                              className="text-red-600 hover:text-red-700"
                            >
                              <XCircle className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
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

