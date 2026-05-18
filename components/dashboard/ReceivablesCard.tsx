'use client';

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ChevronDown, Info, Plus } from 'lucide-react';
import Link from 'next/link';

interface AgingBreakdown {
  current: number;
  days_1_15: number;
  days_16_30: number;
  days_31_45: number;
  days_45_plus: number;
  total: number;
}

interface ReceivablesCardProps {
  total: number;
  aging: AgingBreakdown;
}

export const ReceivablesCard: React.FC<ReceivablesCardProps> = ({ total, aging }) => {
  const [showAging, setShowAging] = useState(false);
  const overdue = aging.days_1_15 + aging.days_16_30 + aging.days_31_45 + aging.days_45_plus;

  return (
    <Card padding="md" className="border border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-text-primary">Total Receivables</h3>
          <div className="relative group">
            <Info className="w-4 h-4 text-text-muted cursor-help" />
            <div className="absolute left-0 bottom-full mb-2 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10">
              <p className="font-semibold mb-2">Total Receivables:</p>
              <ul className="space-y-1 list-disc list-inside">
                <li><strong>Current:</strong> Invoices not yet due (within payment terms)</li>
                <li><strong>Overdue:</strong> Invoices past their due date, broken down by days overdue</li>
                <li>Click on any section to view filtered invoices</li>
              </ul>
              <div className="absolute left-4 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
            </div>
          </div>
        </div>
        <Link href="/invoices/new">
          <Button variant="primary" size="sm">
            <Plus className="w-4 h-4 mr-1" />
            New
          </Button>
        </Link>
      </div>

      <p className="text-sm text-text-secondary mb-4">
        Total Unpaid Invoices ₹{total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
      </p>

      <div className="space-y-3">
        {/* Current (Not Overdue) */}
        <Link 
          href="/invoices?status=unpaid&aging_days_min=0&aging_days_max=0"
          className="flex cursor-pointer items-center justify-between rounded-lg border border-emerald-200/90 bg-gradient-to-r from-emerald-50 via-green-50 to-teal-50 p-3 transition-all hover:from-emerald-100 hover:via-green-100 hover:to-teal-100 dark:border-emerald-800/55 dark:from-emerald-950/50 dark:via-green-950/40 dark:to-teal-950/35 dark:hover:from-emerald-900/55 dark:hover:via-green-900/45 dark:hover:to-teal-900/40"
        >
          <span className="text-sm font-medium text-emerald-900 dark:text-emerald-200">CURRENT</span>
          <span className="text-lg font-bold text-emerald-900 dark:text-emerald-200">
            ₹{aging.current.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </span>
        </Link>

        {/* Overdue (Expandable) */}
        <div>
          <button
            onClick={() => setShowAging(!showAging)}
            className="w-full flex items-center justify-between p-3 bg-red-50 dark:bg-red-950/35 rounded-lg hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors border border-red-100 dark:border-red-900"
          >
            <span className="text-sm font-medium text-red-700 dark:text-red-300">OVERDUE</span>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-red-700 dark:text-red-300">
                ₹{overdue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
              <ChevronDown 
                className={`w-4 h-4 text-red-700 dark:text-red-300 transition-transform duration-200 ${showAging ? 'rotate-180' : ''}`} 
              />
            </div>
          </button>

          {showAging && (
            <div className="mt-2 space-y-2 pl-4 border-l-2 border-red-200 dark:border-red-900 animate-in fade-in slide-in-from-top-2 duration-200">
              <Link 
                href={`/invoices?status=unpaid&aging_days_min=1&aging_days_max=15`}
                className="flex items-center justify-between py-2 hover:bg-red-50 dark:hover:bg-red-950/25 rounded px-2 -mx-2 transition-colors cursor-pointer"
              >
                <span className="text-xs text-text-secondary">1-15 Days</span>
                <span className="text-sm font-medium text-text-primary">
                  ₹{aging.days_1_15.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </span>
              </Link>
              <Link 
                href={`/invoices?status=unpaid&aging_days_min=16&aging_days_max=30`}
                className="flex items-center justify-between py-2 hover:bg-red-50 dark:hover:bg-red-950/25 rounded px-2 -mx-2 transition-colors cursor-pointer"
              >
                <span className="text-xs text-text-secondary">16-30 Days</span>
                <span className="text-sm font-medium text-text-primary">
                  ₹{aging.days_16_30.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </span>
              </Link>
              <Link 
                href={`/invoices?status=unpaid&aging_days_min=31&aging_days_max=45`}
                className="flex items-center justify-between py-2 hover:bg-red-50 dark:hover:bg-red-950/25 rounded px-2 -mx-2 transition-colors cursor-pointer"
              >
                <span className="text-xs text-text-secondary">31-45 Days</span>
                <span className="text-sm font-medium text-text-primary">
                  ₹{aging.days_31_45.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </span>
              </Link>
              <Link 
                href={`/invoices?status=unpaid&aging_days_min=46&aging_days_max=9999`}
                className="flex items-center justify-between py-2 hover:bg-red-50 dark:hover:bg-red-950/25 rounded px-2 -mx-2 transition-colors cursor-pointer"
              >
                <span className="text-xs text-text-secondary">Above 45 days</span>
                <span className="text-sm font-medium text-text-primary">
                  ₹{aging.days_45_plus.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};

