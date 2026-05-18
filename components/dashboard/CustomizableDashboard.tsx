'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Edit, Save, X, Layout } from 'lucide-react';
import { Widget, WidgetConfig } from './Widget';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';

import { format } from 'date-fns';

interface AvailableWidget {
  id: string;
  type: string;
  title: string;
  icon: string;
  /** Optional feature flag gating availability in the picker + renderer. */
  featureId?: string;
}

// Available widget types
const AVAILABLE_WIDGETS: AvailableWidget[] = [
  { id: 'sales-summary', type: 'sales_summary', title: 'Sales Summary', icon: '📊' },
  { id: 'recent-invoices', type: 'recent_invoices', title: 'Recent Invoices', icon: '🧾' },
  { id: 'top-customers', type: 'top_customers', title: 'Top Customers', icon: '👥' },
  { id: 'cash-flow', type: 'cash_flow', title: 'Cash Flow', icon: '💰' },
  { id: 'pending-payments', type: 'pending_payments', title: 'Pending Payments', icon: '⏰' },
  { id: 'inventory-alerts', type: 'inventory_alerts', title: 'Inventory Alerts', icon: '📦' },
  { id: 'sales-chart', type: 'sales_chart', title: 'Sales Chart', icon: '📈' },
  { id: 'top-products', type: 'top_products', title: 'Top Products', icon: '🏆' },
  { id: 'dead-stock', type: 'dead_stock', title: 'Dead Stock', icon: '🧊', featureId: 'dead_stock_widget' },
];

interface CustomizableDashboardProps {
  businessId: string;
  initialWidgets?: WidgetConfig[];
}

