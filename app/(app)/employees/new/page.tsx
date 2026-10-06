'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { IntlPhoneInput } from '@/components/ui/IntlPhoneInput';
import { Button } from '@/components/ui/Button';
import { AnnotatedFormSection } from '@/components/ui/AnnotatedFormSection';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { Loader2, AlertCircle } from 'lucide-react';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import Link from 'next/link';
import { Toast, ToastType } from '@/components/ui/Toast';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';
import {
  EmployeePortalInviteCard,
  EmployeePortalInviteResultBanner,
} from '@/components/hr/EmployeePortalInviteCard';
import { ReportingManagerSelect } from '@/components/hr/ReportingManagerSelect';
import { HrOrgCatalogField } from '@/components/hr/HrOrgCatalogField';
import { EmployeeShiftSelect } from '@/components/hr/EmployeeShiftSelect';
import { useCapabilityCheck } from '@/hooks/useCapability';
import { hasFullHrFeatures } from '@/lib/subscription/hr-lite';

export default function NewEmployeePage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const { canAdd, loading: permissionsLoading } = usePermissions();
  const { hasCapability } = useCapabilityCheck();
  const fullHr = hasFullHrFeatures((key) => hasCapability(key, 'view'));
  const [loading, setLoading] = useState(false);
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'employees',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [limitInfo, setLimitInfo] = useState<{ current: number; limit: number } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  // Off by default — HR Lite has no employee portal; invite only when plan allows.
  const [sendPortalInvite, setSendPortalInvite] = useState(false);
  const [portalInviteVia, setPortalInviteVia] = useState<'email' | 'whatsapp' | 'both'>('whatsapp');
  const [createdInvite, setCreatedInvite] = useState<{
    temporary_password: string;
    portal_url: string;
    employee_code: string;
    email_sent: boolean;
    whatsapp_sent: boolean;
    errors: string[];
  } | null>(null);
  const [createdEmployeeId, setCreatedEmployeeId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    // User fields
    name: '',
    email: '',
    phone: '',
    password: '',
    
    // Employee fields
    employee_code: '', // Auto-generated if empty
    designation: '',
    department: '',
    default_shift_id: '',
    joining_date: '',
    reporting_manager_id: '',
    employment_type: 'full_time' as 'full_time' | 'part_time' | 'contract',
    access_type: 'attendance_only' as 'attendance_only', // Employees only have attendance access
    salary: '',
    
    // Contact & Emergency
    emergency_contact_name: '',
    emergency_contact_phone: '',
    
    // Bank details
    bank_account_number: '',
    bank_ifsc: '',
    bank_name: '',
    
    // Documents
    pan_number: '',
    aadhaar_number: '',
  });

  useEffect(() => {
    if (business?.id) {
      checkLimits();
    }
  }, [business?.id]);

  const checkLimits = async () => {
    if (!business?.id) return;
    
    try {
      const limitRes = await fetch(`/api/subscriptions/check-limit?business_id=${business.id}&limit_type=employees`);
      if (limitRes.ok) {
        const limitData = await limitRes.json();
        setLimitInfo({ current: limitData.current, limit: limitData.limit });
      }
    } catch (error) {
      console.error('Failed to check limits:', error);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business) return;

    // Check subscription limits
    if (limitInfo && limitInfo.limit !== -1 && limitInfo.current >= limitInfo.limit) {
      setShowUpgradePrompt(true);
      return;
    }

    // Validation
    if (!formData.name || !formData.phone) {
      setToast({ message: 'Name and phone are required', type: 'error' });
      return;
    }

    // Note: Employees are attendance-only, so password is not required
    // Only users (with console access) need passwords

    setLoading(true);

    try {
      const payload = {
        business_id: business.id,
        name: formData.name,
        email: formData.email || null,
        phone: formData.phone,
        password: null, // Employees are attendance-only, no password needed
        employee_code: formData.employee_code || null, // Auto-generate if empty
        designation: formData.designation || null,
        department: formData.department || null,
        default_shift_id: fullHr ? formData.default_shift_id || null : null,
        joining_date: formData.joining_date || null,
        reporting_manager_id: fullHr ? formData.reporting_manager_id || null : null,
        employment_type: formData.employment_type,
        access_type: formData.access_type,
        salary: formData.salary ? Number(formData.salary) : null,
        emergency_contact_name: formData.emergency_contact_name || null,
        emergency_contact_phone: formData.emergency_contact_phone.replace(/\D/g, '') || null,
        bank_account_number: formData.bank_account_number || null,
        bank_ifsc: formData.bank_ifsc || null,
        bank_name: formData.bank_name || null,
        pan_number: fullHr ? formData.pan_number || null : null,
        aadhaar_number: fullHr ? formData.aadhaar_number || null : null,
        created_by_user_id: user?.id,
        send_portal_invite: fullHr ? sendPortalInvite : false,
        portal_invite_via: portalInviteVia,
      };

      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok) {
        if (data.portal_invite) {
          setCreatedInvite(data.portal_invite);
          setCreatedEmployeeId(data.employee.id);
          setToast({ message: 'Employee created successfully', type: 'success' });
        } else {
          setToast({ message: 'Employee created successfully', type: 'success' });
          setTimeout(() => {
            router.push('/employees');
          }, 1000);
        }
      } else {
        // Check if it's a subscription limit error
        if (res.status === 403 && data.code === 'SUBSCRIPTION_LIMIT_EXCEEDED') {
          setLimitInfo({ current: data.current, limit: data.limit });
          setShowUpgradePrompt(true);
        } else {
          setToast({ message: data.error || 'Failed to create employee', type: 'error' });
        }
      }
    } catch (error) {
      console.error('Error creating employee:', error);
      setToast({ message: 'Failed to create employee. Please try again.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Show authorization denied if user cannot create (after all hooks)
  if (!canCreate) {
    return (
      
        <AccessDenied
          module="employees"
          action="create"
          details={reason}
          code="EMPLOYEE_CREATE_DENIED"
        />
      
    );
  }

  return (
    
      <div className="w-full min-w-0 max-w-5xl space-y-6">
        <MobileDuplicatePageChrome
          title="New employee"
          description="Staff record for attendance and salary. Console users are added under Settings → Users."
        />

        <form onSubmit={handleSubmit}>
          <div className="space-y-6">
              <AnnotatedFormSection
                title="Basic information"
                description="Name and contact details used on attendance and HR records."
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <Input
                      label="Full Name"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      required
                      placeholder="John Doe"
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
                    placeholder="john@example.com"
                    helperText="Optional"
                  />
                  <Input
                    label="Employee Code (Optional)"
                    name="employee_code"
                    value={formData.employee_code}
                    onChange={handleChange}
                    placeholder="Auto-generated if empty"
                    helperText="Leave empty to auto-generate (EMP001, EMP002, etc.)"
                  />
                  <div className="md:col-span-2">
                    <p className="text-sm text-text-secondary flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      This is a staff record for attendance and salary. To let someone log in and create invoices, add them under Settings → Users.
                    </p>
                  </div>
                </div>
              </AnnotatedFormSection>

              <AnnotatedFormSection
                title="Employment"
                description="Role, schedule, and compensation details."
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <HrOrgCatalogField
                    businessId={business?.id}
                    kind="designations"
                    label="Designation"
                    name="designation"
                    value={formData.designation}
                    onChange={(v) => setFormData({ ...formData, designation: v })}
                    placeholder="e.g. Sales Executive"
                  />
                  <HrOrgCatalogField
                    businessId={business?.id}
                    kind="departments"
                    label="Department"
                    name="department"
                    value={formData.department}
                    onChange={(v) => setFormData({ ...formData, department: v })}
                    placeholder="e.g. Sales"
                  />
                  {fullHr ? (
                    <EmployeeShiftSelect
                      businessId={business?.id}
                      value={formData.default_shift_id}
                      onChange={(v) => setFormData({ ...formData, default_shift_id: v })}
                    />
                  ) : null}
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1">
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
                  {fullHr ? (
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">
                        Access Type
                      </label>
                      <select
                        name="access_type"
                        value={formData.access_type}
                        onChange={handleChange}
                        className="input"
                        disabled
                      >
                        <option value="attendance_only">Attendance Only</option>
                      </select>
                    </div>
                  ) : null}
                  <Input
                    label="Joining Date"
                    name="joining_date"
                    type="date"
                    value={formData.joining_date}
                    onChange={handleChange}
                  />
                  {fullHr && business?.id && user?.id ? (
                    <ReportingManagerSelect
                      businessId={business.id}
                      userId={user.id}
                      value={formData.reporting_manager_id}
                      onChange={(employeeId) =>
                        setFormData((prev) => ({
                          ...prev,
                          reporting_manager_id: employeeId,
                        }))
                      }
                    />
                  ) : null}
                  <Input
                    label="Salary (Optional)"
                    name="salary"
                    type="number"
                    inputMode="decimal"
                    value={formData.salary}
                    onChange={handleChange}
                    placeholder="0.00"
                  />
                </div>
              </AnnotatedFormSection>

              <AnnotatedFormSection
                title="Emergency contact"
                description="Person to reach if the employee cannot be contacted."
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Contact Name"
                    name="emergency_contact_name"
                    value={formData.emergency_contact_name}
                    onChange={handleChange}
                    placeholder="Emergency contact person name"
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
              </AnnotatedFormSection>

              <AnnotatedFormSection
                title="Bank details"
                description="Optional — used for salary payouts."
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Account Number"
                    name="bank_account_number"
                    value={formData.bank_account_number}
                    onChange={handleChange}
                    placeholder="Bank account number"
                  />
                  <Input
                    label="IFSC Code"
                    name="bank_ifsc"
                    value={formData.bank_ifsc}
                    onChange={handleChange}
                    placeholder="IFSC0001234"
                  />
                  <div className="md:col-span-2">
                    <Input
                      label="Bank Name"
                      name="bank_name"
                      value={formData.bank_name}
                      onChange={handleChange}
                      placeholder="Bank name"
                    />
                  </div>
                </div>
              </AnnotatedFormSection>

              {fullHr ? (
                <AnnotatedFormSection
                  title="Documents"
                  description="Optional identity and tax identifiers."
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="PAN Number"
                      name="pan_number"
                      value={formData.pan_number}
                      onChange={handleChange}
                      placeholder="ABCDE1234F"
                      maxLength={10}
                    />
                    <Input
                      label="Aadhaar Number"
                      name="aadhaar_number"
                      value={formData.aadhaar_number}
                      onChange={handleChange}
                      placeholder="1234 5678 9012"
                      maxLength={12}
                    />
                  </div>
                </AnnotatedFormSection>
              ) : null}

              {fullHr && business?.id ? (
                <EmployeePortalInviteCard
                  mode="form"
                  employeeId=""
                  businessId={business.id}
                  employeeEmail={formData.email}
                  employeePhone={formData.phone}
                  sendPortalInvite={sendPortalInvite}
                  onSendPortalInviteChange={setSendPortalInvite}
                  portalInviteVia={portalInviteVia}
                  onPortalInviteViaChange={setPortalInviteVia}
                />
              ) : null}

          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4 dark:border-border-dark">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create employee'
              )}
            </Button>
          </div>
          </div>
        </form>

        {createdInvite ? (
          <div className="space-y-4">
            <EmployeePortalInviteResultBanner invite={createdInvite} />
            {createdEmployeeId ? (
              <Link href={`/employees/${createdEmployeeId}`}>
                <Button className="w-full sm:w-auto">View employee profile</Button>
              </Link>
            ) : null}
          </div>
        ) : null}

        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}

        {showUpgradePrompt && limitInfo && (
          <UpgradeModal
            limitType="employees"
            moduleKey="hr"
            currentCount={limitInfo.current}
            limit={limitInfo.limit}
            onClose={() => setShowUpgradePrompt(false)}
          />
        )}
      </div>
    
  );
}

