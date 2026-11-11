'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { buildApiUrl } from '@/lib/api-helpers';
import { format } from 'date-fns';
import { formatStockQuantity } from '@/lib/quantity-display';
import { DashboardCardDetails } from '@/components/dashboard/DashboardCardDetails';
import { PromotionCarousel } from '@/components/promotions/PromotionCarousel';
import { DashboardChartsSection } from '@/components/dashboard/DashboardChartsSection';
import { DashboardSalesInsightsSection } from '@/components/dashboard/DashboardSalesInsightsSection';
import { QuickActionsFAB } from '@/components/dashboard/QuickActionsFAB';
import { MobileCreateSheet } from '@/components/dashboard/MobileCreateSheet';
import {
  LowStockRestockMenu,
  suggestedRestockQty,
} from '@/components/dashboard/LowStockRestockMenu';
import { PendingActionsButton, usePendingActions } from '@/components/dashboard/PendingActionsButton';
import { NeedsAttentionStrip } from '@/components/dashboard/NeedsAttentionStrip';
import { DashboardPeriodPicker } from '@/components/dashboard/DashboardPeriodPicker';
import { ReceivablesCard } from '@/components/dashboard/ReceivablesCard';
import { PayablesCard } from '@/components/dashboard/PayablesCard';
import { KhataDashboardCard } from '@/components/dashboard/KhataDashboardCard';
import {
  DashboardFinancialSnapshot,
  type DashboardKpiClickType,
  type DashboardKpiItem,
} from '@/components/dashboard/DashboardFinancialSnapshot';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { useDateRange } from '@/contexts/DateRangeContext';
import { CustomizableDashboard } from '@/components/dashboard/CustomizableDashboard';
import { RecentTransactionsFeed } from '@/components/dashboard/RecentTransactionsFeed';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { STACK_PAGE_CLASS } from '@/lib/page-layout';
import { ShareInvoiceModal } from '@/components/modals/ShareInvoiceModal';
import { RecordPaymentModal } from '@/components/modals/RecordPaymentModal';
import { ShareInvoiceFormatSheet } from '@/components/invoices/ShareInvoiceFormatSheet';
import { canUseNativeInvoiceShare } from '@/lib/share-invoice';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useLazyMountWhenVisible } from '@/hooks/useLazyMountWhenVisible';
import { bumpDashboardRenderCounter } from '@/lib/debug/dashboard-render-counter';
import { isDashboardBodyDisabled, isDashboardMinimalMode } from '@/lib/debug/runtime-isolation';
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
import {
  probeDashboardRefresh,
  probeDashboardRefreshKeyBump,
} from '@/lib/debug/dashboard-refresh-probe';

