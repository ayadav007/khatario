'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Plus, Edit, Trash2, Loader2, Calendar } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { Holiday } from '@/types/database';
import { format } from 'date-fns';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

export default function HolidaysPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  
  // Check authorization for creating/updating holidays
  const { allowed: canCreate, loading: authLoading } = useAuthorizationGuard({
    resource: 'settings',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  const [editingHoliday, setEditingHoliday] = useState<Holiday | null>(null);
  const [formData, setFormData] = useState({
    holiday_date: '',
    holiday_name: '',
    is_recurring: false,
    description: '',
  });

  useEffect(() => {
    if (business?.id) {
      fetchHolidays();
    }
  }, [business?.id]);

  const fetchHolidays = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/holidays?business_id=${business.id}`);
      if (res.ok) {
        const data = await res.json();
        setHolidays(data.holidays || []);
      }
    } catch (error) {
      console.error('Error fetching holidays:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    try {
      const url = editingHoliday
        ? `/api/holidays/${editingHoliday.id}?business_id=${business.id}`
        : '/api/holidays';
      const method = editingHoliday ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          ...formData,
        }),
      });

      if (res.ok) {
        await fetchHolidays();
        setShowForm(false);
        setEditingHoliday(null);
        setFormData({
          holiday_date: '',
          holiday_name: '',
          is_recurring: false,
          description: '',
        });
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to save holiday');
      }
    } catch (error) {
      console.error('Error saving holiday:', error);
      toast.error('Failed to save holiday. Please try again.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!business?.id || !confirm('Are you sure you want to delete this holiday?')) return;

    try {
      const res = await fetch(`/api/holidays/${id}?business_id=${business.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await fetchHolidays();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to delete holiday');
      }
    } catch (error) {
      console.error('Error deleting holiday:', error);
      toast.error('Failed to delete holiday. Please try again.');
    }
  };

  return (
      <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Holiday Calendar</h1>
            <p className="text-sm text-text-secondary mt-1">Manage holidays for working day calculations</p>
          </div>
          <Button onClick={() => {
            setShowForm(true);
            setEditingHoliday(null);
            setFormData({
              holiday_date: '',
              holiday_name: '',
              is_recurring: false,
              description: '',
            });
          }}>
            <Plus className="w-4 h-4 mr-2" />
            Add Holiday
          </Button>
        </div>

        {showForm && (
          <Card>
            <h2 className="text-lg font-semibold text-text-primary mb-4">
              {editingHoliday ? 'Edit Holiday' : 'Add New Holiday'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Holiday Date *"
                  type="date"
                  value={formData.holiday_date}
                  onChange={(e) => setFormData({ ...formData, holiday_date: e.target.value })}
                  required
                />
                <Input
                  label="Holiday Name *"
                  value={formData.holiday_name}
                  onChange={(e) => setFormData({ ...formData, holiday_name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_recurring}
                    onChange={(e) => setFormData({ ...formData, is_recurring: e.target.checked })}
                  />
                  <span className="text-sm text-text-primary">Recurring Holiday (e.g., Independence Day)</span>
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input"
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    setEditingHoliday(null);
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
          ) : holidays.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-12 h-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary">No holidays configured</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Date</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Holiday Name</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Type</th>
                    <th className="text-center py-3 px-4 font-semibold text-text-primary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {holidays
                    .sort((a, b) => new Date(a.holiday_date).getTime() - new Date(b.holiday_date).getTime())
                    .map((holiday) => (
                      <tr key={holiday.id} className="border-b border-border hover:bg-gray-50 dark:bg-slate-800/40 dark:hover:bg-slate-800/70">
                        <td className="py-4 px-4">
                          {format(new Date(holiday.holiday_date), 'dd MMM yyyy')}
                        </td>
                        <td className="py-4 px-4">
                          <div className="font-medium">{holiday.holiday_name}</div>
                          {holiday.description && (
                            <div className="text-sm text-text-secondary">{holiday.description}</div>
                          )}
                        </td>
                        <td className="py-4 px-4">
                          {holiday.is_recurring ? (
                            <span className="text-primary-600">Recurring</span>
                          ) : (
                            <span className="text-text-secondary">One-time</span>
                          )}
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex items-center justify-center gap-2">
                            <Button size="sm" variant="ghost" onClick={() => handleDelete(holiday.id)}>
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

