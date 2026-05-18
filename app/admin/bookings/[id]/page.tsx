'use client';

import React, { useState, useEffect } from 'react';
import { useAdmin } from '@/context/AdminContext';
import { useRouter } from 'next/navigation';
import { 
  Calendar, ArrowLeft, Phone, Mail, Building, Clock, User, 
  MessageSquare, Plus, CheckCircle, XCircle, ClockIcon,
  Edit2, Loader2
} from 'lucide-react';
import { format } from 'date-fns';
import Link from 'next/link';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';

interface Booking {
  id: string;
  booking_number: string;
  name: string;
  email: string;
  phone: string;
  company_name?: string;
  message?: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  lead_source: string;
  demo_type: string;
  outcome?: string;
  assigned_admin_name?: string;
  assigned_admin_id?: string;
  internal_notes?: string;
  next_follow_up_date?: string;
  created_at: string;
}

interface Activity {
  id: string;
  activity_type: string;
  title: string;
  description?: string;
  performed_by_name?: string;
  created_at: string;
  metadata?: any;
}

export default function BookingDetailPage({ params }: { params: { id: string } }) {
  const { admin } = useAdmin();
  const router = useRouter();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddActivity, setShowAddActivity] = useState(false);

  useEffect(() => {
    fetchBooking();
  }, [params.id, admin?.id]);

  const fetchBooking = async () => {
    if (!admin?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/bookings/${params.id}`, {
        ...platformAdminFetchInit,
      });
      if (res.ok) {
        const data = await res.json();
        setBooking(data.booking);
        setActivities(data.activities || []);
      }
    } catch (err) {
      console.error('Failed to fetch booking', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      scheduled: 'bg-slate-100 text-primary-800',
      completed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
      converted: 'bg-purple-100 text-purple-800',
      lost: 'bg-gray-100 text-gray-800'
    };
    return (
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${colors[status] || colors.pending}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'status_change': return <CheckCircle className="w-5 h-5 text-primary-500" />;
      case 'note_added': return <MessageSquare className="w-5 h-5 text-gray-500" />;
      case 'call_logged': return <Phone className="w-5 h-5 text-green-500" />;
      case 'email_sent': return <Mail className="w-5 h-5 text-purple-500" />;
      case 'whatsapp_sent': return <MessageSquare className="w-5 h-5 text-green-600" />;
      case 'follow_up_set': return <ClockIcon className="w-5 h-5 text-orange-500" />;
      default: return <Circle className="w-5 h-5 text-gray-400" />;
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex justify-center items-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="p-8">
        <p className="text-gray-500">Booking not found</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/admin/bookings')}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              {booking.booking_number}
              {getStatusBadge(booking.status)}
            </h1>
            <p className="text-gray-600 mt-1">Booking Details & CRM</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddActivity(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
        >
          <Plus className="w-4 h-4" />
          Add Activity
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Sidebar - Contact Info */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-4">Contact Information</h3>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500 mb-1">Name</p>
                <p className="font-medium text-gray-900 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  {booking.name}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Email</p>
                <p className="font-medium text-gray-900 flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  {booking.email}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Phone</p>
                <p className="font-medium text-gray-900 flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  {booking.phone}
                </p>
              </div>
              {booking.company_name && (
                <div>
                  <p className="text-sm text-gray-500 mb-1">Company</p>
                  <p className="font-medium text-gray-900 flex items-center gap-2">
                    <Building className="w-4 h-4" />
                    {booking.company_name}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-4">Booking Details</h3>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-gray-500">Scheduled Date</p>
                <p className="font-medium text-gray-900">
                  {format(new Date(booking.scheduled_date), 'MMM dd, yyyy')}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Scheduled Time</p>
                <p className="font-medium text-gray-900 flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  {new Date(`2000-01-01T${booking.scheduled_time}`).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Lead Source</p>
                <p className="font-medium text-gray-900 capitalize">{booking.lead_source}</p>
              </div>
              <div>
                <p className="text-gray-500">Demo Type</p>
                <p className="font-medium text-gray-900 capitalize">{booking.demo_type?.replace('_', ' ')}</p>
              </div>
              {booking.outcome && (
                <div>
                  <p className="text-gray-500">Outcome</p>
                  <p className="font-medium text-gray-900 capitalize">{booking.outcome?.replace('_', ' ')}</p>
                </div>
              )}
            </div>
          </div>

          {booking.message && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-bold text-gray-900 mb-2">Customer Message</h3>
              <p className="text-sm text-gray-600">{booking.message}</p>
            </div>
          )}
        </div>

        {/* Main Area - Activity Timeline */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-6">Activity Timeline</h3>
            
            {activities.length > 0 ? (
              <div className="space-y-4">
                {activities.map((activity, idx) => (
                  <div key={activity.id} className="flex gap-4">
                    <div className="flex-shrink-0">
                      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                        {getActivityIcon(activity.activity_type)}
                      </div>
                      {idx < activities.length - 1 && (
                        <div className="w-0.5 h-full bg-gray-200 ml-5 -mt-2" />
                      )}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-gray-900">{activity.title}</p>
                          {activity.description && (
                            <p className="text-sm text-gray-600 mt-1">{activity.description}</p>
                          )}
                          <p className="text-xs text-gray-500 mt-2">
                            {activity.performed_by_name && `by ${activity.performed_by_name} • `}
                            {format(new Date(activity.created_at), 'MMM dd, yyyy h:mm a')}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No activities yet</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Activity Modal - Simplified for now, can be enhanced */}
      {showAddActivity && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold mb-4">Add Activity</h3>
            <p className="text-gray-600 mb-4">Activity management coming soon. Use API to add activities.</p>
            <button
              onClick={() => setShowAddActivity(false)}
              className="w-full py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper component for circle icon
function Circle({ className }: { className: string }) {
  return <div className={`rounded-full ${className}`} />;
}

