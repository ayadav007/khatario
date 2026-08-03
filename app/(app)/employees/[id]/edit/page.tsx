'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { IntlPhoneInput } from '@/components/ui/IntlPhoneInput';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import {
  Loader2,
  User,
  Briefcase,
  Phone,
  CreditCard,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { Toast, ToastType } from '@/components/ui/Toast';
import { ReportingManagerSelect } from '@/components/hr/ReportingManagerSelect';
import { HrOrgCatalogField } from '@/components/hr/HrOrgCatalogField';
import { EmployeeShiftSelect } from '@/components/hr/EmployeeShiftSelect';
import { useMobileHeaderTitleOverride } from '@/contexts/MobileHeaderTitleContext';

function dateInputValue(value: unknown): string {
  if (!value) return '';
  const s = String(value);
  return s.slice(0, 10);
}

export default function EditEmployeePage() {
  const params = useParams();
  const router = useRouter();
  const { business, user } = useAuth();
  const employeeId = params.id as string;

  const { status: authStatus, reason } = useAuthorizationGuard({
    resource: 'employees',
    action: 'update',
    skipCheck: !user?.id || !business?.id,
  });

  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [employeeName, setEmployeeName] = useState('');
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);

  useMobileHeaderTitleOverride(employeeName ? `Edit ${employeeName}` : 'Edit employee');

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    employee_code: '',
    designation: '',
    department: '',
    branch_id: '',
    default_shift_id: '',
    useWeeklyOffOverride: false,
    weekly_off_fixed_days: [0] as number[],
    joining_date: '',
    reporting_manager_id: '',
    employment_type: 'full_time' as 'full_time' | 'part_time' | 'contract',
    access_type: 'attendance_only' as 'attendance_only',
    salary: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    bank_account_number: '',
    bank_ifsc: '',
    bank_name: '',
    pan_number: '',
    aadhaar_number: '',
    uan: '',
    esi_ip_number: '',
    pf_account_no: '',
    pf_applicable: true,
    esi_applicable: true,
  });

  useEffect(() => {
    if (authStatus !== 'allowed' || !business?.id) return;
    void (async () => {
      const res = await fetch(`/api/branches?business_id=${business.id}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setBranches(data.branches ?? []);
      }
    })();
  }, [authStatus, business?.id]);

  useEffect(() => {
    if (authStatus !== 'allowed' || !employeeId || !business?.id) return;

    let cancelled = false;
    void (async () => {
      setLoadState('loading');
      setLoadError(null);
      try {
        const params = new URLSearchParams({
          business_id: business.id,
        });
        if (user?.id) params.set('user_id', user.id);

        const res = await fetch(`/api/employees/${employeeId}?${params}`, {
          credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          if (!cancelled) {
            setLoadError(data.error || 'Could not load employee record');
            setLoadState('error');
          }
          return;
        }

        const emp = data.employee;
        if (cancelled || !emp) {
          if (!cancelled) {
            setLoadError('Employee record was empty');
            setLoadState('error');
          }
          return;
        }

        setEmployeeName(emp.user_name || '');
        const weeklyOverride = emp.weekly_off_override as { fixed_days?: number[] } | null;
        setFormData({
          name: emp.user_name || '',
          email: emp.user_email || '',
          phone: emp.user_phone || '',
          employee_code: emp.employee_code || '',
          designation: emp.designation || '',
          department: emp.department || '',
          branch_id: emp.branch_id || '',
          default_shift_id: emp.default_shift_id || '',
          useWeeklyOffOverride: Boolean(weeklyOverride?.fixed_days?.length),
          weekly_off_fixed_days: weeklyOverride?.fixed_days?.length
            ? weeklyOverride.fixed_days
            : [0],
          joining_date: dateInputValue(emp.joining_date),
          reporting_manager_id: emp.reporting_manager_id || '',
          employment_type: emp.employment_type || 'full_time',
          access_type: emp.access_type || 'attendance_only',
          salary: emp.salary != null ? String(emp.salary) : '',
          emergency_contact_name: emp.emergency_contact_name || '',
          emergency_contact_phone: emp.emergency_contact_phone || '',
          bank_account_number: emp.bank_account_number || '',
          bank_ifsc: emp.bank_ifsc || '',
          bank_name: emp.bank_name || '',
          pan_number: emp.pan_number || '',
          aadhaar_number: emp.aadhaar_number || '',
          uan: emp.uan || '',
          esi_ip_number: emp.esi_ip_number || '',
          pf_account_no: emp.pf_account_no || '',
          pf_applicable: emp.pf_applicable !== false,
          esi_applicable: emp.esi_applicable !== false,
        });
        if (!cancelled) setLoadState('ready');
      } catch {
        if (!cancelled) {
          setLoadError(
            navigator.onLine
              ? 'Failed to load employee. Please try again.'
              : 'You appear to be offline. Reconnect and retry.',
          );
          setLoadState('error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authStatus, employeeId, business?.id, user?.id, reloadKey]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id || !user?.id) return;

    if (!formData.name.trim() || !formData.phone.trim()) {
      setToast({ message: 'Name and phone are required', type: 'error' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        business_id: business.id,
        updated_by_user_id: user.id,
        name: formData.name.trim(),
        email: formData.email.trim() || null,
        phone: formData.phone,
        employee_code: formData.employee_code.trim() || undefined,
        designation: formData.designation.trim() || null,
        department: formData.department.trim() || null,
        branch_id: formData.branch_id || null,
        weekly_off_override: formData.useWeeklyOffOverride
          ? { fixed_days: formData.weekly_off_fixed_days, nth_rules: [] }
          : null,
        default_shift_id: formData.default_shift_id || null,
        joining_date: formData.joining_date || null,
        reporting_manager_id: formData.reporting_manager_id || null,
        employment_type: formData.employment_type,
        access_type: formData.access_type,
        salary: formData.salary ? Number(formData.salary) : null,
        emergency_contact_name: formData.emergency_contact_name.trim() || null,
        emergency_contact_phone: formData.emergency_contact_phone.replace(/\D/g, '') || null,
        bank_account_number: formData.bank_account_number.trim() || null,
        bank_ifsc: formData.bank_ifsc.trim() || null,
        bank_name: formData.bank_name.trim() || null,
        pan_number: formData.pan_number.trim() || null,
        aadhaar_number: formData.aadhaar_number.trim() || null,
        uan: formData.uan.trim() || null,
        esi_ip_number: formData.esi_ip_number.trim() || null,
        pf_account_no: formData.pf_account_no.trim() || null,
        pf_applicable: formData.pf_applicable,
        esi_applicable: formData.esi_applicable,
      };

      const res = await fetch(
        `/api/employees/${employeeId}?business_id=${business.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ message: data.error || 'Failed to update employee', type: 'error' });
        return;
      }

      setToast({ message: 'Employee updated successfully', type: 'success' });
      setTimeout(() => router.push(`/employees/${employeeId}`), 800);
    } catch {
      setToast({ message: 'Failed to update employee. Please try again.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (authStatus === 'loading' || loadState === 'idle' || loadState === 'loading') {
    return (
      <div className="flex h-[calc(100vh-100px)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (authStatus === 'denied') {
    return (
      <AccessDenied module="employees" action="update" details={reason} code="EMPLOYEE_UPDATE_DENIED" />
    );
  }

  if (loadState === 'error') {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-12 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-amber-600" />
        <h2 className="text-lg font-semibold text-text-primary">Could not load employee</h2>
        <p className="text-sm text-text-secondary">{loadError}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </Button>
          <Link href={`/employees/${employeeId}`}>
            <Button type="button" variant="ghost">
              Back to profile
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MobileDuplicatePageChrome
        title="Edit employee"
        description={employeeName || undefined}
        trailing={
          <Link href={`/employees/${employeeId}`}>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </Link>
        }
      />

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <div className="mb-4 flex items-center gap-2">
                <User className="h-5 w-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-text-primary">Basic Information</h2>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Input
                    label="Full Name"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                  />
                </div>
                <IntlPhoneInput
                  label="Phone Number"
                  value={formData.phone}
                  onChange={(full) => setFormData((prev) => ({ ...prev, phone: full }))}
                  required
                  nationalPlaceholder="Mobile number"
                />
                <Input
                  label="Email"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleChange}
                />
                <Input
                  label="Employee Code"
                  name="employee_code"
                  value={formData.employee_code}
                  onChange={handleChange}
                  required
                />
              </div>
            </Card>

            <Card>
              <div className="mb-4 flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-text-primary">Employment Details</h2>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <HrOrgCatalogField
                  businessId={business?.id}
                  kind="designations"
                  label="Designation"
                  name="designation"
                  value={formData.designation}
                  onChange={(v) => setFormData({ ...formData, designation: v })}
                />
                <HrOrgCatalogField
                  businessId={business?.id}
                  kind="departments"
                  label="Department"
                  name="department"
                  value={formData.department}
                  onChange={(v) => setFormData({ ...formData, department: v })}
                />
                <EmployeeShiftSelect
                  businessId={business?.id}
                  value={formData.default_shift_id}
                  onChange={(v) => setFormData({ ...formData, default_shift_id: v })}
                />
                <div>
                  <label className="mb-1 block text-sm font-medium text-text-secondary">Branch</label>
                  <select
                    name="branch_id"
                    value={formData.branch_id}
                    onChange={handleChange}
                    className="input w-full"
                  >
                    <option value="">No branch</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-text-muted">
                    Branch determines which holiday list applies to this employee.
                  </p>
                </div>
                <div className="md:col-span-2 space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={formData.useWeeklyOffOverride}
                      onChange={(e) =>
                        setFormData({ ...formData, useWeeklyOffOverride: e.target.checked })
                      }
                    />
                    Custom weekly off (override business default)
                  </label>
                  {formData.useWeeklyOffOverride && (
                    <div className="flex flex-wrap gap-3">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, idx) => (
                        <label key={idx} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={formData.weekly_off_fixed_days.includes(idx)}
                            onChange={(e) => {
                              const fixed = e.target.checked
                                ? [...formData.weekly_off_fixed_days, idx]
                                : formData.weekly_off_fixed_days.filter((d) => d !== idx);
                              setFormData({ ...formData, weekly_off_fixed_days: fixed });
                            }}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-text-secondary">
                    Employment Type
                  </label>
                  <select
                    name="employment_type"
                    value={formData.employment_type}
                    onChange={handleChange}
                    className="input"
                  >
                    <option value="full_time">Full Time</option>
                    <option value="part_time">Part Time</option>
                    <option value="contract">Contract</option>
                  </select>
                </div>
                <Input
                  label="Joining Date"
                  name="joining_date"
                  type="date"
                  value={formData.joining_date}
                  onChange={handleChange}
                />
                {business?.id && user?.id ? (
                  <ReportingManagerSelect
                    businessId={business.id}
                    userId={user.id}
                    value={formData.reporting_manager_id}
                    excludeEmployeeId={employeeId}
                    onChange={(id) =>
                      setFormData((prev) => ({ ...prev, reporting_manager_id: id }))
                    }
                  />
                ) : null}
                <Input
                  label="Salary"
                  name="salary"
                  type="number"
                  inputMode="decimal"
                  value={formData.salary}
                  onChange={handleChange}
                />
              </div>
            </Card>

            <Card>
              <div className="mb-4 flex items-center gap-2">
                <Phone className="h-5 w-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-text-primary">Emergency Contact</h2>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  label="Contact Name"
                  name="emergency_contact_name"
                  value={formData.emergency_contact_name}
                  onChange={handleChange}
                />
                <IntlPhoneInput
                  label="Contact Phone"
                  value={formData.emergency_contact_phone}
                  onChange={(full) =>
                    setFormData((prev) => ({ ...prev, emergency_contact_phone: full }))
                  }
                  nationalPlaceholder="Emergency mobile"
                />
              </div>
            </Card>

            <Card>
              <div className="mb-4 flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-text-primary">Bank Details</h2>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  label="Account Number"
                  name="bank_account_number"
                  value={formData.bank_account_number}
                  onChange={handleChange}
                />
                <Input
                  label="IFSC Code"
                  name="bank_ifsc"
                  value={formData.bank_ifsc}
                  onChange={handleChange}
                />
                <div className="md:col-span-2">
                  <Input
                    label="Bank Name"
                    name="bank_name"
                    value={formData.bank_name}
                    onChange={handleChange}
                  />
                </div>
              </div>
              <p className="mt-3 flex items-center gap-1 text-xs text-text-secondary">
                <AlertCircle className="h-3 w-3" />
                Salary and bank fields may be hidden if your role lacks permission.
              </p>
            </Card>

            <Card>
              <div className="mb-4 flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-text-primary">Documents</h2>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  label="PAN Number"
                  name="pan_number"
                  value={formData.pan_number}
                  onChange={handleChange}
                  maxLength={10}
                />
                <Input
                  label="Aadhaar Number"
                  name="aadhaar_number"
                  value={formData.aadhaar_number}
                  onChange={handleChange}
                  maxLength={12}
                />
                <Input
                  label="UAN (EPFO)"
                  name="uan"
                  value={formData.uan}
                  onChange={handleChange}
                  maxLength={20}
                />
                <Input
                  label="ESI IP number"
                  name="esi_ip_number"
                  value={formData.esi_ip_number}
                  onChange={handleChange}
                  maxLength={30}
                />
                <Input
                  label="PF account no."
                  name="pf_account_no"
                  value={formData.pf_account_no}
                  onChange={handleChange}
                  maxLength={40}
                />
                <label className="flex items-center gap-2 text-sm text-text-secondary md:col-span-2">
                  <input
                    type="checkbox"
                    checked={formData.pf_applicable}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, pf_applicable: e.target.checked }))
                    }
                    className="h-4 w-4 rounded border-border"
                  />
                  PF applicable
                </label>
                <label className="flex items-center gap-2 text-sm text-text-secondary md:col-span-2">
                  <input
                    type="checkbox"
                    checked={formData.esi_applicable}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, esi_applicable: e.target.checked }))
                    }
                    className="h-4 w-4 rounded border-border"
                  />
                  ESI applicable
                </label>
              </div>
            </Card>
          </div>

          <div className="lg:col-span-1">
            <Card className="sticky top-4">
              <h3 className="mb-4 font-semibold text-text-primary">Save changes</h3>
              <p className="mb-4 text-sm text-text-secondary">
                Updates apply immediately. Salary structure is managed on the employee profile.
              </p>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Employee'
                )}
              </Button>
              <Link href={`/employees/${employeeId}`} className="mt-2 block">
                <Button type="button" variant="ghost" className="w-full">
                  Back to profile
                </Button>
              </Link>
            </Card>
          </div>
        </div>
      </form>

      {toast ? (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      ) : null}
    </div>
  );
}