export const CustomizableDashboard: React.FC<CustomizableDashboardProps> = ({
  businessId,
  initialWidgets = [],
}) => {
  const toast = useToastContext();
  const { hasFeature, loading: featuresLoading } = useFeatureRegistry();
  const [widgets, setWidgets] = useState<WidgetConfig[]>(initialWidgets);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draggedWidget, setDraggedWidget] = useState<string | null>(null);

  const isWidgetAvailable = (w: AvailableWidget) =>
    !w.featureId || hasFeature(w.featureId);

  const availableWidgets = AVAILABLE_WIDGETS.filter(isWidgetAvailable);

  const updateWidgetConfig = (id: string, config: Record<string, any>) => {
    setWidgets((prev) =>
      prev.map((w) =>
        w.id === id ? { ...w, config: { ...(w.config || {}), ...config } } : w,
      ),
    );
  };

  // Load widgets from API
  useEffect(() => {
    if (businessId) {
      loadWidgets();
    }
  }, [businessId]);

  const loadWidgets = async () => {
    try {
      const response = await fetch(`/api/dashboard/widgets?business_id=${businessId}`);
      if (response.ok) {
        const data = await response.json();
        setWidgets(data.widgets || []);
      }
    } catch (error) {
      console.error('Failed to load widgets:', error);
    }
  };

  const saveWidgets = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/dashboard/widgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          widgets,
        }),
      });

      if (response.ok) {
        setIsEditMode(false);
      }
    } catch (error) {
      console.error('Failed to save widgets:', error);
      toast.error('Failed to save dashboard layout');
    } finally {
      setLoading(false);
    }
  };

  const addWidget = (type: string, title: string) => {
    const newWidget: WidgetConfig = {
      id: `widget-${Date.now()}`,
      type,
      title,
      position: { x: 0, y: widgets.length * 2 },
      size: { width: 1, height: 1 },
    };
    setWidgets([...widgets, newWidget]);
    setShowAddWidget(false);
  };

  const removeWidget = (id: string) => {
    setWidgets(widgets.filter(w => w.id !== id));
  };

  const resizeWidget = (id: string, size: { width: number; height: number }) => {
    setWidgets(widgets.map(w => 
      w.id === id ? { ...w, size } : w
    ));
  };

  const handleDragStart = (id: string) => {
    setDraggedWidget(id);
  };

  const handleDragEnd = () => {
    setDraggedWidget(null);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedWidget || draggedWidget === targetId) return;

    // Reorder widgets
    const draggedIndex = widgets.findIndex(w => w.id === draggedWidget);
    const targetIndex = widgets.findIndex(w => w.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const newWidgets = [...widgets];
    const [removed] = newWidgets.splice(draggedIndex, 1);
    newWidgets.splice(targetIndex, 0, removed);

    setWidgets(newWidgets);
  };

  // Render widget content based on type
  const renderWidgetContent = (widget: WidgetConfig) => {
    // Feature-gated widgets: show an unobtrusive placeholder when the plan
    // no longer entitles them so saved layouts downgrade gracefully.
    const gate = AVAILABLE_WIDGETS.find((w) => w.type === widget.type);
    if (gate?.featureId && !featuresLoading && !hasFeature(gate.featureId)) {
      return (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          This widget isn&apos;t available on your current plan. Contact your
          administrator to enable it, or remove the widget in edit mode.
        </div>
      );
    }

    switch (widget.type) {
      case 'sales_summary':
        return <SalesSummaryWidget businessId={businessId} />;
      case 'recent_invoices':
        return <RecentInvoicesWidget businessId={businessId} />;
      case 'top_customers':
        return <TopCustomersWidget businessId={businessId} />;
      case 'cash_flow':
        return <CashFlowWidget businessId={businessId} />;
      case 'pending_payments':
        return <PendingPaymentsWidget businessId={businessId} />;
      case 'inventory_alerts':
        return <InventoryAlertsWidget businessId={businessId} />;
      case 'sales_chart':
        return <SalesChartWidget businessId={businessId} />;
      case 'top_products':
        return <TopProductsWidget businessId={businessId} />;
      case 'dead_stock':
        return (
          <DeadStockWidget
            businessId={businessId}
            config={widget.config}
            onConfigChange={(next) => updateWidgetConfig(widget.id, next)}
          />
        );
      default:
        return <div className="text-gray-500 dark:text-gray-400">Widget content</div>;
    }
  };



  return (
    <div className="space-y-4">
      {/* Dashboard Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layout className="w-6 h-6 text-primary-600 dark:text-primary-400" />
          <h2 className="text-xl font-bold text-text-primary">
            My Dashboard
          </h2>
        </div>

        <div className="flex gap-2">
          {!isEditMode ? (
            <Button
              onClick={() => setIsEditMode(true)}
              variant="secondary"
              className="flex items-center gap-2"
            >
              <Edit className="w-4 h-4" />
              <span>Customize</span>
            </Button>
          ) : (
            <>
              <Button
                onClick={() => setShowAddWidget(true)}
                variant="secondary"
                className="flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>Add Widget</span>
              </Button>
              <Button
                onClick={saveWidgets}
                disabled={loading}
                className="flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                <span>{loading ? 'Saving...' : 'Save Layout'}</span>
              </Button>
              <button
                onClick={() => setIsEditMode(false)}
                className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded text-text-secondary"
              >
                <X className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Widgets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-[300px]">
        {widgets.map((widget) => (
          <div
            key={widget.id}
            draggable={isEditMode}
            onDragStart={() => handleDragStart(widget.id)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, widget.id)}
          >
            <Widget
              widget={widget}
              onRemove={removeWidget}
              onResize={resizeWidget}
              isDragging={draggedWidget === widget.id}
              isEditMode={isEditMode}
            >
              {renderWidgetContent(widget)}
            </Widget>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {widgets.length === 0 && (
        <div className="text-center py-12 bg-background/80 dark:bg-slate-900/40 rounded-lg border border-dashed border-border">
          <Layout className="w-16 h-16 mx-auto text-text-muted mb-4" />
          <h3 className="text-lg font-semibold text-text-primary mb-2">
            No widgets yet
          </h3>
          <p className="text-text-secondary mb-4">
            Click "Customize" to add widgets to your dashboard
          </p>
        </div>
      )}

      {/* Add Widget Modal */}
      {showAddWidget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-surface border border-border rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">Add Widget</h3>
              <button
                onClick={() => setShowAddWidget(false)}
                className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded"
              >
                <X className="w-5 h-5 text-text-muted" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {availableWidgets.map((widgetType) => (
                <button
                  key={widgetType.id}
                  onClick={() => addWidget(widgetType.type, widgetType.title)}
                  className="p-4 border border-border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-primary-500 dark:hover:border-primary-400 transition-all text-left"
                >
                  <div className="text-2xl mb-2">{widgetType.icon}</div>
                  <div className="font-medium text-text-primary">
                    {widgetType.title}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SalesSummaryWidget: React.FC<{ businessId: string }> = ({ businessId }) => {
  const [data, setData] = useState<{ today_sales: number; month_sales: number } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!businessId) return;
    fetch(`/api/dashboard/sales-summary?business_id=${businessId}`)
      .then((r) => r.json())
      .then((res) => setData(res))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [businessId]);
  if (loading) return <div className="text-gray-500 dark:text-gray-400 animate-pulse">Loading...</div>;
  if (!data) return <div className="text-gray-500 dark:text-gray-400">Unable to load</div>;
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-gray-600 dark:text-gray-400">Today&apos;s Sales:</span>
        <span className="font-semibold dark:text-gray-200">₹ {data.today_sales.toLocaleString('en-IN')}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-gray-600 dark:text-gray-400">This Month:</span>
        <span className="font-semibold dark:text-gray-200">₹ {data.month_sales.toLocaleString('en-IN')}</span>
      </div>
    </div>
  );
};

const RecentInvoicesWidget: React.FC<{ businessId: string }> = ({ businessId }) => {
  const [data, setData] = useState<Array<{ id: string; invoice_number: string; invoice_date: string; grand_total: number; status: string; customer_name: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!businessId) return;
    fetch(`/api/dashboard/recent-invoices?business_id=${businessId}&limit=5`)
      .then((r) => r.json())
      .then((res) => setData(res.invoices || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [businessId]);
  if (loading) return <div className="text-gray-500 dark:text-gray-400 animate-pulse">Loading...</div>;
  if (!data.length) return <div className="text-gray-500 dark:text-gray-400">No invoices yet.</div>;
  return (
    <ul className="space-y-2">
      {data.map((inv) => (
        <li key={inv.id} className="flex justify-between items-center text-sm">
          <Link href={`/invoices/${inv.id}`} className="text-primary-600 dark:text-primary-400 hover:underline truncate flex-1">
            {inv.invoice_number}
          </Link>
          <span className="font-medium ml-2">₹ {Number(inv.grand_total).toLocaleString('en-IN')}</span>
        </li>
      ))}
    </ul>
  );
};

const TopCustomersWidget: React.FC<{ businessId: string }> = ({ businessId }) => {
  const [data, setData] = useState<Array<{ id: string; name: string; total_sales: number; invoice_count: number }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!businessId) return;
    fetch(`/api/dashboard/top-customers?business_id=${businessId}&limit=10`)
      .then((r) => r.json())
      .then((res) => setData(res.topCustomers || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [businessId]);
  if (loading) return <div className="text-gray-500 dark:text-gray-400 animate-pulse">Loading...</div>;
  if (!data.length) return <div className="text-gray-500 dark:text-gray-400">No customer sales data yet.</div>;
  return (
    <ul className="space-y-2">
      {data.map((c, i) => (
        <li key={c.id} className="flex justify-between items-center text-sm">
          <span className="text-gray-700 dark:text-gray-300 truncate flex-1">
            {i + 1}. {c.name}
          </span>
          <span className="font-medium text-gray-900 dark:text-gray-100 ml-2">
            ₹ {c.total_sales.toLocaleString('en-IN')}
          </span>
        </li>
      ))}
    </ul>
  );
};

const CashFlowWidget: React.FC<{ businessId: string }> = ({ businessId }) => {
  const [data, setData] = useState<{ summary?: { total_incoming: number; total_outgoing: number; closing_balance: number }; months?: Array<{ monthLabel: string; incoming: number; outgoing: number }> } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!businessId) return;
    const year = new Date().getMonth() < 3 ? new Date().getFullYear() - 1 : new Date().getFullYear();
    fetch(`/api/dashboard/cash-flow?business_id=${businessId}&fiscal_year=${year}`)
      .then((r) => r.json())
      .then((res) => setData(res))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [businessId]);
  if (loading) return <div className="text-gray-500 dark:text-gray-400 animate-pulse">Loading...</div>;
  if (!data?.summary) return <div className="text-gray-500 dark:text-gray-400">No cash flow data.</div>;
  const s = data.summary;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex justify-between">
        <span className="text-gray-600 dark:text-gray-400">Incoming:</span>
        <span className="font-medium text-green-600 dark:text-green-400">₹ {Number(s.total_incoming || 0).toLocaleString('en-IN')}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-600 dark:text-gray-400">Outgoing:</span>
        <span className="font-medium text-red-600 dark:text-red-400">₹ {Number(s.total_outgoing || 0).toLocaleString('en-IN')}</span>
      </div>
      <div className="flex justify-between pt-1 border-t dark:border-gray-600">
        <span className="text-gray-600 dark:text-gray-400">Closing:</span>
        <span className="font-semibold">₹ {Number(s.closing_balance || 0).toLocaleString('en-IN')}</span>
      </div>
    </div>
  );
};

