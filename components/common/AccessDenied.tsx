'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Lock, ArrowLeft, Settings, AlertTriangle, Key, Folder } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface AccessDeniedProps {
  message?: string;
  details?: string;
  code?: string;
  module?: string; // e.g., 'invoices', 'customers', 'items', 'employees'
  action?: string; // e.g., 'view', 'create', 'update', 'delete'
  onRetry?: () => void;
  className?: string;
}

/**
 * Module-specific messages mapping
 */
const MODULE_MESSAGES: Record<string, { name: string; description: string }> = {
  invoices: { name: 'Invoices', description: 'view or manage invoices' },
  customers: { name: 'Customers', description: 'view or manage customers' },
  items: { name: 'Items', description: 'view or manage items' },
  employees: { name: 'Employees', description: 'view or manage employees' },
  attendance: { name: 'Attendance', description: 'view or manage attendance' },
  leaves: { name: 'Leave management', description: 'view or manage leave requests' },
  leave_requests: { name: 'Leave management', description: 'view or manage leave requests' },
  commissions: { name: 'Commissions', description: 'view or manage commissions' },
  payroll: { name: 'Payroll', description: 'view or manage payroll' },
  purchases: { name: 'Purchases', description: 'view or manage purchases' },
  reports: { name: 'Reports', description: 'view or export reports' },
  settings: { name: 'Settings', description: 'access settings' },
  hr: { name: 'HR', description: 'access HR features' },
  whatsapp: { name: 'WhatsApp', description: 'access WhatsApp features' },
  warehouses: { name: 'Warehouses', description: 'view or manage warehouses' },
  journal: { name: 'Journal Entries', description: 'view or manage journal entries' },
  credit_notes: { name: 'Credit Notes', description: 'create or manage credit notes' },
  suppliers: { name: 'Suppliers', description: 'view or manage suppliers' },
};

/**
 * Action-specific messages
 */
const ACTION_MESSAGES: Record<string, string> = {
  view: 'view',
  create: 'create',
  update: 'modify',
  delete: 'delete',
  export: 'export',
};

/**
 * Access Denied Component
 * Modern, vibrant design with gradients inspired by contemporary UI patterns
 */
