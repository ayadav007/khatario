'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { Lock, ArrowLeft, CheckCircle } from 'lucide-react';
import Link from 'next/link';

export default function UpgradePage() {
  const router = useRouter();
  const { business } = useAuth();
  const [planName, setPlanName] = useState<string>('Free');

  useEffect(() => {
    if (business?.id) {
      fetch(`/api/subscriptions/current?business_id=${business.id}`)
        .then(res => res.json())
        .then(data => {
          if (data.subscription?.plan_display_name) {
            setPlanName(data.subscription.plan_display_name);
          } else if (data.subscription?.plan_name) {
            setPlanName(data.subscription.plan_name);
          }
        })
        .catch(() => {
          // Keep default 'Free' if fetch fails
        });
    }
  }, [business?.id]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <div className="text-center mb-6">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-yellow-100 mb-4">
            <Lock className="h-8 w-8 text-yellow-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Feature Not Available
          </h1>
          <p className="text-gray-600">
            This feature is not available in your current plan.
          </p>
        </div>

        <div className="mb-6">
          <p className="text-sm text-gray-500 mb-4">
            To access this feature, please upgrade your subscription plan.
          </p>

          <div className="bg-slate-50 border border-primary-200 rounded-lg p-4 mb-4">
            <h3 className="font-semibold text-primary-900 mb-2">Available Plans:</h3>
            <ul className="space-y-2 text-sm text-primary-800">
              <li className="flex items-center">
                <CheckCircle className="h-4 w-4 mr-2" />
                <span>Professional Plan - ₹299/month</span>
              </li>
              <li className="flex items-center">
                <CheckCircle className="h-4 w-4 mr-2" />
                <span>Business Plan - ₹999/month</span>
              </li>
              <li className="flex items-center">
                <CheckCircle className="h-4 w-4 mr-2" />
                <span>Enterprise Plan - ₹2,999/month</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="space-y-3">
          <Link href="/settings/subscription" className="block">
            <Button className="w-full" variant="primary">
              View Subscription Plans
            </Button>
          </Link>
          
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Go Back
          </Button>
        </div>

        {business && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center">
              Current Plan: <span className="font-semibold">{planName}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
