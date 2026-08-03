'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { Search, Plus, Loader2, Phone, User, Edit, Eye, Filter, X, Mail, Briefcase } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { useAuth } from '@/contexts/AuthContext';
import { Employee } from '@/types/database';
import { Toast, ToastType } from '@/components/ui/Toast';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { DeleteAction } from '@/components/common/DeleteAction';
import { usePermissions } from '@/hooks/usePermissions';
import { EmployeePortalResetActions } from '@/components/hr/EmployeePortalResetActions';

interface EmployeeWithUser extends Employee {
  user_name: string;
  user_email?: string;
  user_phone: string;
  user_is_active: boolean;
  reporting_manager_name?: string;
  reporting_manager_code?: string;
}

export default function EmployeesPage() {
  const { business, user } = useAuth();
  const router = useRouter();
  const [employees, setEmployees] = useState<EmployeeWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [accessTypeFilter, setAccessTypeFilter] = useState<'all' | 'full' | 'attendance_only'>('all');
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });

  // Authorization guard: Check if user can read employees
  // Uses tri-state model: 'loading' | 'allowed' | 'denied'
  const { status: authStatus } = useAuthorizationGuard({
    resource: 'employees',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });
  const { canModify } = usePermissions();
  const canUpdateEmployees = canModify('employees');

  const fetchEmployees = async () => {
    if (!business?.id || !user?.id) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user.id, // REQUIRED for authorization
        ...(search && { search }),
        ...(statusFilter !== 'all' && { status: statusFilter }),
        ...(accessTypeFilter !== 'all' && { access_type: accessTypeFilter }),
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      });
      
      const res = await fetch(`/api/employees?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees || []);
        if (data.pagination) {
          setPagination(data.pagination);
        }
      } else {
        const error = await res.json();
        setToast({ message: error.error || 'Failed to fetch employees', type: 'error' });
      }
    } catch (error) {
      console.error('Failed to fetch employees', error);
      setToast({ message: 'Failed to fetch employees. Please try again.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (business?.id) {
      fetchEmployees();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, search, statusFilter, accessTypeFilter, pagination.page]);

  useEffect(() => {
    if (business?.id) {
      // Reset to page 1 when search or filter changes
      setPagination(prev => ({ ...prev, page: 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, search, statusFilter, accessTypeFilter]);

  const getStatusColor = (employee: EmployeeWithUser) => {
    if (!employee.is_active || !employee.user_is_active) return 'bg-red-100 text-red-800';
    return 'bg-green-100 text-green-800';
  };

  const getAccessTypeColor = (accessType: string) => {
    if (accessType === 'full') return 'bg-slate-100 text-primary-800';
    return 'bg-purple-100 text-purple-800';
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
      <AccessDenied module="employees" action="read" />
    );
  }

  // authStatus === 'allowed' - render page content

  const statusBadge = (employee: EmployeeWithUser) => {
    const active = employee.is_active && employee.user_is_active;
    return (
      <span
        className={clsx(
          'inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-2xs font-medium',
          active
            ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/35 dark:text-green-300'
            : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/35 dark:text-red-300'
        )}
      >
        {active ? 'Active' : 'Inactive'}
      </span>
    );
  };

  return (
    <div className="space-y-3 md:space-y-6">
        <ListPageHeader
          title="Employees"
          description="Manage your team members"
          actions={
            <>
              <button
                type="button"
                onClick={() => setShowMobileFilters(true)}
                className="rounded-lg border border-border bg-surface p-2 text-text-secondary md:hidden"
                aria-label="Filters"
              >
                <Filter className="w-5 h-5" />
              </button>
              <Link href="/employees/new">
                <Button className="h-10 px-4">
                  <Plus className="w-4 h-4 md:mr-2" />
                  <span className="hidden md:inline">Add Employee</span>
                </Button>
              </Link>
            </>
          }
        />

        {/* Desktop search & filters */}
        <Card padding="md" className="hidden md:block">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                placeholder="Search by name, code, phone, designation..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-10"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="input"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <select
                value={accessTypeFilter}
                onChange={(e) => setAccessTypeFilter(e.target.value as typeof accessTypeFilter)}
                className="input"
              >
                <option value="all">All Access Types</option>
                <option value="full">Full Access</option>
                <option value="attendance_only">Attendance Only</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Mobile search */}
        <div className="md:hidden relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Name, code, or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10 w-full h-10 rounded-xl"
          />
        </div>

        {showMobileFilters && (
          <div className="fixed inset-0 z-[100] md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowMobileFilters(false)} />
            <div className="absolute bottom-0 left-0 right-0 rounded-t-2xl border-t border-border bg-surface p-6 shadow-xl animate-slide-up">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="text-base font-semibold text-text-primary">Filters</h3>
                <button
                  type="button"
                  onClick={() => setShowMobileFilters(false)}
                  className="rounded-full p-2 hover:bg-slate-50 dark:hover:bg-slate-800"
                  aria-label="Close filters"
                >
                  <X className="w-5 h-5 text-text-muted" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="type-label mb-1.5 block">Status</label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                    className="input w-full"
                  >
                    <option value="all">All Status</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div>
                  <label className="type-label mb-1.5 block">Access type</label>
                  <select
                    value={accessTypeFilter}
                    onChange={(e) => setAccessTypeFilter(e.target.value as typeof accessTypeFilter)}
                    className="input w-full"
                  >
                    <option value="all">All Access Types</option>
                    <option value="full">Full Access</option>
                    <option value="attendance_only">Attendance Only</option>
                  </select>
                </div>
                <Button className="w-full" onClick={() => setShowMobileFilters(false)}>
                  Apply
                </Button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary-600 md:w-8 md:h-8" />
          </div>
        ) : employees.length === 0 ? (
          <div className="text-center py-10 md:py-12">
            <User className="w-10 h-10 text-text-muted mx-auto mb-3 md:w-12 md:h-12 md:mb-4" />
            <p className="type-body-secondary text-sm">
              {search || statusFilter !== 'all' || accessTypeFilter !== 'all'
                ? 'No employees match your filters'
                : 'No employees yet'}
            </p>
            {!search && statusFilter === 'all' && accessTypeFilter === 'all' && (
              <Link href="/employees/new">
                <Button size="sm" className="mt-3">
                  Add Employee
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <>
            <Card padding="none" className="overflow-hidden hidden md:block">
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Employee</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Code</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Designation</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Department</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Access</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Status</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((employee) => (
                    <tr
                      key={employee.id}
                      className="border-b border-border hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => router.push(`/employees/${employee.id}`)}
                    >
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          {employee.photo_url ? (
                            <img
                              src={employee.photo_url}
                              alt={employee.user_name}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                              <User className="w-5 h-5 text-primary-600" />
                            </div>
                          )}
                          <div>
                            <div className="font-medium text-text-primary">{employee.user_name}</div>
                            <div className="text-sm text-text-secondary flex items-center gap-2 mt-1">
                              {employee.user_phone && (
                                <span className="flex items-center gap-1">
                                  <Phone className="w-3 h-3" />
                                  {employee.user_phone}
                                </span>
                              )}
                              {employee.user_email && (
                                <span className="flex items-center gap-1">
                                  <Mail className="w-3 h-3" />
                                  {employee.user_email}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className="font-mono text-sm text-text-secondary">{employee.employee_code}</span>
                      </td>
                      <td className="py-4 px-4">
                        {employee.designation ? (
                          <div className="flex items-center gap-1">
                            <Briefcase className="w-4 h-4 text-gray-400" />
                            <span className="text-text-primary">{employee.designation}</span>
                          </div>
                        ) : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        {employee.department ? (
                          <span className="text-text-primary">{employee.department}</span>
                        ) : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <Chip
                          className={getAccessTypeColor(employee.access_type)}
                        >
                          {employee.access_type === 'full' ? 'Full Access' : 'Attendance Only'}
                        </Chip>
                      </td>
                      <td className="py-4 px-4">
                        <Chip className={getStatusColor(employee)}>
                          {employee.is_active && employee.user_is_active ? 'Active' : 'Inactive'}
                        </Chip>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                          <Link href={`/employees/${employee.id}`}>
                            <Button variant="ghost" size="sm">
                              <Eye className="w-4 h-4" />
                            </Button>
                          </Link>
                          <Link href={`/employees/${employee.id}/edit`}>
                            <Button variant="ghost" size="sm">
                              <Edit className="w-4 h-4" />
                            </Button>
                          </Link>
                          {canUpdateEmployees && business?.id ? (
                            <EmployeePortalResetActions
                              variant="compact"
                              employeeId={employee.id}
                              businessId={business.id}
                              employeeName={employee.user_name}
                              employeeCode={employee.employee_code}
                              disabled={!employee.is_active || !employee.user_is_active}
                            />
                          ) : null}
                          <DeleteAction
                            entityName="employee"
                            variant="deactivate"
                            confirmMessage="This employee will be deactivated. Existing records will remain intact."
                            disabled={!employee.is_active || !employee.user_is_active}
                            disabledTooltip="Employee is already inactive"
                            deleteFn={async () => {
                              if (!business?.id || !user?.id) throw new Error('Missing business/user context');
                              const res = await fetch(
                                `/api/employees/${employee.id}?business_id=${business.id}&user_id=${user.id}`,
                                { method: 'DELETE' }
                              );
                              const data = await res.json().catch(() => ({}));
                              if (!res.ok) throw new Error(data?.error || 'Failed to deactivate employee');
                            }}
                            onSuccess={fetchEmployees}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {pagination.totalPages > 1 && (
                <div className="hidden md:flex justify-between items-center p-4 border-t border-border">
                  <p className="text-sm text-text-secondary">
                    Page {pagination.page} of {pagination.totalPages} ({pagination.total} employees)
                  </p>
                  <div className="flex space-x-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                      disabled={pagination.page === 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))}
                      disabled={pagination.page === pagination.totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            <div className="md:hidden space-y-2">
              {employees.map((employee) => (
                <div
                  key={employee.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/employees/${employee.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') router.push(`/employees/${employee.id}`);
                  }}
                  className="rounded-xl border border-border bg-surface px-3 py-2.5 shadow-sm transition-colors active:bg-slate-50/80 dark:active:bg-slate-800/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      {employee.photo_url ? (
                        <img
                          src={employee.photo_url}
                          alt={employee.user_name}
                          className="h-8 w-8 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-primary-700 dark:bg-slate-800/40 dark:text-primary-300">
                          {employee.user_name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold leading-snug text-text-primary">
                          {employee.user_name}
                        </p>
                        {employee.employee_code ? (
                          <p className="mt-0.5 font-mono text-2xs text-text-muted">{employee.employee_code}</p>
                        ) : null}
                        {employee.user_phone ? (
                          <div className="mt-0.5 flex items-center gap-1 text-xs text-text-muted">
                            <Phone className="h-3 w-3 shrink-0" />
                            <span className="truncate">{employee.user_phone}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {statusBadge(employee)}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {employee.designation ? (
                      <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
                        <Briefcase className="h-3 w-3 shrink-0 text-text-muted" />
                        {employee.designation}
                      </span>
                    ) : null}
                    {employee.department ? (
                      <span className="text-xs text-text-muted">{employee.department}</span>
                    ) : null}
                    <span className="chip text-2xs">
                      {employee.access_type === 'full' ? 'Full access' : 'Attendance only'}
                    </span>
                  </div>

                  <div
                    className="mt-2 flex flex-col gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="grid grid-cols-3 gap-1.5">
                    <Link href={`/employees/${employee.id}`}>
                      <button
                        type="button"
                        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-caption font-medium text-text-secondary hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View
                      </button>
                    </Link>
                    <Link href={`/employees/${employee.id}/edit`}>
                      <button
                        type="button"
                        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-slate-50 text-caption font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                      >
                        <Edit className="h-3.5 w-3.5" />
                        Edit
                      </button>
                    </Link>
                    <div className="flex items-center justify-center">
                      <DeleteAction
                        entityName="employee"
                        variant="deactivate"
                        confirmMessage="This employee will be deactivated. Existing records will remain intact."
                        disabled={!employee.is_active || !employee.user_is_active}
                        disabledTooltip="Employee is already inactive"
                        deleteFn={async () => {
                          if (!business?.id || !user?.id) throw new Error('Missing business/user context');
                          const res = await fetch(
                            `/api/employees/${employee.id}?business_id=${business.id}&user_id=${user.id}`,
                            { method: 'DELETE' }
                          );
                          const data = await res.json().catch(() => ({}));
                          if (!res.ok) throw new Error(data?.error || 'Failed to deactivate employee');
                        }}
                        onSuccess={fetchEmployees}
                      />
                    </div>
                    </div>
                    {canUpdateEmployees && business?.id ? (
                      <EmployeePortalResetActions
                        employeeId={employee.id}
                        businessId={business.id}
                        employeeName={employee.user_name}
                        employeeCode={employee.employee_code}
                        disabled={!employee.is_active || !employee.user_is_active}
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {pagination.totalPages > 1 && employees.length > 0 && (
          <div className="mt-2 flex items-center justify-between rounded-xl border border-border bg-surface p-3 md:hidden">
            <p className="text-sm text-text-secondary">
              Page {pagination.page} of {pagination.totalPages} ({pagination.total} employees)
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                disabled={pagination.page === 1}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))}
                disabled={pagination.page === pagination.totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
    </div>
  );
}

