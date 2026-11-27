'use client';

import { PageHeader } from '@/components/layout/PageHeader';
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { Lock, ArrowLeft, CheckCircle } from 'lucide-react';
import Link from 'next/link';

type OfferedPlan = {
  id: string;
  display_name?: string;
  name?: string;
  price_monthly: number | string;
  price_yearly?: number | string;
  product_line?: string;
  is_public?: boolean;
  is_active?: boolean;
  offer?: { current: boolean; selectable: boolean };
};

const PRODUCT_LABELS: Record<string, string> = { billing: 'Billing', hr: 'HR', connect: 'Connect' };

function formatInr(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

/** Plans a visitor can buy today: public, active and not free, straight from the plan catalogue. */
function plansOnSale(plans: OfferedPlan[]): OfferedPlan[] {
  return plans.filter(
    (p) => !p.offer?.current && p.offer?.selectable !== false && p.is_public !== false && p.is_active !== false && (Number(p.price_monthly) > 0 || Number(p.price_yearly) > 0),
  );
}

export default function UpgradePage() {
  const router = useRouter();
  const { business } = useAuth();
  const [planName, setPlanName] = useState<string>('Free');
  const [plans, setPlans] = useState<OfferedPlan[]>([]);
  const [plansState, setPlansState] = useState<'loading' | 'ready' | 'error'>('loading');

  const loadPlans = useCallback(() => {
    setPlansState('loading');
    fetch('/api/subscriptions/plans', { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('plans');
        return res.json();
      })
      .then((data) => {
        setPlans(plansOnSale(Array.isArray(data.plans) ? data.plans : []));
        setPlansState('ready');
      })
      .catch(() => setPlansState('error'));
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

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
          <PageHeader
  title="Feature Not Available"
  subtitle="This feature is not available in your current plan."
/>
        </div>

        <div className="mb-6">
          <p className="text-sm text-gray-500 mb-4">
            To access this feature, please upgrade your subscription plan.
          </p>

          {plansState === 'loading' && <p className="text-sm text-gray-500 mb-4">Loading plans...</p>}
          {plansState === 'error' && (
            <div className="bg-slate-50 border border-primary-200 rounded-lg p-4 mb-4 text-sm text-primary-800">
              <p>Plans could not be loaded.</p>
              <button type="button" onClick={loadPlans} className="mt-2 font-semibold underline">
                Try again
              </button>
            </div>
          )}
          {plansState === 'ready' && plans.length === 0 && (
            <p className="text-sm text-gray-500 mb-4">No plans are on sale right now. Open Subscription Plans to see your options.</p>
          )}
          {plansState === 'ready' && plans.length > 0 && (
            <div className="bg-slate-50 border border-primary-200 rounded-lg p-4 mb-4">
              <h3 className="font-semibold text-primary-900 mb-2">Available Plans:</h3>
              <ul className="space-y-2 text-sm text-primary-800">
                {plans.map((plan) => {
                  const line = plan.product_line && plan.product_line !== 'billing' ? PRODUCT_LABELS[plan.product_line] : null;
                  const monthly = Number(plan.price_monthly);
                  const yearly = Number(plan.price_yearly);
                  const price = monthly > 0 ? `${formatInr(monthly)}/month` : `${formatInr(yearly)}/year`;
                  return (
                    <li key={plan.id} className="flex items-center">
                      <CheckCircle className="h-4 w-4 mr-2" />
                      <span>
                        {line ? `${line} ` : ''}
                        {plan.display_name || plan.name} - {price}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
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
