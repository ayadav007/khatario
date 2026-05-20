'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { IntlPhoneInput } from '@/components/ui/IntlPhoneInput';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { Loader2, User, Briefcase, Building, Calendar, DollarSign, Phone, Mail, CreditCard, FileText, AlertCircle } from 'lucide-react';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import Link from 'next/link';
import { Toast, ToastType } from '@/components/ui/Toast';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';

interface Role {
  id: string;
  role_name: string;
  role_key: string;
  description: string;
}

interface Employee {
  id: string;
  employee_code: string;
  name: string;
}

export default function NewEmployeePage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const { canAdd, loading: permissionsLoading } = usePermissions();
  const [loading, setLoading] = useState(false);
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'employees',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  
  const [fetchingEmployees, setFetchingEmployees] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [limitInfo, setLimitInfo] = useState<{ current: number; limit: number } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

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
      fetchEmployees();
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

  const fetchEmployees = async () => {
    if (!business?.id) return;
    
    try {
      const res = await fetch(`/api/employees?business_id=${business.id}&status=active&user_id=${user?.id}`);
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees || []);
      }
    } catch (error) {
      console.error('Failed to fetch employees:', error);
    } finally {
      setFetchingEmployees(false);
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
        joining_date: formData.joining_date || null,
        reporting_manager_id: formData.reporting_manager_id || null,
        employment_type: formData.employment_type,
        access_type: formData.access_type,
        salary: formData.salary ? Number(formData.salary) : null,
        emergency_contact_name: formData.emergency_contact_name || null,
        emergency_contact_phone: formData.emergency_contact_phone.replace(/\D/g, '') || null,
        bank_account_number: formData.bank_account_number || null,
        bank_ifsc: formData.bank_ifsc || null,
        bank_name: formData.bank_name || null,
        pan_number: formData.pan_number || null,
        aadhaar_number: formData.aadhaar_number || null,
        // Note: role_id is not set - employees don't have console access, so no roles
        created_by_user_id: user?.id, // Required for authorization
      };

      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok) {
        setToast({ message: 'Employee created successfully', type: 'success' });
        setTimeout(() => {
          router.push(`/employees/${data.employee.id}`);
        }, 1000);
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
    
      <div className="space-y-6">
        <MobileDuplicatePageChrome
          title="New employee"
          description="Create a new employee record"
        />

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Form */}
            <div className="lg:col-span-2 space-y-6">
              {/* Basic Information */}
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <User className="w-5 h-5 text-primary-600" />
                  <h2 className="text-lg font-semibold text-text-primary">Basic Information</h2>
                </div>
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
                    label="Email (Optional)"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="john@example.com"
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
                      Note: Employees have attendance-only access. To grant console access (create invoices, purchases, etc.), create a User instead.
                    </p>
                  </div>
                </div>
              </Card>

              {/* Employment Details */}
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <Briefcase className="w-5 h-5 text-primary-600" />
                  <h2 className="text-lg font-semibold text-text-primary">Employment Details</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Designation"
                    name="designation"
                    value={formData.designation}
                    onChange={handleChange}
                    placeholder="e.g. Sales Executive"
                  />
                  <Input
                    label="Department"
                    name="department"
                    value={formData.department}
                    onChange={handleChange}
                    placeholder="e.g. Sales"
                  />
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
                    <p className="text-xs text-text-secondary mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Employees can only mark attendance via face recognition or OTP login
                    </p>
                  </div>
                  <Input
                    label="Joining Date"
                    name="joining_date"
                    type="date"
                    value={formData.joining_date}
                    onChange={handleChange}
                  />
                  {fetchingEmployees ? (
                    <div className="flex items-center gap-2 text-sm text-text-secondary">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading managers...
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">
                        Reporting Manager (Optional)
                      </label>
                      <select
                        name="reporting_manager_id"
                        value={formData.reporting_manager_id}
                        onChange={handleChange}
                        className="input"
                      >
                        <option value="">No Manager</option>
                        {employees.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.employee_code} - {emp.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
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
              </Card>

              {/* Emergency Contact */}
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <Phone className="w-5 h-5 text-primary-600" />
                  <h2 className="text-lg font-semibold text-text-primary">Emergency Contact</h2>
                </div>
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
              </Card>

              {/* Bank Details */}
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <CreditCard className="w-5 h-5 text-primary-600" />
                  <h2 className="text-lg font-semibold text-text-primary">Bank Details (Optional)</h2>
                </div>
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
              </Card>

              {/* Documents */}
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <FileText className="w-5 h-5 text-primary-600" />
                  <h2 className="text-lg font-semibold text-text-primary">Documents (Optional)</h2>
                </div>
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
              </Card>
            </div>

            {/* Sidebar - Summary */}
            <div className="lg:col-span-1">
              <Card className="sticky top-4">
                <h3 className="font-semibold text-text-primary mb-4">Summary</h3>
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-text-secondary">Name:</span>
                    <p className="font-medium text-text-primary">{formData.name || '—'}</p>
                  </div>
                  <div>
                    <span className="text-text-secondary">Phone:</span>
                    <p className="font-medium text-text-primary">{formData.phone || '—'}</p>
                  </div>
                  <div>
                    <span className="text-text-secondary">Access Type:</span>
                    <p className="font-medium text-text-primary">
                      Attendance Only
                    </p>
                  </div>
                  {formData.designation && (
                    <div>
                      <span className="text-text-secondary">Designation:</span>
                      <p className="font-medium text-text-primary">{formData.designation}</p>
                    </div>
                  )}
                  {formData.department && (
                    <div>
                      <span className="text-text-secondary">Department:</span>
                      <p className="font-medium text-text-primary">{formData.department}</p>
                    </div>
                  )}
                </div>
                <div className="mt-6 pt-6 border-t border-border">
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      'Create Employee'
                    )}
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        </form>

        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}

        {showUpgradePrompt && limitInfo && (
          <UpgradeModal
            limitType="users"
            currentCount={limitInfo.current}
            limit={limitInfo.limit}
            onClose={() => setShowUpgradePrompt(false)}
          />
        )}
      </div>
    
  );
}

