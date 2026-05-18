'use client';

import React from 'react';
import { AlertTriangle, TrendingUp } from 'lucide-react';
import { CreditMetrics } from '@/lib/credit-utils';

interface CreditWarningBannerProps {
  metrics: CreditMetrics;
  projectedMetrics?: CreditMetrics;
  partyType: 'customer' | 'supplier';
  partyName?: string;
}

export function CreditWarningBanner({
  metrics,
  projectedMetrics,
  partyType,
  partyName,
}: CreditWarningBannerProps) {
  // Use projected metrics if available, otherwise current
  const displayMetrics = projectedMetrics || metrics;

  // Skip if unlimited
  if (displayMetrics.credit_status === 'UNLIMITED' || 
      displayMetrics.credit_utilization_percent === null) {
    return null;
  }
  
  // Show warning if utilization >= 70% OR if already over limit (even if < 70% utilization shown)
  // This handles the case where customer is already over limit but utilization calculation might be off
  const shouldShow = displayMetrics.credit_utilization_percent >= 70 || 
                     displayMetrics.credit_status === 'OVER_LIMIT';
  
  if (!shouldShow) {
    return null;
  }

  const utilization = displayMetrics.credit_utilization_percent;
  const partyLabel = partyType === 'customer' ? 'Customer' : 'Supplier';

  // Determine color scheme based on utilization
  let bgColor = '';
  let borderColor = '';
  let textColor = '';
  let iconColor = '';

  if (utilization >= 100) {
    // Red for over limit
    bgColor = 'bg-red-50';
    borderColor = 'border-red-300';
    textColor = 'text-red-800';
    iconColor = 'text-red-600';
  } else if (utilization >= 90) {
    // Orange for critical (90-99%)
    bgColor = 'bg-orange-50';
    borderColor = 'border-orange-300';
    textColor = 'text-orange-800';
    iconColor = 'text-orange-600';
  } else {
    // Yellow for warning (70-89%)
    bgColor = 'bg-yellow-50';
    borderColor = 'border-yellow-300';
    textColor = 'text-yellow-800';
    iconColor = 'text-yellow-600';
  }

  return (
    <div className={`${bgColor} ${borderColor} border-l-4 rounded-r-lg p-4 mb-4`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className={`w-5 h-5 ${iconColor} mt-0.5 flex-shrink-0`} />
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <h4 className={`font-semibold ${textColor}`}>
              Credit Utilization: {utilization.toFixed(1)}%
            </h4>
            <span className={`text-xs font-medium px-2 py-1 rounded ${textColor} ${bgColor.replace('50', '200')}`}>
              {displayMetrics.credit_status}
            </span>
          </div>

          {/* Progress Bar */}
          <div className="mb-3">
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full transition-all ${
                  utilization >= 100
                    ? 'bg-red-600'
                    : utilization >= 90
                    ? 'bg-orange-500'
                    : 'bg-yellow-500'
                }`}
                style={{ width: `${Math.min(utilization, 100)}%` }}
              />
            </div>
          </div>

          {/* Details */}
          <div className="grid grid-cols-2 gap-4 text-sm mb-2">
            <div>
              <span className="text-gray-600">Credit Limit:</span>
              <span className={`ml-2 font-medium ${textColor}`}>
                ₹{displayMetrics.credit_limit.toLocaleString('en-IN')}
              </span>
            </div>
            <div>
              <span className="text-gray-600">Available Credit:</span>
              <span className={`ml-2 font-medium ${textColor}`}>
                {displayMetrics.available_credit !== null
                  ? `₹${displayMetrics.available_credit.toLocaleString('en-IN')}`
                  : 'Unlimited'}
              </span>
            </div>
          </div>

          {/* Warning Message */}
          {projectedMetrics && (
            <p className={`text-sm ${textColor} mt-2`}>
              {utilization >= 100
                ? `This transaction will push ${partyName || partyLabel.toLowerCase()} over their credit limit.`
                : utilization >= 90
                ? `This transaction will push ${partyName || partyLabel.toLowerCase()} to ${utilization.toFixed(1)}% of their credit limit (CRITICAL).`
                : `This transaction will push ${partyName || partyLabel.toLowerCase()} to ${utilization.toFixed(1)}% of their credit limit.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