function DashboardPage() {
  useLayoutEffect(() => {
    bumpDashboardRenderCounter();
  });
  probeDashboardRefresh('dashboard-rerender');
  const { business, user, loading: authLoading } = useAuth();
  const { isLoading: branchLoading } = useBranch();
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
  const { isOffline, isOnline } = useNetworkStatus();
  const widgetsMount = useLazyMountWhenVisible('240px');
  const prevOnlineRef = useRef(isOnline);
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);

  useEffect(() => {
    const wasOffline = !prevOnlineRef.current;
    prevOnlineRef.current = isOnline;

    if (isOnline && wasOffline) {
      probeDashboardRefreshKeyBump('offline-to-online');
      setDashboardRefreshKey((key) => key + 1);
    }
  }, [isOnline]);

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

  const overviewLoadedRef = useRef(false);

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
      if (!overviewLoadedRef.current) setLoading(true);
      probeDashboardRefresh('overview-fetch', dateRangeKey);
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
          overviewLoadedRef.current = true;
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
  }, [authLoading, branchLoading, business?.id, user?.id, dateRangeKey, dashboardRefreshKey, isOffline]);

  const handleCardClick = useCallback(async (
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
        const start = dateRange.start;
        const end = dateRange.end;
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
  }, [business?.id, dateRange.start, dateRange.end]);

  const periodLabel = dateRange.label || 'Today';

  const periodPrefix = useMemo(() => {
    if (periodLabel === 'Today') return "Today's";
    if (periodLabel.endsWith("'s")) return periodLabel;
    return `${periodLabel}'s`;
  }, [periodLabel]);

  const sales = data?.sales || 0;
  const purchases = data?.purchases || 0;
  const collection = data?.collection || 0;
  const profit = data?.profit || 0;

  const handleKpiClick = useCallback((type: DashboardKpiClickType) => {
    if (type === 'profit') return;
    void handleCardClick(type);
  }, [handleCardClick]);

  // Brand colours (primary/accent) follow the business theme; money-in green stays fixed.
  const financialSnapshotItems: DashboardKpiItem[] = useMemo(
    () => [
      {
        id: 'sales',
        title: 'Sales',
        value: `₹ ${sales.toLocaleString('en-IN')}`,
        topBorderClassName: 'border-t-primary-600 dark:border-t-primary-400',
        valueColor: 'text-text-primary',
        clickType: 'sales',
        tooltipTitle: `${periodPrefix} Sales`,
        tooltipBody: 'Invoice revenue in the selected period (final invoices, incl. GST).',
      },
      {
        id: 'collection',
        title: 'Collection',
        value: `₹ ${collection.toLocaleString('en-IN')}`,
        topBorderClassName: 'border-t-emerald-600',
        valueColor: 'text-text-primary',
        clickType: 'collection',
        tooltipTitle: `${periodPrefix} Collection`,
        tooltipBody: 'Customer payments received in the selected period.',
      },
      {
        id: 'purchases',
        title: 'Purchases',
        value: `₹ ${purchases.toLocaleString('en-IN')}`,
        topBorderClassName: 'border-t-primary-300',
        valueColor: 'text-text-primary',
        clickType: 'purchases',
        tooltipTitle: `${periodPrefix} Purchases`,
        tooltipBody: 'Purchase bills recorded in the selected period.',
      },
      {
        id: 'profit',
        title: 'Profit',
        value: `₹ ${profit.toLocaleString('en-IN')}`,
        topBorderClassName: profit >= 0 ? 'border-t-accent-500' : 'border-t-red-600',
        valueColor: profit >= 0 ? 'text-text-primary' : 'text-red-600 dark:text-red-400',
        tooltipTitle: `${periodPrefix} Gross profit`,
        tooltipBody: 'Sales minus cost of goods sold (COGS) for the period.',
      },
    ],
    [collection, periodPrefix, profit, purchases, sales]
  );

  const pending = usePendingActions(data);
  const [pendingOpen, setPendingOpen] = useState(false);

  const chartDateRange = useMemo(
    () => ({ start: dateRange.start, end: dateRange.end }),
    [dateRange.start, dateRange.end]
  );

  const salesInsightsDateRange = useMemo(
    () => ({
      start: dateRange.start,
      end: dateRange.end,
      label: dateRange.label,
    }),
    [dateRange.start, dateRange.end, dateRange.label]
  );

  if (loading && !data) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

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

  const overdueOf = (aging: typeof emptyAging) =>
    aging.days_1_15 + aging.days_16_30 + aging.days_31_45 + aging.days_45_plus;

  const minimal = isDashboardMinimalMode();
  const hideBody = isDashboardBodyDisabled();

  return (
    <>
      <div className={STACK_PAGE_CLASS}>
        <ListPageHeader
          title={`Welcome back, ${user?.name ?? 'there'}!`}
          description="Dashboard · Here's what's happening today."
        />

        <SubscriptionUsageBanner businessId={business?.id} variant="dashboard" />

        <QuickActionsFAB />
        <MobileCreateSheet />

        {!hideBody && data ? (
          <NeedsAttentionStrip
            receivablesOverdue={overdueOf(receivablesAging)}
            payablesOverdue={overdueOf(payablesAging)}
            lowStockCount={data.lowStockItems?.length ?? 0}
            pendingCount={pending.totalPending}
            onOpenPending={() => setPendingOpen(true)}
          />
        ) : null}

        <DashboardFinancialSnapshot
          items={financialSnapshotItems}
          periodLabel={periodLabel}
          hideDesktopPeriodLabel={['Today', 'This Week', 'This Month'].includes(periodLabel)}
          actions={
            // Desktop only; phones keep the date stepper in the top bar.
            <div className="hidden lg:block">
              <DashboardPeriodPicker />
            </div>
          }
          onItemClick={handleKpiClick}
        />

        <div className="grid grid-cols-1 gap-stack-section md:gap-stack-page lg:grid-cols-12">
          {business?.id ? (
            <div className={`min-w-0 ${!hideBody && data ? 'lg:col-span-8' : 'lg:col-span-12'}`}>
              <DashboardSalesInsightsSection
                businessId={business.id}
                dateRange={salesInsightsDateRange}
              />
            </div>
          ) : null}

          {!hideBody && data ? (
            <div className="grid min-w-0 grid-cols-1 gap-stack-section md:grid-cols-2 md:gap-stack-page lg:col-span-4 lg:grid-cols-1">
              <ReceivablesCard total={receivablesTotal} aging={receivablesAging} />
              <PayablesCard total={payablesTotal} aging={payablesAging} />
            </div>
          ) : null}
        </div>

        {!hideBody && data ? <KhataDashboardCard /> : null}

        {/* Pending actions panel; the "Needs your attention" tile opens it */}
        {!hideBody && data ? (
          <PendingActionsButton
            pending={pending}
            isOpen={pendingOpen}
            setIsOpen={setPendingOpen}
            showTrigger={false}
          />
        ) : null}

        {!hideBody && business?.id ? (
          <DashboardChartsSection businessId={business.id} chartDateRange={chartDateRange} />
        ) : null}

        {!hideBody && !minimal ? <PromotionCarousel /> : null}

        {!hideBody ? (
        <>
        {data?.lowStockItems?.length > 0 ? (
          <Card padding="none" className="overflow-hidden">
            <div className="flex items-center justify-between px-3 pt-3 pb-2 md:px-5 md:pt-5 md:pb-3">
              <h2 className="text-sm font-bold text-text-primary md:text-base">Low stock</h2>
              <Link
                href="/items?stock=low"
                className="inline-flex min-h-9 items-center text-xs font-semibold text-primary-600 hover:underline dark:text-primary-300 md:text-sm"
              >
                View all ›
              </Link>
            </div>
            <div className="flex gap-3 overflow-x-auto px-3 pb-3 md:px-5 md:pb-5">
              {data.lowStockItems.slice(0, 8).map((item: any) => {
                const outOfStock = Number(item.current_stock) <= 0;
                return (
                  <div
                    key={item.id}
                    className="flex w-52 shrink-0 flex-col gap-1.5 rounded-xl bg-background p-3 dark:bg-slate-800/60"
                  >
                    <Link
                      href={`/items/${item.id}`}
                      className="truncate text-xs font-bold text-text-primary hover:underline md:text-sm"
                    >
                      {item.name}
                    </Link>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-base font-extrabold tabular-nums md:text-lg ${
                          outOfStock
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-orange-700 dark:text-orange-300'
                        }`}
                      >
                        {formatStockQuantity(item.current_stock, item.unit, item.pack_size, item.pack_unit)}
                      </span>
                      <LowStockRestockMenu
                        itemId={String(item.id)}
                        itemName={String(item.name || 'item')}
                        suggestedQty={suggestedRestockQty(item.current_stock, item.min_stock)}
                      />
                    </div>
                    <p className="truncate text-caption text-text-secondary md:text-xs">
                      Min: {item.min_stock} {item.unit}
                    </p>
                  </div>
                );
              })}
            </div>
          </Card>
        ) : null}

        <div ref={widgetsMount.ref}>
          {widgetsMount.mounted ? (
            <CustomizableDashboard businessId={business?.id || ''} initialWidgets={[]} />
          ) : (
            <div className="h-10 rounded-lg border border-dashed border-border bg-background/80" aria-hidden />
          )}
        </div>

        <RecentTransactionsFeed />
        </>
        ) : null}
      </div>

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
