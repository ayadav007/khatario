'use client';

import { useEffect, useState } from 'react';
import { useAdmin } from '@/context/AdminContext';
import { CreditCard, Building2, Calendar, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';

interface BusinessSubscription {
  business_id: string;
  business_name: string;
  plan_name: string;
  plan_code: string;
  status: string;
  billing_cycle: string;
  start_date: string;
  end_date: string | null;
  is_trial: boolean;
  trial_ends_at: string | null;
  monthly_price: number;
  yearly_price: number;
}

export default function AdminSubscriptionsPage() {
  const { admin } = useAdmin();
  const toast = useToastContext();
  const [subscriptions, setSubscriptions] = useState<BusinessSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    trial: 0,
    expired: 0,
  });

  useEffect(() => {
    if (admin?.id) {
      fetchSubscriptions();
    }
  }, [admin]);

  async function fetchSubscriptions() {
    try {
      const response = await fetch('/api/admin/subscriptions', {
        ...platformAdminFetchInit,
      });
      const data = await response.json();
      
      if (response.ok) {
        console.log('Subscriptions data:', data);
        setSubscriptions(data.subscriptions || []);
        calculateStats(data.subscriptions || []);
      } else {
        console.error('Failed to fetch subscriptions:', data.error, data.details);
        toast.error(`Failed to load subscriptions: ${data.error}`);
      }
    } catch (error) {
      console.error('Error fetching subscriptions:', error);
      toast.error('Error fetching subscriptions. Check console for details.');
    } finally {
      setLoading(false);
    }
  }

  function calculateStats(subs: BusinessSubscription[]) {
    const total = subs.length;
    const active = subs.filter(s => s.status === 'active').length;
    const trial = subs.filter(s => s.is_trial).length;
    const expired = subs.filter(s => s.status === 'expired' || s.status === 'cancelled').length;
    
    setStats({ total, active, trial, expired });
  }

  const getStatusBadge = (status: string, isTrial: boolean) => {
    if (isTrial) {
      return (
        <div className="flex items-center space-x-2 px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-medium">
          <Clock className="w-3 h-3" />
          <span>Trial</span>
        </div>
      );
    }

    const badges: Record<string, { color: string; icon: any; label: string }> = {
      active: { color: 'bg-green-100 text-green-800', icon: CheckCircle, label: 'Active' },
      expired: { color: 'bg-red-100 text-red-800', icon: AlertCircle, label: 'Expired' },
      cancelled: { color: 'bg-gray-100 text-gray-800', icon: AlertCircle, label: 'Cancelled' },
    };

    const badge = badges[status] || badges.active;
    const Icon = badge.icon;

    return (
      <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium ${badge.color}`}>
        <Icon className="w-3 h-3" />
        <span>{badge.label}</span>
      </div>
    );
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Business Subscriptions</h1>
        <p className="text-gray-600 mt-2">Monitor all active business subscriptions</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Subscriptions</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.total}</p>
            </div>
            <div className="bg-slate-100 p-3 rounded-lg">
              <CreditCard className="w-6 h-6 text-primary-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Active</p>
              <p className="text-3xl font-bold text-green-600 mt-2">{stats.active}</p>
            </div>
            <div className="bg-green-100 p-3 rounded-lg">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">On Trial</p>
              <p className="text-3xl font-bold text-purple-600 mt-2">{stats.trial}</p>
            </div>
            <div className="bg-purple-100 p-3 rounded-lg">
              <Clock className="w-6 h-6 text-purple-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Expired</p>
              <p className="text-3xl font-bold text-red-600 mt-2">{stats.expired}</p>
            </div>
            <div className="bg-red-100 p-3 rounded-lg">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Subscriptions List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        {loading ? (
          <div className="p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="p-12 text-center">
            <CreditCard className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No subscriptions found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Business</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Plan</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Billing</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Price</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Start Date</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Plan end</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub) => (
                  <tr key={sub.business_id} className="border-b border-gray-100 hover:bg-gray-50">
                    {/* Business */}
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3">
                        <div className="bg-slate-100 p-2 rounded-lg">
                          <Building2 className="w-4 h-4 text-primary-600" />
                        </div>
                        <span className="font-medium text-gray-900">{sub.business_name}</span>
                      </div>
                    </td>

                    {/* Plan */}
                    <td className="py-4 px-4">
                      <span className="inline-flex px-3 py-1 text-xs font-semibold rounded-full bg-slate-100 text-primary-800">
                        {sub.plan_name}
                      </span>
                    </td>

                    {/* Billing Cycle */}
                    <td className="py-4 px-4">
                      <span className="text-sm text-gray-600 capitalize">{sub.billing_cycle}</span>
                    </td>

                    {/* Price */}
                    <td className="py-4 px-4">
                      <span className="text-sm font-semibold text-gray-900">
                        ₹{sub.billing_cycle === 'monthly' 
                          ? Number(sub.monthly_price || 0).toFixed(2) 
                          : Number(sub.yearly_price || 0).toFixed(2)}
                      </span>
                    </td>

                    {/* Start Date */}
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-2 text-sm text-gray-600">
                        <Calendar className="w-4 h-4" />
                        <span>{new Date(sub.start_date).toLocaleDateString()}</span>
                      </div>
                    </td>

                    {/* Plan end: paid → end_date; trial → trial_end_date; free → none */}
                    <td className="py-4 px-4">
                      {sub.end_date ? (
                        <span className="text-sm text-gray-600">
                          {new Date(sub.end_date).toLocaleDateString()}
                        </span>
                      ) : sub.trial_ends_at ? (
                        <span className="text-sm text-gray-600">
                          {new Date(sub.trial_ends_at.includes('T') ? sub.trial_ends_at : `${sub.trial_ends_at}T12:00:00`).toLocaleDateString()}
                          <span className="block text-xs text-gray-400">Trial</span>
                        </span>
                      ) : sub.plan_code === 'free' ? (
                        <span className="text-sm text-gray-400" title="Free plan has no expiry">
                          No expiry
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="py-4 px-4">
                      {getStatusBadge(sub.status, sub.is_trial)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

