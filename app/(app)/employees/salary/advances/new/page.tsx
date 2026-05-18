'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import Link from 'next/link';
import { format } from 'date-fns';
import { useToastContext } from '@/contexts/ToastContext';

interface Employee {
  id: string;
  name: string;
  employee_code: string;
}

export default function NewAdvancePage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'payroll',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [formData, setFormData] = useState({
    employee_id: '',
    advance_amount: '',
    advance_date: format(new Date(), 'yyyy-MM-dd'),
    reason: '',
    recovery_method: 'salary_deduction' as 'salary_deduction' | 'one_time_payment',
    recovery_months: '',
  });

  useEffect(() => {
    if (business?.id) {
      fetchEmployees();
    }
  }, [business?.id]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    setLoading(true);
    try {
      const res = await fetch('/api/employees/salary/advances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          ...formData,
          recovery_months: formData.recovery_method === 'salary_deduction' && formData.recovery_months
            ? parseInt(formData.recovery_months)
            : null,
          requested_by: user?.id,
        }),
      });

      if (res.ok) {
        router.push('/employees/salary/advances');
        router.refresh();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to request advance');
      }
    } catch (error) {
      console.error('Error requesting advance:', error);
      toast.error('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };
  
  // Show authorization denied if user cannot create
  if (!canCreate) {
    return (
      
        <AccessDenied
          module="payroll"
          action="create"
          details={reason}
          code="SALARY_ADVANCE_CREATE_DENIED"
        />
      
    );
  }

  return (
    
      <div className="space-y-6">
        <Link href="/employees/salary/advances">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Advances
          </Button>
        </Link>

        <Card padding="md">
          <h1 className="text-2xl font-bold text-text-primary mb-6">Request Salary Advance</h1>

          <form onSubmit={handleSubmit} className="space-y-6">
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
                >
                  <option value="">Select Employee</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.employee_code})
                    </option>
                  ))}
                </select>
              </div>

              <Input
                label="Advance Amount (₹) *"
                type="number"
                value={formData.advance_amount}
                onChange={(e) => setFormData({ ...formData, advance_amount: e.target.value })}
                required
                min="0.01"
                step="0.01"
              />

              <Input
                label="Advance Date *"
                type="date"
                value={formData.advance_date}
                onChange={(e) => setFormData({ ...formData, advance_date: e.target.value })}
                required
              />

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Recovery Method *
                </label>
                <select
                  value={formData.recovery_method}
                  onChange={(e) => setFormData({ ...formData, recovery_method: e.target.value as any })}
                  className="input"
                  required
                >
                  <option value="salary_deduction">Recover from Salary</option>
                  <option value="one_time_payment">One-time Payment</option>
                </select>
              </div>

              {formData.recovery_method === 'salary_deduction' && (
                <Input
                  label="Recovery Months (Optional)"
                  type="number"
                  value={formData.recovery_months}
                  onChange={(e) => setFormData({ ...formData, recovery_months: e.target.value })}
                  min="1"
                  placeholder="Leave empty to recover in next salary"
                  helperText="Leave empty to recover entire amount in next salary payment"
                />
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Reason *
              </label>
              <textarea
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                className="input"
                rows={4}
                placeholder="Enter reason for advance request..."
                required
              />
            </div>

            <div className="flex justify-end gap-4">
              <Link href="/employees/salary/advances">
                <Button type="button" variant="ghost">Cancel</Button>
              </Link>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Submit Request
              </Button>
            </div>
          </form>
        </Card>
      </div>
    
  );
}