export function AccessDenied({
  message,
  details,
  code,
  module,
  action,
  onRetry,
  className = '',
}: AccessDeniedProps) {
  const router = useRouter();

  const isPlanDenial = code === 'FEATURE_NOT_IN_PLAN';

  // Generate user-friendly message if module/action provided
  let displayMessage = message || 'Access Denied';
  let displayDetails = details;

  if (isPlanDenial) {
    displayMessage = message || 'Not included in your current plan';
    displayDetails =
      details ||
      'This module is not part of your subscription. You can upgrade your plan or add an add-on (if available) from Subscription & billing.';
  } else if (module && MODULE_MESSAGES[module]) {
    const moduleInfo = MODULE_MESSAGES[module];
    const actionText = action && ACTION_MESSAGES[action] ? ACTION_MESSAGES[action] : 'access';

    displayMessage = message || `Access to ${moduleInfo.name} is restricted`;
    displayDetails =
      details ||
      `You don't have permission to ${actionText} ${moduleInfo.description}. Ask your organization admin to grant the right role in Settings → Roles.`;
  } else if (!details && !message) {
    displayMessage = 'Access Denied';
    displayDetails =
      'You don\'t have permission to perform this action. Please contact your administrator if you believe this is an error.';
  }

  return (
    <div className={`flex flex-col items-center justify-center min-h-[600px] p-6 relative overflow-hidden ${className}`}>
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Gradient circles */}
        <div className="absolute -top-20 -left-20 w-64 h-64 bg-gradient-to-br from-purple-300/30 to-pink-300/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-gradient-to-br from-orange-300/30 to-yellow-300/30 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-br from-primary-300/20 to-purple-300/20 rounded-full blur-3xl" />
        
        {/* Decorative shapes */}
        <div className="absolute top-10 left-10 w-3 h-3 bg-purple-400/40 rounded-full" />
        <div className="absolute top-20 right-20 w-2 h-2 bg-pink-400/40 rounded-full" />
        <div className="absolute bottom-20 left-1/4 w-2.5 h-2.5 bg-orange-400/40 rounded-full" />
        <div className="absolute bottom-32 right-1/3 w-2 h-2 bg-yellow-400/40 rounded-full" />
        
        {/* Dashed lines */}
        <svg className="absolute top-20 right-10 w-16 h-16 opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4">
          <path d="M5 12h14M12 5v14" />
        </svg>
        <svg className="absolute bottom-20 left-10 w-12 h-12 opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4">
          <circle cx="12" cy="12" r="10" />
        </svg>
      </div>

      {/* Main content card */}
      <div className="relative z-10 max-w-lg w-full">
        {/* Central monitor/display area */}
        <div className="bg-white rounded-2xl shadow-2xl p-8 md:p-10 text-center relative overflow-hidden">
          {/* Card gradient border effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500 rounded-2xl opacity-5" />
          
          {/* Monitor screen representation */}
          <div className="relative mb-6">
            <div className="mx-auto w-24 h-24 md:w-32 md:h-32 bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 rounded-2xl flex items-center justify-center shadow-lg relative overflow-hidden">
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
              
              {/* Lock icon */}
              <Lock className="w-12 h-12 md:w-16 md:h-16 text-white relative z-10" strokeWidth={2.5} />
              
              {/* Decorative elements on the icon background */}
              <div className="absolute top-2 right-2 w-3 h-3 bg-yellow-300/60 rounded-full blur-sm" />
              <div className="absolute bottom-2 left-2 w-2 h-2 bg-primary-300/60 rounded-full blur-sm" />
            </div>
          </div>

          {/* Warning icon above title */}
          <div className="flex justify-center mb-4">
            <div className="p-2 bg-gradient-to-br from-orange-100 to-pink-100 rounded-full">
              <AlertTriangle className="w-6 h-6 text-orange-500" />
            </div>
          </div>

          {/* Title */}
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3 bg-gradient-to-r from-purple-600 via-pink-600 to-orange-600 bg-clip-text text-transparent">
            {displayMessage}
          </h2>
          
          {/* Error code */}
          {code && code !== 'FEATURE_NOT_IN_PLAN' && (
            <p className="text-xs text-gray-400 mb-4 font-mono tracking-wider">
              {code}
            </p>
          )}
          
          {/* Details message */}
          {displayDetails && (
            <p className="text-sm md:text-base text-gray-600 mb-8 leading-relaxed max-w-md mx-auto">
              {displayDetails}
            </p>
          )}

          {/* Decorative foreground elements (key and folder icons) */}
          <div className="flex justify-center items-center gap-6 mb-8 opacity-60">
            <div className="transform -rotate-12">
              <Key className="w-8 h-8 text-purple-400" strokeWidth={1.5} />
            </div>
            <div className="transform rotate-12">
              <Folder className="w-8 h-8 text-orange-400" strokeWidth={1.5} />
            </div>
          </div>
          
          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md mx-auto">
            <Button
              variant="secondary"
              onClick={() => router.push('/dashboard')}
              className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-purple-50 to-pink-50 hover:from-purple-100 hover:to-pink-100 border-purple-200 text-purple-700 font-medium transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Button>
            
            {isPlanDenial ? (
              <Button
                variant="secondary"
                onClick={() => router.push('/settings/subscription')}
                className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-orange-50 to-yellow-50 hover:from-orange-100 hover:to-yellow-100 border-orange-200 text-orange-700 font-medium transition-all"
              >
                <Settings className="w-4 h-4" />
                Subscription &amp; billing
              </Button>
            ) : (
              module && (
                <Button
                  variant="secondary"
                  onClick={() => router.push('/settings/roles')}
                  className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-orange-50 to-yellow-50 hover:from-orange-100 hover:to-yellow-100 border-orange-200 text-orange-700 font-medium transition-all"
                >
                  <Settings className="w-4 h-4" />
                  Manage Permissions
                </Button>
              )
            )}
            
            {onRetry && (
              <Button
                onClick={onRetry}
                className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-medium shadow-lg hover:shadow-xl transition-all"
              >
                Try Again
              </Button>
            )}
          </div>
        </div>

        {/* Floating decorative elements around the card */}
        <div className="absolute -top-4 -left-4 w-16 h-16 bg-gradient-to-br from-purple-300/40 to-pink-300/40 rounded-full blur-xl opacity-50 -z-10" />
        <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-gradient-to-br from-orange-300/40 to-yellow-300/40 rounded-full blur-xl opacity-50 -z-10" />
      </div>
    </div>
  );
}
