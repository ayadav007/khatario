import React, { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { FileCheck, FileClock, AlertCircle } from 'lucide-react';

interface GSTStatusIndicatorProps {
  status?: 'included' | 'pending' | 'not_applicable'; // Optional for backward compatibility
  returnType: 'GSTR-1' | 'GSTR-3B' | 'GSTR-2B';
  period?: string;
  className?: string;
  invoiceId?: string; // New: If provided, will fetch status from API
}

export const GSTStatusIndicator: React.FC<GSTStatusIndicatorProps> = ({
  status: propStatus,
  returnType,
  period: propPeriod,
  className,
  invoiceId
}) => {
  const [status, setStatus] = useState<'included' | 'pending' | 'not_applicable'>(propStatus || 'pending');
  const [period, setPeriod] = useState<string | undefined>(propPeriod);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // If invoiceId is provided and returnType is GSTR-1, fetch status from API
    if (invoiceId && returnType === 'GSTR-1' && !propStatus) {
      setLoading(true);
      fetch(`/api/invoices/${invoiceId}/gstr1-status`)
        .then(res => res.json())
        .then(data => {
          if (data.status) {
            setStatus(data.status);
            if (data.filing_period) {
              setPeriod(data.filing_period);
            }
          }
        })
        .catch(err => {
          console.error('Error fetching GSTR-1 status:', err);
          // Default to pending on error
          setStatus('pending');
        })
        .finally(() => {
          setLoading(false);
        });
    } else if (propStatus) {
      // Use provided status
      setStatus(propStatus);
      setPeriod(propPeriod);
    }
  }, [invoiceId, returnType, propStatus, propPeriod]);

  const getStatusStyles = () => {
    switch (status) {
      case 'included':
        return {
          bg: 'bg-green-50 text-green-700 border-green-100 dark:bg-green-950/35 dark:text-green-300 dark:border-green-900',
          icon: FileCheck,
          text: `Included in ${returnType}`
        };
      case 'pending':
        return {
          bg: 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/35 dark:text-amber-300 dark:border-amber-900',
          icon: FileClock,
          text: `Pending in ${returnType}`
        };
      case 'not_applicable':
        return {
          bg: 'bg-gray-50 text-gray-500 border-gray-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
          icon: AlertCircle,
          text: `Not in ${returnType}`
        };
    }
  };

  const { bg, icon: Icon, text } = getStatusStyles();

  if (loading) {
    return (
      <div className={clsx(
        'flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-medium',
        'bg-gray-50 text-gray-400 border-gray-100 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
        className
      )}>
        <div className="w-3 h-3 border border-gray-300 dark:border-slate-500 border-t-transparent rounded-full animate-spin" />
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <div className={clsx(
      'flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-medium transition-all',
      bg,
      className
    )}>
      <Icon className="w-3 h-3" />
      <span>{text} {period && `(${period})`}</span>
    </div>
  );
};

