'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2, Calculator } from 'lucide-react';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import Link from 'next/link';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { useToastContext } from '@/contexts/ToastContext';
import {
  type ProRataSalaryResult,
} from '@/lib/hr/salary-payroll-helpers';

interface Employee {
  id: string;
  name: string;
  employee_code: string;
  salary?: number;
  joining_date?: string | null;
}

type RecoveryBreakdownRow = {
  advance_id: string;
  remaining_amount: number;
  recovery_months: number | null;
  recoveries_done: number;
  suggested_installment: number;
  plan_label: string | null;
};

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
  const [pendingAdvance, setPendingAdvance] = useState(0);
  const [suggestedRecovery, setSuggestedRecovery] = useState(0);
  const [recoveryBreakdown, setRecoveryBreakdown] = useState<RecoveryBreakdownRow[]>([]);
  const [proRataInfo, setProRataInfo] = useState<ProRataSalaryResult | null>(null);
  const [prefillSource, setPrefillSource] = useState<'salary_structure' | 'employee_salary' | null>(null);
  const [attendanceDeductionLines, setAttendanceDeductionLines] = useState<
    { type: string; date: string; label: string; amount: number }[]
  >([]);
  const [attendanceDeductionSummary, setAttendanceDeductionSummary] = useState<Record<string, unknown> | null>(null);
  const [componentBreakdown, setComponentBreakdown] = useState<
    Array<{ code: string; name: string; type: string; amount: number }>
  >([]);

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
    attendance_deduction: '0',
    other_deductions: '0',
    employer_provident_fund: '0',
    esi_employee: '0',
    esi_employer: '0',
    pf_wage: '',
    esi_wage: '',
    working_days: '',
    present_days: '',
    absent_days: '',
    leave_days: '',
    overtime_hours: '',
    payment_mode: 'bank_transfer',
    payment_reference: '',
    notes: '',
    advance_recovery_note: '',
  });

  useEffect(() => {
    if (business?.id) {
      fetchEmployees();
    }
  }, [business?.id]);

  useEffect(() => {
    if (!formData.employee_id || !business?.id) return;

    let cancelled = false;

    const loadPrefill = async () => {
      try {
        const params = new URLSearchParams({
          business_id: business.id,
          user_id: user?.id || '',
          employee_id: formData.employee_id,
          from_date: formData.from_date,
          to_date: formData.to_date,
        });

        const res = await fetch(`/api/employees/salary/payments/prefill?${params}`);
        if (!res.ok || cancelled) return;

        const data = await res.json();
        const fields = data.fields ?? {};
        setPrefillSource(data.source ?? null);
        setProRataInfo(data.pro_rata ?? null);

        const attDed = data.attendance_deduction;
        const suggestedAtt = Number(attDed?.total ?? 0);
        setAttendanceDeductionLines(attDed?.lines ?? []);
        setAttendanceDeductionSummary(attDed?.summary ?? null);
        setComponentBreakdown(
          Array.isArray(data.component_breakdown) ? data.component_breakdown : [],
        );

        setFormData((prev) => ({
          ...prev,
          basic_salary: Number(fields.basic_salary ?? 0).toFixed(2),
          hra: Number(fields.hra ?? 0).toFixed(2),
          transport_allowance: Number(fields.transport_allowance ?? 0).toFixed(2),
          medical_allowance: Number(fields.medical_allowance ?? 0).toFixed(2),
          special_allowance: Number(fields.special_allowance ?? 0).toFixed(2),
          other_earnings: Number(fields.other_earnings ?? 0).toFixed(2),
          provident_fund: Number(fields.provident_fund ?? 0).toFixed(2),
          professional_tax: Number(fields.professional_tax ?? 0).toFixed(2),
          tds: Number(fields.tds ?? 0).toFixed(2),
          other_deductions: Number(fields.other_deductions ?? 0).toFixed(2),
          employer_provident_fund: Number(fields.employer_provident_fund ?? 0).toFixed(2),
          esi_employee: Number(fields.esi_employee ?? 0).toFixed(2),
          esi_employer: Number(fields.esi_employer ?? 0).toFixed(2),
          pf_wage:
            fields.pf_wage != null ? Number(fields.pf_wage).toFixed(2) : prev.pf_wage,
          esi_wage:
            fields.esi_wage != null ? Number(fields.esi_wage).toFixed(2) : prev.esi_wage,
          attendance_deduction: suggestedAtt.toFixed(2),
          working_days: data.pro_rata?.applied
            ? prev.working_days || String(data.pro_rata.daysInPeriod)
            : prev.working_days,
          present_days: data.pro_rata?.applied
            ? prev.present_days || String(data.pro_rata.daysPaid)
            : prev.present_days,
        }));

        const grossPreview =
          Number(fields.basic_salary ?? 0) +
          Number(fields.hra ?? 0) +
          Number(fields.transport_allowance ?? 0) +
          Number(fields.medical_allowance ?? 0) +
          Number(fields.special_allowance ?? 0) +
          Number(fields.other_earnings ?? 0);

        await fetchPendingAdvance(grossPreview);
      } catch (error) {
        console.error('Error loading payroll prefill:', error);
      }
    };

    void loadPrefill();

    return () => {
      cancelled = true;
    };
  }, [formData.employee_id, formData.from_date, formData.to_date, business?.id, user?.id, employees]);

  function applySuggestedRecovery() {
    setFormData((prev) => ({
      ...prev,
      advance_recovery: suggestedRecovery.toFixed(2),
    }));
  }

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
          joining_date: emp.joining_date,
        })));
      }
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  const fetchPendingAdvance = async (basicOverride?: number) => {
    if (!business?.id || !formData.employee_id) return;

    const basic = basicOverride ?? parseFloat(formData.basic_salary || '0');
    const grossPreview =
      basic +
      parseFloat(formData.hra || '0') +
      parseFloat(formData.transport_allowance || '0') +
      parseFloat(formData.medical_allowance || '0') +
      parseFloat(formData.special_allowance || '0') +
      parseFloat(formData.overtime || '0') +
      parseFloat(formData.bonus || '0') +
      parseFloat(formData.commission || '0') +
      parseFloat(formData.other_earnings || '0');

    try {
      const params = new URLSearchParams({
        business_id: business.id,
        employee_id: formData.employee_id,
      });
      if (grossPreview > 0) {
        params.set('cap_amount', String(grossPreview));
      }

      const res = await fetch(`/api/employees/salary/advances/balance?${params}`);
      if (res.ok) {
        const data = await res.json();
        const pending = data.pending_balance || 0;
        const suggested = data.suggested_recovery ?? pending;
        setPendingAdvance(pending);
        setSuggestedRecovery(suggested);
        setRecoveryBreakdown(data.recovery_breakdown ?? []);
        setFormData((prev) => ({
          ...prev,
          advance_recovery: Math.min(suggested, pending, grossPreview || pending).toFixed(2),
        }));
      }
    } catch (error) {
      console.error('Error fetching pending advance:', error);
    }
  };

  const partialRecovery =
    pendingAdvance > 0 &&
    parseFloat(formData.advance_recovery || '0') > 0 &&
    parseFloat(formData.advance_recovery || '0') < pendingAdvance - 0.001;

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

    const deductions =
      parseFloat(formData.provident_fund || '0') +
      parseFloat(formData.professional_tax || '0') +
      parseFloat(formData.tds || '0') +
      parseFloat(formData.advance_recovery || '0') +
      parseFloat(formData.loan_deduction || '0') +
      parseFloat(formData.attendance_deduction || '0') +
      parseFloat(formData.other_deductions || '0') +
      parseFloat(formData.esi_employee || '0');

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
          component_breakdown: componentBreakdown,
          attendance_adjustment_details:
            attendanceDeductionLines.length > 0
              ? { lines: attendanceDeductionLines, summary: attendanceDeductionSummary }
              : null,
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
        <MobileDuplicatePageChrome title="Process salary payment" description="Run payroll for an employee" />

        <Card padding="md">
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
              <Input
                label="Period from *"
                type="date"
                value={formData.from_date}
                onChange={(e) => setFormData({ ...formData, from_date: e.target.value })}
                required
              />
              <Input
                label="Period to *"
                type="date"
                value={formData.to_date}
                onChange={(e) => setFormData({ ...formData, to_date: e.target.value })}
                required
              />
            </div>

            {prefillSource === 'salary_structure' && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                <p className="font-medium">Prefilled from salary structure</p>
                <p className="mt-1 text-blue-800/90">
                  Earnings and statutory deductions loaded from the employee&apos;s active structure. You can still
                  adjust amounts before processing.
                </p>
              </div>
            )}

            {proRataInfo?.applied && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                <p className="font-medium">Pro-rata salary applied</p>
                <p className="mt-1 text-blue-800/90">
                  Joined {proRataInfo.joiningDate} — {proRataInfo.daysPaid} of{' '}
                  {proRataInfo.daysInPeriod} days in this period. Full monthly: ₹
                  {proRataInfo.fullMonthlySalary.toLocaleString('en-IN')} → payable gross ₹
                  {proRataInfo.proratedAmount.toLocaleString('en-IN')}.
                </p>
              </div>
            )}

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
              {attendanceDeductionLines.length > 0 && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">Suggested attendance deductions</p>
                  <ul className="mt-2 space-y-1 text-xs text-amber-800/90">
                    {attendanceDeductionLines.map((line, i) => (
                      <li key={`${line.date}-${line.type}-${i}`}>
                        {line.label}: ₹{line.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </li>
                    ))}
                  </ul>
                  {attendanceDeductionSummary ? (
                    <p className="mt-2 text-xs text-amber-800/90">
                      Daily rate: ₹{Number(attendanceDeductionSummary.daily_rate ?? 0).toLocaleString('en-IN')}
                      {' · '}
                      Lates: {String(attendanceDeductionSummary.late_count ?? 0)} (
                      {String(attendanceDeductionSummary.billable_late_count ?? 0)} billable)
                    </p>
                  ) : null}
                </div>
              )}
              {pendingAdvance > 0 && (
                <div className="mb-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p>
                    <strong>Pending advance:</strong> ₹
                    {pendingAdvance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                  {suggestedRecovery > 0 && suggestedRecovery < pendingAdvance && (
                    <p>
                      <strong>Suggested this month:</strong> ₹
                      {suggestedRecovery.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      {recoveryBreakdown.some((b) => b.plan_label) ? (
                        <span className="block text-xs text-amber-800/90 mt-1">
                          {recoveryBreakdown
                            .filter((b) => b.plan_label)
                            .map((b) => b.plan_label)
                            .join(' · ')}
                        </span>
                      ) : null}
                    </p>
                  )}
                  {suggestedRecovery > 0 && (
                    <Button type="button" variant="secondary" size="sm" onClick={applySuggestedRecovery}>
                      Use suggested ₹{suggestedRecovery.toLocaleString('en-IN')}
                    </Button>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input
                  label="Employee PF"
                  type="number"
                  value={formData.provident_fund}
                  onChange={(e) => setFormData({ ...formData, provident_fund: e.target.value })}
                  min="0"
                  step="0.01"
                />
                <Input
                  label="Employer PF (cost)"
                  type="number"
                  value={formData.employer_provident_fund}
                  onChange={(e) =>
                    setFormData({ ...formData, employer_provident_fund: e.target.value })
                  }
                  min="0"
                  step="0.01"
                />
                <Input
                  label="Employee ESI"
                  type="number"
                  value={formData.esi_employee}
                  onChange={(e) => setFormData({ ...formData, esi_employee: e.target.value })}
                  min="0"
                  step="0.01"
                />
                <Input
                  label="Employer ESI (cost)"
                  type="number"
                  value={formData.esi_employer}
                  onChange={(e) => setFormData({ ...formData, esi_employer: e.target.value })}
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
                  label="Attendance deduction (late / LWP)"
                  type="number"
                  value={formData.attendance_deduction}
                  onChange={(e) => setFormData({ ...formData, attendance_deduction: e.target.value })}
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
              {partialRecovery && (
                <div className="mt-4">
                  <label className="mb-1 block text-sm font-medium text-text-secondary">
                    Partial recovery note
                  </label>
                  <textarea
                    value={formData.advance_recovery_note}
                    onChange={(e) =>
                      setFormData({ ...formData, advance_recovery_note: e.target.value })
                    }
                    className="input w-full"
                    rows={2}
                    placeholder="e.g. Employee requested half recovery this month; balance next salary."
                  />
                  <p className="mt-1 text-xs text-text-muted">
                    Saved on the advance recovery record. A default note is generated if left blank.
                  </p>
                </div>
              )}
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

