'use client';

import { useEffect, useState } from 'react';
import {
  Building2,
  TrendingUp,
  FileText,
  Users,
  DollarSign,
  Activity,
  Calendar,
} from 'lucide-react';
import { useAdmin } from '@/context/AdminContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';

interface PlatformMetrics {
  totalBusinesses: number;
  activeBusinesses: number;
  totalInvoices: number;
  invoicesThisMonth: number;
  newBusinessesThisMonth: number;
  trialConversions: number;
  mrr: number;
  arr: number;
}

interface SubscriptionByPlan {
  plan_name: string;
  plan_id: string;
  count: number;
}

interface RecentBusiness {
  id: string;
  name: string;
  email: string;
  created_at: string;
  plan_id: string;
  plan_name: string;
}

export default function AdminDashboard() {
  const { admin, loading: adminLoading } = useAdmin();
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [subscriptionsByPlan, setSubscriptionsByPlan] = useState<SubscriptionByPlan[]>([]);
  const [recentBusinesses, setRecentBusinesses] = useState<RecentBusiness[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (adminLoading) return;
    if (!admin?.id) {
      setLoading(false);
      return;
    }
    fetchMetrics();
  }, [admin?.id, adminLoading]);

  async function fetchMetrics() {
    if (!admin?.id) return;
    try {
      const response = await fetch('/api/admin/metrics', {
        ...platformAdminFetchInit,
      });
      const data = await response.json();
      if (!response.ok) {
        console.error('Metrics error:', data);
        return;
      }
      setMetrics(data.metrics);
      setSubscriptionsByPlan(data.subscriptionsByPlan || []);
      setRecentBusinesses(data.recentBusinesses || []);
    } catch (error) {
      console.error('Error fetching metrics:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-300 rounded w-1/4"></div>
          <div className="grid grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-gray-300 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const statCards = [
    {
      name: 'Total Businesses',
      value: metrics?.totalBusinesses || 0,
      icon: Building2,
      color: 'bg-primary-500',
    },
    {
      name: 'Active (30 days)',
      value: metrics?.activeBusinesses || 0,
      icon: Activity,
      color: 'bg-green-500',
    },
    {
      name: 'New This Month',
      value: metrics?.newBusinessesThisMonth || 0,
      icon: Calendar,
      color: 'bg-purple-500',
    },
    {
      name: 'Total Invoices',
      value: metrics?.totalInvoices || 0,
      icon: FileText,
      color: 'bg-orange-500',
    },
    {
      name: 'MRR',
      value: `₹${(metrics?.mrr || 0).toLocaleString()}`,
      icon: DollarSign,
      color: 'bg-emerald-500',
    },
    {
      name: 'ARR',
      value: `₹${(metrics?.arr || 0).toLocaleString()}`,
      icon: TrendingUp,
      color: 'bg-pink-500',
    },
    {
      name: 'Paid Customers',
      value: metrics?.trialConversions || 0,
      icon: Users,
      color: 'bg-indigo-500',
    },
    {
      name: 'Invoices This Month',
      value: metrics?.invoicesThisMonth || 0,
      icon: FileText,
      color: 'bg-yellow-500',
    },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Platform Overview</h1>
        <p className="text-gray-600 mt-2">Monitor your platform's health and growth</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.name} className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">{stat.name}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-2">{stat.value}</p>
                </div>
                <div className={`${stat.color} p-3 rounded-lg`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Subscriptions by Plan */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Subscriptions by Plan</h2>
          <div className="space-y-4">
            {subscriptionsByPlan.map((sub) => {
              const total = subscriptionsByPlan.reduce((acc, s) => acc + (typeof s.count === 'string' ? parseInt(s.count) : s.count), 0);
              const percentage = total > 0 ? (((typeof sub.count === 'string' ? parseInt(sub.count) : sub.count) / total) * 100).toFixed(1) : '0';

              return (
                <div key={sub.plan_id}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium text-gray-700">{sub.plan_name}</span>
                    <span className="text-sm font-semibold text-gray-900">{sub.count}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-primary-600 h-2 rounded-full transition-all"
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Revenue Breakdown */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Revenue Overview</h2>
          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-gray-600">Monthly Recurring Revenue</span>
                <span className="text-2xl font-bold text-green-600">
                  ₹{(metrics?.mrr || 0).toLocaleString()}
                </span>
              </div>
              <p className="text-xs text-gray-500">Income generated per month from active subscriptions</p>
            </div>
            <div className="border-t pt-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-gray-600">Annual Recurring Revenue</span>
                <span className="text-2xl font-bold text-primary-600">
                  ₹{(metrics?.arr || 0).toLocaleString()}
                </span>
              </div>
              <p className="text-xs text-gray-500">Projected yearly revenue (MRR × 12)</p>
            </div>
            <div className="border-t pt-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Avg. Revenue Per User</span>
                <span className="text-lg font-semibold text-gray-900">
                  ₹{metrics?.totalBusinesses ? Math.round((metrics.mrr || 0) / metrics.totalBusinesses) : 0}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Businesses */}
      <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Recent Businesses</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Business Name</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Email</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Plan</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Joined</th>
              </tr>
            </thead>
            <tbody>
              {recentBusinesses.map((business) => (
                <tr key={business.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4 text-sm text-gray-900">{business.name}</td>
                  <td className="py-3 px-4 text-sm text-gray-600">{business.email || '-'}</td>
                  <td className="py-3 px-4">
                    <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-slate-100 text-primary-800">
                      {business.plan_name || 'Free'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-600">
                    {new Date(business.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

