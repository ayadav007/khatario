'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Receipt, Plus, CheckCircle, XCircle, Clock, DollarSign, Loader2, Filter, Download, Eye, Printer } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { EmployeeExpense } from '@/types/database';
import { format } from 'date-fns';
import Link from 'next/link';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useToastContext } from '@/contexts/ToastContext';
import { DeleteAction } from '@/components/common/DeleteAction';

interface ExpenseWithDetails extends EmployeeExpense {
  employee_code: string;
  employee_name: string;
  category_name?: string;
  approver_code?: string;
  approver_name?: string;
}

export default function ExpensesPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  
  // Authorization guard: Check if user can read expenses
  // Uses tri-state model: 'loading' | 'allowed' | 'denied'
  const { status: authStatus } = useAuthorizationGuard({
    resource: 'expenses',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });
  
  const [expenses, setExpenses] = useState<ExpenseWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'reimbursed' | 'cancelled'>('all');
  const [startDate, setStartDate] = useState(format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [printingVoucher, setPrintingVoucher] = useState<string | null>(null);
  const [downloadingVoucher, setDownloadingVoucher] = useState<string | null>(null);

  const handlePrintVoucher = async (expenseId: string) => {
    try {
      setPrintingVoucher(expenseId);
      const res = await fetch(`/api/employees/expenses/${expenseId}/voucher`);
      if (res.ok) {
        const { html } = await res.json();
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(html);
          printWindow.document.close();
          printWindow.focus();
          setTimeout(() => {
            printWindow.print();
          }, 500);
        }
      }
    } catch (error) {
      console.error('Error printing voucher:', error);
    } finally {
      setPrintingVoucher(null);
    }
  };

  const handleDownloadVoucher = async (expenseId: string) => {
    try {
      setDownloadingVoucher(expenseId);
      const res = await fetch(`/api/employees/expenses/${expenseId}/voucher/pdf`);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Voucher-${expenseId.substring(0, 8)}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (error) {
      console.error('Error downloading voucher:', error);
    } finally {
      setDownloadingVoucher(null);
    }
  };
  const [totals, setTotals] = useState({ pending: 0, approved: 0, reimbursed: 0, total: 0 });

  useEffect(() => {
    if (business?.id) {
      fetchExpenses();
    }
  }, [business?.id, statusFilter, startDate, endDate]);

  const fetchExpenses = async () => {
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

      const res = await fetch(`/api/employees/expenses?${params}`);
      if (res.ok) {
        const data = await res.json();
        setExpenses(data.expenses || []);
        setTotals(data.totals || { pending: 0, approved: 0, reimbursed: 0, total: 0 });
      }
    } catch (error) {
      console.error('Error fetching expenses:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (expenseId: string, action: 'approve' | 'reject' | 'reimburse' | 'cancel', rejectionReason?: string, reimbursementRef?: string) => {
    if (!business?.id) return;

    setProcessingId(expenseId);
    try {
      const res = await fetch(`/api/employees/expenses/${expenseId}?business_id=${business.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          approved_by: user?.id || null,
          rejection_reason: rejectionReason,
          reimbursement_reference: reimbursementRef,
          updated_by_user_id: user?.id, // Required for authorization
        }),
      });

      if (res.ok) {
        await fetchExpenses();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to update expense');
      }
    } catch (error) {
      console.error('Error updating expense:', error);
      toast.error('Failed to update expense. Please try again.');
    } finally {
      setProcessingId(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      case 'reimbursed':
        return 'bg-slate-100 text-primary-800';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800';
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
      case 'rejected':
        return <XCircle className="w-4 h-4" />;
      case 'reimbursed':
        return <DollarSign className="w-4 h-4" />;
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
      <AccessDenied module="expenses" action="read" />
    );
  }

  // authStatus === 'allowed' - render page content

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Expense Management</h1>
            <p className="text-sm text-text-secondary mt-1">View and manage employee expenses</p>
          </div>
          <Link href="/employees/expenses/new">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Submit Expense
            </Button>
          </Link>
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
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Reimbursed</p>
                <p className="text-2xl font-bold text-text-primary">₹{totals.reimbursed.toLocaleString('en-IN')}</p>
              </div>
              <DollarSign className="w-8 h-8 text-primary-500" />
            </div>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Total</p>
                <p className="text-2xl font-bold text-text-primary">₹{totals.total.toLocaleString('en-IN')}</p>
              </div>
              <Receipt className="w-8 h-8 text-primary-500" />
            </div>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                <option value="rejected">Rejected</option>
                <option value="reimbursed">Reimbursed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button onClick={fetchExpenses} className="w-full">
                <Filter className="w-4 h-4 mr-2" />
                Filter
              </Button>
            </div>
          </div>
        </Card>

        {/* Expenses List */}
        <Card>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : expenses.length === 0 ? (
            <div className="text-center py-12">
              <Receipt className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-text-secondary">No expenses found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Employee</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Category</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Date</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Description</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Amount</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Status</th>
                    <th className="text-center py-3 px-4 font-semibold text-text-primary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((exp) => (
                    <tr
                      key={exp.id}
                      className="border-b border-border hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-4 px-4">
                        <div>
                          <div className="font-medium text-text-primary">{exp.employee_name}</div>
                          <div className="text-sm text-text-secondary font-mono">
                            {exp.employee_code}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        {exp.category_name || <span className="text-text-secondary">—</span>}
                      </td>
                      <td className="py-4 px-4">
                        {format(new Date(exp.expense_date), 'dd MMM yyyy')}
                      </td>
                      <td className="py-4 px-4">
                        <div className="max-w-xs truncate" title={exp.description}>
                          {exp.description}
                        </div>
                        {exp.receipt_url && (
                          <a
                            href={exp.receipt_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary-600 hover:underline flex items-center gap-1 mt-1"
                          >
                            <Eye className="w-3 h-3" />
                            View Receipt
                          </a>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className="font-medium">₹{exp.amount.toLocaleString('en-IN')}</span>
                      </td>
                      <td className="py-4 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${getStatusColor(exp.status)}`}>
                          {getStatusIcon(exp.status)}
                          {exp.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center justify-center gap-2">
                          {exp.status === 'pending' && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => handleAction(exp.id, 'approve')}
                                disabled={processingId === exp.id}
                              >
                                {processingId === exp.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  'Approve'
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  const reason = prompt('Enter rejection reason:');
                                  if (reason) {
                                    handleAction(exp.id, 'reject', reason);
                                  }
                                }}
                                disabled={processingId === exp.id}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {exp.status === 'approved' && (
                            <Button
                              size="sm"
                              onClick={() => {
                                const ref = prompt('Enter reimbursement reference:');
                                if (ref) {
                                  handleAction(exp.id, 'reimburse', undefined, ref);
                                }
                              }}
                              disabled={processingId === exp.id}
                            >
                              {processingId === exp.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                'Mark Reimbursed'
                              )}
                            </Button>
                          )}
                          {(exp.status === 'pending' || exp.status === 'approved') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleAction(exp.id, 'cancel')}
                              disabled={processingId === exp.id}
                            >
                              Cancel
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handlePrintVoucher(exp.id)}
                            disabled={!!printingVoucher || !!downloadingVoucher}
                            title="Print Voucher"
                          >
                            {printingVoucher === exp.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Printer className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownloadVoucher(exp.id)}
                            disabled={!!printingVoucher || !!downloadingVoucher}
                            title="Download Voucher"
                          >
                            {downloadingVoucher === exp.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                          </Button>
                          <DeleteAction
                            entityName="expense"
                            variant="delete"
                            disabled={!(exp.status === 'pending' || exp.status === 'cancelled')}
                            disabledTooltip="Only pending items can be deleted"
                            deleteFn={async () => {
                              if (!business?.id || !user?.id) throw new Error('Missing business/user context');
                              const res = await fetch(
                                `/api/employees/expenses/${exp.id}?business_id=${business.id}&user_id=${user.id}`,
                                { method: 'DELETE' }
                              );
                              const data = await res.json().catch(() => ({}));
                              if (!res.ok) throw new Error(data?.error || 'Failed to delete expense');
                            }}
                            onSuccess={fetchExpenses}
                          />
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

