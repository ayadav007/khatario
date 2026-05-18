'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Search, Filter, Download, CheckCircle, XCircle, Clock, DollarSign, Loader2, Calendar } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { CommissionEarning } from '@/types/database';
import { format } from 'date-fns';
import Link from 'next/link';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useToastContext } from '@/contexts/ToastContext';

interface CommissionWithDetails extends CommissionEarning {
  employee_code: string;
  employee_name: string;
  invoice_number: string;
  invoice_date: Date;
  invoice_total: number;
}

export default function CommissionsPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  
  // Authorization guard: Check if user can read commissions
  // Uses tri-state model: 'loading' | 'allowed' | 'denied'
  const { status: authStatus } = useAuthorizationGuard({
    resource: 'commissions',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });
  
  const [commissions, setCommissions] = useState<CommissionWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'paid' | 'cancelled'>('all');
  const [startDate, setStartDate] = useState(format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [totals, setTotals] = useState({ pending: 0, approved: 0, paid: 0, total: 0 });
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    if (business?.id) {
      fetchCommissions();
    }
  }, [business?.id, statusFilter, startDate, endDate]);

  const fetchCommissions = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user?.id || '', // Required for authorization
        ...(statusFilter !== 'all' && { status: statusFilter }),
        start_date: startDate,
        end_date: endDate,
      });

      const res = await fetch(`/api/employees/commissions?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCommissions(data.commissions || []);
        setTotals(data.totals || { pending: 0, approved: 0, paid: 0, total: 0 });
      }
    } catch (error) {
      console.error('Error fetching commissions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (commissionId: string, action: 'approve' | 'pay' | 'cancel') => {
    if (!business?.id) return;

    setProcessingId(commissionId);
    try {
      const res = await fetch('/api/employees/commissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commission_id: commissionId,
          action,
          approved_by: user?.id || null,
          updated_by_user_id: user?.id, // Required for authorization
        }),
      });

      if (res.ok) {
        await fetchCommissions();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to update commission');
      }
    } catch (error) {
      console.error('Error updating commission:', error);
      toast.error('Failed to update commission. Please try again.');
    } finally {
      setProcessingId(null);
    }
  };

  const filteredCommissions = commissions.filter((comm) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      comm.employee_code.toLowerCase().includes(searchLower) ||
      comm.employee_name.toLowerCase().includes(searchLower) ||
      comm.invoice_number.toLowerCase().includes(searchLower)
    );
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'approved':
        return 'bg-slate-100 text-primary-800';
      case 'paid':
        return 'bg-green-100 text-green-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4" />;
      case 'approved':
        return <CheckCircle className="w-4 h-4" />;
      case 'paid':
        return <CheckCircle className="w-4 h-4" />;
      case 'cancelled':
        return <XCircle className="w-4 h-4" />;
      default:
        return null;
    }
  };

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
      <AccessDenied module="commissions" action="read" />
    );
  }

  // authStatus === 'allowed' - render page content

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Commission Management</h1>
            <p className="text-sm text-text-secondary mt-1">View and manage employee commissions</p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Pending</p>
                <p className="text-2xl font-bold text-text-primary">₹{totals.pending.toLocaleString('en-IN')}</p>
              </div>
              <Clock className="w-8 h-8 text-yellow-500" />
            </div>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Approved</p>
                <p className="text-2xl font-bold text-text-primary">₹{totals.approved.toLocaleString('en-IN')}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-primary-500" />
            </div>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Paid</p>
                <p className="text-2xl font-bold text-text-primary">₹{totals.paid.toLocaleString('en-IN')}</p>
              </div>
              <DollarSign className="w-8 h-8 text-green-500" />
            </div>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Total</p>
                <p className="text-2xl font-bold text-text-primary">₹{totals.total.toLocaleString('en-IN')}</p>
              </div>
              <DollarSign className="w-8 h-8 text-primary-500" />
            </div>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <Input
                type="text"
                placeholder="Search by employee or invoice..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Input
              label="Start Date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              label="End Date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="input"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="paid">Paid</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Commissions List */}
        <Card>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : filteredCommissions.length === 0 ? (
            <div className="text-center py-12">
              <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-text-secondary">No commission records found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Employee</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Invoice</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Sale Amount</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Commission Rate</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Commission</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Status</th>
                    <th className="text-center py-3 px-4 font-semibold text-text-primary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCommissions.map((comm) => (
                    <tr
                      key={comm.id}
                      className="border-b border-border hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-4 px-4">
                        <div>
                          <div className="font-medium text-text-primary">{comm.employee_name}</div>
                          <div className="text-sm text-text-secondary font-mono">
                            {comm.employee_code}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <Link href={`/invoices/${comm.invoice_id}`} className="text-primary-600 hover:underline">
                          {comm.invoice_number}
                        </Link>
                        <div className="text-xs text-text-secondary">
                          {format(new Date(comm.invoice_date), 'dd MMM yyyy')}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className="font-medium">₹{comm.sale_amount.toLocaleString('en-IN')}</span>
                      </td>
                      <td className="py-4 px-4">
                        {comm.commission_rate > 0 ? (
                          <span>{comm.commission_rate}%</span>
                        ) : (
                          <span className="text-text-secondary">Fixed</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <span className="font-bold text-primary-600">
                          ₹{comm.commission_amount.toLocaleString('en-IN')}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${getStatusColor(comm.status)}`}>
                          {getStatusIcon(comm.status)}
                          {comm.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center justify-center gap-2">
                          {comm.status === 'pending' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleAction(comm.id, 'approve')}
                              disabled={processingId === comm.id}
                            >
                              {processingId === comm.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                'Approve'
                              )}
                            </Button>
                          )}
                          {comm.status === 'approved' && (
                            <Button
                              size="sm"
                              onClick={() => handleAction(comm.id, 'pay')}
                              disabled={processingId === comm.id}
                            >
                              {processingId === comm.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                'Mark Paid'
                              )}
                            </Button>
                          )}
                          {(comm.status === 'pending' || comm.status === 'approved') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleAction(comm.id, 'cancel')}
                              disabled={processingId === comm.id}
                            >
                              Cancel
                            </Button>
                          )}
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

