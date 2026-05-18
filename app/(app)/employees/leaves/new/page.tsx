'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ArrowLeft, Loader2, Calendar, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import Link from 'next/link';
import { format } from 'date-fns';
import { useToastContext } from '@/contexts/ToastContext';

interface LeaveType {
  id: string;
  leave_name: string;
  leave_code: string;
  max_days_per_year?: number;
}

interface Employee {
  id: string;
  name: string;
  employee_code: string;
}

export default function NewLeaveRequestPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'leave_requests',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [calculatedDays, setCalculatedDays] = useState<number | null>(null);
  const [balanceInfo, setBalanceInfo] = useState<{ current: number; sufficient: boolean } | null>(null);

  const [formData, setFormData] = useState({
    employee_id: '',
    leave_type_id: '',
    start_date: '',
    end_date: '',
    reason: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (business?.id) {
      fetchLeaveTypes();
      fetchEmployees();
    }
  }, [business?.id]);

  useEffect(() => {
    if (formData.start_date && formData.end_date && formData.leave_type_id && formData.employee_id && business?.id) {
      calculateDays();
      checkBalance();
    } else {
      setCalculatedDays(null);
      setBalanceInfo(null);
    }
  }, [formData.start_date, formData.end_date, formData.leave_type_id, formData.employee_id, business?.id]);

  const fetchLeaveTypes = async () => {
    if (!business?.id) return;

    try {
      const res = await fetch(`/api/leave-types?business_id=${business.id}&active_only=true`);
      if (res.ok) {
        const data = await res.json();
        setLeaveTypes(data.leave_types || []);
      }
    } catch (error) {
      console.error('Error fetching leave types:', error);
    }
  };

  const fetchEmployees = async () => {
    if (!business?.id) return;

    try {
      const res = await fetch(`/api/employees?business_id=${business.id}&status=active&user_id=${user?.id}`);
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

  const calculateDays = async () => {
    if (!business?.id || !formData.start_date || !formData.end_date) return;

    try {
      const res = await fetch('/api/employees/leave-calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          start_date: formData.start_date,
          end_date: formData.end_date,
        }),
      });

      // For now, calculate client-side (simplified)
      const start = new Date(formData.start_date);
      const end = new Date(formData.end_date);
      let days = 0;
      const current = new Date(start);

      while (current <= end) {
        const dayOfWeek = current.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          days++;
        }
        current.setDate(current.getDate() + 1);
      }

      setCalculatedDays(days);
    } catch (error) {
      console.error('Error calculating days:', error);
    }
  };

  const checkBalance = async () => {
    if (!business?.id || !formData.employee_id || !formData.leave_type_id || !calculatedDays) return;

    try {
      const year = new Date(formData.start_date).getFullYear();
      const res = await fetch(
        `/api/employees/leave-balances?business_id=${business.id}&employee_id=${formData.employee_id}&year=${year}&user_id=${user?.id}`
      );
      if (res.ok) {
        const data = await res.json();
        const balance = data.balances.find((b: any) => b.leave_type_id === formData.leave_type_id);
        if (balance) {
          setBalanceInfo({
            current: balance.current_balance,
            sufficient: balance.current_balance >= calculatedDays,
          });
        } else {
          setBalanceInfo({ current: 0, sufficient: false });
        }
      }
    } catch (error) {
      console.error('Error checking balance:', error);
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.employee_id) newErrors.employee_id = 'Employee is required';
    if (!formData.leave_type_id) newErrors.leave_type_id = 'Leave type is required';
    if (!formData.start_date) newErrors.start_date = 'Start date is required';
    if (!formData.end_date) newErrors.end_date = 'End date is required';

    if (formData.start_date && formData.end_date) {
      const start = new Date(formData.start_date);
      const end = new Date(formData.end_date);
      if (start > end) {
        newErrors.end_date = 'End date must be after start date';
      }
    }

    if (balanceInfo && !balanceInfo.sufficient) {
      newErrors.leave_type_id = `Insufficient leave balance. Available: ${balanceInfo.current} days`;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id || !validateForm()) return;

    setLoading(true);
    try {
      const res = await fetch('/api/employees/leave-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          ...formData,
          created_by: user?.id, // Required for authorization
        }),
      });

      if (res.ok) {
        router.push('/employees/leaves');
        router.refresh();
      } else {
        const errorData = await res.json();
        setErrors({ general: errorData.error || 'Failed to create leave request' });
        toast.error(errorData.error || 'Failed to create leave request');
      }
    } catch (error) {
      console.error('Error creating leave request:', error);
      setErrors({ general: 'An unexpected error occurred' });
      toast.error('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };
  
  // Show authorization denied if user cannot create
  if (!canCreate) {
    return (
      
        <AccessDenied
          module="leave_requests"
          action="create"
          details={reason}
          code="LEAVE_REQUEST_CREATE_DENIED"
        />
      
    );
  }

  return (
    
      <div className="space-y-6">
        <Link href="/employees/leaves">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Leaves
          </Button>
        </Link>

        <Card padding="md">
          <h1 className="text-2xl font-bold text-text-primary mb-6">Request Leave</h1>

          {errors.general && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800">
              {errors.general}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Employee *
                </label>
                <select
                  value={formData.employee_id}
                  onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                  className={`input ${errors.employee_id ? 'border-red-500' : ''}`}
                  required
                >
                  <option value="">Select Employee</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.employee_code})
                    </option>
                  ))}
                </select>
                {errors.employee_id && (
                  <p className="text-xs text-red-500 mt-1">{errors.employee_id}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Leave Type *
                </label>
                <select
                  value={formData.leave_type_id}
                  onChange={(e) => setFormData({ ...formData, leave_type_id: e.target.value })}
                  className={`input ${errors.leave_type_id ? 'border-red-500' : ''}`}
                  required
                >
                  <option value="">Select Leave Type</option>
                  {leaveTypes.map((lt) => (
                    <option key={lt.id} value={lt.id}>
                      {lt.leave_name} ({lt.leave_code})
                    </option>
                  ))}
                </select>
                {errors.leave_type_id && (
                  <p className="text-xs text-red-500 mt-1">{errors.leave_type_id}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Start Date *
                </label>
                <Input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  required
                  error={errors.start_date}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  End Date *
                </label>
                <Input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  required
                  error={errors.end_date}
                />
              </div>
            </div>

            {/* Calculated Days and Balance Info */}
            {calculatedDays !== null && (
              <Card className="p-4 bg-slate-50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-text-secondary">Working Days</p>
                    <p className="text-lg font-semibold text-text-primary">{calculatedDays} days</p>
                  </div>
                  {balanceInfo && (
                    <div className={`p-3 rounded-lg ${balanceInfo.sufficient ? 'bg-green-100' : 'bg-red-100'}`}>
                      <p className="text-xs text-text-secondary">Available Balance</p>
                      <p className={`text-lg font-semibold ${balanceInfo.sufficient ? 'text-green-700' : 'text-red-700'}`}>
                        {balanceInfo.current} days
                      </p>
                      {!balanceInfo.sufficient && (
                        <p className="text-xs text-red-600 mt-1">Insufficient balance</p>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            )}

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Reason (Optional)
              </label>
              <textarea
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                className="input"
                rows={4}
                placeholder="Enter reason for leave..."
              />
            </div>

            <div className="flex justify-end gap-4">
              <Link href="/employees/leaves">
                <Button type="button" variant="ghost">Cancel</Button>
              </Link>
              <Button type="submit" disabled={loading || !balanceInfo?.sufficient}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Submit Request
              </Button>
            </div>
          </form>
        </Card>
      </div>
    
  );
}

