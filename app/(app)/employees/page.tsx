'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Chip } from '@/components/ui/Chip';
import { Search, Plus, Loader2, Phone, User, Edit, Eye, Filter, X, Mail, Briefcase, Calendar } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Employee } from '@/types/database';
import { Toast, ToastType } from '@/components/ui/Toast';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { DeleteAction } from '@/components/common/DeleteAction';

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

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Employees</h1>
            <p className="text-sm text-text-secondary mt-1">Manage your team members</p>
          </div>
          <Link href="/employees/new">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Employee
            </Button>
          </Link>
        </div>

        {/* Search and Filters */}
        <Card>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <Input
                type="text"
                placeholder="Search by name, code, phone, designation..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <div className="flex gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="input"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              
              <select
                value={accessTypeFilter}
                onChange={(e) => setAccessTypeFilter(e.target.value as any)}
                className="input"
              >
                <option value="all">All Access Types</option>
                <option value="full">Full Access</option>
                <option value="attendance_only">Attendance Only</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Employees List */}
        <Card>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : employees.length === 0 ? (
            <div className="text-center py-12">
              <User className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-text-secondary">No employees found</p>
              <Link href="/employees/new">
                <Button className="mt-4">Add Your First Employee</Button>
              </Link>
            </div>
          ) : (
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
          )}

          {/* Pagination Controls */}
          {pagination.totalPages > 1 && (
            <div className="flex justify-between items-center p-4 border-t border-border">
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

