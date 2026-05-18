'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Calendar, Search, Filter, Download, Plus, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { EmployeeAttendance } from '@/types/database';
import { format } from 'date-fns';
import Link from 'next/link';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';

interface AttendanceWithEmployee extends EmployeeAttendance {
  employee_code: string;
  employee_name: string;
  designation?: string;
  shift_name?: string;
}

export default function AttendanceManagementPage() {
  const { business, user } = useAuth();
  
  // Authorization guard: Check if user can read attendance
  // Uses tri-state model: 'loading' | 'allowed' | 'denied'
  const { status: authStatus } = useAuthorizationGuard({
    resource: 'attendance',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });
  
  const [attendance, setAttendance] = useState<AttendanceWithEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [statusFilter, setStatusFilter] = useState<'all' | 'present' | 'absent' | 'half_day' | 'leave'>('all');

  useEffect(() => {
    if (business?.id) {
      fetchAttendance();
    }
  }, [business?.id, startDate, endDate, statusFilter]);

  const fetchAttendance = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user?.id || '', // Required for authorization
        start_date: startDate,
        end_date: endDate,
        ...(statusFilter !== 'all' && { status: statusFilter }),
      });

      const res = await fetch(`/api/employees/attendance?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAttendance(data.attendance || []);
      }
    } catch (error) {
      console.error('Error fetching attendance:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredAttendance = attendance.filter((record) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      record.employee_code.toLowerCase().includes(searchLower) ||
      record.employee_name.toLowerCase().includes(searchLower)
    );
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'present':
        return 'bg-green-100 text-green-800';
      case 'absent':
        return 'bg-red-100 text-red-800';
      case 'half_day':
        return 'bg-yellow-100 text-yellow-800';
      case 'leave':
        return 'bg-slate-100 text-primary-800';
      default:
        return 'bg-gray-100 text-gray-800';
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
      <AccessDenied module="attendance" action="read" />
    );
  }

  // authStatus === 'allowed' - render page content

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Attendance Management</h1>
            <p className="text-sm text-text-secondary mt-1">View and manage employee attendance</p>
          </div>
          <Link href="/employees/attendance/mark">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Mark Attendance
            </Button>
          </Link>
        </div>

        {/* Filters */}
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <Input
                type="text"
                placeholder="Search by name or code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
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
                <option value="present">Present</option>
                <option value="absent">Absent</option>
                <option value="half_day">Half Day</option>
                <option value="leave">Leave</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Attendance List */}
        <Card>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : filteredAttendance.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-text-secondary">No attendance records found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Employee</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Date</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Check In</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Check Out</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Hours</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAttendance.map((record) => (
                    <tr
                      key={record.id}
                      className="border-b border-border hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-4 px-4">
                        <div>
                          <div className="font-medium text-text-primary">{record.employee_name}</div>
                          <div className="text-sm text-text-secondary font-mono">
                            {record.employee_code}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        {format(new Date(record.date), 'dd MMM yyyy')}
                      </td>
                      <td className="py-4 px-4">
                        {record.check_in_time ? (
                          <div className="flex items-center gap-1 text-green-700">
                            <CheckCircle className="w-4 h-4" />
                            <span>{format(new Date(record.check_in_time), 'hh:mm a')}</span>
                          </div>
                        ) : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        {record.check_out_time ? (
                          <div className="flex items-center gap-1 text-primary-700">
                            <XCircle className="w-4 h-4" />
                            <span>{format(new Date(record.check_out_time), 'hh:mm a')}</span>
                          </div>
                        ) : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        {record.total_hours ? (
                          <span className="font-medium">{record.total_hours.toFixed(2)} hrs</span>
                        ) : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <span className={`px-2 py-1 rounded-md text-xs font-medium ${getStatusColor(record.status)}`}>
                          {record.status.replace('_', ' ').toUpperCase()}
                        </span>
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

