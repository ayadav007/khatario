'use client';

import {
  BarChart3,
  BookOpen,
  FileText,
  Landmark,
  Package,
  Receipt,
  Scale,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { MobileListRow, MobileListSection } from '@/components/layout/MobileList';

type ReportLink = {
  href: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
};

const POPULAR: ReportLink[] = [
  { href: '/reports/profit-loss', label: 'Profit and Loss', icon: TrendingUp },
  { href: '/reports/sales/summary', label: 'Sales Summary', icon: Receipt },
  { href: '/reports/purchase/summary', label: 'Purchase Summary', icon: ShoppingCart },
  { href: '/reports/stock/summary', label: 'Stock Summary', hint: 'Price and stock of all items', icon: Package },
  { href: '/reports/balance-sheet', label: 'Balance Sheet', icon: Scale },
  { href: '/reports/cash-flow', label: 'Cash Flow', icon: Wallet },
  { href: '/reports/trial-balance', label: 'Trial Balance', icon: BookOpen },
  { href: '/reports/aging/receivables', label: 'Receivables Aging', icon: Landmark },
];

const MORE: ReportLink[] = [
  { href: '/reports/aging/payables', label: 'Payables Aging', icon: Landmark },
  { href: '/reports/gst/gstr1', label: 'GSTR-1', icon: FileText },
  { href: '/reports/gst/gstr2b', label: 'GSTR-2B', icon: FileText },
  { href: '/reports/gst/gstr3b', label: 'GSTR-3B', icon: FileText },
  { href: '/reports/gst/cash-ledger', label: 'GST Cash Ledger', icon: Wallet },
  { href: '/reports/stock/closing-stock', label: 'Closing Stock', icon: Package },
  { href: '/reports/builder', label: 'Custom Report Builder', icon: BarChart3 },
];

function ReportRows({ items }: { items: ReportLink[] }) {
  return items.map((item) => (
    <MobileListRow
      key={item.href}
      href={item.href}
      label={item.label}
      hint={item.hint}
      icon={item.icon}
    />
  ));
}

/** Phone index only. Totals stay on the report that is opened. */
export function MobileReportsIndex() {
  return (
    <div className="md:hidden -mx-page-x">
      <h1 className="px-4 pb-1 pt-2 text-lg font-semibold text-text-primary">Reports</h1>
      <MobileListSection title="Popular">
        <ReportRows items={POPULAR} />
      </MobileListSection>
      <MobileListSection title="More">
        <ReportRows items={MORE} />
      </MobileListSection>
    </div>
  );
}
