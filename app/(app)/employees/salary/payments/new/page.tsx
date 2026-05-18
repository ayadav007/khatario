'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ArrowLeft, Loader2, Calculator } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import Link from 'next/link';
import { format, startOfMonth, endOfMonth, addMonths } from 'date-fns';
import { useToastContext } from '@/contexts/ToastContext';

interface Employee {
  id: string;
  name: string;
  employee_code: string;
  salary?: number;
}

export default function NewSalaryPaymentPage() {
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
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [pendingAdvance, setPendingAdvance] = useState(0);

  // Get current month
  const currentMonth = format(new Date(), 'yyyy-MM');
  const monthStart = startOfMonth(new Date());
  const monthEnd = endOfMonth(new Date());

  const [formData, setFormData] = useState({
    employee_id: '',
    salary_month: currentMonth,
    from_date: format(monthStart, 'yyyy-MM-dd'),
    to_date: format(monthEnd, 'yyyy-MM-dd'),
    payment_date: format(new Date(), 'yyyy-MM-dd'),
    basic_salary: '',
    hra: '0',
    transport_allowance: '0',
    medical_allowance: '0',
    special_allowance: '0',
    overtime: '0',
    bonus: '0',
    commission: '0',
    other_earnings: '0',
    provident_fund: '0',
    professional_tax: '0',
    tds: '0',
    advance_recovery: '0',
    loan_deduction: '0',
    other_deductions: '0',
    working_days: '',
    present_days: '',
    absent_days: '',
    leave_days: '',
    overtime_hours: '',
    payment_mode: 'bank_transfer',
    payment_reference: '',
    notes: '',
  });

  useEffect(() => {
    if (business?.id) {
      fetchEmployees();
    }
  }, [business?.id]);

  useEffect(() => {
    if (formData.employee_id && business?.id) {
      fetchPendingAdvance();
      // Auto-fill basic salary from employee record
      const emp = employees.find(e => e.id === formData.employee_id);
      if (emp?.salary) {
        setFormData(prev => ({ ...prev, basic_salary: emp.salary!.toString() }));
      }
    }
  }, [formData.employee_id, business?.id]);

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
          salary: emp.salary,
        })));
      }
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  const fetchPendingAdvance = async () => {
    if (!business?.id || !formData.employee_id) return;

    try {
      const res = await fetch(`/api/employees/salary/advances/balance?business_id=${business.id}&employee_id=${formData.employee_id}`);
      if (res.ok) {
        const data = await res.json();
        setPendingAdvance(data.pending_balance || 0);
        setFormData(prev => ({ ...prev, advance_recovery: Math.min(data.pending_balance || 0, prev.basic_salary ? parseFloat(prev.basic_salary) : 0).toString() }));
      }
    } catch (error) {
      console.error('Error fetching pending advance:', error);
    }
  };

  const calculateTotals = () => {
    const earnings = parseFloat(formData.basic_salary || '0') +
      parseFloat(formData.hra || '0') +
      parseFloat(formData.transport_allowance || '0') +
      parseFloat(formData.medical_allowance || '0') +
      parseFloat(formData.special_allowance || '0') +
      parseFloat(formData.overtime || '0') +
      parseFloat(formData.bonus || '0') +
      parseFloat(formData.commission || '0') +
      parseFloat(formData.other_earnings || '0');

    const deductions = parseFloat(formData.provident_fund || '0') +
      parseFloat(formData.professional_tax || '0') +
      parseFloat(formData.tds || '0') +
      parseFloat(formData.advance_recovery || '0') +
      parseFloat(formData.loan_deduction || '0') +
      parseFloat(formData.other_deductions || '0');

    return {
      totalEarnings: earnings,
      totalDeductions: deductions,
      grossSalary: earnings,
      netSalary: earnings - deductions,
    };
  };

  const totals = calculateTotals();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    setLoading(true);
    try {
      const res = await fetch('/api/employees/salary/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          ...formData,
          processed_by: user?.id,
          generate_payslip: true,
        }),
      });

      if (res.ok) {
        router.push('/employees/salary/payments');
        router.refresh();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to process salary');
      }
    } catch (error) {
      console.error('Error processing salary:', error);
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
          code="SALARY_PAYMENT_CREATE_DENIED"
        />
      
    );
  }

  return (
    
      <div className="space-y-6">
        <Link href="/employees/salary/payments">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Salary Payments
          </Button>
        </Link>

        <Card padding="md">
          <h1 className="text-2xl font-bold text-text-primary mb-6">Process Salary Payment</h1>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Employee & Period Selection */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                label="Salary Month *"
                type="month"
                value={formData.salary_month}
                onChange={(e) => {
                  const monthDate = new Date(e.target.value + '-01');
                  setFormData({
                    ...formData,
                    salary_month: e.target.value,
                    from_date: format(startOfMonth(monthDate), 'yyyy-MM-dd'),
                    to_date: format(endOfMonth(monthDate), 'yyyy-MM-dd'),
                  });
                }}
                required
              />
              <Input
                label="Payment Date *"
                type="date"
                value={formData.payment_date}
                onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                required
              />
            </div>

            {/* Earnings */}
            <div>
              <h2 className="text-lg font-semibold text-text-primary mb-4">Earnings</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input
                  label="Basic Salary *"
                  type="number"
                  value={formData.basic_salary}
                  onChange={(e) => setFormData({ ...formData, basic_salary: e.target.value })}
                  required
                  min="0"
                  step="0.01"
                />
                <Input
                  label="HRA"
                  type="number"
                  value={formData.hra}
                  onChange={(e) => setFormData({ ...formData, hra: e.target.value })}
                  min="0"
                  step="0.01"
                />
                <Input
                  label="Transport Allowance"
                  type="number"
                  value={formData.transport_allowance}
                  onChange={(e) => setFormData({ ...formData, transport_allowance: e.target.value })}
                  min="0"
                  step="0.01"
                />
                <Input
                  label="Medical Allowance"
                  type="number"
                  value={formData.medical_allowance}
                  onChange={(e) => setFormData({ ...formData, medical_allowance: e.target.value })}
                  min="0"
                  step="0.01"
                />
                <Input
                  label="Special Allowance"
                  type="number"
                  value={formData.special_allowance}
                  onChange={(e) => setFormData({ ...formData, special_allowance: e.target.value })}
                  min="0"
                  step="0.01"
                />
                <Input
                  label="Overtime"
                  type="number"
                  value={formData.overtime}
                  onChange={(e) => setFormData({ ...formData, overtime: e.target.value })}
                  min="0"
                  step="0.01"
                />
                <Input
                  label="Bonus"
                  type="number"
                  value={formData.bonus}
                  onChange={(e) => setFormData({ ...formData, bonus: e.target.value })}
                  min="0"
                  step="0.01"
                />
                <Input
                  label="Commission"
                  type="number"
                  value={formData.commission}
                  onChange={(e) => setFormData({ ...formData, commission: e.target.value })}
                  min="0"
                  step="0.01"
                />
                <Input
                  label="Other Earnings"
                  type="number"
                  value={formData.other_earnings}
                  onChange={(e) => setFormData({ ...formData, other_earnings: e.target.value })}
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            {/* Deductions */}
            <div>
              <h2 className="text-lg font-semibold text-text-primary mb-4">Deductions</h2>
              {pendingAdvance > 0 && (
                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800">
                    <strong>Pending Advance:</strong> ₹{pendingAdvance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input
                  label="Provident Fund (PF)"
                  type="number"
                  value={formData.provident_fund}
                  onChange={(e) => setFormData({ ...formData, provident_fund: e.target.value })}
                  min="0"
                  step="0.01"
                />
                <Input
                  label="Professional Tax"
                  type="number"
                  value={formData.professional_tax}
                  onChange={(e) => setFormData({ ...formData, professional_tax: e.target.value })}
                  min="0"
                  step="0.01"
                />
                <Input
                  label="TDS"
                  type="number"
                  value={formData.tds}
                  onChange={(e) => setFormData({ ...formData, tds: e.target.value })}
                  min="0"
                  step="0.01"
                />
                <Input
                  label="Advance Recovery"
                  type="number"
                  value={formData.advance_recovery}
                  onChange={(e) => setFormData({ ...formData, advance_recovery: e.target.value })}
                  min="0"
                  max={pendingAdvance.toString()}
                  step="0.01"
                />
                <Input
                  label="Loan Deduction"
                  type="number"
                  value={formData.loan_deduction}
                  onChange={(e) => setFormData({ ...formData, loan_deduction: e.target.value })}
                  min="0"
                  step="0.01"
                />
                <Input
                  label="Other Deductions"
                  type="number"
                  value={formData.other_deductions}
                  onChange={(e) => setFormData({ ...formData, other_deductions: e.target.value })}
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            {/* Attendance (Optional) */}
            <div>
              <h2 className="text-lg font-semibold text-text-primary mb-4">Attendance (Optional)</h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Input
                  label="Working Days"
                  type="number"
                  value={formData.working_days}
                  onChange={(e) => setFormData({ ...formData, working_days: e.target.value })}
                  min="0"
                />
                <Input
                  label="Present Days"
                  type="number"
                  value={formData.present_days}
                  onChange={(e) => setFormData({ ...formData, present_days: e.target.value })}
                  min="0"
                />
                <Input
                  label="Absent Days"
                  type="number"
                  value={formData.absent_days}
                  onChange={(e) => setFormData({ ...formData, absent_days: e.target.value })}
                  min="0"
                />
                <Input
                  label="Leave Days"
                  type="number"
                  value={formData.leave_days}
                  onChange={(e) => setFormData({ ...formData, leave_days: e.target.value })}
                  min="0"
                />
              </div>
            </div>

            {/* Payment Details */}
            <div>
              <h2 className="text-lg font-semibold text-text-primary mb-4">Payment Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Payment Mode
                  </label>
                  <select
                    value={formData.payment_mode}
                    onChange={(e) => setFormData({ ...formData, payment_mode: e.target.value })}
                    className="input"
                  >
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="cash">Cash</option>
                    <option value="cheque">Cheque</option>
                    <option value="upi">UPI</option>
                  </select>
                </div>
                <Input
                  label="Payment Reference"
                  type="text"
                  value={formData.payment_reference}
                  onChange={(e) => setFormData({ ...formData, payment_reference: e.target.value })}
                  placeholder="Transaction ID, Cheque Number, etc."
                />
              </div>
            </div>

            {/* Summary */}
            <Card>
              <h2 className="text-lg font-semibold text-text-primary mb-4">Salary Summary</h2>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-text-secondary">Total Earnings:</span>
                  <span className="font-semibold">₹{totals.totalEarnings.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">Total Deductions:</span>
                  <span className="font-semibold">₹{totals.totalDeductions.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-2">
                  <span className="text-lg font-bold text-text-primary">Net Salary Payable:</span>
                  <span className="text-lg font-bold text-primary-600">₹{totals.netSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </Card>

            <div className="flex justify-end gap-4">
              <Link href="/employees/salary/payments">
                <Button type="button" variant="ghost">Cancel</Button>
              </Link>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Process Salary
              </Button>
            </div>
          </form>
        </Card>
      </div>
    
  );
}

