'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Plus, Download, Eye, Loader2, DollarSign, Calendar, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { SalaryPayment } from '@/types/database';
import { format } from 'date-fns';
import Link from 'next/link';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';

interface PaymentWithEmployee extends SalaryPayment {
  employee_name: string;
  employee_code: string;
}

export default function SalaryPaymentsPage() {
  const { business, user } = useAuth();
  
  // Authorization guard: Check if user can read payroll
  // Uses tri-state model: 'loading' | 'allowed' | 'denied'
  const { status: authStatus } = useAuthorizationGuard({
    resource: 'payroll',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });
  
  const [payments, setPayments] = useState<PaymentWithEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'processed' | 'paid' | 'cancelled'>('all');

  useEffect(() => {
    if (business?.id) {
      fetchPayments();
    }
  }, [business?.id, statusFilter]);

  const fetchPayments = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user?.id || '', // Required for authorization
        ...(statusFilter !== 'all' && { status: statusFilter }),
      });

      const res = await fetch(`/api/employees/salary/payments?${params}`);
      if (res.ok) {
        const data = await res.json();
        setPayments(data.payments || []);
      }
    } catch (error) {
      console.error('Error fetching salary payments:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredPayments = payments.filter(payment => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      payment.employee_name?.toLowerCase().includes(searchLower) ||
      payment.employee_code?.toLowerCase().includes(searchLower) ||
      payment.salary_month?.toLowerCase().includes(searchLower)
    );
  });

  // Show loading while checking authorization (tri-state: 'loading')
  if (authStatus === 'loading') {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  // Show access denied only if check completed and denied (tri-state: 'denied')
  if (authStatus === 'denied') {
    return (
      <AccessDenied module="payroll" action="read" />
    );
  }

  // authStatus === 'allowed' - render page content

  return (
    
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Salary Payments</h1>
            <p className="text-sm text-text-secondary mt-1">Manage employee salary payments</p>
          </div>
          <Link href="/employees/salary/payments/new">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Process Salary
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
                <option value="processed">Processed</option>
                <option value="paid">Paid</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
        </Card>

        <Card>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : filteredPayments.length === 0 ? (
            <div className="text-center py-12">
              <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-text-secondary">No salary payments found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Employee</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Salary Month</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Payment Date</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Gross Salary</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Deductions</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Net Salary</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Status</th>
                    <th className="text-center py-3 px-4 font-semibold text-text-primary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.map((payment) => (
                    <tr key={payment.id} className="border-b border-border hover:bg-gray-50">
                      <td className="py-4 px-4">
                        <div className="font-medium">{payment.employee_name}</div>
                        <div className="text-sm text-text-secondary">{payment.employee_code}</div>
                      </td>
                      <td className="py-4 px-4">{payment.salary_month}</td>
                      <td className="py-4 px-4">
                        {format(new Date(payment.payment_date), 'dd MMM yyyy')}
                      </td>
                      <td className="py-4 px-4 text-right">
                        ₹{Number(payment.gross_salary).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-4 text-right">
                        ₹{Number(payment.total_deductions).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-4 text-right font-semibold">
                        ₹{Number(payment.net_salary).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-4">
                        <span className={`px-2 py-1 rounded-md text-xs font-medium ${
                          payment.status === 'paid' ? 'bg-green-100 text-green-800' :
                          payment.status === 'processed' ? 'bg-slate-100 text-primary-800' :
                          payment.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center justify-center gap-2">
                          <Link href={`/employees/salary/payslips/${payment.id}`}>
                            <Button size="sm" variant="ghost">
                              <Eye className="w-4 h-4" />
                            </Button>
                          </Link>
                          <a
                            href={`/api/employees/salary/payslips/${payment.id}/pdf?business_id=${business?.id}`}
                            target="_blank"
                            download
                          >
                            <Button size="sm" variant="ghost">
                              <Download className="w-4 h-4" />
                            </Button>
                          </a>
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

