'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, Building2, Mail, Phone, MapPin, Calendar, 
  TrendingUp, Users, Package, CreditCard, FileText, Loader2
} from 'lucide-react';
import Link from 'next/link';
import { useAdmin } from '@/context/AdminContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { BusinessAdminPanel } from '@/components/admin/BusinessAdminPanel';

interface BusinessDetail {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  state_code: string | null;
  pincode: string | null;
  gstin: string | null;
  pan: string | null;
  currency: string;
  invoice_prefix: string;
  created_at: string;
  plan_id: string | null;
  plan_name: string | null;
  price_monthly: number | null;
  invoice_count: number;
  customer_count: number;
  item_count: number;
  last_invoice_date: string | null;
  platform_suspended_at: string | null;
  platform_suspend_reason: string | null;
  subscription_status: string | null;
  trial_end_date: string | null;
  user_count: number;
}

export default function BusinessDetailPage({ params }: { params: { id: string } }) {
  const { admin, loading: adminLoading } = useAdmin();
  const router = useRouter();
  const [business, setBusiness] = useState<BusinessDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (adminLoading) return;
    if (!admin?.id) {
      setLoading(false);
      setError('Not signed in');
      return;
    }
    fetchBusiness();
  }, [params.id, admin?.id, adminLoading]);

  async function fetchBusiness() {
    if (!admin?.id) return;
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/admin/businesses/${params.id}`, {
        ...platformAdminFetchInit,
      });
      if (!response.ok) {
        if (response.status === 404) {
          setError('Business not found');
        } else {
          setError('Failed to load business details');
        }
        return;
      }
      const data = await response.json();
      setBusiness(data.business);
    } catch (err) {
      console.error('Error fetching business:', err);
      setError('Failed to load business details');
    } finally {
      setLoading(false);
    }
  }

  const getPlanBadgeColor = (planId: string | null) => {
    const colors: Record<string, string> = {
      free: 'bg-gray-100 text-gray-700',
      professional: 'bg-slate-100 text-primary-700',
      business: 'bg-purple-100 text-purple-700',
      enterprise: 'bg-orange-100 text-orange-700',
    };
    return planId ? colors[planId] || 'bg-gray-100 text-gray-700' : 'bg-gray-100 text-gray-700';
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (error || !business) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Error</h2>
          <p className="text-red-600">{error || 'Business not found'}</p>
          <Link
            href="/admin/businesses"
            className="mt-4 inline-flex items-center text-primary-600 hover:text-primary-800"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Businesses
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/admin/businesses"
          className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Businesses
        </Link>
        <h1 className="text-3xl font-bold text-gray-900">{business.name}</h1>
        <p className="text-gray-600 mt-2">Business Details</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Information */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Basic Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-500">Business Name</label>
                <p className="mt-1 text-gray-900">{business.name}</p>
              </div>
              {business.email && (
                <div>
                  <label className="text-sm font-medium text-gray-500">Email</label>
                  <p className="mt-1 text-gray-900 flex items-center">
                    <Mail className="w-4 h-4 mr-2 text-gray-400" />
                    {business.email}
                  </p>
                </div>
              )}
              {business.phone && (
                <div>
                  <label className="text-sm font-medium text-gray-500">Phone</label>
                  <p className="mt-1 text-gray-900 flex items-center">
                    <Phone className="w-4 h-4 mr-2 text-gray-400" />
                    {business.phone}
                  </p>
                </div>
              )}
              {business.gstin && (
                <div>
                  <label className="text-sm font-medium text-gray-500">GSTIN</label>
                  <p className="mt-1 text-gray-900">{business.gstin}</p>
                </div>
              )}
              {business.pan && (
                <div>
                  <label className="text-sm font-medium text-gray-500">PAN</label>
                  <p className="mt-1 text-gray-900">{business.pan}</p>
                </div>
              )}
            </div>
          </div>

          {/* Address */}
          {(business.address_line1 || business.city || business.state) && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <MapPin className="w-5 h-5 mr-2 text-gray-400" />
                Address
              </h2>
              <div className="text-gray-700">
                {business.address_line1 && <p>{business.address_line1}</p>}
                {business.address_line2 && <p>{business.address_line2}</p>}
                <p>
                  {business.city && business.city}
                  {business.city && business.state && ', '}
                  {business.state && business.state}
                  {business.pincode && ` ${business.pincode}`}
                </p>
                {business.state_code && (
                  <p className="text-sm text-gray-500 mt-1">State Code: {business.state_code}</p>
                )}
              </div>
            </div>
          )}

          {/* Business Settings */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Business Settings</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-500">Currency</label>
                <p className="mt-1 text-gray-900">{business.currency || 'INR'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Invoice Prefix</label>
                <p className="mt-1 text-gray-900">{business.invoice_prefix || 'INV'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Subscription */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
              <CreditCard className="w-5 h-5 mr-2 text-gray-400" />
              Subscription
            </h2>
            <div className="space-y-3">
              <div>
                <span
                  className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full ${getPlanBadgeColor(
                    business.plan_id
                  )}`}
                >
                  {business.plan_name || 'Free'}
                </span>
                {business.price_monthly && business.price_monthly > 0 && (
                  <p className="text-sm text-gray-600 mt-2">₹{business.price_monthly}/month</p>
                )}
              </div>
            </div>
          </div>

          {/* Activity Stats */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
              <TrendingUp className="w-5 h-5 mr-2 text-gray-400" />
              Activity
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-600">Invoices</span>
                </div>
                <span className="font-semibold text-gray-900">{business.invoice_count}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Users className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-600">Customers</span>
                </div>
                <span className="font-semibold text-gray-900">{business.customer_count}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Package className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-600">Items</span>
                </div>
                <span className="font-semibold text-gray-900">{business.item_count}</span>
              </div>
              {business.last_invoice_date && (
                <div className="pt-3 border-t border-gray-200">
                  <div className="flex items-center space-x-2 text-sm text-gray-600">
                    <Calendar className="w-4 h-4" />
                    <span>Last Invoice:</span>
                    <span className="font-medium text-gray-900">
                      {new Date(business.last_invoice_date).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Account Info */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
              <Calendar className="w-5 h-5 mr-2 text-gray-400" />
              Account
            </h2>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-gray-500">Joined:</span>
                <p className="text-gray-900 font-medium mt-1">
                  {new Date(business.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Platform operations</h2>
        <BusinessAdminPanel
          businessId={business.id}
          businessName={business.name}
          platformSuspendedAt={business.platform_suspended_at}
          platformSuspendReason={business.platform_suspend_reason}
          subscriptionStatus={business.subscription_status}
          planId={business.plan_id}
          trialEndDate={business.trial_end_date}
          onUpdated={fetchBusiness}
        />
      </div>
    </div>
  );
}
