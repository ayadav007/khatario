'use client';

import React, { useState, useEffect } from 'react';
import { useAdmin } from '@/context/AdminContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { Clock, Plus, Edit2, Trash2, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToastContext } from '@/contexts/ToastContext';

interface TimeSlot {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
  max_bookings_per_slot: number;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function TimeSlotsPage() {
  const { admin } = useAdmin();
  const router = useRouter();
  const toast = useToastContext();
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSlot, setEditingSlot] = useState<TimeSlot | null>(null);
  const [formData, setFormData] = useState({
    day_of_week: 1,
    start_time: '09:00',
    end_time: '10:00',
    is_active: true,
    max_bookings_per_slot: 1
  });

  useEffect(() => {
    fetchSlots();
  }, [admin?.id]);

  const fetchSlots = async () => {
    if (!admin?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/bookings/time-slots`, {
        ...platformAdminFetchInit,
      });
      if (res.ok) {
        const data = await res.json();
        setSlots(data.slots || []);
      }
    } catch (err) {
      console.error('Failed to fetch time slots', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!admin?.id) return;

    try {
      const url = editingSlot
        ? `/api/admin/bookings/time-slots/${editingSlot.id}`
        : '/api/admin/bookings/time-slots';
      const method = editingSlot ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        ...platformAdminFetchInit,
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...formData })
      });

      if (res.ok) {
        setShowForm(false);
        setEditingSlot(null);
        setFormData({
          day_of_week: 1,
          start_time: '09:00',
          end_time: '10:00',
          is_active: true,
          max_bookings_per_slot: 1
        });
        fetchSlots();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to save time slot');
      }
    } catch (err) {
      console.error('Error saving time slot', err);
      toast.error('Failed to save time slot');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this time slot?')) return;
    if (!admin?.id) return;

    try {
      const res = await fetch(`/api/admin/bookings/time-slots/${id}`, {
        ...platformAdminFetchInit,
        method: 'DELETE',
      });
      if (res.ok) {
        fetchSlots();
      }
    } catch (err) {
      console.error('Error deleting time slot', err);
    }
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const date = new Date();
    date.setHours(parseInt(hours), parseInt(minutes));
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  const groupedSlots = slots.reduce((acc: Record<number, TimeSlot[]>, slot) => {
    if (!acc[slot.day_of_week]) acc[slot.day_of_week] = [];
    acc[slot.day_of_week].push(slot);
    return acc;
  }, {});

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Clock className="w-8 h-8 text-primary-600" />
            Manage Time Slots
          </h1>
          <p className="text-gray-600 mt-2">Configure available time slots for demo bookings</p>
        </div>
        <button
          onClick={() => {
            setEditingSlot(null);
            setShowForm(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
        >
          <Plus className="w-4 h-4" />
          Add Time Slot
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      ) : (
        <div className="space-y-6">
          {DAYS.map((day, dayIndex) => {
            const daySlots = groupedSlots[dayIndex] || [];
            return (
              <div key={dayIndex} className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="font-bold text-gray-900 mb-4">{day}</h3>
                {daySlots.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {daySlots.map((slot) => (
                      <div
                        key={slot.id}
                        className={`p-4 border-2 rounded-lg ${
                          slot.is_active
                            ? 'border-green-200 bg-green-50'
                            : 'border-gray-200 bg-gray-50'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="font-medium text-gray-900">
                              {formatTime(slot.start_time)} - {formatTime(slot.end_time)}
                            </p>
                            <p className="text-sm text-gray-500">
                              Max {slot.max_bookings_per_slot} booking{slot.max_bookings_per_slot > 1 ? 's' : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {slot.is_active ? (
                              <CheckCircle className="w-5 h-5 text-green-600" />
                            ) : (
                              <XCircle className="w-5 h-5 text-gray-400" />
                            )}
                            <button
                              onClick={() => {
                                setEditingSlot(slot);
                                setFormData({
                                  day_of_week: slot.day_of_week,
                                  start_time: slot.start_time,
                                  end_time: slot.end_time,
                                  is_active: slot.is_active,
                                  max_bookings_per_slot: slot.max_bookings_per_slot
                                });
                                setShowForm(true);
                              }}
                              className="p-1 hover:bg-gray-200 rounded"
                            >
                              <Edit2 className="w-4 h-4 text-gray-600" />
                            </button>
                            <button
                              onClick={() => handleDelete(slot.id)}
                              className="p-1 hover:bg-red-100 rounded"
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">No time slots configured</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold mb-4">
              {editingSlot ? 'Edit Time Slot' : 'Add Time Slot'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Day of Week</label>
                <select
                  value={formData.day_of_week}
                  onChange={(e) => setFormData({...formData, day_of_week: parseInt(e.target.value)})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  {DAYS.map((day, idx) => (
                    <option key={idx} value={idx}>{day}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                  <input
                    type="time"
                    required
                    value={formData.start_time}
                    onChange={(e) => setFormData({...formData, start_time: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                  <input
                    type="time"
                    required
                    value={formData.end_time}
                    onChange={(e) => setFormData({...formData, end_time: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Bookings per Slot</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={formData.max_bookings_per_slot}
                  onChange={(e) => setFormData({...formData, max_bookings_per_slot: parseInt(e.target.value)})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({...formData, is_active: e.target.checked})}
                  className="w-4 h-4 rounded text-primary-600"
                />
                <label className="text-sm font-medium text-gray-700">Active</label>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingSlot(null);
                  }}
                  className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
                >
                  {editingSlot ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

