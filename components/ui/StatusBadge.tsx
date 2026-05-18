import React from 'react';
import { clsx } from 'clsx';
import { CheckCircle2, FileEdit, Clock, XCircle, AlertCircle } from 'lucide-react';

export type StatusType =
  | 'draft'
  | 'final'
  | 'paid'
  | 'unpaid'
  | 'partially_paid'
  | 'partial_paid'
  | 'requires_review'
  | 'cancelled'
  | 'pending'
  | 'eligible'
  | 'ineligible';

interface StatusBadgeProps {
  status: StatusType | string;
  className?: string;
  showIcon?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ 
  status, 
  className,
  showIcon = true 
}) => {
  const normalizedStatus = status.toLowerCase();

  const getStatusStyles = (s: string) => {
    switch (s) {
      case 'draft':
        return {
          bg: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600',
          icon: FileEdit,
          label: 'Draft'
        };
      case 'final':
        return {
          bg: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800',
          icon: CheckCircle2,
          label: 'Final'
        };
      case 'paid':
        return {
          bg: 'bg-slate-100 text-primary-700 border-primary-200 dark:bg-slate-800/40 dark:text-primary-300 dark:border-primary-800',
          icon: CheckCircle2,
          label: 'Paid'
        };
      case 'unpaid':
        return {
          bg: 'bg-orange-100 text-orange-700 border-orange-200',
          icon: Clock,
          label: 'Unpaid'
        };
      /** Sales orders (`partial_paid`) use the same badge as invoices (`partially_paid`). */
      case 'partial_paid':
      case 'partially_paid':
        return {
          bg: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/35 dark:text-amber-300 dark:border-amber-800',
          icon: Clock,
          label: 'Partially paid'
        };
      case 'requires_review':
        return {
          bg: 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800',
          icon: AlertCircle,
          label: 'Review Required'
        };
      case 'cancelled':
        return {
          bg: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
          icon: XCircle,
          label: 'Cancelled'
        };
      case 'eligible':
        return {
          bg: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
          icon: CheckCircle2,
          label: 'Eligible'
        };
      case 'ineligible':
        return {
          bg: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
          icon: AlertCircle,
          label: 'Ineligible'
        };
      case 'pending':
        return {
          bg: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/35 dark:text-amber-300 dark:border-amber-800',
          icon: Clock,
          label: 'Pending'
        };
      default:
        return {
          bg: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600',
          icon: FileEdit,
          label: s.charAt(0).toUpperCase() + s.slice(1)
        };
    }
  };

  const { bg, icon: Icon, label } = getStatusStyles(normalizedStatus);

  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border',
      bg,
      className
    )}>
      {showIcon && <Icon className="w-3.5 h-3.5" />}
      {label}
    </span>
  );
};

