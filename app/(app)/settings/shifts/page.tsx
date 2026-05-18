'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Plus, Edit, Trash2, Loader2, Clock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { Shift } from '@/types/database';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

export default function ShiftsPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  
  // Check authorization for creating/updating shifts
  const { allowed: canCreate, loading: authLoading } = useAuthorizationGuard({
    resource: 'settings',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [formData, setFormData] = useState({
    shift_name: '',
    start_time: '',
    end_time: '',
    break_duration: '0',
  });

  useEffect(() => {
    if (business?.id) {
      fetchShifts();
    }
  }, [business?.id]);

  const fetchShifts = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/shifts?business_id=${business.id}`);
      if (res.ok) {
        const data = await res.json();
        setShifts(data.shifts || []);
      }
    } catch (error) {
      console.error('Error fetching shifts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    try {
      const url = editingShift
        ? `/api/shifts/${editingShift.id}?business_id=${business.id}`
        : '/api/shifts';
      const method = editingShift ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          ...formData,
          break_duration: parseInt(formData.break_duration),
        }),
      });

      if (res.ok) {
        await fetchShifts();
        setShowForm(false);
        setEditingShift(null);
        setFormData({
          shift_name: '',
          start_time: '',
          end_time: '',
          break_duration: '0',
        });
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to save shift');
      }
    } catch (error) {
      console.error('Error saving shift:', error);
      toast.error('Failed to save shift. Please try again.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!business?.id || !confirm('Are you sure you want to delete this shift?')) return;

    try {
      const res = await fetch(`/api/shifts/${id}?business_id=${business.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await fetchShifts();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to delete shift');
      }
    } catch (error) {
      console.error('Error deleting shift:', error);
      toast.error('Failed to delete shift. Please try again.');
    }
  };

  const handleEdit = (shift: Shift) => {
    // Check authorization before editing
    if (!canCreate) {
      toast.error('You do not have permission to edit shifts. Please contact your administrator.');
      return;
    }
    setEditingShift(shift);
    setFormData({
      shift_name: shift.shift_name,
      start_time: shift.start_time,
      end_time: shift.end_time,
      break_duration: shift.break_duration.toString(),
    });
    setShowForm(true);
  };

  return (
      <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Shifts</h1>
            <p className="text-sm text-text-secondary mt-1">Manage work shifts for employees</p>
          </div>
          <Button onClick={() => {
            // Check authorization before showing form
            if (!canCreate) {
              toast.error('You do not have permission to create shifts. Please contact your administrator.');
              return;
            }
            setShowForm(true);
            setEditingShift(null);
            setFormData({
              shift_name: '',
              start_time: '',
              end_time: '',
              break_duration: '0',
            });
          }}>
            <Plus className="w-4 h-4 mr-2" />
            Add Shift
          </Button>
        </div>

        {showForm && (
          <Card>
            <h2 className="text-lg font-semibold text-text-primary mb-4">
              {editingShift ? 'Edit Shift' : 'Add New Shift'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Shift Name *"
                  value={formData.shift_name}
                  onChange={(e) => setFormData({ ...formData, shift_name: e.target.value })}
                  required
                  placeholder="Morning, Evening, Night, etc."
                />
                <Input
                  label="Start Time *"
                  type="time"
                  value={formData.start_time}
                  onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                  required
                />
                <Input
                  label="End Time *"
                  type="time"
                  value={formData.end_time}
                  onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                  required
                />
                <Input
                  label="Break Duration (minutes)"
                  type="number"
                  value={formData.break_duration}
                  onChange={(e) => setFormData({ ...formData, break_duration: e.target.value })}
                  min="0"
                />
              </div>
              <div className="flex justify-end gap-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    setEditingShift(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit">Save</Button>
              </div>
            </form>
          </Card>
        )}

        <Card>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : shifts.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="w-12 h-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary">No shifts configured</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Shift Name</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Start Time</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">End Time</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Break Duration</th>
                    <th className="text-center py-3 px-4 font-semibold text-text-primary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((shift) => (
                    <tr key={shift.id} className="border-b border-border hover:bg-gray-50 dark:bg-slate-800/40 dark:hover:bg-slate-800/70">
                      <td className="py-4 px-4">
                        <div className="font-medium">{shift.shift_name}</div>
                        {!shift.is_active && (
                          <div className="text-xs text-red-600">Inactive</div>
                        )}
                      </td>
                      <td className="py-4 px-4">{shift.start_time}</td>
                      <td className="py-4 px-4">{shift.end_time}</td>
                      <td className="py-4 px-4">{shift.break_duration} minutes</td>
                      <td className="py-4 px-4">
                        <div className="flex items-center justify-center gap-2">
                          <Button size="sm" variant="ghost" onClick={() => handleEdit(shift)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(shift.id)}>
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        </div>
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

