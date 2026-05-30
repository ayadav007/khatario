'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { useDarkMode } from '@/contexts/DarkModeContext';
import { getChartPalette } from '@/lib/chartTheme';
import { useDashboardChartHeight } from '@/hooks/useDashboardChartHeight';
import { buildApiUrl } from '@/lib/api-helpers';
import {
  canStepSalesTrendForward,
  deriveSalesTrendPreset,
  formatSalesTrendNavLabel,
  stepSalesTrendRange,
} from '@/lib/dashboard/sales-trend-range';

type DashboardDateRange = { start: string; end: string; label: string };

type SalesTrendBucket = {
  key: string;
  label: string;
  sales: number;
  receipt_count: number;
};

type SalesTrendResponse = {
  granularity: 'hour' | 'day' | 'week';
  buckets: SalesTrendBucket[];
  summary: {
    receipt_count: number;
    net_sales: number;
    average_sale: number;
  };
};

export interface SalesInsightsCardProps {
  businessId: string;
  dateRange: DashboardDateRange;
}

function formatInr(amount: number): string {
  return `₹ ${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatCompactInr(value: number): string {
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

export function SalesInsightsCard({ businessId, dateRange }: SalesInsightsCardProps) {
  const router = useRouter();
  const { isDarkMode } = useDarkMode();
  const chartColors = getChartPalette(isDarkMode);
  const plotHeight = useDashboardChartHeight(160, 220);

  const preset = useMemo(
    () => deriveSalesTrendPreset(dateRange.label, dateRange.start, dateRange.end),
    [dateRange.label, dateRange.start, dateRange.end]
  );

  const [focusRange, setFocusRange] = useState({ start: dateRange.start, end: dateRange.end });
  const [data, setData] = useState<SalesTrendResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setFocusRange({ start: dateRange.start, end: dateRange.end });
  }, [dateRange.start, dateRange.end, dateRange.label]);

  const navLabel = formatSalesTrendNavLabel(preset, focusRange.start, focusRange.end);
  const canGoForward = canStepSalesTrendForward(focusRange.end);

  const chartSubtitle = useMemo(() => {
    if (!data) return '';
    if (data.granularity === 'hour') return 'Hourly sales';
    if (data.granularity === 'week') return 'Weekly sales';
    return 'Daily sales';
  }, [data]);

  const fetchData = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const url = buildApiUrl('/api/dashboard/sales-trend', {
        business_id: businessId,
        start_date: focusRange.start,
        end_date: focusRange.end,
      });
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const json = (await res.json()) as SalesTrendResponse;
        setData(json);
      } else {
        setData(null);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [businessId, focusRange.end, focusRange.start]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleStep = (direction: -1 | 1) => {
    setFocusRange((prev) => stepSalesTrendRange(preset, prev.start, prev.end, direction));
  };

  const handleBarClick = (bucket: SalesTrendBucket) => {
    if (bucket.sales <= 0) return;
    if (data?.granularity === 'hour' && preset === 'day') {
      router.push(`/invoices?date_from=${focusRange.start}&date_to=${focusRange.end}`);
      return;
    }
    if (data?.granularity === 'week') {
      const weekEnd = format(addDays(parseISO(bucket.key), 6), 'yyyy-MM-dd');
      router.push(`/invoices?date_from=${bucket.key}&date_to=${weekEnd}`);
      return;
    }
    router.push(`/invoices?date_from=${bucket.key}&date_to=${bucket.key}`);
  };

  const renderChart = () => {
    const buckets = data?.buckets ?? [];
    const hasSales = buckets.some((b) => b.sales > 0);

    if (!hasSales) {
      return (
        <div
          className="flex items-center justify-center text-sm text-text-muted"
          style={{ height: plotHeight }}
        >
          No sales in this period
        </div>
      );
    }

    const maxValue = Math.max(...buckets.map((b) => b.sales), 1);
    const width = 800;
    const height = plotHeight;
    const paddingLeft = 52;
    const paddingRight = 16;
    const paddingTop = 12;
    const paddingBottom = preset === 'day' && data?.granularity === 'hour' ? 36 : 44;
    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    const barSpacing = chartWidth / buckets.length;
    const barWidth = Math.max(4, Math.min(40, barSpacing * 0.72));
    const c = chartColors;
    const labelEvery = data?.granularity === 'hour' ? 4 : Math.max(1, Math.ceil(buckets.length / 8));

    return (
      <div className="w-full overflow-x-auto">
        <svg width={width} height={height} className="h-auto w-full" viewBox={`0 0 ${width} ${height}`}>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = paddingTop + chartHeight * (1 - ratio);
            return (
              <g key={ratio}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={width - paddingRight}
                  y2={y}
                  stroke={c.grid}
                  strokeWidth="1"
                />
                <text
                  x={paddingLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill={c.axis}
                >
                  {formatCompactInr(maxValue * ratio)}
                </text>
              </g>
            );
          })}

          {buckets.map((bucket, i) => {
            const salesValue = Number(bucket.sales) || 0;
            const x = paddingLeft + i * barSpacing + (barSpacing - barWidth) / 2;
            const barH =
              maxValue > 0 ? Math.max(salesValue > 0 ? 2 : 0, (salesValue / maxValue) * chartHeight) : 0;
            const y = paddingTop + chartHeight - barH;
            const showLabel = i % labelEvery === 0 || i === buckets.length - 1;

            return (
              <g key={bucket.key}>
                {salesValue > 0 && (
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barH}
                    rx={2}
                    fill="#22c55e"
                    className="cursor-pointer opacity-90 hover:opacity-100"
                    onClick={() => handleBarClick(bucket)}
                  >
                    <title>
                      {bucket.label}: {formatInr(salesValue)} ({bucket.receipt_count} receipts)
                    </title>
                  </rect>
                )}
                {showLabel && (
                  <text
                    x={x + barWidth / 2}
                    y={height - 10}
                    textAnchor="middle"
                    fontSize="9"
                    fill={c.axis}
                  >
                    {data?.granularity === 'hour' ? bucket.label.replace(' ', '') : bucket.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  const summary = data?.summary;

  return (
    <Card padding="sm" className="border border-border md:!p-5">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <TrendingUp className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-primary md:text-base">Sales insights</h2>
            <p className="text-[11px] text-text-secondary md:text-xs">{chartSubtitle}</p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-1 sm:justify-end">
          <button
            type="button"
            onClick={() => handleStep(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors hover:bg-gray-50 dark:hover:bg-slate-800"
            aria-label="Previous period"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="min-w-[9rem] px-2 text-center text-sm font-medium text-text-primary md:min-w-[11rem] md:text-base">
            {navLabel}
          </span>
          <button
            type="button"
            onClick={() => handleStep(1)}
            disabled={!canGoForward}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-slate-800"
            aria-label="Next period"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center md:h-52">
          <div className="h-7 w-7 animate-spin rounded-full border-b-2 border-primary-500 md:h-8 md:w-8" />
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-2 border-y border-border py-3 md:gap-4 md:py-4">
            <SummaryStat
              label="Receipts"
              value={String(summary?.receipt_count ?? 0)}
              hint="Final invoices"
            />
            <SummaryStat
              label="Net sales"
              value={formatInr(summary?.net_sales ?? 0)}
              hint="Incl. GST"
              prominent
            />
            <SummaryStat
              label="Avg sale"
              value={formatInr(summary?.average_sale ?? 0)}
              hint="Per receipt"
            />
          </div>

          <div className="border-t border-border pt-2 md:pt-3">{renderChart()}</div>
        </>
      )}
    </Card>
  );
}

function SummaryStat({
  label,
  value,
  hint,
  prominent = false,
}: {
  label: string;
  value: string;
  hint: string;
  prominent?: boolean;
}) {
  return (
    <div className="text-center">
      <p className="text-[10px] font-medium uppercase tracking-wide text-text-secondary md:text-[11px]">
        {label}
      </p>
      <p
        className={`mt-0.5 truncate text-sm font-bold md:text-lg ${
          prominent ? 'text-gray-900 dark:text-gray-100' : 'text-text-primary'
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 hidden text-[10px] text-text-muted sm:block">{hint}</p>
    </div>
  );
}
