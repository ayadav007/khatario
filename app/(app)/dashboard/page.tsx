'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { TrendingUp, TrendingDown, Loader2, IndianRupee, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { buildApiUrl } from '@/lib/api-helpers';
import { format } from 'date-fns';
import { DashboardCardDetails } from '@/components/dashboard/DashboardCardDetails';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { GSTStatusIndicator } from '@/components/ui/GSTStatusIndicator';
import { PromotionCarousel } from '@/components/promotions/PromotionCarousel';
import { SalesVsPurchasesChart } from '@/components/dashboard/SalesVsPurchasesChart';
import { SalesInsightsCard } from '@/components/dashboard/SalesInsightsCard';
import { QuickActionsFAB } from '@/components/dashboard/QuickActionsFAB';
import { PendingActionsButton } from '@/components/dashboard/PendingActionsButton';
import { ReceivablesCard } from '@/components/dashboard/ReceivablesCard';
import { PayablesCard } from '@/components/dashboard/PayablesCard';
import { CashFlowChart } from '@/components/dashboard/CashFlowChart';
import {
  DashboardFinancialSnapshot,
  type DashboardKpiClickType,
  type DashboardKpiItem,
} from '@/components/dashboard/DashboardFinancialSnapshot';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { useDateRange } from '@/contexts/DateRangeContext';
import { CustomizableDashboard } from '@/components/dashboard/CustomizableDashboard';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { STACK_PAGE_CLASS, STACK_SECTION_CLASS } from '@/lib/page-layout';
import { ShareInvoiceModal } from '@/components/modals/ShareInvoiceModal';
import { RecordPaymentModal } from '@/components/modals/RecordPaymentModal';
import { ShareInvoiceFormatSheet } from '@/components/invoices/ShareInvoiceFormatSheet';
import { canUseNativeInvoiceShare } from '@/lib/share-invoice';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import {
  loadDashboardSnapshot,
  saveDashboardSnapshot,
} from '@/lib/dashboard-snapshot';
import {
  loadDashboardCache,
  saveDashboardCache,
} from '@/lib/offline/repositories/entity-cache-repository';
import { markAppSynced } from '@/lib/sync-timestamp';
import { SubscriptionUsageBanner } from '@/components/subscription/SubscriptionUsageBanner';