const PendingPaymentsWidget: React.FC<{ businessId: string }> = ({ businessId }) => {
  const [data, setData] = useState<Array<{ id: string; invoice_number: string; grand_total: number; paid_amount: number; customer_name: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!businessId) return;
    fetch(`/api/dashboard/receivables?business_id=${businessId}`)
      .then((r) => r.json())
      .then((res) => setData((res.invoices || []).slice(0, 5)))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [businessId]);
  if (loading) return <div className="text-gray-500 dark:text-gray-400 animate-pulse">Loading...</div>;
  if (!data.length) return <div className="text-gray-500 dark:text-gray-400">No pending payments.</div>;
  return (
    <ul className="space-y-2">
      {data.map((inv) => {
        const pending = Number(inv.grand_total) - Number(inv.paid_amount || 0);
        return (
          <li key={inv.id} className="flex justify-between items-center text-sm">
            <Link href={`/invoices/${inv.id}`} className="text-primary-600 dark:text-primary-400 hover:underline truncate flex-1">
              {inv.invoice_number}
            </Link>
            <span className="font-medium ml-2">₹ {pending.toLocaleString('en-IN')}</span>
          </li>
        );
      })}
    </ul>
  );
};

const InventoryAlertsWidget: React.FC<{ businessId: string }> = ({ businessId }) => {
  const [data, setData] = useState<Array<{ id: string; name: string; current_stock: number; min_stock: number; unit: string }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!businessId) return;
    fetch(`/api/dashboard/low-stock?business_id=${businessId}&limit=5`)
      .then((r) => r.json())
      .then((res) => setData(res.items || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [businessId]);
  if (loading) return <div className="text-gray-500 dark:text-gray-400 animate-pulse">Loading...</div>;
  if (!data.length) return <div className="text-gray-500 dark:text-gray-400">All items well stocked.</div>;
  return (
    <ul className="space-y-2">
      {data.map((item) => (
        <li key={item.id} className="flex justify-between items-center text-sm">
          <Link href={`/items/${item.id}`} className="text-gray-700 dark:text-gray-300 truncate flex-1 hover:underline">
            {item.name}
          </Link>
          <span className={`font-medium ml-2 ${item.current_stock <= 0 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
            {item.current_stock} / {item.min_stock} {item.unit}
          </span>
        </li>
      ))}
    </ul>
  );
};

const SalesChartWidget: React.FC<{ businessId: string }> = ({ businessId }) => {
  const [data, setData] = useState<Array<{ date: string; sales: number; purchases: number }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!businessId) return;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    fetch(`/api/dashboard/charts?business_id=${businessId}&start_date=${startStr}&end_date=${endStr}`)
      .then((r) => r.json())
      .then((res) => setData(res.chartData || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [businessId]);
  if (loading) return <div className="text-gray-500 dark:text-gray-400 animate-pulse">Loading...</div>;
  if (!data.length) return <div className="text-gray-500 dark:text-gray-400">No chart data for last 30 days.</div>;
  const totalSales = data.reduce((s, d) => s + Number(d.sales || 0), 0);
  const totalPurchases = data.reduce((s, d) => s + Number(d.purchases || 0), 0);
  const maxVal = Math.max(...data.map((d) => Number(d.sales || 0)), 1);
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs">
        <span className="text-green-600 dark:text-green-400">Sales: ₹ {totalSales.toLocaleString('en-IN')}</span>
        <span className="text-orange-600 dark:text-orange-400">Purchases: ₹ {totalPurchases.toLocaleString('en-IN')}</span>
      </div>
      <div className="flex gap-0.5 h-16 items-end">
        {data.slice(-14).map((d) => (
          <div key={d.date} className="flex-1 min-w-0 flex flex-col items-center justify-end" title={`${d.date}: ₹ ${Number(d.sales).toLocaleString('en-IN')}`}>
            <div className="w-full bg-green-500/60 dark:bg-green-600/60 rounded-t min-h-[2px]" style={{ height: `${Math.max((Number(d.sales) / maxVal) * 100, 2)}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
};

const TopProductsWidget: React.FC<{ businessId: string }> = ({ businessId }) => {
  const [data, setData] = useState<Array<{ id: string; name: string; total_revenue: number; total_qty: number }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!businessId) return;
    fetch(`/api/dashboard/top-products?business_id=${businessId}&limit=10`)
      .then((r) => r.json())
      .then((res) => setData(res.topProducts || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [businessId]);
  if (loading) return <div className="text-gray-500 dark:text-gray-400 animate-pulse">Loading...</div>;
  if (!data.length) return <div className="text-gray-500 dark:text-gray-400">No product sales yet.</div>;
  return (
    <ul className="space-y-2">
      {data.map((p, i) => (
        <li key={p.id} className="flex justify-between items-center text-sm">
          <span className="text-gray-700 dark:text-gray-300 truncate flex-1">
            {i + 1}. {p.name}
          </span>
          <span className="font-medium text-gray-900 dark:text-gray-100 ml-2">
            ₹ {p.total_revenue.toLocaleString('en-IN')}
          </span>
        </li>
      ))}
    </ul>
  );
};

interface DeadStockConfig {
  stale_days?: number;
  min_qty?: number;
  include_never_sold?: boolean;
  branch_id?: string | null;
  warehouse_id?: string | null;
}

interface DeadStockApiRow {
  branch_id: string;
  branch_name: string;
  warehouse_id: string | null;
  warehouse_name: string | null;
  item_id: string;
  item_name: string;
  item_code: string | null;
  unit: string;
  quantity: number;
  purchase_price: number;
  last_sale_date: string | null;
  days_without_sale: number | null;
  inventory_value: number;
}

interface DeadStockApiResponse {
  stock_mode: 'branch' | 'warehouse';
  value_basis: string;
  stale_days: number;
  rows: DeadStockApiRow[];
  totals: { sku_count: number; total_qty: number; total_value: number };
  branches: Array<{ id: string; name: string }>;
  warehouses: Array<{ id: string; name: string; branch_id: string | null }>;
}

const STALE_DAYS_PRESETS = [30, 60, 90, 180];

const DeadStockWidget: React.FC<{
  businessId: string;
  config?: Record<string, any>;
  onConfigChange?: (next: DeadStockConfig) => void;
}> = ({ businessId, config, onConfigChange }) => {
  const initial = {
    stale_days: Number.isFinite(config?.stale_days) ? Math.max(1, Math.min(730, Number(config!.stale_days))) : 90,
    min_qty: Number.isFinite(config?.min_qty) ? Math.max(0, Number(config!.min_qty)) : 0,
    include_never_sold: config?.include_never_sold !== false,
    branch_id: (config?.branch_id ?? null) as string | null,
    warehouse_id: (config?.warehouse_id ?? null) as string | null,
  };

  const [staleDays, setStaleDays] = useState<number>(initial.stale_days);
  const [minQty, setMinQty] = useState<number>(initial.min_qty);
  const [includeNeverSold, setIncludeNeverSold] = useState<boolean>(initial.include_never_sold);
  const [branchId, setBranchId] = useState<string | null>(initial.branch_id);
  const [warehouseId, setWarehouseId] = useState<string | null>(initial.warehouse_id);
  const [data, setData] = useState<DeadStockApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      business_id: businessId,
      stale_days: String(staleDays),
      min_qty: String(minQty),
      never_sold: includeNeverSold ? 'true' : 'false',
      limit: '10',
    });
    if (branchId) params.set('branch_id', branchId);
    if (warehouseId) params.set('warehouse_id', warehouseId);

    let cancelled = false;
    fetch(`/api/dashboard/dead-stock?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || `Request failed (${r.status})`);
        }
        return r.json() as Promise<DeadStockApiResponse>;
      })
      .then((res) => {
        if (cancelled) return;
        setData(res);
        // Reset warehouse filter if warehouse mode is off or the chosen
        // warehouse is no longer available.
        if (res.stock_mode !== 'warehouse' && warehouseId) {
          setWarehouseId(null);
        } else if (warehouseId && !res.warehouses.some((w) => w.id === warehouseId)) {
          setWarehouseId(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [businessId, staleDays, minQty, includeNeverSold, branchId, warehouseId]);

  const persist = (next: DeadStockConfig) => {
    onConfigChange?.({
      stale_days: staleDays,
      min_qty: minQty,
      include_never_sold: includeNeverSold,
      branch_id: branchId,
      warehouse_id: warehouseId,
      ...next,
    });
  };

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="flex items-center gap-1">
          {STALE_DAYS_PRESETS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setStaleDays(d);
                persist({ stale_days: d });
              }}
              className={`px-2 py-1 rounded border transition-colors ${
                staleDays === d
                  ? 'bg-primary-600 text-white border-primary-600 dark:bg-primary-500 dark:border-primary-500'
                  : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              {d}d
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={730}
            value={staleDays}
            onChange={(e) => {
              const v = Math.max(1, Math.min(730, Number(e.target.value) || 0));
              setStaleDays(v);
            }}
            onBlur={() => persist({ stale_days: staleDays })}
            className="w-16 px-2 py-1 border border-gray-200 rounded text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            title="Days without sale"
          />
        </div>

        <label className="inline-flex items-center gap-1 text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={includeNeverSold}
            onChange={(e) => {
              setIncludeNeverSold(e.target.checked);
              persist({ include_never_sold: e.target.checked });
            }}
            className="rounded"
          />
          Include never-sold
        </label>

        {data && data.branches.length > 1 && (
          <select
            value={branchId || ''}
            onChange={(e) => {
              const v = e.target.value || null;
              setBranchId(v);
              persist({ branch_id: v });
            }}
            className="px-2 py-1 border border-gray-200 rounded text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            <option value="">All branches</option>
            {data.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}

        {data && data.stock_mode === 'warehouse' && data.warehouses.length > 1 && (
          <select
            value={warehouseId || ''}
            onChange={(e) => {
              const v = e.target.value || null;
              setWarehouseId(v);
              persist({ warehouse_id: v });
            }}
            className="px-2 py-1 border border-gray-200 rounded text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            <option value="">All warehouses</option>
            {data.warehouses
              .filter((w) => !branchId || w.branch_id === branchId)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
          </select>
        )}
      </div>

      {/* Summary */}
      {data && data.rows.length > 0 && (
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>{data.totals.sku_count} SKU{data.totals.sku_count === 1 ? '' : 's'} stuck</span>
          <span>Value: ₹ {data.totals.total_value.toLocaleString('en-IN')}</span>
        </div>
      )}

      {/* Body */}
      {loading && <div className="text-gray-500 dark:text-gray-400 animate-pulse text-sm">Loading...</div>}
      {!loading && error && (
        <div className="text-red-600 dark:text-red-400 text-sm">{error}</div>
      )}
      {!loading && !error && data && data.rows.length === 0 && (
        <div className="text-gray-500 dark:text-gray-400 text-sm">
          No dead stock for the current rules.
        </div>
      )}
      {!loading && !error && data && data.rows.length > 0 && (
        <ul className="space-y-2">
          {data.rows.map((row) => (
            <DeadStockRowItem
              key={`${row.branch_id}-${row.warehouse_id || 'b'}-${row.item_id}`}
              businessId={businessId}
              row={row}
            />
          ))}
        </ul>
      )}
    </div>
  );
};

interface CustomerSuggestion {
  customer_id: string;
  name: string;
  phone: string | null;
  last_purchase_date: string;
  purchase_count: number;
  match_type: 'same_item' | 'same_category';
}

/** Build a `wa.me` link. Strips non-digits and drops any leading zeros so
 *  domestic numbers without country code still produce a usable URL. */
function buildWhatsappLink(phone: string, message: string): string | null {
  const digits = phone.replace(/\D+/g, '').replace(/^0+/, '');
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

const DeadStockRowItem: React.FC<{
  businessId: string;
  row: DeadStockApiRow;
}> = ({ businessId, row }) => {
  const [expanded, setExpanded] = useState(false);
  const [suggestions, setSuggestions] = useState<CustomerSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (!next || suggestions !== null) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        business_id: businessId,
        item_id: row.item_id,
        branch_id: row.branch_id,
      });
      const res = await fetch(
        `/api/dashboard/dead-stock/suggestions?${params.toString()}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      const payload = await res.json();
      setSuggestions(payload.suggestions || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  };

  const defaultMessage = `Hi, we currently have ${row.quantity} ${row.unit} of ${row.item_name} available${
    row.last_sale_date ? '' : ' and thought you might be interested'
  }. Let us know if you'd like to place an order.`;

  return (
    <li className="text-sm">
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={toggle}
            className="text-gray-800 dark:text-gray-200 hover:underline truncate block text-left w-full"
          >
            {row.item_name}
          </button>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
            {row.quantity} {row.unit} · {row.branch_name}
            {row.warehouse_name ? ` / ${row.warehouse_name}` : ''}
            {row.last_sale_date
              ? ` · last sold ${row.days_without_sale}d ago`
              : ' · never sold'}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-medium text-gray-900 dark:text-gray-100">
            ₹ {row.inventory_value.toLocaleString('en-IN')}
          </div>
          <Link
            href={`/items/${row.item_id}`}
            className="text-[11px] text-primary-600 dark:text-primary-400 hover:underline"
          >
            View item
          </Link>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 pl-2 border-l-2 border-primary-200 dark:border-primary-800">
          {loading && (
            <div className="text-xs text-gray-500 dark:text-gray-400 animate-pulse">
              Finding likely buyers...
            </div>
          )}
          {!loading && error && (
            <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
          )}
          {!loading && !error && suggestions && suggestions.length === 0 && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              No matching customer history in the last 12 months.
            </div>
          )}
          {!loading && !error && suggestions && suggestions.length > 0 && (
            <ul className="space-y-1">
              {suggestions.map((s) => {
                const waLink = s.phone ? buildWhatsappLink(s.phone, defaultMessage) : null;
                return (
                  <li
                    key={s.customer_id}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/customers/${s.customer_id}`}
                        className="text-gray-800 dark:text-gray-200 hover:underline truncate"
                      >
                        {s.name}
                      </Link>
                      <span className="ml-1 text-[10px] text-gray-500 dark:text-gray-400">
                        ({s.match_type === 'same_item' ? 'bought this' : 'same category'})
                      </span>
                    </div>
                    {waLink ? (
                      <a
                        href={waLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-green-600 dark:text-green-400 hover:underline"
                      >
                        WhatsApp
                      </a>
                    ) : (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">
                        No phone
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  );
};
