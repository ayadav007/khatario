'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { ArrowUp, ArrowDown, TrendingUp, TrendingDown, FileText, Package, Users, ShoppingCart, Loader2, Eye, Share2, CreditCard, AlertCircle, DollarSign, Info } from 'lucide-react';
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
import { QuickActionsFAB } from '@/components/dashboard/QuickActionsFAB';
import { PendingActionsButton } from '@/components/dashboard/PendingActionsButton';
import { ReceivablesCard } from '@/components/dashboard/ReceivablesCard';
import { PayablesCard } from '@/components/dashboard/PayablesCard';
import { CashFlowChart } from '@/components/dashboard/CashFlowChart';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { useDateRange } from '@/contexts/DateRangeContext';
import { CustomizableDashboard } from '@/components/dashboard/CustomizableDashboard';
import { ListPageHeader } from '@/components/layout/ListPageHeader';

function DashboardPage() {
  const { business, user, loading: authLoading } = useAuth();
  const { currentBranchId, isLoading: branchLoading } = useBranch();
  const { registerHandler } = useDateRange();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [selectedCard, setSelectedCard] = useState<'sales' | 'purchases' | 'receivables' | 'payables' | null>(null);
  const [cardDetails, setCardDetails] = useState<any[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  
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
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [authLoading, branchLoading, business?.id, user?.id, dateRange, currentBranchId]);

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

  const handleCardClick = async (type: 'sales' | 'purchases' | 'receivables' | 'payables') => {
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
      }

      const response = await fetch(endpoint);
      if (response.ok) {
        const result = await response.json();
        
        // The API already returns the filtered data
        if (type === 'sales' || type === 'receivables') {
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
  const profit = data?.profit || 0; // Gross Profit = Sales - COGS (calculated in API)

  const kpiIconWellDefault =
    'bg-accent-50 dark:bg-accent-900/35';

  const kpiData: Array<{
    title: string;
    value: string;
    change: string;
    trend: string;
    icon: typeof TrendingUp;
    iconColor: string;
    valueColor: string;
    type: 'sales' | 'purchases';
    iconWellClassName?: string;
  }> = [
    {
      title: `${periodPrefix} Sales`,
      value: `₹ ${sales.toLocaleString('en-IN')}`,
      change: "+0%",
      trend: "neutral",
      icon: TrendingUp,
      iconColor: 'text-emerald-700 dark:text-emerald-200',
      valueColor: "text-green-600 dark:text-green-400",
      type: 'sales' as const,
      iconWellClassName:
        'border border-emerald-200/90 bg-gradient-to-br from-emerald-50 via-green-50 to-teal-50 dark:border-emerald-800/55 dark:from-emerald-950/50 dark:via-green-950/40 dark:to-teal-950/35',
    },
    {
      title: `${periodPrefix} Purchases`,
      value: `₹ ${purchases.toLocaleString('en-IN')}`,
      change: "+0%",
      trend: "neutral",
      icon: TrendingDown,
      iconColor: "text-red-600 dark:text-red-300",
      valueColor: "text-orange-600 dark:text-orange-400",
      type: 'purchases' as const,
      iconWellClassName:
        'border border-red-200/80 bg-gradient-to-br from-red-50 via-rose-50 to-red-100 dark:border-red-800/55 dark:from-red-950/50 dark:via-rose-950/40 dark:to-red-900/35',
    },
    {
      title: `${periodPrefix} Profit`,
      value: `₹ ${profit.toLocaleString('en-IN')}`,
      change: "+0%",
      trend: profit >= 0 ? "up" : "down",
      icon: DollarSign,
      iconColor:
        profit >= 0 ? 'text-emerald-700 dark:text-emerald-200' : 'text-red-600 dark:text-red-300',
      valueColor: profit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400",
      type: 'sales' as const, // Use sales type for click handler
      iconWellClassName:
        profit >= 0
          ? 'border border-emerald-200/90 bg-gradient-to-br from-emerald-50 via-green-50 to-teal-50 dark:border-emerald-800/55 dark:from-emerald-950/50 dark:via-green-950/40 dark:to-teal-950/35'
          : 'border border-red-200/80 bg-gradient-to-br from-red-50 via-rose-50 to-red-100 dark:border-red-800/55 dark:from-red-950/50 dark:via-rose-950/40 dark:to-red-900/35',
    },
  ];

  return (
    <div className="space-y-3 md:space-y-6">
        <ListPageHeader
          title="Dashboard"
          description={`Welcome back, ${user?.name ?? 'there'}! Here's what's happening today.`}
        />

        {/* Quick Actions FAB - Floating Action Button */}
        <QuickActionsFAB />

        {/* KPI Cards - Sales, Purchases, and Profit */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {kpiData.map((kpi) => {
            const Icon = kpi.icon;
            
            // Tooltip content for each KPI
            const getTooltipContent = () => {
              if (kpi.title.includes('Sales')) {
                return (
                  <>
                    <p className="font-semibold mb-2">Today's Sales:</p>
                    <p className="text-xs leading-relaxed">
                      Total revenue from all invoices created today. This includes the selling price of items sold, plus applicable taxes (GST).
                    </p>
                    <p className="text-xs mt-2 text-gray-300">
                      Formula: Sum of all invoice grand totals for today
                    </p>
                  </>
                );
              } else if (kpi.title.includes('Purchases')) {
                return (
                  <>
                    <p className="font-semibold mb-2">Today's Purchases:</p>
                    <p className="text-xs leading-relaxed">
                      Total amount spent on purchasing new inventory today. This represents the cost of goods bought from suppliers, plus applicable taxes.
                    </p>
                    <p className="text-xs mt-2 text-gray-300">
                      Formula: Sum of all purchase bill grand totals for today
                    </p>
                  </>
                );
              } else if (kpi.title.includes('Profit')) {
                return (
                  <>
                    <p className="font-semibold mb-2">Today's Profit (Gross Profit):</p>
                    <p className="text-xs leading-relaxed">
                      Revenue from sales minus the cost of goods sold (COGS). COGS is calculated as the purchase price of items that were sold today, regardless of when they were purchased.
                    </p>
                    <p className="text-xs mt-2 text-gray-300">
                      Formula: Sales Revenue - COGS (Cost of Goods Sold)
                    </p>
                    <p className="text-xs mt-1 text-gray-300">
                      COGS = Sum of (Quantity Sold × Purchase Price) for all items sold today
                    </p>
                  </>
                );
              }
              return null;
            };

            return (
              <Card 
                key={kpi.title} 
                padding="md" 
                hover
                className="cursor-pointer transition-all hover:shadow-lg"
                onClick={() => handleCardClick(kpi.type)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm text-text-secondary">{kpi.title}</p>
                      <div className="relative group">
                        <Info 
                          className="w-3.5 h-3.5 text-text-muted cursor-help" 
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent card click when clicking info icon
                          }}
                        />
                        <div className="absolute left-0 bottom-full mb-2 w-72 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-20 pointer-events-none">
                          {getTooltipContent()}
                          <div className="absolute left-4 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                        </div>
                      </div>
                    </div>
                    <p className={`text-2xl font-bold mb-2 ${kpi.valueColor || 'text-text-primary'}`}>{kpi.value}</p>
                  </div>
                  <div
                    className={`rounded-lg p-3 ${kpi.iconWellClassName ?? kpiIconWellDefault} ${kpi.iconColor}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Receivables and Payables Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {data && (
            <>
              <ReceivablesCard 
                total={
                  typeof data.receivables === 'object' && data.receivables?.total !== undefined
                    ? data.receivables.total
                    : typeof data.receivables === 'number'
                    ? data.receivables
                    : 0
                } 
                aging={
                  typeof data.receivables === 'object' && data.receivables?.aging
                    ? data.receivables.aging
                    : {
                        current: 0,
                        days_1_15: 0,
                        days_16_30: 0,
                        days_31_45: 0,
                        days_45_plus: 0,
                        total: 0
                      }
                }
              />
              <PayablesCard 
                total={
                  typeof data.payables === 'object' && data.payables?.total !== undefined
                    ? data.payables.total
                    : typeof data.payables === 'number'
                    ? data.payables
                    : 0
                } 
                aging={
                  typeof data.payables === 'object' && data.payables?.aging
                    ? data.payables.aging
                    : {
                        current: 0,
                        days_1_15: 0,
                        days_16_30: 0,
                        days_31_45: 0,
                        days_45_plus: 0,
                        total: 0
                      }
                }
              />
            </>
          )}
        </div>

        {/* Promotional Carousel */}
        <PromotionCarousel />

        {/* Card Details Modal */}
        {selectedCard && (
          <DashboardCardDetails
            type={selectedCard}
            title={
              selectedCard === 'sales' ? "Today's Sales" :
              selectedCard === 'purchases' ? "Today's Purchases" :
              selectedCard === 'receivables' ? "Receivables" :
              "Payables"
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Invoices - Takes 2 columns */}
          <Card className="lg:col-span-2" padding="md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-text-primary">Recent Invoices</h2>
              <Link href="/invoices">
                <Button variant="ghost" size="sm">View All</Button>
              </Link>
            </div>
            <div className="overflow-x-auto hidden md:block">
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

            {/* Mobile Card View */}
            <div className="md:hidden space-y-3">
              {data?.recentInvoices?.length > 0 ? (
                data.recentInvoices.map((invoice: any) => (
                  <div 
                    key={invoice.id}
                    className="rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-slate-100/90 dark:hover:bg-slate-800/70"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-bold text-text-primary">{invoice.invoice_number}</p>
                        <p className="text-sm text-text-secondary">{invoice.customer_name || 'Cash Sale'}</p>
                      </div>
                      <StatusBadge status={invoice.status} />
                    </div>
                    
                    <div className="flex justify-between items-center mb-4">
                      <div>
                        <p className="text-[10px] text-text-muted">
                          {format(new Date(invoice.invoice_date), 'dd MMM yyyy')}
                        </p>
                        {invoice.status === 'final' && (
                          <GSTStatusIndicator status="pending" returnType="GSTR-1" className="mt-1" />
                        )}
                      </div>
                      <p className="text-lg font-bold text-text-primary">
                        ₹ {Number(invoice.grand_total).toLocaleString('en-IN')}
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-2 border-t border-border pt-3">
                      <Link href={`/invoices/${invoice.id}`} className="w-full">
                        <Button variant="ghost" size="sm" className="w-full gap-1 text-[10px] px-1">
                          <Eye className="w-3 h-3" />
                          View
                        </Button>
                      </Link>
                      <Button variant="ghost" size="sm" className="w-full gap-1 text-[10px] px-1">
                        <Share2 className="w-3 h-3" />
                        Share
                      </Button>
                      {invoice.payment_status !== 'paid' && (
                        <Button variant="ghost" size="sm" className="w-full gap-1 text-[10px] px-1">
                          <CreditCard className="w-3 h-3" />
                          Pay
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-text-secondary border border-dashed border-border rounded-xl">
                  No recent invoices found.
                </div>
              )}
            </div>
          </Card>

          {/* Low Stock Items */}
          <Card padding="md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-text-primary">Low Stock Items</h2>
              <Link href="/items">
                <Button variant="ghost" size="sm">View All</Button>
              </Link>
            </div>
            <div className="space-y-3">
              {data?.lowStockItems?.length > 0 ? (
                data.lowStockItems.map((item: any) => (
                  <Link 
                    key={item.id}
                    href={`/items/${item.id}`}
                    className="block rounded-xl border border-border p-4 transition-all hover:bg-slate-100/90 dark:hover:bg-slate-800/70 active:scale-[0.98]"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-bold text-text-primary">{item.name}</p>
                      <Chip
                        variant={Number(item.current_stock) <= 0 ? 'error' : 'warning'}
                      >
                        {item.current_stock} {item.unit}
                      </Chip>
                    </div>
                    <div className="flex justify-between items-center text-xs text-text-secondary">
                      <p>Minimum Stock: {item.min_stock} {item.unit}</p>
                      <span className="text-primary-500 font-medium">Update Stock →</span>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="text-center py-8 text-text-secondary text-sm border border-dashed border-border rounded-xl">
                  All items are well stocked!
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Customizable Widgets Section */}
        <div className="mt-8">
          <CustomizableDashboard 
            businessId={business?.id || ''} 
            initialWidgets={[]}
          />
        </div>
      </div>
  );
}

export default withPageAuth('dashboard', 'read', DashboardPage);