function DashboardPage() {
  const { business, user, loading: authLoading } = useAuth();
  const { currentBranchId, isLoading: branchLoading } = useBranch();
  const { registerHandler } = useDateRange();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [selectedCard, setSelectedCard] = useState<
    'sales' | 'purchases' | 'receivables' | 'payables' | 'collection' | null
  >(null);
  const [cardDetails, setCardDetails] = useState<any[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [shareModalInvoice, setShareModalInvoice] = useState<any>(null);
  const [shareFormatInvoice, setShareFormatInvoice] = useState<any>(null);
  const [paymentModalInvoice, setPaymentModalInvoice] = useState<any>(null);
  const { isOffline, isOnline, lastChangedAt } = useNetworkStatus();
  const prevOnlineRef = useRef(isOnline);
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);

  useEffect(() => {
    const wasOffline = !prevOnlineRef.current;
    prevOnlineRef.current = isOnline;

    if (isOnline && wasOffline) {
      setDashboardRefreshKey((key) => key + 1);
    }
  }, [isOnline, lastChangedAt]);

  const openShareForInvoice = (invoice: { id: string; invoice_number: string }) => {
    if (canUseNativeInvoiceShare()) {
      setShareFormatInvoice(invoice);
    } else {
      setShareModalInvoice(invoice);
    }
  };
  
  // Initialize with default "today" range to prevent double-load
  const getDefaultDateRange = () => {
    const today = new Date();
    return {
      start: format(today, 'yyyy-MM-dd'),
      end: format(today, 'yyyy-MM-dd'),
      label: 'Today'
    };
  };
  
  const [dateRange, setDateRange] = useState<{ start: string; end: string; label: string }>(getDefaultDateRange());
  const dateRangeRef = useRef<string>(`${getDefaultDateRange().start}-${getDefaultDateRange().end}`);
  const dateRangeKey = `${dateRange.start}-${dateRange.end}`;

  useEffect(() => {
    if (!business?.id || !user?.id || !isOffline) return;
    void (async () => {
      const idb = await loadDashboardCache(
        { businessId: business.id, userId: user.id },
        dateRangeKey
      );
      if (idb?.data) {
        setData(idb.data);
        setLoading(false);
        return;
      }
      const cached = loadDashboardSnapshot(business.id, user.id, dateRangeKey);
      if (cached?.data) {
        setData(cached.data);
      }
      setLoading(false);
    })();
  }, [business?.id, user?.id, isOffline, dateRangeKey]);

  const handleDateRangeChange = useCallback((range: { start: string; end: string; label: string }) => {
    const rangeKey = `${range.start}-${range.end}`;
    // Only update if the range actually changed
    if (dateRangeRef.current !== rangeKey) {
      dateRangeRef.current = rangeKey;
      setDateRange(range);
    }
  }, []);

  // Register the handler with the context so TopBar can call it
  useEffect(() => {
    registerHandler(handleDateRangeChange);
    // Cleanup: unregister when component unmounts
    return () => {
      registerHandler(null);
    };
  }, [handleDateRangeChange, registerHandler]);

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (authLoading || branchLoading) return;
      if (!business?.id || !user?.id) {
        setLoading(false);
        return;
      }
      if (isOffline) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const params: Record<string, string> = {
          business_id: business.id,
          start_date: dateRange.start,
          end_date: dateRange.end,
          user_id: user.id,
        };
        const res = await fetch(buildApiUrl('/api/dashboard/overview', params), { cache: 'no-store' });
        if (res.ok) {
          const result = await res.json();
          setData(result);
          saveDashboardSnapshot(business.id, user.id, dateRangeKey, result);
          void saveDashboardCache(
            { businessId: business.id, userId: user.id },
            dateRangeKey,
            result
          );
          markAppSynced();
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [authLoading, branchLoading, business?.id, user?.id, dateRange, currentBranchId, dashboardRefreshKey, isOffline, dateRangeKey]);

  if (loading && !data) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

  const handleCardClick = async (
    type: 'sales' | 'purchases' | 'receivables' | 'payables' | 'collection'
  ) => {
    if (!business?.id) return;

    setSelectedCard(type);
    setLoadingDetails(true);

    try {
      let endpoint = '';
      if (type === 'sales') {
        endpoint = `/api/dashboard/today-sales?business_id=${business.id}`;
      } else if (type === 'purchases') {
        endpoint = `/api/dashboard/today-purchases?business_id=${business.id}`;
      } else if (type === 'receivables') {
        endpoint = `/api/dashboard/receivables?business_id=${business.id}`;
      } else if (type === 'payables') {
        endpoint = `/api/dashboard/payables?business_id=${business.id}`;
      } else if (type === 'collection') {
        const start = dateRange?.start ?? format(new Date(), 'yyyy-MM-dd');
        const end = dateRange?.end ?? format(new Date(), 'yyyy-MM-dd');
        endpoint = `/api/dashboard/collection?business_id=${business.id}&start_date=${start}&end_date=${end}`;
      }

      const response = await fetch(endpoint);
      if (response.ok) {
        const result = await response.json();

        if (type === 'collection') {
          setCardDetails(result.payments || []);
        } else if (type === 'sales' || type === 'receivables') {
          setCardDetails(result.invoices || []);
        } else {
          setCardDetails(result.purchases || []);
        }
      } else {
        const error = await response.json();
        console.error('Error fetching card details:', error);
      }
    } catch (error) {
      console.error('Error fetching card details:', error);
    } finally {
      setLoadingDetails(false);
    }
  };

  // Get period label for KPI titles (e.g., "Today", "This Week", "This Month")
  const periodLabel = dateRange?.label || "Today";
  
  // Format period label for titles (handle apostrophe correctly)
  const getPeriodPrefix = (label: string) => {
    if (label === "Today") return "Today's";
    if (label.endsWith("'s")) return label; // Already has apostrophe
    return `${label}'s`;
  };
  
  const periodPrefix = getPeriodPrefix(periodLabel);
  
  // Get values from API (profit is now calculated correctly using COGS)
  const sales = data?.sales || 0;
  const purchases = data?.purchases || 0;
  const collection = data?.collection || 0;
  const profit = data?.profit || 0; // Gross Profit = Sales - COGS (calculated in API)

  const handleKpiClick = (type: DashboardKpiClickType) => {
    if (type === 'profit') return;
    handleCardClick(type);
  };

  const formatInr = (amount: number) => `₹ ${amount.toLocaleString('en-IN')}`;

  const financialSnapshotItems: DashboardKpiItem[] = [
    {
      id: 'sales',
      title: `${periodPrefix} Sales`,
      value: formatInr(sales),
      icon: TrendingUp,
      iconColor: 'text-emerald-700 dark:text-emerald-200',
      valueColor: 'text-emerald-700 dark:text-emerald-300',
      iconWellClassName:
        'border border-emerald-300/80 bg-gradient-to-br from-emerald-100 via-emerald-50 to-teal-50 dark:border-emerald-700 dark:from-emerald-950/60 dark:via-emerald-950/40 dark:to-teal-950/35',
      clickType: 'sales',
      tooltipTitle: 'Sales',
      tooltipBody: 'Invoice revenue in the selected period (final invoices, incl. GST).',
    },
    {
      id: 'collection',
      title: `${periodPrefix} Collection`,
      value: formatInr(collection),
      icon: Wallet,
      iconColor: 'text-blue-700 dark:text-blue-200',
      valueColor: 'text-blue-700 dark:text-blue-300',
      iconWellClassName:
        'border border-blue-300/80 bg-gradient-to-br from-blue-100 via-blue-50 to-sky-50 dark:border-blue-700 dark:from-blue-950/60 dark:via-blue-950/40 dark:to-sky-950/35',
      clickType: 'collection',
      tooltipTitle: 'Collection',
      tooltipBody: 'Customer payments received in the selected period.',
    },
    {
      id: 'purchases',
      title: `${periodPrefix} Purchases`,
      value: formatInr(purchases),
      icon: TrendingDown,
      iconColor: 'text-orange-700 dark:text-orange-200',
      valueColor: 'text-orange-700 dark:text-orange-300',
      iconWellClassName:
        'border border-orange-300/80 bg-gradient-to-br from-orange-100 via-orange-50 to-amber-50 dark:border-orange-700 dark:from-orange-950/60 dark:via-orange-950/40 dark:to-amber-950/35',
      clickType: 'purchases',
      tooltipTitle: 'Purchases',
      tooltipBody: 'Purchase bills recorded in the selected period.',
    },
    {
      id: 'profit',
      title: `${periodPrefix} Profit`,
      value: formatInr(profit),
      icon: IndianRupee,
      iconColor: profit >= 0 ? 'text-violet-700 dark:text-violet-200' : 'text-red-600 dark:text-red-300',
      valueColor: profit >= 0 ? 'text-violet-700 dark:text-violet-300' : 'text-red-600 dark:text-red-400',
      iconWellClassName:
        profit >= 0
          ? 'border border-violet-300/80 bg-gradient-to-br from-violet-100 via-violet-50 to-purple-50 dark:border-violet-700 dark:from-violet-950/60 dark:via-violet-950/40 dark:to-purple-950/35'
          : 'border border-red-200/80 bg-gradient-to-br from-red-50 via-rose-50 to-red-100 dark:border-red-800/55 dark:from-red-950/50 dark:via-rose-950/40 dark:to-red-900/35',
      tooltipTitle: 'Gross profit',
      tooltipBody: 'Sales minus cost of goods sold (COGS) for the period.',
    },
  ];

  const emptyAging = {
    current: 0,
    days_1_15: 0,
    days_16_30: 0,
    days_31_45: 0,
    days_45_plus: 0,
    total: 0,
  };

  const receivablesTotal =
    typeof data?.receivables === 'object' && data?.receivables?.total !== undefined
      ? data.receivables.total
      : typeof data?.receivables === 'number'
        ? data.receivables
        : 0;

  const receivablesAging =
    typeof data?.receivables === 'object' && data?.receivables?.aging
      ? data.receivables.aging
      : emptyAging;

  const payablesTotal =
    typeof data?.payables === 'object' && data?.payables?.total !== undefined
      ? data.payables.total
      : typeof data?.payables === 'number'
        ? data.payables
        : 0;

  const payablesAging =
    typeof data?.payables === 'object' && data?.payables?.aging ? data.payables.aging : emptyAging;

  return (
    <>
      <div className={STACK_PAGE_CLASS}>
        <ListPageHeader
          title="Dashboard"
          description={`Welcome back, ${user?.name ?? 'there'}! Here's what's happening today.`}
        />

        <SubscriptionUsageBanner businessId={business?.id} variant="dashboard" />

        <QuickActionsFAB />

        <DashboardFinancialSnapshot
          items={financialSnapshotItems}
          onItemClick={handleKpiClick}
        />

        {business?.id && (
          <SalesInsightsCard businessId={business.id} dateRange={dateRange} />
        )}

        {data ? (
          <div className={STACK_SECTION_CLASS}>
            <ReceivablesCard total={receivablesTotal} aging={receivablesAging} />
            <PayablesCard total={payablesTotal} aging={payablesAging} />
          </div>
        ) : null}

        {/* Promotional Carousel */}
        <PromotionCarousel />

        {/* Card Details Modal */}
        {selectedCard && (
          <DashboardCardDetails
            type={selectedCard}
            title={
              selectedCard === 'sales'
                ? `${periodPrefix} Sales`
                : selectedCard === 'collection'
                  ? `${periodPrefix} Collection`
                  : selectedCard === 'purchases'
                    ? `${periodPrefix} Purchases`
                    : selectedCard === 'receivables'
                      ? 'Receivables'
                      : 'Payables'
            }
            data={cardDetails}
            loading={loadingDetails}
            onClose={() => {
              setSelectedCard(null);
              setCardDetails([]);
            }}
          />
        )}

        {/* Pending Actions Button - Sticky in top-right */}
        {data && <PendingActionsButton data={data} />}

        {/* Charts Row - Two equal columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-stack-section md:gap-stack-page">
          {/* Cash Flow Chart */}
          {business?.id && (
            <CashFlowChart businessId={business.id} />
          )}

          {/* Sales vs Purchases Chart */}
          {business?.id && (
            <SalesVsPurchasesChart businessId={business.id} dateRange={dateRange || undefined} />
          )}
        </div>

        {/* Main Content Row - Recent Invoices and Low Stock */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-stack-page">
          {/* Recent Invoices - Takes 2 columns */}
          <Card className="lg:col-span-2 overflow-hidden" padding="none">
            <div className="flex items-center justify-between px-4 pt-3 pb-2 md:mb-4 md:px-6 md:pt-6 md:pb-0">
              <h2 className="text-base font-semibold text-text-primary md:text-lg">
                Recent Invoices
              </h2>
              <Link href="/invoices">
                <Button variant="ghost" size="sm">
                  View All
                </Button>
              </Link>
            </div>
            <div className="hidden overflow-x-auto md:block md:px-6 md:pb-6">
              <table className="table">
                <thead>
                  <tr className="table-header">
                    <th className="table-cell text-left">Invoice No</th>
                    <th className="table-cell text-left">Customer</th>
                    <th className="table-cell text-left">Date</th>
                    <th className="table-cell text-right">Amount</th>
                    <th className="table-cell text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.recentInvoices?.length > 0 ? (
                    data.recentInvoices.map((invoice: any) => (
                      <tr key={invoice.id} className="cursor-pointer transition-colors hover:bg-slate-100/90 dark:hover:bg-slate-800/70">
                        <td className="table-cell text-left font-medium">{invoice.invoice_number}</td>
                        <td className="table-cell text-left">{invoice.customer_name || 'Cash Sale'}</td>
                        <td className="table-cell text-left text-text-secondary">
                          {format(new Date(invoice.invoice_date), 'dd MMM yyyy')}
                        </td>
                        <td className="table-cell text-right font-medium">₹ {Number(invoice.grand_total).toLocaleString('en-IN')}</td>
                        <td className="table-cell text-center">
                          <StatusBadge status={invoice.status} />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-text-secondary">
                        No recent invoices found. Create your first invoice!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile — compact list rows (tap to open invoice) */}
            <div className="md:hidden divide-y divide-border border-t border-border">
              {data?.recentInvoices?.length > 0 ? (
                data.recentInvoices.map((invoice: any) => (
                  <Link
                    key={invoice.id}
                    href={`/invoices/${invoice.id}`}
                    className="flex items-center gap-2.5 px-3 py-2.5 transition-colors active:bg-slate-100/90 dark:active:bg-slate-800/70"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-semibold text-primary-600 dark:text-primary-400">
                          {invoice.invoice_number}
                        </p>
                        <p className="shrink-0 text-sm font-bold tabular-nums text-text-primary">
                          ₹ {Number(invoice.grand_total).toLocaleString('en-IN')}
                        </p>
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-text-secondary">
                        <span className="truncate">{invoice.customer_name || 'Cash Sale'}</span>
                        <span className="shrink-0 text-text-muted">·</span>
                        <span className="shrink-0 text-text-muted">
                          {format(new Date(invoice.invoice_date), 'dd MMM yyyy')}
                        </span>
                        <StatusBadge status={invoice.status} />
                        {invoice.status === 'final' ? (
                          <GSTStatusIndicator status="pending" returnType="GSTR-1" />
                        ) : null}
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="px-4 py-6 text-center text-sm text-text-secondary">
                  No recent invoices found.
                </div>
              )}
            </div>
          </Card>

          {/* Low Stock Items */}
          <Card padding="none" className="overflow-hidden">
            <div className="flex items-center justify-between px-3 pt-3 pb-2 md:px-5 md:pt-5 md:pb-3">
              <h2 className="text-sm font-semibold text-text-primary md:text-base">
                Low Stock Items
              </h2>
              <Link href="/items">
                <Button variant="ghost" size="sm" className="h-8 text-xs md:h-9 md:text-sm">
                  View All
                </Button>
              </Link>
            </div>
            <div className="divide-y divide-border border-t border-border">
              {data?.lowStockItems?.length > 0 ? (
                data.lowStockItems.slice(0, 4).map((item: any) => (
                  <div
                    key={item.id}
                    className="px-3 py-2 transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40 md:px-5 md:py-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/items/${item.id}`}
                        className="min-w-0 flex-1 truncate text-xs font-semibold text-text-primary hover:underline md:text-sm"
                      >
                        {item.name}
                      </Link>
                      <Chip
                        variant={Number(item.current_stock) <= 0 ? 'error' : 'warning'}
                        className="shrink-0 !px-1.5 !py-0.5 !text-[10px] md:!text-xs"
                      >
                        {item.current_stock} {item.unit}
                      </Chip>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-text-secondary md:text-xs">
                      <p className="truncate">
                        Min: {item.min_stock} {item.unit}
                      </p>
                      <Link
                        href={`/inventory-adjustments/new?item_id=${encodeURIComponent(item.id)}`}
                        className="link-primary shrink-0 font-medium"
                      >
                        Update →
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-3 py-4 text-center text-xs text-text-secondary md:px-5 md:py-6 md:text-sm">
                  All items are well stocked!
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Customizable Widgets Section */}
        <div className="mt-3 md:mt-6">
          <CustomizableDashboard 
            businessId={business?.id || ''} 
            initialWidgets={[]}
          />
        </div>
      </div>

      {shareFormatInvoice && (
        <ShareInvoiceFormatSheet
          open
          invoiceId={shareFormatInvoice.id}
          invoiceNumber={shareFormatInvoice.invoice_number}
          businessName={business?.name}
          userId={user?.id}
          businessId={business?.id}
          onClose={() => setShareFormatInvoice(null)}
          onFallbackModal={() => {
            setShareModalInvoice(shareFormatInvoice);
            setShareFormatInvoice(null);
          }}
        />
      )}

      {shareModalInvoice && (
        <ShareInvoiceModal
          invoiceId={shareModalInvoice.id}
          invoiceNumber={shareModalInvoice.invoice_number}
          customerEmail={shareModalInvoice.customer_email}
          customerPhone={shareModalInvoice.customer_phone}
          onClose={() => setShareModalInvoice(null)}
        />
      )}

      {paymentModalInvoice && (
        <RecordPaymentModal
          invoiceId={paymentModalInvoice.id}
          invoiceNumber={paymentModalInvoice.invoice_number}
          grandTotal={Number(paymentModalInvoice.grand_total || 0)}
          paidAmount={Number(paymentModalInvoice.paid_amount || 0)}
          balanceAmount={Number(
            paymentModalInvoice.balance_amount ?? paymentModalInvoice.grand_total ?? 0
          )}
          onSuccess={() => {
            setPaymentModalInvoice(null);
            setDashboardRefreshKey((k) => k + 1);
          }}
          onClose={() => setPaymentModalInvoice(null)}
        />
      )}
    </>
  );
}

export default withPageAuth('dashboard', 'read', DashboardPage);
