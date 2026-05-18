'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ArrowLeft, Loader2, Calendar, Clock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { format } from 'date-fns';
import { useToastContext } from '@/contexts/ToastContext';

interface Employee {
  id: string;
  name: string;
  employee_code: string;
}

interface Shift {
  id: string;
  shift_name: string;
  start_time: string;
  end_time: string;
}

export default function MarkAttendancePage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);

  const [formData, setFormData] = useState({
    employee_id: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    shift_id: '',
    status: 'present' as 'present' | 'absent' | 'half_day' | 'leave',
    check_in_time: '',
    check_out_time: '',
    break_duration: '0',
    notes: '',
  });

  useEffect(() => {
    if (business?.id) {
      fetchEmployees();
      fetchShifts();
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

  const fetchShifts = async () => {
    if (!business?.id) return;

    try {
      const res = await fetch(`/api/shifts?business_id=${business.id}&active_only=true`);
      if (res.ok) {
        const data = await res.json();
        setShifts(data.shifts || []);
      }
    } catch (error) {
      console.error('Error fetching shifts:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id || !formData.employee_id || !formData.date) return;

    setLoading(true);
    try {
      const res = await fetch('/api/employees/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          ...formData,
          shift_id: formData.shift_id || null,
          check_in_time: formData.check_in_time ? `${formData.date}T${formData.check_in_time}:00` : null,
          check_out_time: formData.check_out_time ? `${formData.date}T${formData.check_out_time}:00` : null,
          break_duration: parseInt(formData.break_duration) || 0,
          created_by: user?.id, // Required for authorization
        }),
      });

      if (res.ok) {
        router.push('/employees/attendance');
        router.refresh();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to mark attendance');
      }
    } catch (error) {
      console.error('Error marking attendance:', error);
      toast.error('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    
      <div className="space-y-6">
        <Link href="/employees/attendance">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Attendance
          </Button>
        </Link>

        <Card padding="md">
          <h1 className="text-2xl font-bold text-text-primary mb-6">Mark Attendance</h1>

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
                label="Date *"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                required
              />

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Shift (Optional)
                </label>
                <select
                  value={formData.shift_id}
                  onChange={(e) => setFormData({ ...formData, shift_id: e.target.value })}
                  className="input"
                >
                  <option value="">No Shift</option>
                  {shifts.map((shift) => (
                    <option key={shift.id} value={shift.id}>
                      {shift.shift_name} ({shift.start_time} - {shift.end_time})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Status *
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="input"
                  required
                >
                  <option value="present">Present</option>
                  <option value="absent">Absent</option>
                  <option value="half_day">Half Day</option>
                  <option value="leave">Leave</option>
                </select>
              </div>

              <Input
                label="Check In Time (Optional)"
                type="time"
                value={formData.check_in_time}
                onChange={(e) => setFormData({ ...formData, check_in_time: e.target.value })}
              />

              <Input
                label="Check Out Time (Optional)"
                type="time"
                value={formData.check_out_time}
                onChange={(e) => setFormData({ ...formData, check_out_time: e.target.value })}
              />

              <Input
                label="Break Duration (minutes)"
                type="number"
                value={formData.break_duration}
                onChange={(e) => setFormData({ ...formData, break_duration: e.target.value })}
                min="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Notes (Optional)
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="input"
                rows={4}
                placeholder="Enter any notes about this attendance..."
              />
            </div>

            <div className="flex justify-end gap-4">
              <Link href="/employees/attendance">
                <Button type="button" variant="ghost">Cancel</Button>
              </Link>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Mark Attendance
              </Button>
            </div>
          </form>
        </Card>
      </div>
    
  );
}

