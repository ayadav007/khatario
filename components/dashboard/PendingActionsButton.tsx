'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { AlertCircle, FileText, Calendar, Clock, Package, X, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';

interface PendingAction {
  id: string;
  label: string;
  count: number;
  amount?: number;
  href: string;
  color: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface PendingActionsButtonProps {
  data: {
    invoiceAlerts?: {
      overdue?: { count: number; total_amount?: number };
      due_tomorrow?: { count: number; total_amount?: number };
    };
    /** Accurate count from /api/dashboard/overview — matches GET /api/invoices?status=draft */
    draftInvoicesCount?: number;
    recentInvoices?: Array<{ status: string; branch_id?: string }>;
    lowStockItems?: Array<any>;
  };
}

export const PendingActionsButton: React.FC<PendingActionsButtonProps> = ({ data }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { isPrimaryAdmin } = useAuth();
  const { currentBranchId } = useBranch();

  /**
   * Draft count comes from API (draftInvoicesCount), not from the last 5 "recent" rows — that
   * heuristic could show 2 while only 1 draft exists for the current branch scope.
   * Deep link: only primary admin gets branch_id=ALL so /api/invoices matches admin scope.
   */
  const pendingActions: PendingAction[] = useMemo(() => {
    const recent = data?.recentInvoices ?? [];
    const draftRowsFallback = isPrimaryAdmin
      ? recent.filter((i: any) => i.status === 'draft')
      : recent.filter(
          (i: any) =>
            i.status === 'draft' &&
            currentBranchId &&
            i.branch_id === currentBranchId
        );
    const draftCount =
      typeof data?.draftInvoicesCount === 'number'
        ? data.draftInvoicesCount
        : draftRowsFallback.length;
    const draftsHref = isPrimaryAdmin
      ? '/invoices?status=draft&branch_id=ALL'
      : '/invoices?status=draft';

    return [
      {
        id: 'overdue',
        label: 'Overdue Invoices',
        count: data?.invoiceAlerts?.overdue?.count || 0,
        amount: data?.invoiceAlerts?.overdue?.total_amount,
        href: '/invoices?status=overdue',
        color: 'text-red-700 bg-red-50 border-red-200 dark:text-red-200 dark:bg-red-950/35 dark:border-red-800',
        icon: AlertCircle,
      },
      {
        id: 'due_tomorrow',
        label: 'Due Tomorrow',
        count: data?.invoiceAlerts?.due_tomorrow?.count || 0,
        amount: data?.invoiceAlerts?.due_tomorrow?.total_amount,
        href: '/invoices?due_soon=true',
        color: 'text-orange-700 bg-orange-50 border-orange-200 dark:text-orange-200 dark:bg-orange-950/35 dark:border-orange-800',
        icon: Calendar,
      },
      {
        id: 'drafts',
        label: 'Draft Invoices',
        count: draftCount,
        href: draftsHref,
        color: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-200 dark:bg-amber-950/35 dark:border-amber-800',
        icon: FileText,
      },
      {
        id: 'itc',
        label: 'ITC Decisions Pending',
        count: 0, // Placeholder - replace with actual ITC count
        href: '/reports/gst/gstr2b-reconciliation',
        color: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-200 dark:bg-amber-950/35 dark:border-amber-800',
        icon: Clock,
      },
      {
        id: 'low_stock',
        label: 'Low Stock Items',
        count: data?.lowStockItems?.length || 0,
        href: '/items?filter=low_stock',
        color: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-200 dark:bg-amber-950/35 dark:border-amber-800',
        icon: Package,
      },
    ];
  }, [data, isPrimaryAdmin, currentBranchId]);

  // Calculate total pending count
  const totalPending = pendingActions.reduce((sum, action) => sum + action.count, 0);
  const hasPendingActions = totalPending > 0;

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div ref={containerRef} className="fixed right-0 top-1/2 -translate-y-1/2 z-50">
      {/* Main Button - Vertical Strip */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`relative w-8 h-32 flex items-center justify-center shadow-lg hover:shadow-xl transition-all transform hover:scale-105 rounded-l-lg ${
          hasPendingActions 
            ? 'bg-amber-500 hover:bg-amber-600 text-white' 
            : 'bg-green-500 hover:bg-green-600 text-white'
        }`}
        aria-label={`Pending Actions (${totalPending})`}
      >
        <div 
          className="text-white text-[10px] font-bold tracking-widest"
          style={{ 
            writingMode: 'vertical-rl',
            textOrientation: 'upright'
          }}
        >
          PENDING
        </div>
        {hasPendingActions && (
          <span className="absolute top-2 text-[10px] font-bold bg-red-500 rounded-full w-5 h-5 flex items-center justify-center">
            {totalPending > 9 ? '9+' : totalPending}
          </span>
        )}
      </button>

      {/* Expanded Menu */}
      {isOpen && (
        <Card
          padding="md"
          className="absolute top-1/2 -translate-y-1/2 right-12 mr-2 w-[min(20rem,calc(100vw-2.5rem))] max-h-[600px] overflow-y-auto shadow-xl animate-in fade-in slide-in-from-right-2 duration-200"
        >
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600" />
              <h3 className="text-lg font-semibold text-text-primary">Pending Actions</h3>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-slate-50 dark:hover:bg-slate-800 rounded transition-colors"
            >
              <X className="w-4 h-4 text-text-muted" />
            </button>
          </div>

          <div className="space-y-2">
            {hasPendingActions ? (
              pendingActions
                .filter((action) => action.count > 0)
                .map((action) => {
                  const Icon = action.icon;
                  return (
                    <Link
                      key={action.id}
                      href={action.href}
                      onClick={() => setIsOpen(false)}
                      className={`block p-4 rounded-lg border ${action.color} hover:shadow-md transition-all`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1">
                          <div className={`p-2 rounded-lg ${action.color.split(' ')[0]} bg-opacity-20`}>
                            <Icon className={`w-5 h-5 ${action.color.split(' ')[0]}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-text-primary">{action.label}</p>
                            {action.amount !== undefined && action.amount > 0 && (
                              <p className="text-xs text-text-secondary mt-0.5">
                                ₹{Number(action.amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl font-bold text-gray-900">{action.count}</span>
                          <ChevronRight className="w-5 h-5 text-gray-400" />
                        </div>
                      </div>
                    </Link>
                  );
                })
            ) : (
              <div className="text-center py-8 text-text-muted">
                <AlertCircle className="w-12 h-12 mx-auto mb-2 text-text-muted opacity-70" />
                <p className="text-sm font-medium text-text-primary">All caught up!</p>
                <p className="text-xs mt-1 text-text-secondary">No pending actions at the moment</p>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
};

