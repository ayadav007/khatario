'use client';

import React, { useState, useEffect } from 'react';
import { useAdmin } from '@/context/AdminContext';
import { Calendar, Search, Filter, Eye, Clock, User, Mail, Phone, Building, Loader2, Plus } from 'lucide-react';
import Link from 'next/link';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { format } from 'date-fns';

interface Booking {
  id: string;
  booking_number: string;
  name: string;
  email: string;
  phone: string;
  company_name?: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  lead_source: string;
  assigned_admin_name?: string;
  created_at: string;
}

export default function AdminBookingsPage() {
  const { admin } = useAdmin();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [filters, setFilters] = useState({
    status: '',
    lead_source: '',
    search: '',
    page: 1
  });

  useEffect(() => {
    fetchBookings();
    fetchStats();
  }, [filters, admin?.id]);

  const fetchBookings = async () => {
    if (!admin?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: filters.page.toString(),
        limit: '20'
      });
      if (filters.status) params.append('status', filters.status);
      if (filters.lead_source) params.append('lead_source', filters.lead_source);
      if (filters.search) params.append('search', filters.search);

      const res = await fetch(`/api/admin/bookings?${params.toString()}`, {
        ...platformAdminFetchInit,
      });
      if (res.ok) {
        const data = await res.json();
        setBookings(data.bookings || []);
      }
    } catch (err) {
      console.error('Failed to fetch bookings', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    if (!admin?.id) return;
    try {
      const res = await fetch(`/api/admin/bookings/stats`, {
        ...platformAdminFetchInit,
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to fetch stats', err);
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
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || colors.pending}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <Calendar className="w-8 h-8 text-primary-600" />
          Demo Bookings
        </h1>
        <p className="text-gray-600 mt-2">Manage demo bookings and track customer journey</p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Total Bookings</p>
            <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
          </div>
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Pending</p>
            <p className="text-3xl font-bold text-yellow-600">{stats.byStatus?.pending || 0}</p>
          </div>
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Converted</p>
            <p className="text-3xl font-bold text-purple-600">{stats.converted}</p>
          </div>
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Conversion Rate</p>
            <p className="text-3xl font-bold text-green-600">{stats.conversionRate}%</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, email, phone..."
              value={filters.search}
              onChange={(e) => setFilters({...filters, search: e.target.value, page: 1})}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <select
            value={filters.status}
            onChange={(e) => setFilters({...filters, status: e.target.value, page: 1})}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
            <option value="converted">Converted</option>
            <option value="cancelled">Cancelled</option>
            <option value="lost">Lost</option>
          </select>
          <select
            value={filters.lead_source}
            onChange={(e) => setFilters({...filters, lead_source: e.target.value, page: 1})}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All Sources</option>
            <option value="organic">Organic</option>
            <option value="google_ads">Google Ads</option>
            <option value="referral">Referral</option>
            <option value="social_media">Social Media</option>
            <option value="direct">Direct</option>
            <option value="other">Other</option>
          </select>
          <Link
            href="/admin/bookings/time-slots"
            className="flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          >
            <Plus className="w-4 h-4" />
            Manage Time Slots
          </Link>
        </div>
      </div>

      {/* Bookings Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          </div>
        ) : bookings.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Booking #</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Customer</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Contact</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Scheduled</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Source</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bookings.map((booking) => (
                  <tr key={booking.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <span className="font-bold text-gray-900">{booking.booking_number}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-gray-900">{booking.name}</p>
                        {booking.company_name && (
                          <p className="text-sm text-gray-500 flex items-center gap-1">
                            <Building className="w-3 h-3" />
                            {booking.company_name}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1 text-sm">
                        <p className="flex items-center gap-1 text-gray-700">
                          <Mail className="w-3 h-3" />
                          {booking.email}
                        </p>
                        <p className="flex items-center gap-1 text-gray-700">
                          <Phone className="w-3 h-3" />
                          {booking.phone}
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm">
                        <p className="font-medium text-gray-900">
                          {format(new Date(booking.scheduled_date), 'MMM dd, yyyy')}
                        </p>
                        <p className="text-gray-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(`2000-01-01T${booking.scheduled_time}`).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(booking.status)}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-600 capitalize">{booking.lead_source}</span>
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/admin/bookings/${booking.id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-50 text-primary-600 rounded-lg hover:bg-slate-100 transition text-sm font-medium"
                      >
                        <Eye className="w-4 h-4" />
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12">
            <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">No bookings found</p>
          </div>
        )}
      </div>
    </div>
  );
}

